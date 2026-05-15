package com.msgforwarderapp.sms.integrations

/**
 * Lookup table from a destination provider variant to its outbound adapter.
 * Add a new entry when introducing Slack / Discord adapters.
 */
object AdapterRegistry {
  private val telegram: IntegrationAdapter by lazy { TelegramAdapter() }

  fun adapterFor(provider: DestinationProvider): IntegrationAdapter =
      when (provider) {
        is DestinationProvider.Telegram -> telegram
      }
}
