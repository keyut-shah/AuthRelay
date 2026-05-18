import type { RouteRule } from '../types';

export function parsePhraseList(input: string): string[] {
  return input
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
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

  const pattern = rule.senderPattern.trim().toLowerCase();
  if (!pattern) return false;
  return sender.trim().toLowerCase().includes(pattern);
}

export function doesRouteMatchMessage(rule: RouteRule, message: string): boolean {
  const normalizedMessage = message.trim().toLowerCase();
  if (!normalizedMessage) return false;

  const allowPatterns = rule.messageAllowPatterns
    .map(pattern => pattern.trim().toLowerCase())
    .filter(Boolean);
  const blockPatterns = rule.messageBlockPatterns
    .map(pattern => pattern.trim().toLowerCase())
    .filter(Boolean);

  if (allowPatterns.length > 0) {
    const hasAllowMatch = allowPatterns.some(pattern => normalizedMessage.includes(pattern));
    if (!hasAllowMatch) return false;
  }

  const hasBlockedPattern = blockPatterns.some(pattern => normalizedMessage.includes(pattern));
  if (hasBlockedPattern) return false;

  return true;
}

export function describeSenderRule(rule: RouteRule): string {
  if (rule.senderSourceType === 'any') {
    return 'Any sender on this device';
  }

  if (rule.senderSourceType === 'contact') {
    const name = rule.contactDisplayName || 'Saved contact';
    return `${name} (${rule.contactPhoneNumbers.length} number${rule.contactPhoneNumbers.length === 1 ? '' : 's'})`;
  }

  return rule.senderPattern || 'Unknown sender';
}
