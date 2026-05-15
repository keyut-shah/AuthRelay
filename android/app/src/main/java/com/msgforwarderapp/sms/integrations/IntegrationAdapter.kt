package com.msgforwarderapp.sms.integrations

/**
 * Provider configuration loaded from MMKV. Mirrors the discriminated union
 * `DestinationProvider` in src/types.ts. Add a new branch when adding Slack /
 * Discord — the dispatcher pattern-matches over these.
 */
sealed class DestinationProvider {
  data class Telegram(val botToken: String, val chatId: String) : DestinationProvider()
}

/** Joined view of a destination row from MMKV. */
data class Destination(
    val id: String,
    val name: String,
    val provider: DestinationProvider,
)

/** Joined view of a rule row from MMKV. */
data class Rule(
    val id: String,
    val enabled: Boolean,
    val teamName: String,
    val senderPattern: String,
    val senderMatchMode: String,
    val destinationId: String,
)

/** Payload an adapter receives when forwarding a matched SMS. */
data class DeliveryPayload(
    val sender: String,
    val rawMessage: String,
    val maskedCode: String?,
    val rule: Rule,
    val destination: Destination,
)

/**
 * Common interface for all outbound integrations (Telegram now; Slack /
 * Discord come later). Mirrors src/services/integrations/types.ts.
 */
interface IntegrationAdapter {
  /** Forward a matched SMS. Must throw on any failure for the dispatcher to record it. */
  fun send(payload: DeliveryPayload)
}
