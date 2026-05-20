import type { MatchMode, RouteRule } from '../types';
import { extractOtp } from './otp';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Apply one allow/block phrase against the (already lowercased) message
 * using the route's chosen match mode. Returns false silently when a
 * regex pattern fails to compile — we never throw from the dispatcher path.
 */
function phraseMatches(pattern: string, normalizedMessage: string, mode: MatchMode): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) return false;

  switch (mode) {
    case 'contains':
      return normalizedMessage.includes(trimmed.toLowerCase());
    case 'whole_word': {
      try {
        const re = new RegExp(`\\b${escapeRegex(trimmed)}\\b`, 'i');
        return re.test(normalizedMessage);
      } catch {
        return false;
      }
    }
    case 'regex': {
      try {
        const re = new RegExp(trimmed, 'i');
        return re.test(normalizedMessage);
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

export function parsePhraseList(input: string): string[] {
  return input
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

/** Sender lists use the same comma-separated syntax as phrase lists. */
export function parseSenderList(input: string): string[] {
  return parsePhraseList(input);
}

/**
 * Match a single sender-list entry against the incoming sender. If the
 * entry has ≥7 digits after stripping non-digits, it's treated as a
 * phone number and uses the digit-normalized compare (so `9876543210`
 * stored matches `+91 9876543210` SMS, regardless of country).
 * Otherwise it's a brand short code or partial string — plain
 * case-insensitive substring.
 */
export function doesSenderEntryMatch(entry: string, sender: string): boolean {
  const trimmedEntry = entry.trim();
  if (!trimmedEntry) return false;

  const entryDigits = normalizePhoneNumber(trimmedEntry);
  if (entryDigits.length >= 7) {
    return phoneNumbersMatch(trimmedEntry, sender);
  }

  return sender.trim().toLowerCase().includes(trimmedEntry.toLowerCase());
}

export function normalizePhoneNumber(value: string): string {
  return value.replace(/\D/g, '');
}

export function phoneNumbersMatch(left: string, right: string): boolean {
  const normalizedLeft = normalizePhoneNumber(left);
  const normalizedRight = normalizePhoneNumber(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;

  const shorter =
    normalizedLeft.length <= normalizedRight.length ? normalizedLeft : normalizedRight;
  const longer =
    normalizedLeft.length > normalizedRight.length ? normalizedLeft : normalizedRight;

  return shorter.length >= 7 && longer.endsWith(shorter);
}

export function doesRouteMatchSender(rule: RouteRule, sender: string): boolean {
  if (!rule.enabled) return false;

  if (rule.senderSourceType === 'any') {
    // "Forward every OTP from this device" — relies on the OTP gate + any
    // message filters the user added to keep the route from being a firehose.
    return true;
  }

  if (rule.senderSourceType === 'contact') {
    return rule.contactPhoneNumbers.some(phone => phoneNumbersMatch(phone, sender));
  }

  // sender_id mode: comma-separated list. Any entry matches → forward.
  // Each entry is auto-detected as phone-shaped (digit-normalized compare)
  // or brand/text (case-insensitive substring). Fail-closed when empty.
  const entries = parseSenderList(rule.senderPattern);
  if (entries.length === 0) return false;
  return entries.some(entry => doesSenderEntryMatch(entry, sender));
}

export function doesRouteMatchMessage(rule: RouteRule, message: string): boolean {
  // Empty/whitespace-only payload — only allow forwarding if the route has
  // no content filters at all. Real SMS payloads are essentially never
  // empty so this branch is only a defensive guard.
  const normalizedMessage = message.trim().toLowerCase();
  if (!normalizedMessage) {
    return rule.messageAllowPatterns.length === 0 && rule.messageBlockPatterns.length === 0;
  }

  const mode: MatchMode = rule.matchMode ?? 'contains';

  if (rule.messageAllowPatterns.length > 0) {
    const hasAllowMatch = rule.messageAllowPatterns.some(pattern =>
      phraseMatches(pattern, normalizedMessage, mode),
    );
    if (!hasAllowMatch) return false;
  }

  const hasBlockedPattern = rule.messageBlockPatterns.some(pattern =>
    phraseMatches(pattern, normalizedMessage, mode),
  );
  if (hasBlockedPattern) return false;

  return true;
}

/**
 * Does this rule's OTP requirement pass for the given message?
 * If `requireOtp` is false (general-forwarder route), always passes.
 * If `requireOtp` is true, the message must contain an OTP-shaped code.
 */
export function doesRouteOtpGatePass(rule: RouteRule, message: string): boolean {
  if (!rule.requireOtp) return true;
  return extractOtp(message).code != null;
}

export function describeSenderRule(rule: RouteRule): string {
  if (rule.senderSourceType === 'any') {
    return 'Any sender on this device';
  }

  if (rule.senderSourceType === 'contact') {
    const name = rule.contactDisplayName || 'Saved contact';
    return `${name} (${rule.contactPhoneNumbers.length} number${rule.contactPhoneNumbers.length === 1 ? '' : 's'})`;
  }

  const entries = parseSenderList(rule.senderPattern);
  if (entries.length === 0) return 'Unknown sender';
  if (entries.length === 1) return entries[0];
  return `${entries[0]} +${entries.length - 1} more`;
}
