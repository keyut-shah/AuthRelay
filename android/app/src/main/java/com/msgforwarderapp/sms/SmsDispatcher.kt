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
import java.util.regex.Pattern
import java.util.regex.PatternSyntaxException
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
    // OTP extraction always runs — the masked code is recorded in history
    // even for non-OTP rules. The actual OTP *gate* is now per-rule (see
    // rule.requireOtp) so general-forwarder rules work.
    val otp = OtpExtractor.extract(message)

    val destinations = loadDestinations(context)
    val rules = loadRules(context)

    if (rules.isEmpty()) {
      logEvent(
          context = context,
          sender = sender,
          status = "ignored",
          maskedCode = otp.maskedCode,
          matchedRuleId = null,
          matchedRouteName = null,
          destinationName = null,
          reason = "no_routes_configured",
      )
      Log.i(TAG, "No rules configured; ignoring SMS from $sender")
      return
    }

    val destinationsById = destinations.associateBy { it.id }
    var matchedAny = false

    for (rule in rules) {
      if (!ruleMatches(rule, sender, message)) continue
      matchedAny = true

      val destination = destinationsById[rule.destinationId]
      if (destination == null) {
        Log.w(TAG, "Rule ${rule.id} references missing destination ${rule.destinationId}")
        logEvent(
            context = context,
            sender = sender,
            status = "failed",
            maskedCode = otp.maskedCode,
            matchedRuleId = rule.id,
            matchedRouteName = rule.routeName,
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
            context = context,
            sender = sender,
            status = "sent",
            maskedCode = otp.maskedCode,
            matchedRuleId = rule.id,
            matchedRouteName = rule.routeName,
            destinationName = destination.name,
            reason = null,
        )
      } catch (t: Throwable) {
        Log.e(TAG, "Adapter ${destination.provider::class.simpleName} failed for rule ${rule.id}", t)
        logEvent(
            context = context,
            sender = sender,
            status = "failed",
            maskedCode = otp.maskedCode,
            matchedRuleId = rule.id,
            matchedRouteName = rule.routeName,
            destinationName = destination.name,
            reason = t.message ?: "delivery_error",
        )
      }
    }

    if (!matchedAny) {
      logEvent(
          context = context,
          sender = sender,
          status = "ignored",
          maskedCode = otp.maskedCode,
          matchedRuleId = null,
          matchedRouteName = null,
          destinationName = null,
          reason = "no_route_matched",
      )
      Log.i(TAG, "SMS from $sender matched no route")
    }
  }

  private fun ruleMatches(rule: Rule, sender: String, message: String): Boolean {
    if (!rule.enabled) return false
    if (!doesRuleOtpGatePass(rule, message)) return false
    return doesRuleMatchSender(rule, sender) && doesRuleMatchMessage(rule, message)
  }

  private fun doesRuleOtpGatePass(rule: Rule, message: String): Boolean {
    if (!rule.requireOtp) return true
    return OtpExtractor.extract(message).code != null
  }

  private fun doesRuleMatchSender(rule: Rule, sender: String): Boolean {
    return when (rule.senderSourceType) {
      "any" -> true
      "contact" -> rule.contactPhoneNumbers.any { phoneNumbersMatch(it, sender) }
      else -> {
        // sender_id mode: comma-separated entries, any match wins. Each
        // entry is auto-detected as phone-shaped (digit-normalized) or
        // brand/text (case-insensitive substring).
        val entries = parseSenderList(rule.senderPattern)
        if (entries.isEmpty()) return false
        entries.any { doesSenderEntryMatch(it, sender) }
      }
    }
  }

  private fun parseSenderList(input: String): List<String> =
      input.split(',').map { it.trim() }.filter { it.isNotEmpty() }

  private fun doesSenderEntryMatch(entry: String, sender: String): Boolean {
    val trimmed = entry.trim()
    if (trimmed.isEmpty()) return false

    val digits = normalizePhoneNumber(trimmed)
    if (digits.length >= 7) {
      return phoneNumbersMatch(trimmed, sender)
    }

    return sender.trim().lowercase(Locale.ROOT).contains(trimmed.lowercase(Locale.ROOT))
  }

  private fun doesRuleMatchMessage(rule: Rule, message: String): Boolean {
    val normalizedMessage = message.trim().lowercase(Locale.ROOT)
    if (normalizedMessage.isEmpty()) {
      // Defensive: only forward an empty message when the rule has no
      // content filters at all. Real SMS payloads are essentially never
      // empty, so this branch mostly guards against carrier oddities.
      return rule.messageAllowPatterns.isEmpty() && rule.messageBlockPatterns.isEmpty()
    }

    if (rule.messageAllowPatterns.isNotEmpty()) {
      val hasAllowMatch =
          rule.messageAllowPatterns.any { pattern ->
            phraseMatches(pattern, normalizedMessage, rule.matchMode)
          }
      if (!hasAllowMatch) return false
    }

    val hasBlockedPattern =
        rule.messageBlockPatterns.any { pattern ->
          phraseMatches(pattern, normalizedMessage, rule.matchMode)
        }
    if (hasBlockedPattern) return false

    return true
  }

  /**
   * Apply a single allow/block phrase using the rule's match mode.
   * Invalid regex patterns are swallowed silently — we never want to crash
   * the dispatcher because of a user-typed regex.
   */
  private fun phraseMatches(pattern: String, normalizedMessage: String, mode: String): Boolean {
    val trimmed = pattern.trim()
    if (trimmed.isEmpty()) return false
    return try {
      when (mode) {
        "regex" -> Pattern.compile(trimmed, Pattern.CASE_INSENSITIVE).matcher(normalizedMessage).find()
        "whole_word" ->
            Pattern.compile(
                    "\\b" + Pattern.quote(trimmed) + "\\b",
                    Pattern.CASE_INSENSITIVE,
                )
                .matcher(normalizedMessage)
                .find()
        else -> normalizedMessage.contains(trimmed.lowercase(Locale.ROOT))
      }
    } catch (_: PatternSyntaxException) {
      false
    }
  }

  private fun phoneNumbersMatch(left: String, right: String): Boolean {
    val normalizedLeft = normalizePhoneNumber(left)
    val normalizedRight = normalizePhoneNumber(right)
    if (normalizedLeft.isEmpty() || normalizedRight.isEmpty()) return false
    if (normalizedLeft == normalizedRight) return true

    val shorter = if (normalizedLeft.length <= normalizedRight.length) normalizedLeft else normalizedRight
    val longer = if (normalizedLeft.length > normalizedRight.length) normalizedLeft else normalizedRight
    return shorter.length >= 7 && longer.endsWith(shorter)
  }

  private fun normalizePhoneNumber(value: String): String {
    return value.filter { it.isDigit() }
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
      val rawName = obj.optString("name")
      val name =
          if (rawName.isNotEmpty()) {
            rawName
          } else {
            when (provider) {
              is DestinationProvider.Telegram -> buildTelegramDestinationName(provider.chatId)
            }
          }
      out.add(Destination(id = id, name = name, provider = provider))
    }
    return out
  }

  private fun buildTelegramDestinationName(chatId: String): String {
    val trimmed = chatId.trim()
    if (trimmed.isEmpty()) return "Telegram destination"
    if (trimmed.startsWith("@")) return "Telegram $trimmed"
    val suffix = if (trimmed.length > 6) trimmed.takeLast(6) else trimmed
    return "Telegram chat $suffix"
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
      val contactPhones = jsonArrayToStringList(obj.optJSONArray("contactPhoneNumbers"))
      val allowPatterns = jsonArrayToStringList(obj.optJSONArray("messageAllowPatterns"))
      val blockPatterns = jsonArrayToStringList(obj.optJSONArray("messageBlockPatterns"))
      // Phase A: requireOtp + matchMode are new — older saved rows are missing
      // them. Default to legacy behavior (OTP required, plain `contains`).
      val requireOtp = if (obj.has("requireOtp")) obj.optBoolean("requireOtp", true) else true
      val matchMode = obj.optString("matchMode").ifEmpty { "contains" }
      out.add(
          Rule(
              id = id,
              enabled = obj.optBoolean("enabled", true),
              routeName = obj.optString("routeName").ifEmpty { obj.optString("teamName", "Route") },
              senderSourceType = obj.optString("senderSourceType", "sender_id"),
              senderPattern = obj.optString("senderPattern"),
              contactDisplayName = obj.optString("contactDisplayName").ifEmpty { null },
              contactPhoneNumbers = contactPhones,
              requireOtp = requireOtp,
              matchMode = matchMode,
              messageAllowPatterns = allowPatterns,
              messageBlockPatterns = blockPatterns,
              destinationId = destinationId,
          ),
      )
    }
    return out
  }

  private fun jsonArrayToStringList(array: JSONArray?): List<String> {
    if (array == null) return emptyList()
    val out = mutableListOf<String>()
    for (i in 0 until array.length()) {
      val value = array.optString(i).trim()
      if (value.isNotEmpty()) out.add(value)
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
      matchedRouteName: String?,
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
          if (matchedRouteName != null) put("matchedRouteName", matchedRouteName)
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
