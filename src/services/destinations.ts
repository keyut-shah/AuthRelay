import type { DestinationConfig } from '../types';

export function buildTelegramDestinationName(chatId: string): string {
  const trimmed = chatId.trim();
  if (!trimmed) return 'Telegram destination';
  if (trimmed.startsWith('@')) return `Telegram ${trimmed}`;
  const suffix = trimmed.length > 6 ? trimmed.slice(-6) : trimmed;
  return `Telegram chat ${suffix}`;
}

export function getDestinationDisplayName(destination: DestinationConfig | null): string {
  if (!destination) return 'Destination missing';
  if (destination.name.trim()) return `Telegram (${destination.name})`;
  if (destination.provider.type === 'telegram') {
    return `Telegram (${buildTelegramDestinationName(destination.provider.chatId)})`;
  }
  return 'Telegram';
}
