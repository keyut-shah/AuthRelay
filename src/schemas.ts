import { z } from 'zod';
import { parsePhraseList } from './services/routing';

// ───────────────────────────────────────────────────────────
// Provider-specific shapes
// ───────────────────────────────────────────────────────────

// Telegram bot token format: "<bot_id>:<35+ url-safe chars>"
const TELEGRAM_BOT_TOKEN_REGEX = /^\d+:[A-Za-z0-9_-]{30,}$/;
// Telegram chat id: numeric (channels/groups can be negative) or "@username"
const TELEGRAM_CHAT_ID_REGEX = /^(-?\d+|@[A-Za-z0-9_]{5,})$/;

const phraseArray = z.array(z.string()).catch([]);

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

const RawRouteRuleSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean().catch(true),
  routeName: z.string().optional(),
  teamName: z.string().optional(),
  senderSourceType: z.enum(['any', 'sender_id', 'contact']).optional(),
  senderPattern: z.string().optional(),
  contactDisplayName: z.string().nullable().optional(),
  contactPhoneNumbers: phraseArray,
  messageAllowPatterns: phraseArray,
  messageBlockPatterns: phraseArray,
  destinationId: z.string().min(1),
});

export const RouteRuleSchema = RawRouteRuleSchema.transform(raw => ({
  id: raw.id,
  enabled: raw.enabled,
  routeName: (raw.routeName ?? raw.teamName ?? '').trim() || 'Route',
  senderSourceType: raw.senderSourceType ?? 'sender_id',
  senderPattern: (raw.senderPattern ?? '').trim(),
  contactDisplayName: raw.contactDisplayName?.trim() || null,
  contactPhoneNumbers: raw.contactPhoneNumbers
    .map(value => value.trim())
    .filter(Boolean),
  messageAllowPatterns: raw.messageAllowPatterns
    .map(value => value.trim())
    .filter(Boolean),
  messageBlockPatterns: raw.messageBlockPatterns
    .map(value => value.trim())
    .filter(Boolean),
  destinationId: raw.destinationId,
}));

// ───────────────────────────────────────────────────────────
// Event history
// ───────────────────────────────────────────────────────────

const RawProcessedMessageEventSchema = z.object({
  id: z.string().min(1),
  createdAt: z.number(),
  sender: z.string(),
  matchedRuleId: z.string().optional(),
  matchedRouteName: z.string().optional(),
  matchedTeamName: z.string().optional(),
  destinationName: z.string().optional(),
  status: z.enum(['sent', 'failed', 'ignored']),
  maskedCode: z.string().nullable(),
  reason: z.string().optional(),
});

export const ProcessedMessageEventSchema = RawProcessedMessageEventSchema.transform(raw => ({
  id: raw.id,
  createdAt: raw.createdAt,
  sender: raw.sender,
  matchedRuleId: raw.matchedRuleId,
  matchedRouteName: raw.matchedRouteName ?? raw.matchedTeamName,
  destinationName: raw.destinationName,
  status: raw.status,
  maskedCode: raw.maskedCode,
  reason: raw.reason,
}));

// ───────────────────────────────────────────────────────────
// Wizard form — validated at save time
// ───────────────────────────────────────────────────────────

export const RouteFormSchema = z
  .object({
    routeName: z.string().trim().min(1, 'Route name is required'),
    telegramBotToken: z
      .string()
      .trim()
      .regex(TELEGRAM_BOT_TOKEN_REGEX, 'Invalid Telegram bot token format'),
    telegramChatId: z
      .string()
      .trim()
      .regex(TELEGRAM_CHAT_ID_REGEX, 'Chat ID must be a numeric ID or @username'),
    senderSourceType: z.enum(['any', 'sender_id', 'contact']),
    senderPattern: z.string().trim(),
    contactDisplayName: z.string().trim(),
    contactPhoneNumbers: z.array(z.string()).catch([]),
    useMessageFilters: z.boolean(),
    messageFilterMode: z.enum(['include', 'exclude', 'advanced']),
    messageAllowInput: z.string(),
    messageBlockInput: z.string(),
  })
  .superRefine((value, ctx) => {
    if (value.senderSourceType === 'sender_id' && value.senderPattern.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['senderPattern'],
        message: 'Sender ID or number is required',
      });
    }

    if (value.senderSourceType === 'contact') {
      if (!value.contactDisplayName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['contactDisplayName'],
          message: 'Choose a saved contact',
        });
      }

      if (value.contactPhoneNumbers.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['contactPhoneNumbers'],
          message: 'Selected contact must have at least one phone number',
        });
      }
    }

    if (!value.useMessageFilters) return;

    const allowPatterns = parsePhraseList(value.messageAllowInput);
    const blockPatterns = parsePhraseList(value.messageBlockInput);

    if (value.messageFilterMode === 'include' && allowPatterns.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['messageAllowInput'],
        message: 'Add at least one required phrase',
      });
    }

    if (value.messageFilterMode === 'exclude' && blockPatterns.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['messageBlockInput'],
        message: 'Add at least one blocked phrase',
      });
    }

    if (value.messageFilterMode === 'advanced') {
      if (allowPatterns.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['messageAllowInput'],
          message: 'Add at least one required phrase',
        });
      }

      if (blockPatterns.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['messageBlockInput'],
          message: 'Add at least one blocked phrase',
        });
      }
    }
  });

export type RouteFormValidated = z.infer<typeof RouteFormSchema>;

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
