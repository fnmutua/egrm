import type { Cd09Notifications } from './cd09-notifications.js';

/** Outbound channels a complainant may opt into at intake (excludes in_app). */
export const PARTY_NOTIFICATION_CHANNELS = ['sms', 'email', 'whatsapp'] as const;
export type PartyNotificationChannel = (typeof PARTY_NOTIFICATION_CHANNELS)[number];

export interface PartyNotificationChannelOption {
  value: PartyNotificationChannel;
  label: { en: string; sw: string };
  /** Contact field required before this channel can be selected. */
  requires: 'phone' | 'email';
}

const CHANNEL_LABELS: Record<PartyNotificationChannel, PartyNotificationChannelOption['label']> = {
  sms: { en: 'SMS', sw: 'Ujumbe mfupi (SMS)' },
  email: { en: 'Email', sw: 'Barua pepe' },
  whatsapp: { en: 'WhatsApp', sw: 'WhatsApp' },
};

function isChannelKilled(cfg: Cd09Notifications, channel: PartyNotificationChannel): boolean {
  return cfg.kill_switches.some((ks) => ks.channel === channel && !ks.enabled);
}

function senderReady(cfg: Cd09Notifications, channel: PartyNotificationChannel): boolean {
  if (isChannelKilled(cfg, channel)) return false;
  const sender = cfg.senders[channel];
  if (!sender || sender.enabled === false) return false;
  if (channel === 'email') {
    return Boolean(sender.api_url?.trim() || ('from_address' in sender && sender.from_address?.trim()));
  }
  if (channel === 'sms') {
    return Boolean(sender.api_url?.trim() || sender.provider?.trim());
  }
  return true;
}

/** Channels available on the intake form — mirrors CD-09 sender identities + kill switches. */
export function configuredPartyNotificationChannels(cfg: Cd09Notifications): PartyNotificationChannelOption[] {
  return PARTY_NOTIFICATION_CHANNELS.filter((ch) => senderReady(cfg, ch)).map((value) => ({
    value,
    label: CHANNEL_LABELS[value],
    requires: value === 'email' ? 'email' : 'phone',
  }));
}

export function isPartyNotificationChannel(value: string): value is PartyNotificationChannel {
  return (PARTY_NOTIFICATION_CHANNELS as readonly string[]).includes(value);
}

/** Normalize and validate complainant channel picks against configured + contact info. */
export function normalizePartyNotificationChannels(
  selected: unknown,
  cfg: Cd09Notifications,
  contact: { phone: string | null; email: string | null },
): { ok: true; channels: PartyNotificationChannel[] } | { ok: false; error: string } {
  const allowed = new Set(configuredPartyNotificationChannels(cfg).map((c) => c.value));
  if (allowed.size === 0) return { ok: true, channels: [] };

  if (!Array.isArray(selected) || selected.length === 0) {
    return { ok: false, error: 'notification_channels_required' };
  }

  const channels: PartyNotificationChannel[] = [];
  for (const raw of selected) {
    if (typeof raw !== 'string' || !isPartyNotificationChannel(raw)) {
      return { ok: false, error: 'invalid_notification_channel' };
    }
    if (!allowed.has(raw)) return { ok: false, error: 'notification_channel_not_configured' };
    if ((raw === 'sms' || raw === 'whatsapp') && !contact.phone) {
      return { ok: false, error: 'notification_channel_requires_phone' };
    }
    if (raw === 'email' && !contact.email) {
      return { ok: false, error: 'notification_channel_requires_email' };
    }
    if (!channels.includes(raw)) channels.push(raw);
  }

  return { ok: true, channels };
}

/** Filter rule channels by complainant opt-in; non-party channels (e.g. in_app) pass through. */
export function filterChannelsForPartyPreference(
  channels: string[],
  selector: unknown,
  partyChannels: PartyNotificationChannel[] | null | undefined,
): string[] {
  if (!selector || typeof selector !== 'object' || !('party' in selector) || !partyChannels?.length) return channels;
  const allowed = new Set(partyChannels);
  return channels.filter((ch) => !isPartyNotificationChannel(ch) || allowed.has(ch));
}
