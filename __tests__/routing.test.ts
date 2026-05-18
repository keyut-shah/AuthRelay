import {
  doesRouteMatchMessage,
  doesRouteMatchSender,
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
