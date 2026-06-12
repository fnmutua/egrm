import { z } from 'zod';

/** Contact routes shown on the portal landing page ("Other ways to reach us"). */
export const PUBLIC_CHANNEL_TYPES = ['hotline', 'ussd', 'email', 'office', 'sms'] as const;

export const publicChannelEntry = z.object({
  type: z.enum(PUBLIC_CHANNEL_TYPES),
  value: z.string().min(1),
  /** Channel is operational for intake routing (assisted / telecom when implemented). */
  enabled: z.boolean().default(true),
  /** Listed on the public landing page. */
  show_on_portal: z.boolean().default(true),
});

export const cd08Channels = z.object({
  /** Same catalogue as CD-01 `channels_display` — single source of truth for public contact info. */
  public_channels: z.array(publicChannelEntry).default([]),
  modules: z
    .object({
      web_portal: z.object({ enabled: z.boolean().default(true) }).default({}),
      assisted: z
        .object({
          enabled: z.boolean().default(true),
          source_channels: z
            .array(z.string())
            .default(['walk_in', 'phone', 'letter', 'community_meeting', 'complaint_box']),
        })
        .default({}),
      ussd: z.object({ enabled: z.boolean().default(false), shortcode: z.string().optional() }).default({}),
      sms: z.object({ enabled: z.boolean().default(false) }).default({}),
      email_inbound: z.object({ enabled: z.boolean().default(false) }).default({}),
      hotline: z.object({ enabled: z.boolean().default(false) }).default({}),
      mobile_app: z
        .object({
          enabled: z.boolean().default(false),
          /** Apple App Store URL (shown on portal when enabled). */
          ios_url: z.string().optional(),
          /** Google Play Store URL (shown on portal when enabled). */
          android_url: z.string().optional(),
          show_on_portal: z.boolean().default(true),
        })
        .default({}),
      partner_api: z.object({ enabled: z.boolean().default(false) }).default({}),
      chatbot: z.object({ enabled: z.boolean().default(false) }).default({}),
    })
    .default({}),
});

export type Cd08Channels = z.infer<typeof cd08Channels>;
export type PublicChannelEntry = z.infer<typeof publicChannelEntry>;
