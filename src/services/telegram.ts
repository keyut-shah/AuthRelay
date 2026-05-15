import type { IncomingSmsEvent } from '../native/smsRouter';
import type { StoredRoute } from '../types';

type TelegramSendResponse = {
  ok: boolean;
  description?: string;
};

const TELEGRAM_API_BASE = 'https://api.telegram.org';

function buildTelegramMessage(route: StoredRoute, sms: IncomingSmsEvent) {
  return [
    `AuthRelay OTP for ${route.teamName}`,
    '',
    `Sender: ${sms.sender}`,
    `Route filter: ${route.senderFilter}`,
    `Destination: ${route.telegramName}`,
    '',
    sms.message,
  ].join('\n');
}

export function doesRouteMatchSender(route: StoredRoute, sender: string) {
  const normalizedFilter = route.senderFilter.trim().toLowerCase();
  const normalizedSender = sender.trim().toLowerCase();

  // Whitelist-only: an empty/missing filter must never forward.
  if (normalizedFilter.length === 0) {
    return false;
  }

  return normalizedSender.includes(normalizedFilter);
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
) {
  const response = await fetch(
    `${TELEGRAM_API_BASE}/bot${encodeURIComponent(botToken)}/sendMessage`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
      }),
    },
  );

  const body = (await response.json().catch(() => null)) as TelegramSendResponse | null;

  if (!response.ok || !body?.ok) {
    throw new Error(body?.description || `Telegram request failed with ${response.status}`);
  }

  return body;
}

export async function forwardSmsToTelegramRoute(
  route: StoredRoute,
  sms: IncomingSmsEvent,
) {
  const text = buildTelegramMessage(route, sms);
  return sendTelegramMessage(route.telegramBotToken, route.telegramChatId, text);
}

