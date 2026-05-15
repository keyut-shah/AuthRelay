package com.msgforwarderapp.sms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import com.facebook.react.ReactApplication

class SmsBroadcastReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) {
      return
    }

    val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
    if (messages.isEmpty()) {
      return
    }

    val body = messages.joinToString(separator = "") { sms -> sms.messageBody.orEmpty() }
    val sender = messages.firstOrNull()?.displayOriginatingAddress.orEmpty()

    // 1. Native dispatch always runs — does not depend on the JS bundle being alive.
    //    goAsync() keeps the receiver alive while we do the HTTPS POST on a worker thread.
    val pendingResult = goAsync()
    SmsDispatcher.dispatchAsync(context, sender, body) {
      pendingResult.finish()
    }

    // 2. Best-effort: also emit to JS for live UI updates if the app is open.
    val application = context.applicationContext as? ReactApplication ?: return
    val reactContext = application.reactHost?.currentReactContext ?: return
    val nativeModule = reactContext.getNativeModule(SmsRouterModule::class.java) ?: return
    nativeModule.emitIncomingSms(sender = sender, message = body)
  }
}
