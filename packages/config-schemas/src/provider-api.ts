import { z } from 'zod';

/** One key/value sent in the provider request (body or header). */
export const providerField = z.object({
  key: z.string().min(1),
  value: z.string(),
  /** Mask in the admin UI (password input). */
  secret: z.boolean().default(false),
});

export type ProviderField = z.infer<typeof providerField>;

/** Runtime placeholders substituted when sending. */
export const PROVIDER_FIELD_PLACEHOLDERS = [
  '{{to}}',
  '{{message}}',
  '{{subject}}',
  '{{from}}',
  '{{from_email}}',
] as const;

export const channelApiConfig = z.object({
  provider: z.string().optional(),
  enabled: z.boolean().default(true),
  /** HTTP endpoint (POST). */
  api_url: z.string().optional(),
  request_format: z.enum(['json', 'form']).default('json'),
  headers: z.array(providerField).default([]),
  /** Request body fields — use {{to}}, {{message}}, etc. for runtime values. */
  fields: z.array(providerField).default([]),
});

export type ChannelApiConfig = z.infer<typeof channelApiConfig>;

export const ADVANTA_SMS_SENDOTP_URL = 'https://quicksms.advantasms.com/api/services/sendotp/';
export const ADVANTA_SMS_SENDBULK_URL = 'https://quicksms.advantasms.com/api/services/sendbulk/';

export interface ProviderRuntimeContext {
  to?: string;
  message?: string;
  subject?: string;
  from?: string;
  from_email?: string;
}

/** Substitute {{to}}, {{message}}, … in configured field values. */
export function resolveProviderFields(
  fields: ProviderField[],
  ctx: ProviderRuntimeContext,
): Record<string, string> {
  const map: Record<string, string> = {
    to: ctx.to ?? '',
    message: ctx.message ?? '',
    subject: ctx.subject ?? '',
    from: ctx.from ?? '',
    from_email: ctx.from_email ?? '',
  };

  const out: Record<string, string> = {};
  for (const f of fields) {
    if (!f.key.trim()) continue;
    out[f.key] = f.value.replace(/\{\{([a-z_]+)\}\}/g, (_, name: string) => map[name] ?? '');
  }
  return out;
}

export interface ProviderPreset extends Omit<ChannelApiConfig, 'enabled'> {
  label: string;
  enabled?: boolean;
}

export const SMS_PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  advanta: {
    label: 'Advanta (KISIP)',
    provider: 'advanta',
    api_url: ADVANTA_SMS_SENDOTP_URL,
    request_format: 'json',
    headers: [],
    fields: [
      { key: 'apikey', value: '', secret: true },
      { key: 'partnerID', value: '12108', secret: false },
      { key: 'shortcode', value: 'KISIP', secret: false },
      { key: 'mobile', value: '{{to}}', secret: false },
      { key: 'message', value: '{{message}}', secret: false },
    ],
  },
  africas_talking: {
    label: "Africa's Talking",
    provider: 'africas_talking',
    api_url: 'https://api.africastalking.com/version1/messaging',
    request_format: 'form',
    headers: [{ key: 'apiKey', value: '', secret: true }],
    fields: [
      { key: 'username', value: '', secret: false },
      { key: 'to', value: '{{to}}', secret: false },
      { key: 'message', value: '{{message}}', secret: false },
      { key: 'from', value: 'KISIP', secret: false },
    ],
  },
  twilio: {
    label: 'Twilio',
    provider: 'twilio',
    api_url: 'https://api.twilio.com/2010-04-01/Accounts/{{account_sid}}/Messages.json',
    request_format: 'form',
    headers: [{ key: 'Authorization', value: 'Basic {{auth_basic}}', secret: true }],
    fields: [
      { key: 'To', value: '{{to}}', secret: false },
      { key: 'From', value: '', secret: false },
      { key: 'Body', value: '{{message}}', secret: false },
    ],
  },
  custom: {
    label: 'Custom HTTP',
    provider: 'custom',
    api_url: '',
    request_format: 'json',
    headers: [],
    fields: [
      { key: 'mobile', value: '{{to}}', secret: false },
      { key: 'message', value: '{{message}}', secret: false },
    ],
  },
};

export const EMAIL_PROVIDER_PRESETS: Record<string, ProviderPreset & { from_name?: string; from_address?: string }> = {
  smtp: {
    label: 'SMTP',
    provider: 'smtp',
    api_url: '',
    request_format: 'json',
    headers: [],
    fields: [
      { key: 'host', value: '', secret: false },
      { key: 'port', value: '587', secret: false },
      { key: 'user', value: '{{from_email}}', secret: false },
      { key: 'pass', value: '', secret: true },
    ],
  },
  gmail: {
    label: 'Gmail',
    provider: 'gmail',
    api_url: 'smtp.gmail.com',
    request_format: 'json',
    headers: [],
    fields: [
      { key: 'user', value: 'kisip.mis@gmail.com', secret: false },
      { key: 'pass', value: '', secret: true },
    ],
  },
  sendgrid: {
    label: 'SendGrid',
    provider: 'sendgrid',
    api_url: 'smtp.sendgrid.net',
    request_format: 'json',
    headers: [],
    fields: [{ key: 'pass', value: '', secret: true }],
  },
  custom: {
    label: 'Custom HTTP',
    provider: 'custom',
    api_url: '',
    request_format: 'json',
    headers: [{ key: 'Authorization', value: 'Bearer ', secret: true }],
    fields: [
      { key: 'to', value: '{{to}}', secret: false },
      { key: 'subject', value: '{{subject}}', secret: false },
      { key: 'body', value: '{{message}}', secret: false },
    ],
  },
};

export function applyProviderPreset(
  target: Record<string, unknown>,
  preset: ProviderPreset,
  opts?: { keepSecrets?: boolean },
) {
  const prevFields = (target.fields as ProviderField[] | undefined) ?? [];
  const secretByKey = new Map(prevFields.filter((f) => f.secret && f.value).map((f) => [f.key, f.value]));

  target.provider = preset.provider;
  target.api_url = preset.api_url ?? '';
  target.request_format = preset.request_format ?? 'json';
  target.headers = structuredClone(preset.headers ?? []);
  target.fields = (preset.fields ?? []).map((f) => ({
    ...f,
    value: opts?.keepSecrets && f.secret && secretByKey.has(f.key) ? secretByKey.get(f.key)! : f.value,
  }));
}

/** Ensure fields/headers arrays exist on a channel sender config. */
export function ensureChannelApiConfig(sender: Record<string, unknown>) {
  sender.enabled ??= true;
  sender.provider ??= '';
  sender.api_url ??= '';
  sender.request_format ??= 'json';
  sender.headers ??= [];
  sender.fields ??= [];
  if (!Array.isArray(sender.headers)) sender.headers = [];
  if (!Array.isArray(sender.fields)) sender.fields = [];
}

/** Migrate legacy api_token / sender_id into fields when loading old tenant config. */
export function migrateLegacySender(sender: Record<string, unknown>, kind: 'sms' | 'email' | 'whatsapp') {
  ensureChannelApiConfig(sender);
  const fields = sender.fields as ProviderField[];
  if (fields.length > 0) return;

  const legacyToken = String(sender.api_token ?? '').trim();
  const legacySenderId = String(sender.sender_id ?? '').trim();
  const legacyPartner = String(sender.partner_id ?? '').trim();

  if (kind === 'sms') {
    if (legacyToken) fields.push({ key: 'apikey', value: legacyToken, secret: true });
    if (legacyPartner) fields.push({ key: 'partnerID', value: legacyPartner, secret: false });
    if (legacySenderId) fields.push({ key: 'shortcode', value: legacySenderId, secret: false });
    fields.push(
      { key: 'mobile', value: '{{to}}', secret: false },
      { key: 'message', value: '{{message}}', secret: false },
    );
  } else if (kind === 'email' && legacyToken) {
    fields.push({ key: 'pass', value: legacyToken, secret: true });
  } else if (kind === 'whatsapp' && legacyToken) {
    sender.headers = [{ key: 'Authorization', value: `Bearer ${legacyToken}`, secret: true }];
  }
}
