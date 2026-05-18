package com.msgforwarderapp.sms

import android.content.Context

/**
 * Small persisted state about the SMS listener — separate from the encrypted
 * MMKV store so it can be read/written cheaply from BootCompletedReceiver
 * without needing the Keystore key.
 */
object ListenerState {
  private const val PREFS_NAME = "msg-forwarder-listener-state"
  private const val KEY_BOOT_RESTORED_AT = "boot_restored_at"
  private const val KEY_AUTOSTART_ATTEMPTED_AT = "autostart_attempted_at"

  private fun prefs(context: Context) =
      context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  fun setBootRestoredAt(context: Context, ms: Long) {
    prefs(context).edit().putLong(KEY_BOOT_RESTORED_AT, ms).apply()
  }

  fun getBootRestoredAt(context: Context): Long {
    return prefs(context).getLong(KEY_BOOT_RESTORED_AT, 0L)
  }

  fun setAutostartAttempted(context: Context, ms: Long) {
    prefs(context).edit().putLong(KEY_AUTOSTART_ATTEMPTED_AT, ms).apply()
  }

  fun getAutostartAttemptedAt(context: Context): Long {
    return prefs(context).getLong(KEY_AUTOSTART_ATTEMPTED_AT, 0L)
  }
}
