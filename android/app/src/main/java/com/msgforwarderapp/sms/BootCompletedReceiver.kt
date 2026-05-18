package com.msgforwarderapp.sms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.tencent.mmkv.MMKV

/**
 * Runs after device reboot (and after a package replace / quick-boot on some
 * OEMs). Our job here is small but important:
 *
 *  1. Record the boot timestamp so the UI can show "Listener restored after
 *     reboot at <time>". This is the operator's signal that the listener
 *     came back online without them needing to open the app.
 *  2. Pre-warm the Keystore + MMKV. The very next SMS may arrive within
 *     seconds; we don't want the first dispatch to pay the cold-start cost
 *     for keystore unlock + MMKV mmap.
 *
 * Note: SmsBroadcastReceiver is declared statically in the manifest, so it
 * gets re-registered automatically by the OS on boot. We do NOT need to do
 * anything to "re-attach" it.
 */
class BootCompletedReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED) return

    val pendingResult = goAsync()
    Thread {
      try {
        ListenerState.setBootRestoredAt(context, System.currentTimeMillis())

        // Pre-warm encryption key + MMKV so the first post-boot SMS doesn't
        // pay the cold start cost.
        runCatching {
          SecureStore.getMmkvPassphrase(context)
          MMKV.initialize(context.applicationContext)
          Log.i(TAG, "Boot recovery: listener state warmed.")
        }.onFailure { Log.w(TAG, "Boot warm-up failed", it) }
      } finally {
        pendingResult.finish()
      }
    }.start()
  }

  companion object {
    private const val TAG = "OtpRouter.Boot"
  }
}
