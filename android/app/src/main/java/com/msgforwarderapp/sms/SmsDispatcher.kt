package com.msgforwarderapp.sms

import android.content.Context
import android.util.Log
import com.tencent.mmkv.MMKV
import java.io.IOException
import java.util.Locale
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
 * Reads routes from the same encrypted MMKV instance that JS writes to.
 */
object SmsDispatcher {
  private const val TAG = "OtpRouter.Dispatch"
  private const val STORAGE_ID = "msg-forwarder-storage"
  private const val KEY_ROUTES = "app_routes"
  private const val TELEGRAM_API_BASE = "https://api.telegram.org"

  @Volatile private var mmkvInitialized = false

  private val executor = Executors.newSingleThreadExecutor()
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
    val routes = loadRoutes(context) ?: return
    if (routes.length() == 0) {
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
      val botToken = route.optString("telegramBotToken").trim()
      val chatId = route.optString("telegramChatId").trim()
      if (botToken.isEmpty() || chatId.isEmpty()) {
        Log.w(TAG, "Route ${route.optString("id")} missing token or chat id; skipping")
        continue
      }

      val text = buildTelegramText(route, sender, message)
      try {
        postToTelegram(botToken, chatId, text)
      } catch (e: IOException) {
        Log.e(TAG, "Telegram POST failed for route ${route.optString("id")}", e)
      }
    }

    if (!matchedAny) {
      Log.i(TAG, "SMS from $sender matched no route")
    }
  }

  private fun loadRoutes(context: Context): JSONArray? {
    return try {
      ensureMmkv(context)
      val key = SecureStore.getMmkvPassphrase(context)
      val mmkv = MMKV.mmkvWithID(STORAGE_ID, MMKV.SINGLE_PROCESS_MODE, key) ?: return null
      val raw = mmkv.decodeString(KEY_ROUTES) ?: return JSONArray()
      JSONArray(raw)
    } catch (t: Throwable) {
      Log.e(TAG, "Unable to read routes from MMKV", t)
      null
    }
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
        Log.w(TAG, "Telegram responded ${response.code}: ${response.body?.string()?.take(200)}")
      }
    }
  }
}
