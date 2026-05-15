package com.msgforwarderapp.sms

/**
 * Kotlin mirror of src/services/otp.ts. Keep the two in sync — they
 * implement the same OTP gate that the JS layer applies for UI previews.
 *
 * If no code is found the dispatcher will skip forwarding entirely,
 * which keeps marketing/transactional messages from whitelisted senders
 * from leaking to Telegram.
 */
object OtpExtractor {
  private val CODE_REGEX = Regex("(?<!\\d)(\\d{4,8})(?!\\d)")
  private val KEYWORDS =
      listOf(
          "otp",
          "code",
          "verify",
          "verification",
          "verifying",
          "login",
          "sign in",
          "sign-in",
          "signin",
          "2fa",
          "two-factor",
          "auth",
          "authentication",
          "passcode",
          "pin",
          "one-time",
          "one time",
      )

  data class Result(val code: String?, val hasKeyword: Boolean, val maskedCode: String?)

  fun extract(message: String): Result {
    if (message.isEmpty()) return Result(null, false, null)
    val lower = message.lowercase()
    val hasKeyword = KEYWORDS.any { lower.contains(it) }
    val match = CODE_REGEX.find(message)
    val code = match?.groupValues?.getOrNull(1)
    return Result(code = code, hasKeyword = hasKeyword, maskedCode = code?.let { maskCode(it) })
  }

  fun maskCode(code: String): String {
    if (code.length <= 2) return "•".repeat(code.length)
    return "•".repeat(code.length - 2) + code.takeLast(2)
  }
}
