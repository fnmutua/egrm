import { z } from 'zod';
import { localizedText } from './cd01-identity.js';

export const THREAD_MESSAGE_KINDS = [
  'free_text',
  'request_info',
  'acknowledgement',
  'resolution_notice',
  'logged_contact',
] as const;

export const THREAD_DIRECTIONS = ['inbound', 'outbound', 'internal_note'] as const;

export const correspondencePolicy = z.object({
  enabled: z.boolean().default(true),
  portal: z
    .object({
      enabled: z.boolean().default(true),
      allow_reply: z.boolean().default(true),
      allow_initiate: z.boolean().default(false),
      max_body_length: z.number().int().positive().default(4000),
      max_replies_per_day: z.number().int().positive().default(10),
      show_messages_on_track: z.boolean().default(true),
    })
    .default({}),
  staff: z
    .object({
      allow_outbound: z.boolean().default(true),
      allow_logged_contact: z.boolean().default(true),
      max_body_length: z.number().int().positive().default(8000),
      default_outbound_kind: z.enum(THREAD_MESSAGE_KINDS).default('free_text'),
      mirror_status_updates: z.boolean().default(false),
    })
    .default({}),
  attachments: z
    .object({
      staff_outbound_enabled: z.boolean().default(true),
      complainant_reply_enabled: z.boolean().default(true),
      max_files_per_message: z.number().int().positive().default(3),
      reply_kind_codes: z.array(z.string().min(1)).optional(),
      staff_kind_codes: z.array(z.string().min(1)).optional(),
    })
    .default({}),
  sensitive: z
    .object({
      redact_outbound_for_party: z.boolean().default(true),
      redacted_template: localizedText.default({
        en: 'We have an update on your case. Please check the tracking page or contact the GRM office.',
        sw: 'Tuna taarifa kuhusu kesi yako. Tafadhali angalia ukurasa wa ufuatiliaji au wasiliana na ofisi ya GRM.',
      }),
    })
    .default({}),
  workflow: z
    .object({
      inbound_reply_unpauses_awaiting: z.boolean().default(true),
      awaiting_status_names: z.array(z.string()).default(['Awaiting information']),
      inbound_reply_to_status: z.string().nullable().optional(),
    })
    .default({}),
  notify: z
    .object({
      on_outbound_message: z.boolean().default(true),
      on_inbound_reply: z.boolean().default(true),
    })
    .default({}),
});

export const cd17Correspondence = z.object({
  correspondence_policy: correspondencePolicy.default({}),
});

export type Cd17Correspondence = z.infer<typeof cd17Correspondence>;
export type CorrespondencePolicy = z.infer<typeof correspondencePolicy>;

export const DEFAULT_CORRESPONDENCE_POLICY: CorrespondencePolicy = {
  enabled: true,
  portal: {
    enabled: true,
    allow_reply: true,
    allow_initiate: false,
    max_body_length: 4000,
    max_replies_per_day: 10,
    show_messages_on_track: true,
  },
  staff: {
    allow_outbound: true,
    allow_logged_contact: true,
    max_body_length: 8000,
    default_outbound_kind: 'free_text',
    mirror_status_updates: false,
  },
  attachments: {
    staff_outbound_enabled: true,
    complainant_reply_enabled: true,
    max_files_per_message: 3,
    reply_kind_codes: ['evidence'],
    staff_kind_codes: ['evidence', 'correspondence', 'acknowledgement'],
  },
  sensitive: {
    redact_outbound_for_party: true,
    redacted_template: {
      en: 'We have an update on your case. Please check the tracking page or contact the GRM office.',
      sw: 'Tuna taarifa kuhusu kesi yako. Tafadhali angalia ukurasa wa ufuatiliaji au wasiliana na ofisi ya GRM.',
    },
  },
  workflow: {
    inbound_reply_unpauses_awaiting: true,
    awaiting_status_names: ['Awaiting information'],
    inbound_reply_to_status: null,
  },
  notify: {
    on_outbound_message: true,
    on_inbound_reply: true,
  },
};
