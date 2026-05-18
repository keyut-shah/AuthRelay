package com.msgforwarderapp.sms

import android.content.Context
import android.util.Log
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.msgforwarderapp.sms.integrations.AdapterRegistry
import com.msgforwarderapp.sms.integrations.DeliveryPayload
import com.msgforwarderapp.sms.integrations.Destination
import com.msgforwarderapp.sms.integrations.DestinationProvider
import com.msgforwarderapp.sms.integrations.Rule
import com.tencent.mmkv.MMKV
import java.util.Locale
import java.util.UUID
import java.util.concurrent.Executors
import org.json.JSONArray
import org.json.JSONObject

/**
 * Forwards an incoming SMS directly from native code so routing keeps
 * working when the JS bundle is not running (app swiped from recents,
 * cold-start through the SMS broadcast, etc.).
 *
 * Reads destinations + rules from the same encrypted MMKV instance that
 * JS writes to, and writes ProcessedMessageEvent records back so the
 * History screen can render dispatch outcomes.
 */
object SmsDispatcher {
  private const val TAG = "OtpRouter.Dispatch"
  private const val STORAGE_ID = "msg-forwarder-storage"
  private const val KEY_DESTINATIONS = "app_destinations"
  private const val KEY_RULES = "app_rules"
  private const val KEY_EVENTS = "app_events"
  private const val EVENT_HISTORY_CAP = 200
  private const val EVENT_HISTORY_UPDATED = "otpRouter:eventHistoryUpdated"

  @Volatile private var mmkvInitialized = false

  private val executor = Executors.newSingleThreadExecutor()
  private val eventLock = Any()

  fun dispatchAsync(context: Context, sender: String, message: String, onDone: (() -> Unit)? = null) {
    val appContext = context.applicationContext
    executor.execute {
      try {
        dispatchInternal(appContext, sender, message)
      } catch (t: Throwable) {
        Log.e(TAG, "Dispatch failed", t)
      } finally {
        onDone?.invoke()
      }
    }
  }

  private fun dispatchInternal(context: Context, sender: String, message: String) {
    val otp = OtpExtractor.extract(message)

    // Gate: nothing in the message looks like an OTP. Don't forward, but log
    // an "ignored" event so the History screen can show what was filtered.
    if (otp.code == null) {
      logEvent(
          context,
          sender = sender,
          status = "ignored",
          maskedCode = null,
          matchedRuleId = null,
          matchedTeamName = null,
          destinationName = null,
          reason = "no_otp_detected",
      )
      Log.i(TAG, "SMS from $sender contains no OTP-like code; ignoring")
      return
    }

    val destinations = loadDestinations(context)
    val rules = loadRules(context)

    if (rules.isEmpty()) {
      logEvent(
          context,
          sender = sender,
          status = "ignored",
          maskedCode = otp.maskedCode,
          matchedRuleId = null,
          matchedTeamName = null,
          destinationName = null,
          reason = "no_routes_configured",
      )
      Log.i(TAG, "No rules configured; ignoring SMS from $sender")
      return
    }

    val destinationsById = destinations.associateBy { it.id }
    val normalizedSender = sender.trim().lowercase(Locale.ROOT)
    var matchedAny = false

    for (rule in rules) {
      if (!ruleMatches(rule, normalizedSender)) continue
      matchedAny = true

      val destination = destinationsById[rule.destinationId]
      if (destination == null) {
        Log.w(TAG, "Rule ${rule.id} references missing destination ${rule.destinationId}")
        logEvent(
            context,
            sender = sender,
            status = "failed",
            maskedCode = otp.maskedCode,
            matchedRuleId = rule.id,
            matchedTeamName = rule.teamName,
            destinationName = null,
            reason = "destination_missing",
        )
        continue
      }

      val adapter = AdapterRegistry.adapterFor(destination.provider)
      val payload =
          DeliveryPayload(
              sender = sender,
              rawMessage = message,
              maskedCode = otp.maskedCode,
              rule = rule,
              destination = destination,
          )

      try {
        adapter.send(payload)
        logEvent(
            context,
            sender = sender,
            status = "sent",
            maskedCode = otp.maskedCode,
            matchedRuleId = rule.id,
            matchedTeamName = rule.teamName,
            destinationName = destination.name,
            reason = null,
        )
      } catch (t: Throwable) {
        Log.e(TAG, "Adapter ${destination.provider::class.simpleName} failed for rule ${rule.id}", t)
        logEvent(
            context,
            sender = sender,
            status = "failed",
            maskedCode = otp.maskedCode,
            matchedRuleId = rule.id,
            matchedTeamName = rule.teamName,
            destinationName = destination.name,
            reason = t.message ?: "delivery_error",
        )
      }
    }

    if (!matchedAny) {
      logEvent(
          context,
          sender = sender,
          status = "ignored",
          maskedCode = otp.maskedCode,
          matchedRuleId = null,
          matchedTeamName = null,
          destinationName = null,
          reason = "no_route_matched",
      )
      Log.i(TAG, "SMS from $sender matched no route")
    }
  }

  private fun ruleMatches(rule: Rule, normalizedSender: String): Boolean {
    if (!rule.enabled) return false
    val pattern = rule.senderPattern.trim().lowercase(Locale.ROOT)
    if (pattern.isEmpty()) return false
    return when (rule.senderMatchMode) {
      "contains" -> normalizedSender.contains(pattern)
      else -> false
    }
  }

  // ───────────────────────────────────────────────────────────
  // Storage reads
  // ───────────────────────────────────────────────────────────

  private fun loadDestinations(context: Context): List<Destination> {
    val mmkv = openMmkv(context) ?: return emptyList()
    val raw = mmkv.decodeString(KEY_DESTINATIONS) ?: return emptyList()
    return try {
      parseDestinationsArray(JSONArray(raw))
    } catch (t: Throwable) {
      Log.e(TAG, "Failed to parse destinations", t)
      emptyList()
    }
  }

  private fun parseDestinationsArray(array: JSONArray): List<Destination> {
    val out = mutableListOf<Destination>()
    for (i in 0 until array.length()) {
      val obj = array.optJSONObject(i) ?: continue
      val id = obj.optString("id")
      if (id.isEmpty()) continue
      val name = obj.optString("name")
      val providerObj = obj.optJSONObject("provider") ?: continue
      val provider =
          when (providerObj.optString("type")) {
            "telegram" -> {
              val botToken = providerObj.optString("botToken")
              val chatId = providerObj.optString("chatId")
              if (botToken.isEmpty() || chatId.isEmpty()) continue
              DestinationProvider.Telegram(botToken, chatId)
            }
            else -> continue
          }
      out.add(Destination(id = id, name = name, provider = provider))
    }
    return out
  }

  private fun loadRules(context: Context): List<Rule> {
    val mmkv = openMmkv(context) ?: return emptyList()
    val raw = mmkv.decodeString(KEY_RULES) ?: return emptyList()
    return try {
      parseRulesArray(JSONArray(raw))
    } catch (t: Throwable) {
      Log.e(TAG, "Failed to parse rules", t)
      emptyList()
    }
  }

  private fun parseRulesArray(array: JSONArray): List<Rule> {
    val out = mutableListOf<Rule>()
    for (i in 0 until array.length()) {
      val obj = array.optJSONObject(i) ?: continue
      val id = obj.optString("id")
      if (id.isEmpty()) continue
      val destinationId = obj.optString("destinationId")
      if (destinationId.isEmpty()) continue
      out.add(
          Rule(
              id = id,
              enabled = obj.optBoolean("enabled", true),
              teamName = obj.optString("teamName"),
              senderPattern = obj.optString("senderPattern"),
              senderMatchMode = obj.optString("senderMatchMode", "contains"),
              destinationId = destinationId,
          ),
      )
    }
    return out
  }

  // ───────────────────────────────────────────────────────────
  // Event log
  // ───────────────────────────────────────────────────────────

  private fun logEvent(
      context: Context,
      sender: String,
      status: String,
      maskedCode: String?,
      matchedRuleId: String?,
      matchedTeamName: String?,
      destinationName: String?,
      reason: String?,
  ) {
    val event =
        JSONObject().apply {
          put("id", "evt_${System.currentTimeMillis()}_${UUID.randomUUID().toString().take(8)}")
          put("createdAt", System.currentTimeMillis())
          put("sender", sender)
          put("status", status)
          if (maskedCode != null) put("maskedCode", maskedCode) else put("maskedCode", JSONObject.NULL)
          if (matchedRuleId != null) put("matchedRuleId", matchedRuleId)
          if (matchedTeamName != null) put("matchedTeamName", matchedTeamName)
          if (destinationName != null) put("destinationName", destinationName)
          if (reason != null) put("reason", reason)
        }

    persistEvent(context, event)
    emitEventHistoryUpdated(context)
  }

  private fun persistEvent(context: Context, event: JSONObject) {
    synchronized(eventLock) {
      try {
        val mmkv = openMmkv(context) ?: return
        val raw = mmkv.decodeString(KEY_EVENTS)
        val existing = if (raw.isNullOrEmpty()) JSONArray() else JSONArray(raw)
        val combined = JSONArray()
        combined.put(event)
        val limit = minOf(existing.length(), EVENT_HISTORY_CAP - 1)
        for (i in 0 until limit) {
          combined.put(existing.get(i))
        }
        mmkv.encode(KEY_EVENTS, combined.toString())
      } catch (t: Throwable) {
        Log.e(TAG, "Failed to persist event", t)
      }
    }
  }

  private fun emitEventHistoryUpdated(context: Context) {
    try {
      val application = context.applicationContext as? ReactApplication ?: return
      val reactContext = application.reactHost?.currentReactContext ?: return
      if (!reactContext.hasActiveReactInstance()) return
      reactContext
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(EVENT_HISTORY_UPDATED, Arguments.createMap())
    } catch (t: Throwable) {
      Log.d(TAG, "emitEventHistoryUpdated skipped: ${t.message}")
    }
  }

  // ───────────────────────────────────────────────────────────
  // MMKV
  // ───────────────────────────────────────────────────────────

  private fun openMmkv(context: Context): MMKV? {
    ensureMmkv(context)
    val key = SecureStore.getMmkvPassphrase(context)
    return MMKV.mmkvWithID(STORAGE_ID, MMKV.SINGLE_PROCESS_MODE, key)
  }

  private fun ensureMmkv(context: Context) {
    if (mmkvInitialized) return
    synchronized(this) {
      if (mmkvInitialized) return
      MMKV.initialize(context.applicationContext)
      mmkvInitialized = true
    }
  }
}
