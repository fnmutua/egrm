import type { ChannelApiConfig, ProviderField } from '@egrm/config-schemas';
import { META_WHATSAPP_API_VERSION } from '@egrm/config-schemas';
import type { OutboundWhatsApp, SendResult, WhatsAppSenderConfig } from './types.js';
import { DeliveryError } from './types.js';
import { formatMobileNumber } from './phone.js';
import { sendConfiguredHttp } from './provider-http.js';

function authHeader(cfg: WhatsAppSenderConfig): string {
  const row = (cfg.headers ?? []).find((h) => h.key.toLowerCase() === 'authorization');
  const value = row?.value?.trim() ?? '';
  if (!value || value === 'Bearer') {
    throw new DeliveryError('Authorization Bearer token required in CD-09 senders.whatsapp', 'whatsapp', false);
  }
  return value.startsWith('Bearer ') ? value : `Bearer ${value}`;
}

function apiUrl(cfg: WhatsAppSenderConfig): string {
  const phoneNumberId = cfg.phone_number_id?.trim();
  if (!phoneNumberId) {
    throw new DeliveryError('phone_number_id required in CD-09 senders.whatsapp', 'whatsapp', false);
  }
  if (phoneNumberId.startsWith('+') || !/^\d+$/.test(phoneNumberId)) {
    throw new DeliveryError(
      'phone_number_id must be the numeric Meta API ID from WhatsApp → API Setup (not the +254 display number)',
      'meta',
      false,
    );
  }
  const custom = cfg.api_url?.trim();
  if (custom) return custom.replace(/\{\{phone_number_id\}\}/g, phoneNumberId);
  return `https://graph.facebook.com/${META_WHATSAPP_API_VERSION}/${phoneNumberId}/messages`;
}

function buildTemplatePayload(cfg: WhatsAppSenderConfig, message: OutboundWhatsApp) {
  const isTest = (cfg.mode ?? 'test') === 'test';
  const name = isTest
    ? 'hello_world'
    : message.templateName?.trim() || cfg.template_name?.trim() || 'hello_world';
  const language = isTest
    ? 'en_US'
    : message.templateLanguage?.trim() || cfg.template_language?.trim() || 'en_US';
  const params = isTest ? [] : (message.templateBodyParams ?? []).filter((p) => p.trim().length > 0);

  const template: Record<string, unknown> = {
    name,
    language: { code: language },
  };

  if (params.length > 0) {
    template.components = [
      {
        type: 'body',
        parameters: params.map((text) => ({ type: 'text', text })),
      },
    ];
  }

  return template;
}

/** Send a WhatsApp template message via Meta Cloud API (CD-09 senders.whatsapp). */
async function sendMetaWhatsApp(
  cfg: WhatsAppSenderConfig,
  message: OutboundWhatsApp,
): Promise<SendResult> {
  const to = formatMobileNumber(message.to);
  if (!to) throw new DeliveryError('Invalid WhatsApp recipient phone', 'meta', false);

  const res = await fetch(apiUrl(cfg), {
    method: 'POST',
    headers: {
      Authorization: authHeader(cfg),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: buildTemplatePayload(cfg, message),
    }),
  });

  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  const msg = (data as { messages?: { id?: string; message_status?: string }[] })?.messages?.[0];
  const messageId = msg?.id;
  if (!res.ok || !messageId) {
    const errMsg =
      (data as { error?: { message?: string } })?.error?.message ??
      `HTTP ${res.status}: ${text.slice(0, 200)}`;
    throw new DeliveryError(errMsg, 'meta', res.status >= 500);
  }

  const status = msg?.message_status ?? 'sent';
  const envTag = (cfg.mode ?? 'test') === 'live' ? 'live' : 'test';
  return { messageId: `${messageId}:${status}`, provider: `meta:${envTag}` };
}

/** Route WhatsApp via Meta Cloud API or configurable HTTP (CD-09 senders.whatsapp). */
export async function sendWhatsApp(cfg: WhatsAppSenderConfig, message: OutboundWhatsApp): Promise<SendResult> {
  if (cfg.enabled === false) {
    throw new DeliveryError('WhatsApp sender disabled', cfg.provider ?? 'whatsapp', false);
  }
  if (!message.to?.trim()) {
    throw new DeliveryError('Missing recipient phone', cfg.provider ?? 'whatsapp', false);
  }

  const provider = (cfg.provider ?? 'meta').toLowerCase();
  if (provider === 'meta') {
    return sendMetaWhatsApp(cfg, message);
  }

  if (!message.body?.trim()) {
    throw new DeliveryError('Empty WhatsApp body', cfg.provider ?? 'whatsapp', false);
  }

  return sendConfiguredHttp(
    cfg,
    { to: message.to, message: message.body, from: cfg.display_number },
    { formatPhone: true, from: cfg.display_number },
  );
}
