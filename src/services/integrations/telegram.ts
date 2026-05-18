import type { DestinationConfig } from '../../types';
import { describeSenderRule } from '../routing';
import type { DeliveryPayload, IntegrationAdapter } from './types';

const TELEGRAM_API_BASE = 'https://api.telegram.org';

type TelegramSendResponse = {
  ok: boolean;
  description?: string;
};

function ensureTelegram(destination: DestinationConfig) {
  if (destination.provider.type !== 'telegram') {
    throw new Error(`Expected telegram destination, got ${destination.provider.type}`);
  }
  return destination.provider;
}

function buildOtpText(payload: DeliveryPayload) {
  const { rule, destination, sender, rawMessage } = payload;
  return [
    `AuthRelay OTP for ${rule.routeName}`,
    '',
    `Sender: ${sender}`,
    `Route: ${rule.routeName}`,
    `Sender rule: ${describeSenderRule(rule)}`,
    `Destination: ${destination.name}`,
    '',
    rawMessage,
  ].join('\n');
}

function buildTestText(destination: DestinationConfig) {
  return [
    `AuthRelay test message`,
    '',
    `Destination: ${destination.name}`,
    '',
    'If you received this, your Telegram bot token and chat ID are working.',
  ].join('\n');
}

async function postSendMessage(botToken: string, chatId: string, text: string) {
  const response = await fetch(
    `${TELEGRAM_API_BASE}/bot${encodeURIComponent(botToken)}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    },
  );
  const body = (await response.json().catch(() => null)) as TelegramSendResponse | null;
  if (!response.ok || !body?.ok) {
    throw new Error(body?.description || `Telegram request failed with ${response.status}`);
  }
}

export const telegramAdapter: IntegrationAdapter = {
  type: 'telegram',
  async send(payload) {
    const { botToken, chatId } = ensureTelegram(payload.destination);
    await postSendMessage(botToken, chatId, buildOtpText(payload));
  },
  async test(destination) {
    const { botToken, chatId } = ensureTelegram(destination);
    await postSendMessage(botToken, chatId, buildTestText(destination));
  },
};
