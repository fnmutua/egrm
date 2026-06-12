import type { ChannelApiConfig, ProviderField } from '@egrm/config-schemas';
import { SMS_PROVIDER_PRESETS, EMAIL_PROVIDER_PRESETS } from '@egrm/config-schemas';

export interface EmailSenderConfig extends ChannelApiConfig {
  from_name?: string;
  from_address?: string;
  /** @deprecated migrated to fields[] */
  api_token?: string;
}

export interface SmsSenderConfig extends ChannelApiConfig {
  bulk_api_url?: string;
  /** @deprecated migrated to fields[] */
  sender_id?: string;
  /** @deprecated migrated to fields[] */
  partner_id?: string;
  /** @deprecated migrated to fields[] */
  api_token?: string;
}

export interface OutboundEmail {
  to: string;
  subject: string;
  body: string;
}

export interface OutboundSms {
  to: string;
  body: string;
}

export interface SendResult {
  messageId: string;
  provider: string;
}

export class DeliveryError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly retryable = true,
  ) {
    super(message);
    this.name = 'DeliveryError';
  }
}

function legacyString(raw: SmsSenderConfig | EmailSenderConfig, key: string): string | undefined {
  const val = (raw as unknown as Record<string, unknown>)[key];
  return typeof val === 'string' ? val : undefined;
}

function mergeLegacyIntoFields(
  fields: ProviderField[],
  legacy: Record<string, string | undefined>,
  mapping: Record<string, string>,
): ProviderField[] {
  const out = fields.map((f) => ({ ...f }));
  for (const [legacyKey, fieldKey] of Object.entries(mapping)) {
    const val = legacy[legacyKey]?.trim();
    if (!val) continue;
    const idx = out.findIndex((f) => f.key === fieldKey);
    if (idx >= 0 && !out[idx]!.value.trim()) {
      out[idx] = { key: out[idx]!.key, value: val, secret: out[idx]!.secret };
    }
  }
  return out;
}

/** Upgrade legacy api_token / sender_id shapes to configurable fields[]. */
export function normalizeSmsConfig(raw: SmsSenderConfig): SmsSenderConfig {
  if ((raw.fields?.length ?? 0) > 0) return raw;

  const provider = (raw.provider ?? 'advanta').toLowerCase();
  const preset = SMS_PROVIDER_PRESETS[provider] ?? SMS_PROVIDER_PRESETS.custom!;
  const legacy: Record<string, string | undefined> = {
    api_token: legacyString(raw, 'api_token'),
    sender_id: legacyString(raw, 'sender_id'),
    partner_id: legacyString(raw, 'partner_id'),
  };
  const fields = mergeLegacyIntoFields(preset.fields ?? [], legacy, {
    api_token: provider === 'advanta' ? 'apikey' : 'apiKey',
    sender_id: provider === 'advanta' ? 'shortcode' : provider === 'twilio' ? 'From' : 'from',
    partner_id: 'partnerID',
  });

  return {
    ...raw,
    api_url: raw.api_url?.trim() || preset.api_url,
    request_format: raw.request_format ?? preset.request_format ?? 'json',
    headers: raw.headers?.length ? raw.headers : (preset.headers ?? []),
    fields,
  };
}

export function normalizeEmailConfig(raw: EmailSenderConfig): EmailSenderConfig {
  if ((raw.fields?.length ?? 0) > 0) return raw;

  const provider = (raw.provider ?? 'smtp').toLowerCase();
  const preset = EMAIL_PROVIDER_PRESETS[provider] ?? EMAIL_PROVIDER_PRESETS.smtp!;
  const legacy: Record<string, string | undefined> = {
    api_token: legacyString(raw, 'api_token'),
  };
  const fields = mergeLegacyIntoFields(preset.fields ?? [], legacy, {
    api_token: 'pass',
  });

  return {
    ...raw,
    api_url: raw.api_url?.trim() || preset.api_url,
    request_format: raw.request_format ?? preset.request_format ?? 'json',
    headers: raw.headers?.length ? raw.headers : (preset.headers ?? []),
    fields,
  };
}

export type { ChannelApiConfig, ProviderField };
