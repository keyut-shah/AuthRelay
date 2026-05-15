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
