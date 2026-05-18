jest.mock('react-native-mmkv', () => ({
  createMMKV: () => ({
    set: jest.fn(),
    getString: jest.fn(),
    remove: jest.fn(),
  }),
}));

import {
  migrateLegacyRoutes,
  normalizeStoredEvents,
  normalizeStoredRules,
} from '../src/storage';

test('migrates legacy routes into the new rule shape', () => {
  const migrated = migrateLegacyRoutes([
    {
      id: 'legacy_1',
      teamName: 'Finance',
      telegramName: 'Finance Bot',
      telegramBotToken: '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
      telegramChatId: '@financealerts',
      senderFilter: 'HDFCBK',
    },
  ]);

  expect(migrated.destinations).toHaveLength(1);
  expect(migrated.rules).toEqual([
    expect.objectContaining({
      id: 'legacy_1',
      routeName: 'Finance',
      senderSourceType: 'sender_id',
      senderPattern: 'HDFCBK',
      contactPhoneNumbers: [],
      messageAllowPatterns: [],
      messageBlockPatterns: [],
    }),
  ]);
});

test('normalizes stored rules saved with the old team-based shape', () => {
  const normalized = normalizeStoredRules([
    {
      id: 'rule_1',
      enabled: true,
      teamName: 'Ops',
      senderPattern: 'AWS',
      senderMatchMode: 'contains',
      destinationId: 'dest_1',
    },
  ]);

  expect(normalized).toEqual([
    {
      id: 'rule_1',
      enabled: true,
      routeName: 'Ops',
      senderSourceType: 'sender_id',
      senderPattern: 'AWS',
      contactDisplayName: null,
      contactPhoneNumbers: [],
      messageAllowPatterns: [],
      messageBlockPatterns: [],
      destinationId: 'dest_1',
    },
  ]);
});

test('normalizes stored events saved with matchedTeamName', () => {
  const normalized = normalizeStoredEvents([
    {
      id: 'evt_1',
      createdAt: 1000,
      sender: 'AWS',
      matchedRuleId: 'rule_1',
      matchedTeamName: 'Ops',
      destinationName: 'Telegram @ops',
      status: 'sent',
      maskedCode: '••56',
    },
  ]);

  expect(normalized).toEqual([
    {
      id: 'evt_1',
      createdAt: 1000,
      sender: 'AWS',
      matchedRuleId: 'rule_1',
      matchedRouteName: 'Ops',
      destinationName: 'Telegram @ops',
      status: 'sent',
      maskedCode: '••56',
      reason: undefined,
    },
  ]);
});
