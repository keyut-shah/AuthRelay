// ───────────────────────────────────────────────────────────
// Destinations — "who/where messages get delivered to"
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
  name: string; // human label, e.g. "Auth Alerts Bot"
  provider: DestinationProvider;
};

// ───────────────────────────────────────────────────────────
// Route rules — "what should be forwarded, and to which destination"
// ───────────────────────────────────────────────────────────

export type SenderMatchMode = 'contains'; // 'exact' | 'regex' come later

export type RouteRule = {
  id: string;
  enabled: boolean;
  teamName: string;
  senderPattern: string;
  senderMatchMode: SenderMatchMode;
  destinationId: string;
};

// ───────────────────────────────────────────────────────────
// UI form shape for the create-route wizard (collects rule + destination
// fields in a single flow). Split into a RouteRule + DestinationConfig on save.
// ───────────────────────────────────────────────────────────

export type ReceiverForm = {
  teamName: string;
  telegramName: string;
  telegramBotToken: string;
  telegramChatId: string;
  senderFilter: string;
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
  matchedTeamName?: string;
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
