import type { OutboundSms, SendResult, SmsSenderConfig } from './types.js';
import { DeliveryError, normalizeSmsConfig } from './types.js';
import { sendConfiguredHttp } from './provider-http.js';
export { formatMobileNumber } from './phone.js';

/** Route SMS via configured api_url, headers, and body fields (CD-09 senders.sms). */
export async function sendSms(cfg: SmsSenderConfig, message: OutboundSms): Promise<SendResult> {
  const normalized = normalizeSmsConfig(cfg);

  if (normalized.enabled === false) {
    throw new DeliveryError('SMS sender disabled', normalized.provider ?? 'sms', false);
  }
  if (!message.to?.trim()) {
    throw new DeliveryError('Missing recipient phone', normalized.provider ?? 'sms', false);
  }
  if (!message.body?.trim()) {
    throw new DeliveryError('Empty SMS body', normalized.provider ?? 'sms', false);
  }

  const provider = (normalized.provider ?? 'custom').toLowerCase();

  // SMTP-like mail providers use nodemailer — everything else is configurable HTTP.
  if (provider === 'smtp' || provider === 'gmail' || provider === 'sendgrid') {
    throw new DeliveryError(`Provider "${provider}" is not an SMS backend`, provider, false);
  }

  return sendConfiguredHttp(
    normalized,
    { to: message.to, message: message.body },
    { formatPhone: true },
  );
}
