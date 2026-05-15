/**
 * Local-only OTP extraction. Runs in both the JS layer (for UI previews)
 * and is mirrored in Kotlin (SmsDispatcher.extractOtp) so the native
 * dispatcher applies the same gate when forwarding.
 *
 * Strategy (intentionally simple for MVP):
 *  - Find the first standalone 4–8 digit numeric sequence in the message.
 *    Word boundaries on both sides so long numbers (account / phone / amount)
 *    don't get treated as codes.
 *  - Flag OTP-related keywords for downstream confidence display.
 *  - If no code is found, the message is not OTP-like and should not be
 *    forwarded — this is the privacy/whitelist safety net.
 */

const OTP_CODE_REGEX = /(?<!\d)(\d{4,8})(?!\d)/;
const OTP_KEYWORDS = [
  'otp',
  'code',
  'verify',
  'verification',
  'verifying',
  'login',
  'sign in',
  'sign-in',
  'signin',
  '2fa',
  'two-factor',
  'auth',
  'authentication',
  'passcode',
  'pin',
  'one-time',
  'one time',
];

export type OtpExtractionResult = {
  /** The raw 4–8 digit code if one was found, else null. */
  code: string | null;
  /** True when any OTP-related keyword appears in the message. */
  hasKeyword: boolean;
  /** Last two digits with the rest masked (e.g. "••56"). null when no code. */
  maskedCode: string | null;
};

export function extractOtp(message: string): OtpExtractionResult {
  if (!message) {
    return { code: null, hasKeyword: false, maskedCode: null };
  }
  const lower = message.toLowerCase();
  const hasKeyword = OTP_KEYWORDS.some(keyword => lower.includes(keyword));
  const match = OTP_CODE_REGEX.exec(message);
  const code = match ? match[1] : null;
  return {
    code,
    hasKeyword,
    maskedCode: code ? maskCode(code) : null,
  };
}

export function maskCode(code: string): string {
  if (code.length <= 2) {
    return '•'.repeat(code.length);
  }
  return '•'.repeat(code.length - 2) + code.slice(-2);
}

/**
 * Mask any OTP-shaped sequences inside a free-text message preview so
 * the UI never displays the full code. Keeps the rest of the message
 * intact for context.
 */
export function maskMessagePreview(message: string): string {
  if (!message) return message;
  return message.replace(/(?<!\d)(\d{4,8})(?!\d)/g, match => maskCode(match));
}
