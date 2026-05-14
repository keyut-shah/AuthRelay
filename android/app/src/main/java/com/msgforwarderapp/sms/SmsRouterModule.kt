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
    val payload =
        Arguments.createMap().apply {
          putBoolean("receiverRegistered", true)
          putBoolean("bootRecoveryEnabled", true)
          putBoolean("foregroundServiceEnabled", false)
        }

    promise.resolve(payload)
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
