import type { ChannelApiConfig, ProviderField, ProviderRuntimeContext } from '@egrm/config-schemas';
import { resolveProviderFields } from '@egrm/config-schemas';
import { DeliveryError, type SendResult } from './types.js';
import { formatMobileNumber } from './phone.js';

function resolveUrlTemplate(url: string, ctx: ProviderRuntimeContext): string {
  const map: Record<string, string> = {
    to: ctx.to ?? '',
    message: ctx.message ?? '',
    subject: ctx.subject ?? '',
    from: ctx.from ?? '',
    from_email: ctx.from_email ?? '',
  };
  return url.replace(/\{\{([a-z_]+)\}\}/g, (_, name: string) => map[name] ?? '');
}

function fieldValue(fields: ProviderField[], key: string): string | undefined {
  return fields.find((f) => f.key === key)?.value?.trim() || undefined;
}

/** Advanta QuickSMS success codes. */
function parseAdvantaResponse(data: unknown): { ok: boolean; code: string } {
  const d = data as Record<string, unknown> | null;
  const respCode = String(
    d?.['response-code'] ??
      (Array.isArray(d?.responses) &&
        (d.responses as Record<string, unknown>[])?.[0]?.['response-code']) ??
      '200',
  );
  const ok = respCode === '200' || respCode === '0' || respCode === 'OK' || respCode === '1000';
  return { ok, code: respCode };
}

export interface HttpSendOptions {
  formatPhone?: boolean;
  from?: string;
  from_email?: string;
}

/** POST configured headers + body fields to api_url. */
export async function sendConfiguredHttp(
  cfg: ChannelApiConfig,
  ctx: ProviderRuntimeContext,
  opts?: HttpSendOptions,
): Promise<SendResult> {
  const provider = (cfg.provider ?? 'custom').toLowerCase();
  const rawUrl = cfg.api_url?.trim();
  if (!rawUrl) throw new DeliveryError('api_url required', provider, false);

  const to = opts?.formatPhone && ctx.to ? formatMobileNumber(ctx.to) ?? ctx.to : ctx.to;
  const runtime: ProviderRuntimeContext = {
    ...ctx,
    to,
    from: opts?.from ?? ctx.from,
    from_email: opts?.from_email ?? ctx.from_email,
  };

  const url = resolveUrlTemplate(rawUrl, runtime);
  const headers = resolveProviderFields(cfg.headers ?? [], runtime);
  const bodyFields = resolveProviderFields(cfg.fields ?? [], runtime);

  const missing = (cfg.fields ?? []).filter(
    (f) => f.secret && !bodyFields[f.key]?.trim() && !headers[f.key]?.trim(),
  );
  if (missing.length) {
    const keys = missing.map((f) => f.key).join(', ');
    throw new DeliveryError(`Missing secret field(s): ${keys}`, provider, false);
  }

  const reqHeaders: Record<string, string> = { ...headers };
  let body: string | URLSearchParams;
  if (cfg.request_format === 'form') {
    body = new URLSearchParams(bodyFields);
    if (!reqHeaders['Content-Type']) reqHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
  } else {
    body = JSON.stringify(bodyFields);
    if (!reqHeaders['Content-Type']) reqHeaders['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, { method: 'POST', headers: reqHeaders, body });
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (provider === 'advanta') {
    const { ok, code } = parseAdvantaResponse(data);
    if (!res.ok || !ok) {
      throw new DeliveryError(
        `Advanta rejected (${code}): ${text.slice(0, 200)}`,
        provider,
        res.status >= 500,
      );
    }
    return { messageId: `advanta-${code}-${Date.now()}`, provider };
  }

  const twilioSid = (data as { sid?: string })?.sid;
  if (provider === 'twilio' && twilioSid) {
    return { messageId: twilioSid, provider };
  }

  if (!res.ok) {
    const errMsg =
      (data as { message?: string })?.message ?? `HTTP ${res.status}: ${text.slice(0, 200)}`;
    throw new DeliveryError(errMsg, provider, res.status >= 500);
  }

  return { messageId: `${provider}-${Date.now()}`, provider };
}

/** Read a configured field by key (for SMTP transport setup). */
export function getConfiguredField(fields: ProviderField[] | undefined, key: string): string {
  return fieldValue(fields ?? [], key) ?? '';
}
