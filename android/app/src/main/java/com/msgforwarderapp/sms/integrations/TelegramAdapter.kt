package com.msgforwarderapp.sms.integrations

import android.util.Log
import java.io.IOException
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

/**
 * Telegram bot integration. Mirrors src/services/integrations/telegram.ts.
 *
 * Single shared OkHttpClient — adapters live for the lifetime of the process.
 */
class TelegramAdapter(
    private val httpClient: OkHttpClient = OkHttpClient(),
) : IntegrationAdapter {

  override fun send(payload: DeliveryPayload) {
    val provider = payload.destination.provider as? DestinationProvider.Telegram
        ?: throw IllegalArgumentException(
            "TelegramAdapter received non-telegram provider: ${payload.destination.provider}",
        )
    val text = buildOtpText(payload)
    postSendMessage(provider.botToken, provider.chatId, text)
  }

  private fun buildOtpText(payload: DeliveryPayload): String {
    val team = payload.rule.teamName.ifEmpty { "Ops" }
    return buildString {
      append("AuthRelay OTP for ")
      append(team)
      append('\n')
      append('\n')
      append("Sender: ")
      append(payload.sender)
      append('\n')
      append("Route filter: ")
      append(payload.rule.senderPattern)
      append('\n')
      append("Destination: ")
      append(payload.destination.name)
      append('\n')
      append('\n')
      append(payload.rawMessage)
    }
  }

  private fun postSendMessage(botToken: String, chatId: String, text: String) {
    val url = "$TELEGRAM_API_BASE/bot$botToken/sendMessage"
    val payload = JSONObject().apply {
      put("chat_id", chatId)
      put("text", text)
    }
    val body = payload.toString().toRequestBody(JSON_MEDIA_TYPE)
    val request = Request.Builder().url(url).post(body).build()
    httpClient.newCall(request).execute().use { response ->
      if (!response.isSuccessful) {
        val snippet = response.body?.string()?.take(200)
        Log.w(TAG, "Telegram responded ${response.code}: $snippet")
        throw IOException("Telegram HTTP ${response.code}")
      }
    }
  }

  companion object {
    private const val TAG = "OtpRouter.Telegram"
    private const val TELEGRAM_API_BASE = "https://api.telegram.org"
    private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
  }
}
