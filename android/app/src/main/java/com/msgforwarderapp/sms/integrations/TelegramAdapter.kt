package com.msgforwarderapp.sms.integrations

import android.util.Log
import java.io.IOException
import java.util.Locale
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
    val routeName = payload.rule.routeName.ifEmpty { "Route" }
    return buildString {
      append("AuthRelay OTP for ")
      append(routeName)
      append('\n')
      append('\n')
      append("Sender: ")
      append(payload.sender)
      append('\n')
      append("Route: ")
      append(routeName)
      append('\n')
      append("Sender rule: ")
      append(describeSenderRule(payload.rule))
      append('\n')
      append("Destination: ")
      append(payload.destination.name)
      append('\n')
      append('\n')
      append(payload.rawMessage)
    }
  }

  private fun describeSenderRule(rule: Rule): String {
    return if (rule.senderSourceType == "contact") {
      val contactName = rule.contactDisplayName?.ifEmpty { "Saved contact" } ?: "Saved contact"
      "$contactName (${rule.contactPhoneNumbers.size} number${if (rule.contactPhoneNumbers.size == 1) "" else "s"})"
    } else {
      rule.senderPattern.ifEmpty { "Unknown sender" }
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
