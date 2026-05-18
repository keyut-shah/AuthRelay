// ───────────────────────────────────────────────────────────
// Destinations — "where messages get delivered to"
// ───────────────────────────────────────────────────────────

export type DestinationType = 'telegram'; // 'slack' | 'discord' come later

export type TelegramDestinationConfig = {
  type: 'telegram';
  botToken: string;
  chatId: string;
};

// Discriminated union — extend with SlackDestinationConfig etc. later.
export type DestinationProvider = TelegramDestinationConfig;

export type DestinationConfig = {
  id: string;
  name: string;
  provider: DestinationProvider;
};

// ───────────────────────────────────────────────────────────
// Route rules — "what should be forwarded, and to which destination"
// ───────────────────────────────────────────────────────────

export type SenderSourceType = 'any' | 'sender_id' | 'contact';
export type MessageFilterMode = 'include' | 'exclude' | 'advanced';

export type RouteRule = {
  id: string;
  enabled: boolean;
  routeName: string;
  senderSourceType: SenderSourceType;
  senderPattern: string;
  contactDisplayName: string | null;
  contactPhoneNumbers: string[];
  messageAllowPatterns: string[];
  messageBlockPatterns: string[];
  destinationId: string;
};

// ───────────────────────────────────────────────────────────
// UI form shape for the create-route wizard
// ───────────────────────────────────────────────────────────

export type RouteForm = {
  routeName: string;
  telegramBotToken: string;
  telegramChatId: string;
  senderSourceType: SenderSourceType;
  senderPattern: string;
  contactDisplayName: string;
  contactPhoneNumbers: string[];
  useMessageFilters: boolean;
  messageFilterMode: MessageFilterMode;
  messageAllowInput: string;
  messageBlockInput: string;
};

/**
 * Result returned by the native system-contact picker. We use Android's
 * ACTION_PICK so the user sees their familiar contacts app — no
 * READ_CONTACTS permission is required, and the system grants temporary
 * read access to the single picked phone row.
 */
export type PickedContact = {
  displayName: string;
  phoneNumber: string;
};

// ───────────────────────────────────────────────────────────
// SMS event preview + processed history
// ───────────────────────────────────────────────────────────

export type SmsEventPreview = {
  sender: string;
  message: string;
  source: string;
  receivedAt: number;
};

export type ProcessedEventStatus = 'sent' | 'failed' | 'ignored';

export type ProcessedMessageEvent = {
  id: string;
  createdAt: number;
  sender: string;
  matchedRuleId?: string;
  matchedRouteName?: string;
  destinationName?: string;
  status: ProcessedEventStatus;
  /** Last 2 digits of the OTP, the rest masked. Null when no code was detected. */
  maskedCode: string | null;
  /** Machine-readable reason for ignored/failed events. */
  reason?: string;
};

// ───────────────────────────────────────────────────────────
// Display helpers
// ───────────────────────────────────────────────────────────

/** Joined view of a rule with its resolved destination — used by the home screen list. */
export type RouteRuleView = {
  rule: RouteRule;
  destination: DestinationConfig | null;
};
