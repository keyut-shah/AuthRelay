import type { DestinationConfig, DestinationType, RouteRule } from '../../types';

/**
 * Common payload every integration adapter receives. Sender/raw message
 * are unmasked here because the integration is the boundary — the
 * destination workspace is the only place the full OTP needs to exist.
 */
export type DeliveryPayload = {
  sender: string;
  rawMessage: string;
  maskedCode: string | null;
  rule: RouteRule;
  destination: DestinationConfig;
};

export interface IntegrationAdapter {
  readonly type: DestinationType;
  /** Forward an OTP to the destination. Must throw on failure. */
  send(payload: DeliveryPayload): Promise<void>;
  /** Send a credential-test message. Must throw on failure. */
  test(destination: DestinationConfig): Promise<void>;
}
