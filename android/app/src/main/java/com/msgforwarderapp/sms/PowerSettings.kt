package com.msgforwarderapp.sms

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log

/**
 * Helpers around Android battery optimization + OEM auto-start settings.
 *
 * - Battery: standard AOSP API. Detectable + requestable.
 * - Autostart: NOT a standard API. Each OEM (Xiaomi, Oppo, Vivo, Huawei…)
 *   buries the setting under a vendor-specific Activity that's not part of
 *   the SDK. We try a known list, fall back to the app-details settings.
 *   The state is NOT detectable — best the UI can do is mark the action
 *   as "attempted" and let the operator confirm visually.
 */
object PowerSettings {
  private const val TAG = "OtpRouter.Power"

  fun isIgnoringBatteryOptimizations(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
    val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return false
    return pm.isIgnoringBatteryOptimizations(context.packageName)
  }

  /**
   * Opens the battery-optimization request dialog when needed. Returns true
   * if the system already considers us exempt (no UI shown).
   */
  fun requestIgnoreBatteryOptimizations(context: Context): Boolean {
    if (isIgnoringBatteryOptimizations(context)) return true
    val intent =
        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
          data = Uri.parse("package:${context.packageName}")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
    return try {
      context.startActivity(intent)
      false
    } catch (t: Throwable) {
      Log.w(TAG, "Battery-optimization dialog not available, falling back", t)
      openBatteryOptimizationsList(context)
      false
    }
  }

  private fun openBatteryOptimizationsList(context: Context) {
    val intent =
        Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
    runCatching { context.startActivity(intent) }
  }

  /**
   * Attempts to open the OEM-specific auto-start manager. Returns true if a
   * known vendor intent was launched; false if we had to fall back to the
   * generic app-details screen.
   */
  fun openAutostartSettings(context: Context): Boolean {
    val manufacturer = Build.MANUFACTURER.lowercase()
    val brand = Build.BRAND.lowercase()
    val candidates =
        when {
          // Order matters: most specific first.
          manufacturer.contains("xiaomi") || brand.contains("xiaomi") || brand.contains("redmi") ->
              listOf(
                  ComponentName(
                      "com.miui.securitycenter",
                      "com.miui.permcenter.autostart.AutoStartManagementActivity",
                  ),
              )
          manufacturer.contains("oppo") || brand.contains("oppo") ->
              listOf(
                  ComponentName(
                      "com.coloros.safecenter",
                      "com.coloros.safecenter.permission.startup.StartupAppListActivity",
                  ),
                  ComponentName(
                      "com.oppo.safe",
                      "com.oppo.safe.permission.startup.StartupAppListActivity",
                  ),
                  ComponentName(
                      "com.coloros.safecenter",
                      "com.coloros.safecenter.startupapp.StartupAppListActivity",
                  ),
              )
          manufacturer.contains("vivo") || brand.contains("vivo") ->
              listOf(
                  ComponentName(
                      "com.vivo.permissionmanager",
                      "com.vivo.permissionmanager.activity.BgStartUpManagerActivity",
                  ),
                  ComponentName(
                      "com.iqoo.secure",
                      "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity",
                  ),
              )
          manufacturer.contains("huawei") || brand.contains("honor") ->
              listOf(
                  ComponentName(
                      "com.huawei.systemmanager",
                      "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
                  ),
                  ComponentName(
                      "com.huawei.systemmanager",
                      "com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity",
                  ),
              )
          manufacturer.contains("samsung") || brand.contains("samsung") ->
              listOf(
                  ComponentName(
                      "com.samsung.android.lool",
                      "com.samsung.android.sm.ui.battery.BatteryActivity",
                  ),
              )
          manufacturer.contains("oneplus") || brand.contains("oneplus") ->
              listOf(
                  ComponentName(
                      "com.oneplus.security",
                      "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity",
                  ),
              )
          manufacturer.contains("realme") || brand.contains("realme") ->
              listOf(
                  ComponentName(
                      "com.coloros.safecenter",
                      "com.coloros.safecenter.permission.startup.StartupAppListActivity",
                  ),
              )
          manufacturer.contains("asus") || brand.contains("asus") ->
              listOf(
                  ComponentName(
                      "com.asus.mobilemanager",
                      "com.asus.mobilemanager.entry.FunctionActivity",
                  ),
              )
          else -> emptyList()
        }

    for (component in candidates) {
      val intent =
          Intent().apply {
            this.component = component
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          }
      val pm = context.packageManager
      if (intent.resolveActivity(pm) != null) {
        return try {
          context.startActivity(intent)
          true
        } catch (t: Throwable) {
          Log.w(TAG, "Failed to open autostart intent for $component", t)
          false
        }
      }
    }

    // Fallback: app-details screen lets the operator open vendor extras manually.
    openAppDetails(context)
    return false
  }

  private fun openAppDetails(context: Context) {
    val intent =
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
          data = Uri.parse("package:${context.packageName}")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
    runCatching { context.startActivity(intent) }
  }
}
