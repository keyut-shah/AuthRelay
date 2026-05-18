import type { DestinationConfig, DestinationType, RouteRule } from '../../types';
import {
  doesRouteMatchMessage as doesRouteMatchMessageValue,
  doesRouteMatchSender as doesRouteMatchSenderValue,
} from '../routing';
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

export function doesRuleMatchSender(rule: RouteRule, sender: string): boolean {
  return doesRouteMatchSenderValue(rule, sender);
}

export function doesRuleMatchMessage(rule: RouteRule, message: string): boolean {
  return doesRouteMatchMessageValue(rule, message);
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
