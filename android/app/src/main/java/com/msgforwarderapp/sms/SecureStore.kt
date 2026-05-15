package com.msgforwarderapp.sms

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Manages the MMKV encryption passphrase.
 *
 * The passphrase itself is a random 32-byte value generated once per install.
 * It is sealed with an AES/GCM key that lives inside the Android Keystore
 * (hardware-backed on most devices) and the sealed blob is stored in
 * SharedPreferences. The raw passphrase never leaves the keystore-protected
 * boundary except into memory of this process.
 */
object SecureStore {
  private const val PREFS_NAME = "msg-forwarder-secure"
  private const val PREF_SEALED_PASSPHRASE = "mmkv_passphrase_sealed_v1"
  private const val KEYSTORE_ALIAS = "msg-forwarder-mmkv-wrap-v1"
  private const val ANDROID_KEYSTORE = "AndroidKeyStore"
  private const val TRANSFORMATION = "AES/GCM/NoPadding"
  private const val GCM_TAG_BITS = 128
  private const val IV_LENGTH = 12
  private const val PASSPHRASE_LENGTH = 32

  @Volatile private var cachedPassphrase: String? = null

  fun getMmkvPassphrase(context: Context): String {
    cachedPassphrase?.let { return it }
    synchronized(this) {
      cachedPassphrase?.let { return it }
      val passphrase = loadOrCreatePassphrase(context)
      cachedPassphrase = passphrase
      return passphrase
    }
  }

  private fun loadOrCreatePassphrase(context: Context): String {
    val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val sealed = prefs.getString(PREF_SEALED_PASSPHRASE, null)
    val key = getOrCreateWrappingKey()

    if (sealed != null) {
      runCatching { return decryptPassphrase(sealed, key) }
      // Sealed blob unreadable (e.g. keystore reset). Fall through and regenerate.
    }

    val newPassphrase = generatePassphrase()
    val sealedNew = encryptPassphrase(newPassphrase, key)
    prefs.edit().putString(PREF_SEALED_PASSPHRASE, sealedNew).apply()
    return newPassphrase
  }

  private fun getOrCreateWrappingKey(): SecretKey {
    val keystore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
    (keystore.getEntry(KEYSTORE_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let {
      return it.secretKey
    }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
    val spec =
        KeyGenParameterSpec.Builder(
                KEYSTORE_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build()
    generator.init(spec)
    return generator.generateKey()
  }

  private fun generatePassphrase(): String {
    val bytes = ByteArray(PASSPHRASE_LENGTH)
    java.security.SecureRandom().nextBytes(bytes)
    return Base64.encodeToString(bytes, Base64.NO_WRAP or Base64.NO_PADDING)
  }

  private fun encryptPassphrase(plaintext: String, key: SecretKey): String {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, key)
    val iv = cipher.iv
    val cipherBytes = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
    val combined = ByteArray(iv.size + cipherBytes.size)
    System.arraycopy(iv, 0, combined, 0, iv.size)
    System.arraycopy(cipherBytes, 0, combined, iv.size, cipherBytes.size)
    return Base64.encodeToString(combined, Base64.NO_WRAP)
  }

  private fun decryptPassphrase(sealed: String, key: SecretKey): String {
    val combined = Base64.decode(sealed, Base64.NO_WRAP)
    val iv = combined.copyOfRange(0, IV_LENGTH)
    val cipherBytes = combined.copyOfRange(IV_LENGTH, combined.size)
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
    return String(cipher.doFinal(cipherBytes), Charsets.UTF_8)
  }
}
