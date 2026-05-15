export const StorageKeys = {
  ROUTES: 'app_routes',
  EVENTS: 'app_events',
} as const;

/** Maximum number of ProcessedMessageEvent entries kept on-device. */
export const EVENT_HISTORY_CAP = 200;
