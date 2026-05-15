import type { DestinationConfig, DestinationType, RouteRule } from '../../types';
import { telegramAdapter } from './telegram';
import type { DeliveryPayload, IntegrationAdapter } from './types';

const adapters: Record<DestinationType, IntegrationAdapter> = {
  telegram: telegramAdapter,
};

export function getAdapter(type: DestinationType): IntegrationAdapter {
  const adapter = adapters[type];
  if (!adapter) throw new Error(`No integration adapter registered for type ${type}`);
  return adapter;
}

/**
 * Match a rule against an incoming sender. Whitelist-only: empty/missing
 * patterns never match.
 */
export function doesRuleMatchSender(rule: RouteRule, sender: string): boolean {
  if (!rule.enabled) return false;
  const pattern = rule.senderPattern.trim().toLowerCase();
  if (pattern.length === 0) return false;
  const normalizedSender = sender.trim().toLowerCase();
  switch (rule.senderMatchMode) {
    case 'contains':
      return normalizedSender.includes(pattern);
    default:
      return false;
  }
}

export type SendOutcome = { status: 'sent' } | { status: 'failed'; error: Error };

/**
 * Send an OTP through the destination's adapter. Returns a structured outcome
 * rather than throwing — callers can log/record failures uniformly.
 */
export async function sendThroughAdapter(payload: DeliveryPayload): Promise<SendOutcome> {
  try {
    const adapter = getAdapter(payload.destination.provider.type);
    await adapter.send(payload);
    return { status: 'sent' };
  } catch (e) {
    return { status: 'failed', error: e instanceof Error ? e : new Error(String(e)) };
  }
}

export async function testDestination(destination: DestinationConfig): Promise<void> {
  const adapter = getAdapter(destination.provider.type);
  await adapter.test(destination);
}

export type { DeliveryPayload, IntegrationAdapter };
