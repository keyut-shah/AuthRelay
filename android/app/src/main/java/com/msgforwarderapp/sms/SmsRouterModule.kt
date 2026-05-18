package com.msgforwarderapp.sms

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

class SmsRouterModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  @ReactMethod
  fun getListenerStatus(promise: Promise) {
    val bootRestoredAt = ListenerState.getBootRestoredAt(reactContext)
    val autostartAttemptedAt = ListenerState.getAutostartAttemptedAt(reactContext)
    val ignoringBattery = PowerSettings.isIgnoringBatteryOptimizations(reactContext)
    val payload =
        Arguments.createMap().apply {
          putBoolean("receiverRegistered", true)
          putBoolean("bootRecoveryEnabled", true)
          putBoolean("foregroundServiceEnabled", false)
          putBoolean("ignoringBatteryOptimizations", ignoringBattery)
          putDouble("bootRestoredAt", bootRestoredAt.toDouble())
          putDouble("autostartAttemptedAt", autostartAttemptedAt.toDouble())
        }

    promise.resolve(payload)
  }

  @ReactMethod
  fun getEncryptionKey(promise: Promise) {
    try {
      promise.resolve(SecureStore.getMmkvPassphrase(reactContext))
    } catch (t: Throwable) {
      promise.reject("E_SECURE_STORE", t.message, t)
    }
  }

  @ReactMethod
  fun isIgnoringBatteryOptimizations(promise: Promise) {
    promise.resolve(PowerSettings.isIgnoringBatteryOptimizations(reactContext))
  }

  @ReactMethod
  fun requestIgnoreBatteryOptimizations(promise: Promise) {
    try {
      val alreadyExempt = PowerSettings.requestIgnoreBatteryOptimizations(reactContext)
      promise.resolve(alreadyExempt)
    } catch (t: Throwable) {
      promise.reject("E_BATTERY_REQUEST", t.message, t)
    }
  }

  @ReactMethod
  fun openAutostartSettings(promise: Promise) {
    try {
      val launchedKnownIntent = PowerSettings.openAutostartSettings(reactContext)
      ListenerState.setAutostartAttempted(reactContext, System.currentTimeMillis())
      promise.resolve(launchedKnownIntent)
    } catch (t: Throwable) {
      promise.reject("E_AUTOSTART", t.message, t)
    }
  }

  @ReactMethod
  fun simulateIncomingSms(sender: String, message: String) {
    emitIncomingSms(sender = sender, message = message, source = "simulation")
  }

  fun emitIncomingSms(sender: String, message: String, source: String = "sms") {
    if (!reactContext.hasActiveReactInstance()) {
      return
    }

    val payload =
        Arguments.createMap().apply {
          putString("sender", sender)
          putString("message", message)
          putString("source", source)
          putDouble("receivedAt", System.currentTimeMillis().toDouble())
        }

    reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(EVENT_SMS_RECEIVED, payload)
  }

  companion object {
    const val NAME = "SmsRouterModule"
    const val EVENT_SMS_RECEIVED = "otpRouter:smsReceived"
  }
}
