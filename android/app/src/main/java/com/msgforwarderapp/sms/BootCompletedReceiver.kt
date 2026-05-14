package com.msgforwarderapp.sms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

class BootCompletedReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
      Log.i("OtpRouter", "Boot completed. Future step: restore listener health checks.")
    }
  }
}
