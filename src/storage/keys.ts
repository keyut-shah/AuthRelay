export const StorageKeys = {
  /** @deprecated kept for one-shot migration to DESTINATIONS + RULES */
  ROUTES_LEGACY: 'app_routes',
  DESTINATIONS: 'app_destinations',
  RULES: 'app_rules',
  EVENTS: 'app_events',
} as const;

/** Maximum number of ProcessedMessageEvent entries kept on-device. */
export const EVENT_HISTORY_CAP = 200;
