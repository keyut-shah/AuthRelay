export type ReceiverForm = {
  teamName: string;
  telegramName: string;
  telegramBotToken: string;
  telegramChatId: string;
  senderFilter: string;
};

export type StoredRoute = ReceiverForm & {
  id: string;
};

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
  matchedRouteId?: string;
  matchedTeamName?: string;
  destinationName?: string;
  status: ProcessedEventStatus;
  /** Last 2 digits of the OTP, the rest masked. Null when no code was detected. */
  maskedCode: string | null;
  /** Machine-readable reason for ignored/failed events. */
  reason?: string;
};
