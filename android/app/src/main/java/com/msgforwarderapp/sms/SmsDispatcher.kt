package com.msgforwarderapp.sms

import android.content.Context
import android.util.Log
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.tencent.mmkv.MMKV
import java.io.IOException
import java.util.Locale
import java.util.UUID
import java.util.concurrent.Executors
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

/**
 * Forwards an incoming SMS directly from native code, so routing keeps
 * working when the JS bundle is not running (app swiped from recents,
 * cold-start through the SMS broadcast, etc.).
 *
 * Reads routes from the same encrypted MMKV instance that JS writes to,
 * and writes ProcessedMessageEvent records back to the same store so
 * the History screen can render dispatch outcomes.
 */
object SmsDispatcher {
  private const val TAG = "OtpRouter.Dispatch"
  private const val STORAGE_ID = "msg-forwarder-storage"
  private const val KEY_ROUTES = "app_routes"
  private const val KEY_EVENTS = "app_events"
  private const val EVENT_HISTORY_CAP = 200
  private const val TELEGRAM_API_BASE = "https://api.telegram.org"
  private const val EVENT_HISTORY_UPDATED = "otpRouter:eventHistoryUpdated"

  @Volatile private var mmkvInitialized = false

  private val executor = Executors.newSingleThreadExecutor()
  private val eventLock = Any()
  private val httpClient by lazy { OkHttpClient() }
  private val jsonMediaType by lazy { "application/json; charset=utf-8".toMediaType() }

  /** Schedule an SMS dispatch off the main thread. Safe to call from a BroadcastReceiver. */
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

    // Gate 1: nothing in the message looks like an OTP. Don't forward — this
    // is the privacy safety net so marketing texts from whitelisted senders
    // don't leak to Telegram. We still log an "ignored" event for transparency.
    if (otp.code == null) {
      logEvent(
          context,
          sender = sender,
          status = "ignored",
          maskedCode = null,
          matchedRouteId = null,
          matchedTeamName = null,
          destinationName = null,
          reason = "no_otp_detected",
      )
      Log.i(TAG, "SMS from $sender contains no OTP-like code; ignoring")
      return
    }

    val routes = loadRoutes(context)
    if (routes == null || routes.length() == 0) {
      logEvent(
          context,
          sender = sender,
          status = "ignored",
          maskedCode = otp.maskedCode,
          matchedRouteId = null,
          matchedTeamName = null,
          destinationName = null,
          reason = "no_routes_configured",
      )
      Log.i(TAG, "No routes configured; ignoring SMS from $sender")
      return
    }

    val normalizedSender = sender.trim().lowercase(Locale.ROOT)
    var matchedAny = false

    for (i in 0 until routes.length()) {
      val route = routes.optJSONObject(i) ?: continue
      val filter = route.optString("senderFilter").trim().lowercase(Locale.ROOT)
      if (filter.isEmpty()) {
        // Whitelist-only: skip routes with no filter. Mirror of JS doesRouteMatchSender.
        continue
      }
      if (!normalizedSender.contains(filter)) {
        continue
      }

      matchedAny = true
      val routeId = route.optString("id")
      val teamName = route.optString("teamName")
      val destinationName = route.optString("telegramName")
      val botToken = route.optString("telegramBotToken").trim()
      val chatId = route.optString("telegramChatId").trim()

      if (botToken.isEmpty() || chatId.isEmpty()) {
        Log.w(TAG, "Route $routeId missing token or chat id; skipping")
        logEvent(
            context,
            sender = sender,
            status = "failed",
            maskedCode = otp.maskedCode,
            matchedRouteId = routeId,
            matchedTeamName = teamName,
            destinationName = destinationName,
            reason = "missing_credentials",
        )
        continue
      }

      val text = buildTelegramText(route, sender, message)
      try {
        postToTelegram(botToken, chatId, text)
        logEvent(
            context,
            sender = sender,
            status = "sent",
            maskedCode = otp.maskedCode,
            matchedRouteId = routeId,
            matchedTeamName = teamName,
            destinationName = destinationName,
            reason = null,
        )
      } catch (e: IOException) {
        Log.e(TAG, "Telegram POST failed for route $routeId", e)
        logEvent(
            context,
            sender = sender,
            status = "failed",
            maskedCode = otp.maskedCode,
            matchedRouteId = routeId,
            matchedTeamName = teamName,
            destinationName = destinationName,
            reason = e.message ?: "network_error",
        )
      }
    }

    if (!matchedAny) {
      logEvent(
          context,
          sender = sender,
          status = "ignored",
          maskedCode = otp.maskedCode,
          matchedRouteId = null,
          matchedTeamName = null,
          destinationName = null,
          reason = "no_route_matched",
      )
      Log.i(TAG, "SMS from $sender matched no route")
    }
  }

  private fun loadRoutes(context: Context): JSONArray? {
    return try {
      val mmkv = openMmkv(context) ?: return null
      val raw = mmkv.decodeString(KEY_ROUTES) ?: return JSONArray()
      JSONArray(raw)
    } catch (t: Throwable) {
      Log.e(TAG, "Unable to read routes from MMKV", t)
      null
    }
  }

  private fun logEvent(
      context: Context,
      sender: String,
      status: String,
      maskedCode: String?,
      matchedRouteId: String?,
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
          // null is stored explicitly so the JS shape stays consistent
          if (maskedCode != null) put("maskedCode", maskedCode) else put("maskedCode", JSONObject.NULL)
          if (matchedRouteId != null) put("matchedRouteId", matchedRouteId)
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
        // Newest-first, cap at EVENT_HISTORY_CAP.
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
      // Best effort — JS may not be running; the History screen will pick up
      // the new event from MMKV on next mount / appstate change.
      Log.d(TAG, "emitEventHistoryUpdated skipped: ${t.message}")
    }
  }

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

  private fun buildTelegramText(route: JSONObject, sender: String, message: String): String {
    val team = route.optString("teamName").ifEmpty { "Ops" }
    val destination = route.optString("telegramName").ifEmpty { "Telegram" }
    val filter = route.optString("senderFilter")
    return buildString {
      append("AuthRelay OTP for ")
      append(team)
      append('\n')
      append('\n')
      append("Sender: ")
      append(sender)
      append('\n')
      append("Route filter: ")
      append(filter)
      append('\n')
      append("Destination: ")
      append(destination)
      append('\n')
      append('\n')
      append(message)
    }
  }

  private fun postToTelegram(botToken: String, chatId: String, text: String) {
    val url = "$TELEGRAM_API_BASE/bot$botToken/sendMessage"
    val payload = JSONObject().apply {
      put("chat_id", chatId)
      put("text", text)
    }
    val body = payload.toString().toRequestBody(jsonMediaType)
    val request = Request.Builder().url(url).post(body).build()
    httpClient.newCall(request).execute().use { response ->
      if (!response.isSuccessful) {
        val snippet = response.body?.string()?.take(200)
        Log.w(TAG, "Telegram responded ${response.code}: $snippet")
        throw IOException("Telegram HTTP ${response.code}")
      }
    }
  }
}
