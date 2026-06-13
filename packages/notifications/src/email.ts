import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { EmailSenderConfig, OutboundEmail, SendResult } from './types.js';
import { DeliveryError, normalizeEmailConfig } from './types.js';
import { getConfiguredField, sendConfiguredHttp } from './provider-http.js';

function fromAddress(cfg: EmailSenderConfig): string {
  const addr = cfg.from_address?.trim();
  const name = cfg.from_name?.trim();
  if (addr && name) return `"${name}" <${addr}>`;
  return addr ?? name ?? 'noreply@egrm.local';
}

function smtpTransport(cfg: EmailSenderConfig): Transporter {
  const provider = (cfg.provider ?? 'smtp').toLowerCase();
  const pass = getConfiguredField(cfg.fields, 'pass') || (cfg as { api_token?: string }).api_token?.trim();
  const user = getConfiguredField(cfg.fields, 'user') || cfg.from_address?.trim();

  if (provider === 'gmail') {
    if (!user?.trim() || !pass?.trim()) {
      throw new DeliveryError('Gmail user and pass required in CD-09 senders.email', 'gmail', false);
    }
    return nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    });
  }

  if (provider === 'sendgrid') {
    return nodemailer.createTransport({
      host: 'smtp.sendgrid.net',
      port: 587,
      secure: false,
      auth: { user: 'apikey', pass },
    });
  }

  const host =
    getConfiguredField(cfg.fields, 'host') || cfg.api_url?.trim() || 'localhost';
  const portStr = getConfiguredField(cfg.fields, 'port');
  const port = portStr ? Number(portStr) : host.includes(':465') ? 465 : 587;
  return nodemailer.createTransport({
    host: host.replace(/:\d+$/, ''),
    port,
    secure: port === 465,
    auth: user && pass ? { user, pass } : undefined,
  });
}

/** Send email via SMTP presets or configurable HTTP (CD-09 senders.email). */
export async function sendEmail(cfg: EmailSenderConfig, message: OutboundEmail): Promise<SendResult> {
  const normalized = normalizeEmailConfig(cfg);

  if (normalized.enabled === false) {
    throw new DeliveryError('Email sender disabled', normalized.provider ?? 'email', false);
  }
  if (!message.to?.trim()) {
    throw new DeliveryError('Missing recipient email', normalized.provider ?? 'email', false);
  }

  const provider = (normalized.provider ?? 'smtp').toLowerCase();

  if (provider === 'custom' || (normalized.api_url?.trim() && !['smtp', 'gmail', 'sendgrid'].includes(provider))) {
    return sendConfiguredHttp(
      normalized,
      {
        to: message.to,
        subject: message.subject,
        message: message.body,
        from_email: normalized.from_address,
      },
      { from_email: normalized.from_address },
    );
  }

  const transport = smtpTransport(normalized);

  try {
    const info = await transport.sendMail({
      from: fromAddress(normalized),
      to: message.to.trim(),
      subject: message.subject,
      text: message.body,
    });
    return { messageId: info.messageId ?? `smtp-${Date.now()}`, provider };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new DeliveryError(msg, provider, true);
  } finally {
    transport.close();
  }
}
