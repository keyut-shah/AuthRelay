import { NativeModules } from 'react-native';
import { createMMKV, type MMKV } from 'react-native-mmkv';
import type { z } from 'zod';
import { buildTelegramDestinationName } from '../services/destinations';
import type {
  DestinationConfig,
  ProcessedMessageEvent,
  RouteRule,
} from '../types';
import {
  DestinationConfigSchema,
  ProcessedMessageEventSchema,
  RouteRuleSchema,
  safeParseArray,
} from '../schemas';
import { EVENT_HISTORY_CAP, StorageKeys } from './keys';

export const STORAGE_ID = 'msg-forwarder-storage';

type SmsRouterNativeModule = {
  getEncryptionKey(): Promise<string>;
};

type LegacyStoredRoute = {
  id?: string;
  teamName?: string;
  telegramName?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  senderFilter?: string;
};

let storage: MMKV | null = null;
let initPromise: Promise<void> | null = null;

const newId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export function initStorage(): Promise<void> {
  if (storage) return Promise.resolve();
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const native = (NativeModules as { SmsRouterModule?: SmsRouterNativeModule })
      .SmsRouterModule;
    if (!native) {
      throw new Error('SmsRouterModule native module is not linked.');
    }
    const encryptionKey = await native.getEncryptionKey();
    storage = createMMKV({ id: STORAGE_ID, encryptionKey });
    runMigrations(storage);
  })();

  return initPromise;
}

function requireStorage(): MMKV {
  if (!storage) {
    throw new Error('Storage not initialized — call initStorage() first.');
  }
  return storage;
}

export function migrateLegacyRoutes(raw: unknown): {
  destinations: DestinationConfig[];
  rules: RouteRule[];
} {
  const parsed = Array.isArray(raw) ? (raw as LegacyStoredRoute[]) : [];
  const destinations: DestinationConfig[] = [];
  const rules: RouteRule[] = [];

  for (const legacy of parsed) {
    if (
      !legacy ||
      !legacy.telegramBotToken ||
      !legacy.telegramChatId ||
      !legacy.senderFilter
    ) {
      continue;
    }

    const destinationId = newId('dest');
    const destinationName =
      legacy.telegramName?.trim() || buildTelegramDestinationName(legacy.telegramChatId);

    destinations.push({
      id: destinationId,
      name: destinationName,
      provider: {
        type: 'telegram',
        botToken: legacy.telegramBotToken,
        chatId: legacy.telegramChatId,
      },
    });

    rules.push({
      id: legacy.id || newId('rule'),
      enabled: true,
      routeName: legacy.teamName?.trim() || 'Route',
      senderSourceType: 'sender_id',
      senderPattern: legacy.senderFilter.trim(),
      contactDisplayName: null,
      contactPhoneNumbers: [],
      requireOtp: true,
      matchMode: 'contains',
      messageAllowPatterns: [],
      messageBlockPatterns: [],
      destinationId,
    });
  }

  return { destinations, rules };
}

export function normalizeStoredRules(raw: unknown): RouteRule[] {
  return safeParseArray(RouteRuleSchema, raw, 'rule');
}

export function normalizeStoredEvents(raw: unknown): ProcessedMessageEvent[] {
  return safeParseArray(ProcessedMessageEventSchema, raw, 'event');
}

function normalizeStoredDestinations(raw: unknown): DestinationConfig[] {
  return safeParseArray(DestinationConfigSchema, raw, 'destination').map(destination => {
    if (destination.name.trim()) return destination;
    if (destination.provider.type === 'telegram') {
      return {
        ...destination,
        name: buildTelegramDestinationName(destination.provider.chatId),
      };
    }
    return destination;
  });
}

function rewriteNormalizedCollection<T>(
  mmkv: MMKV,
  key: string,
  normalizer: (raw: unknown) => T[],
) {
  const raw = mmkv.getString(key);
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw) as unknown;
    const normalized = normalizer(parsed);
    mmkv.set(key, JSON.stringify(normalized));
  } catch (e) {
    console.error(`[storage] Failed to normalize ${key}`, e);
  }
}

function runMigrations(mmkv: MMKV) {
  const legacyRaw = mmkv.getString(StorageKeys.ROUTES_LEGACY);
  if (legacyRaw) {
    const hasNewDestinations = !!mmkv.getString(StorageKeys.DESTINATIONS);
    const hasNewRules = !!mmkv.getString(StorageKeys.RULES);

    if (!hasNewDestinations && !hasNewRules) {
      try {
        const parsed = JSON.parse(legacyRaw) as unknown;
        const migrated = migrateLegacyRoutes(parsed);
        mmkv.set(StorageKeys.DESTINATIONS, JSON.stringify(migrated.destinations));
        mmkv.set(StorageKeys.RULES, JSON.stringify(migrated.rules));
        console.info(
          `[storage] Migrated ${migrated.rules.length} legacy route(s) to destinations + rules.`,
        );
      } catch (e) {
        console.error('[storage] Failed to migrate legacy routes', e);
      }
    }

    mmkv.remove(StorageKeys.ROUTES_LEGACY);
  }

  rewriteNormalizedCollection(mmkv, StorageKeys.DESTINATIONS, normalizeStoredDestinations);
  rewriteNormalizedCollection(mmkv, StorageKeys.RULES, normalizeStoredRules);
  rewriteNormalizedCollection(mmkv, StorageKeys.EVENTS, normalizeStoredEvents);
}

// ───────────────────────────────────────────────────────────
// Helpers — parse with zod, silently drop malformed rows.
// ───────────────────────────────────────────────────────────

function readJsonArray<T>(key: string, schema: z.ZodType<T>, label: string): T[] {
  const raw = requireStorage().getString(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return safeParseArray(schema, parsed, label);
  } catch (e) {
    console.error(`Failed to parse ${key} from MMKV`, e);
    return [];
  }
}

export const StorageHelpers = {
  // — Destinations —
  getDestinations: (): DestinationConfig[] =>
    readJsonArray(StorageKeys.DESTINATIONS, DestinationConfigSchema, 'destination').map(
      destination => {
        if (destination.name.trim()) return destination;
        if (destination.provider.type === 'telegram') {
          return {
            ...destination,
            name: buildTelegramDestinationName(destination.provider.chatId),
          };
        }
        return destination;
      },
    ),

  saveDestinations: (destinations: DestinationConfig[]) => {
    requireStorage().set(StorageKeys.DESTINATIONS, JSON.stringify(destinations));
  },

  upsertDestination: (destination: DestinationConfig) => {
    const existing = StorageHelpers.getDestinations();
    const idx = existing.findIndex(d => d.id === destination.id);
    if (idx >= 0) {
      existing[idx] = destination;
    } else {
      existing.push(destination);
    }
    StorageHelpers.saveDestinations(existing);
    return existing;
  },

  /**
   * Remove a destination and every rule that points to it. Returns the new state.
   */
  removeDestination: (destinationId: string) => {
    const destinations = StorageHelpers.getDestinations().filter(d => d.id !== destinationId);
    const rules = StorageHelpers.getRules().filter(r => r.destinationId !== destinationId);
    StorageHelpers.saveDestinations(destinations);
    StorageHelpers.saveRules(rules);
    return { destinations, rules };
  },

  newDestinationId: () => newId('dest'),

  // — Rules —
  getRules: (): RouteRule[] => readJsonArray(StorageKeys.RULES, RouteRuleSchema, 'rule'),

  saveRules: (rules: RouteRule[]) => {
    requireStorage().set(StorageKeys.RULES, JSON.stringify(rules));
  },

  upsertRule: (rule: RouteRule) => {
    const existing = StorageHelpers.getRules();
    const idx = existing.findIndex(r => r.id === rule.id);
    if (idx >= 0) {
      existing[idx] = rule;
    } else {
      existing.push(rule);
    }
    StorageHelpers.saveRules(existing);
    return existing;
  },

  removeRule: (ruleId: string) => {
    const rules = StorageHelpers.getRules().filter(r => r.id !== ruleId);
    StorageHelpers.saveRules(rules);
    return rules;
  },

  newRuleId: () => newId('rule'),

  // — Events (history) —
  getEvents: (): ProcessedMessageEvent[] =>
    readJsonArray(StorageKeys.EVENTS, ProcessedMessageEventSchema, 'event'),

  appendEvent: (event: ProcessedMessageEvent) => {
    const events = StorageHelpers.getEvents();
    events.unshift(event);
    if (events.length > EVENT_HISTORY_CAP) {
      events.length = EVENT_HISTORY_CAP;
    }
    requireStorage().set(StorageKeys.EVENTS, JSON.stringify(events));
    return events;
  },

  clearEvents: () => {
    requireStorage().set(StorageKeys.EVENTS, JSON.stringify([]));
  },
};
