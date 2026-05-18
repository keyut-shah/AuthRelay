import { z } from 'zod';

// ───────────────────────────────────────────────────────────
// Provider-specific shapes
// ───────────────────────────────────────────────────────────

// Telegram bot token format: "<bot_id>:<35+ url-safe chars>"
const TELEGRAM_BOT_TOKEN_REGEX = /^\d+:[A-Za-z0-9_-]{30,}$/;
// Telegram chat id: numeric (channels/groups can be negative) or "@username"
const TELEGRAM_CHAT_ID_REGEX = /^(-?\d+|@[A-Za-z0-9_]{5,})$/;

export const TelegramProviderSchema = z.object({
  type: z.literal('telegram'),
  botToken: z
    .string()
    .min(1, 'Bot token is required')
    .regex(TELEGRAM_BOT_TOKEN_REGEX, 'Invalid Telegram bot token format'),
  chatId: z
    .string()
    .min(1, 'Chat ID is required')
    .regex(TELEGRAM_CHAT_ID_REGEX, 'Chat ID must be a numeric ID or @username'),
});

// Discriminated union — add SlackProviderSchema / DiscordProviderSchema here.
export const DestinationProviderSchema = z.discriminatedUnion('type', [
  TelegramProviderSchema,
]);

export const DestinationConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, 'Destination name is required'),
  provider: DestinationProviderSchema,
});

// ───────────────────────────────────────────────────────────
// Rules
// ───────────────────────────────────────────────────────────

export const RouteRuleSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
  teamName: z.string().min(1, 'Team name is required'),
  senderPattern: z.string().min(1, 'Sender filter is required'),
  senderMatchMode: z.literal('contains'),
  destinationId: z.string().min(1),
});

// ───────────────────────────────────────────────────────────
// Event history
// ───────────────────────────────────────────────────────────

export const ProcessedMessageEventSchema = z.object({
  id: z.string().min(1),
  createdAt: z.number(),
  sender: z.string(),
  matchedRuleId: z.string().optional(),
  matchedTeamName: z.string().optional(),
  destinationName: z.string().optional(),
  status: z.enum(['sent', 'failed', 'ignored']),
  maskedCode: z.string().nullable(),
  reason: z.string().optional(),
});

// ───────────────────────────────────────────────────────────
// Wizard form — validated at save time
// ───────────────────────────────────────────────────────────

export const ReceiverFormSchema = z.object({
  teamName: z.string().trim().min(1, 'Team name is required'),
  telegramName: z.string().trim().min(1, 'Destination name is required'),
  telegramBotToken: z
    .string()
    .trim()
    .regex(TELEGRAM_BOT_TOKEN_REGEX, 'Invalid Telegram bot token format'),
  telegramChatId: z
    .string()
    .trim()
    .regex(TELEGRAM_CHAT_ID_REGEX, 'Chat ID must be a numeric ID or @username'),
  senderFilter: z.string().trim().min(1, 'Sender filter is required'),
});

export type ReceiverFormValidated = z.infer<typeof ReceiverFormSchema>;

// ───────────────────────────────────────────────────────────
// Helpers for storage layer — silently drop invalid rows.
// ───────────────────────────────────────────────────────────

export function safeParseArray<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  label: string,
): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const item of raw) {
    const result = schema.safeParse(item);
    if (result.success) {
      out.push(result.data);
    } else {
      console.warn(`[schemas] Dropping invalid ${label} row`, result.error.flatten());
    }
  }
  return out;
}
