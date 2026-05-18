package com.msgforwarderapp.sms

import android.app.Activity
import android.content.Intent
import android.provider.ContactsContract
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

class SmsRouterModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  @Volatile private var pendingContactPickPromise: Promise? = null

  private val activityListener: ActivityEventListener =
      object : BaseActivityEventListener() {
        override fun onActivityResult(
            activity: Activity,
            requestCode: Int,
            resultCode: Int,
            data: Intent?,
        ) {
          if (requestCode != REQUEST_CONTACT_PICK) return
          val promise = pendingContactPickPromise ?: return
          pendingContactPickPromise = null

          if (resultCode != Activity.RESULT_OK || data?.data == null) {
            promise.resolve(null) // user cancelled
            return
          }

          try {
            val result = readPickedPhone(activity, data.data!!)
            promise.resolve(result)
          } catch (t: Throwable) {
            promise.reject("E_CONTACT_PICK_READ", t.message, t)
          }
        }
      }

  init {
    reactContext.addActivityEventListener(activityListener)
  }

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

  /**
   * Open Android's system contact picker. Returns `{ displayName, phoneNumber }`
   * for the selected phone row, or `null` if the user cancelled.
   *
   * Uses `Intent.ACTION_PICK` with the phone MIME type so the system grants
   * temporary read access to the single picked row — no READ_CONTACTS
   * permission needed.
   */
  @ReactMethod
  fun pickContact(promise: Promise) {
    if (pendingContactPickPromise != null) {
      promise.reject("E_PICK_IN_FLIGHT", "Contact picker is already open.")
      return
    }
    val activity = reactContext.currentActivity
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "An active Android activity is required.")
      return
    }
    val intent =
        Intent(Intent.ACTION_PICK).apply {
          type = ContactsContract.CommonDataKinds.Phone.CONTENT_TYPE
        }
    if (intent.resolveActivity(activity.packageManager) == null) {
      promise.reject("E_NO_PICKER", "This device has no contact picker.")
      return
    }
    pendingContactPickPromise = promise
    try {
      activity.startActivityForResult(intent, REQUEST_CONTACT_PICK)
    } catch (t: Throwable) {
      pendingContactPickPromise = null
      promise.reject("E_PICK_LAUNCH", t.message, t)
    }
  }

  private fun readPickedPhone(activity: Activity, uri: android.net.Uri): WritableMap? {
    val projection =
        arrayOf(
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER,
        )
    activity.contentResolver.query(uri, projection, null, null, null)?.use { cursor ->
      if (!cursor.moveToFirst()) return null
      val nameIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
      val numberIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)
      val displayName = cursor.getString(nameIndex)?.trim().orEmpty().ifEmpty { "Saved contact" }
      val number = cursor.getString(numberIndex)?.trim().orEmpty()
      if (number.isEmpty()) return null
      return Arguments.createMap().apply {
        putString("displayName", displayName)
        putString("phoneNumber", number)
      }
    }
    return null
  }

  @ReactMethod
  fun simulateIncomingSms(sender: String, message: String) {
    emitIncomingSms(sender = sender, message = message, source = "simulation")
  }

  fun emitIncomingSms(sender: String, message: String, source: String = "sms") {
    if (!reactContext.hasActiveReactInstance()) return
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
    private const val REQUEST_CONTACT_PICK = 5002
  }
}
