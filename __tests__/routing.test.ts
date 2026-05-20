import {
  doesRouteMatchMessage,
  doesRouteMatchSender,
  doesRouteOtpGatePass,
  parsePhraseList,
  phoneNumbersMatch,
} from '../src/services/routing';
import type { RouteRule } from '../src/types';

const baseRule: RouteRule = {
  id: 'rule_1',
  enabled: true,
  routeName: 'Finance OTP',
  senderSourceType: 'sender_id',
  senderPattern: 'HDFCBK',
  contactDisplayName: null,
  contactPhoneNumbers: [],
  requireOtp: true,
  matchMode: 'contains',
  messageAllowPatterns: [],
  messageBlockPatterns: [],
  destinationId: 'dest_1',
};

test('any-sender mode matches every sender', () => {
  const rule: RouteRule = {
    ...baseRule,
    senderSourceType: 'any',
    senderPattern: '',
  };
  expect(doesRouteMatchSender(rule, 'HDFCBK')).toBe(true);
  expect(doesRouteMatchSender(rule, '9876543210')).toBe(true);
  expect(doesRouteMatchSender(rule, '')).toBe(true);
});

test('any-sender mode still respects rule.enabled', () => {
  const rule: RouteRule = {
    ...baseRule,
    enabled: false,
    senderSourceType: 'any',
    senderPattern: '',
  };
  expect(doesRouteMatchSender(rule, 'HDFCBK')).toBe(false);
});

test('matches sender id routes case-insensitively', () => {
  expect(doesRouteMatchSender(baseRule, 'VK-HDFCBK')).toBe(true);
  expect(doesRouteMatchSender(baseRule, 'vk-hdfcbk')).toBe(true);
  expect(doesRouteMatchSender(baseRule, 'AWS')).toBe(false);
});

test('matches saved contact numbers across different formats', () => {
  const rule: RouteRule = {
    ...baseRule,
    senderSourceType: 'contact',
    senderPattern: '',
    contactDisplayName: 'John',
    contactPhoneNumbers: ['+91 98765 43210'],
  };

  expect(doesRouteMatchSender(rule, '9876543210')).toBe(true);
  expect(doesRouteMatchSender(rule, '+91-98765-43210')).toBe(true);
  expect(doesRouteMatchSender(rule, '9123456789')).toBe(false);
  expect(phoneNumbersMatch('+91 98765 43210', '9876543210')).toBe(true);
});

test('allow filters require at least one include match', () => {
  const rule: RouteRule = {
    ...baseRule,
    messageAllowPatterns: ['login', 'verify'],
  };

  expect(doesRouteMatchMessage(rule, 'Your login code is 123456')).toBe(true);
  expect(doesRouteMatchMessage(rule, 'Your payment code is 123456')).toBe(false);
});

test('block filters override allow matches', () => {
  const rule: RouteRule = {
    ...baseRule,
    messageAllowPatterns: ['login'],
    messageBlockPatterns: ['promo'],
  };

  expect(doesRouteMatchMessage(rule, 'Your login code is 123456')).toBe(true);
  expect(doesRouteMatchMessage(rule, 'Your login promo code is 123456')).toBe(false);
});

test('phrase list parsing trims values and removes blanks', () => {
  expect(parsePhraseList(' login, , verify ,promo ')).toEqual([
    'login',
    'verify',
    'promo',
  ]);
});

// ───────────────────────────────────────────────────────────
// Phase A: per-rule OTP gate + matchMode
// ───────────────────────────────────────────────────────────

test('requireOtp=false lets non-OTP messages through', () => {
  const rule: RouteRule = { ...baseRule, requireOtp: false };
  expect(doesRouteOtpGatePass(rule, 'No code here, just a status update')).toBe(true);
});

test('requireOtp=true rejects messages without an OTP-shaped code', () => {
  const rule: RouteRule = { ...baseRule, requireOtp: true };
  expect(doesRouteOtpGatePass(rule, 'No code here')).toBe(false);
  expect(doesRouteOtpGatePass(rule, 'Your code is 482910')).toBe(true);
});

test('whole_word match mode respects word boundaries', () => {
  const rule: RouteRule = {
    ...baseRule,
    matchMode: 'whole_word',
    messageAllowPatterns: ['login'],
  };
  expect(doesRouteMatchMessage(rule, 'Your login code is 123456')).toBe(true);
  // "logout" or "loginid" should NOT match in whole-word mode
  expect(doesRouteMatchMessage(rule, 'Your loginid code is 123456')).toBe(false);
  expect(doesRouteMatchMessage(rule, 'Your logout code is 123456')).toBe(false);
});

test('regex match mode compiles user-supplied patterns', () => {
  const rule: RouteRule = {
    ...baseRule,
    matchMode: 'regex',
    messageAllowPatterns: ['\\bverif(y|ication)\\b'],
  };
  expect(doesRouteMatchMessage(rule, 'Please verify your account')).toBe(true);
  expect(doesRouteMatchMessage(rule, 'Account verification code 482910')).toBe(true);
  expect(doesRouteMatchMessage(rule, 'Random message without that word')).toBe(false);
});

test('regex match mode silently rejects invalid patterns instead of throwing', () => {
  const rule: RouteRule = {
    ...baseRule,
    matchMode: 'regex',
    messageAllowPatterns: ['['], // invalid regex
  };
  expect(() => doesRouteMatchMessage(rule, 'Anything')).not.toThrow();
  expect(doesRouteMatchMessage(rule, 'Anything')).toBe(false);
});

test('block patterns also honor match mode', () => {
  const rule: RouteRule = {
    ...baseRule,
    matchMode: 'whole_word',
    messageBlockPatterns: ['promo'],
  };
  expect(doesRouteMatchMessage(rule, 'Login code 123456')).toBe(true);
  expect(doesRouteMatchMessage(rule, 'Login code 123456 promo')).toBe(false);
  // "promotional" should NOT trigger the block in whole-word mode
  expect(doesRouteMatchMessage(rule, 'Login code 123456 promotional')).toBe(true);
});

// ───────────────────────────────────────────────────────────
// Phase A.1: sender_id field accepts a comma-separated OR list
// ───────────────────────────────────────────────────────────

test('comma-separated senders match any entry (OR semantics)', () => {
  const rule: RouteRule = {
    ...baseRule,
    senderPattern: 'HDFCBK, AWS, AMAZON',
  };
  expect(doesRouteMatchSender(rule, 'VK-HDFCBK')).toBe(true);
  expect(doesRouteMatchSender(rule, 'AM-AWS')).toBe(true);
  expect(doesRouteMatchSender(rule, 'JM-AMAZON')).toBe(true);
  expect(doesRouteMatchSender(rule, 'ICICI')).toBe(false);
});

test('sender entries are case-insensitive', () => {
  const rule: RouteRule = {
    ...baseRule,
    senderPattern: 'hdfcbk',
  };
  expect(doesRouteMatchSender(rule, 'VK-HDFCBK')).toBe(true);
  expect(doesRouteMatchSender(rule, 'vk-hdfcbk')).toBe(true);
});

test('sender entry with >=7 digits uses phone-number matching (country-agnostic)', () => {
  // Stored without country code — should still match SMS that includes it.
  const rule: RouteRule = {
    ...baseRule,
    senderPattern: '9876543210',
  };
  expect(doesRouteMatchSender(rule, '+91 98765 43210')).toBe(true);
  expect(doesRouteMatchSender(rule, '919876543210')).toBe(true);
  expect(doesRouteMatchSender(rule, '9876543210')).toBe(true);
  expect(doesRouteMatchSender(rule, '9999999999')).toBe(false);
});

test('sender list mixing brand + phone matches each independently', () => {
  const rule: RouteRule = {
    ...baseRule,
    senderPattern: 'HDFCBK, +91 98765 43210',
  };
  expect(doesRouteMatchSender(rule, 'VK-HDFCBK')).toBe(true);
  expect(doesRouteMatchSender(rule, '9876543210')).toBe(true);
  expect(doesRouteMatchSender(rule, 'AWS')).toBe(false);
});

test('empty/whitespace-only sender list still fails closed', () => {
  const rule: RouteRule = {
    ...baseRule,
    senderPattern: ' , , ',
  };
  expect(doesRouteMatchSender(rule, 'HDFCBK')).toBe(false);
});
