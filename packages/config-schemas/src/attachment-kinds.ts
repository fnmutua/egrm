import { z } from 'zod';
import { localizedText } from './cd01-identity.js';

/** Visibility of an attachment on public vs staff surfaces (spec 14 §3). */
export const ATTACHMENT_VISIBILITY = ['public', 'staff', 'restricted'] as const;
export type AttachmentVisibility = (typeof ATTACHMENT_VISIBILITY)[number];

export const attachmentKindDef = z.object({
  code: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/, 'Kind code must be lowercase snake_case'),
  label: localizedText,
  default_visibility: z.enum(ATTACHMENT_VISIBILITY).default('staff'),
  allowed_mime: z.array(z.string().min(1)).optional(),
  max_size_mb: z.number().positive().optional(),
  active: z.boolean().default(true),
  /** When false, hidden from staff console upload pickers (spec 14 §3). */
  console_allowed: z.boolean().default(true),
  /** When true, available on public intake when global intake attachments are enabled. */
  intake_allowed: z.boolean().default(false),
});

export const attachmentPolicy = z.object({
  max_files_per_action: z.number().int().positive().default(10),
  max_files_per_case: z.number().int().positive().default(200),
  max_total_case_size_mb: z.number().int().positive().default(500),
  allowed_mime_default: z.array(z.string().min(1)).min(1),
  block_executable: z.boolean().default(true),
  malware_scan: z.boolean().default(false),
  duplicate_detection: z.enum(['off', 'warn', 'block']).default('warn'),
  intake_enabled: z.boolean().default(true),
  intake_max_files: z.number().int().positive().default(5),
  /** Optional whitelist for staff console; empty = all active kinds with console_allowed. */
  console_kind_codes: z.array(z.string().min(1)).optional(),
  /** Optional whitelist for public intake; empty = all active kinds with intake_allowed. */
  intake_kind_codes: z.array(z.string().min(1)).optional(),
});

export type AttachmentKindDef = z.infer<typeof attachmentKindDef>;
export type AttachmentPolicy = z.infer<typeof attachmentPolicy>;

/** Platform default document kinds (spec 14 §3.1). */
export const DEFAULT_ATTACHMENT_KINDS: AttachmentKindDef[] = [
  {
    code: 'evidence',
    label: { en: 'Evidence', sw: 'Ushahidi' },
    default_visibility: 'staff',
    active: true,
    console_allowed: true,
    intake_allowed: true,
  },
  {
    code: 'investigation_report',
    label: { en: 'Investigation report', sw: 'Ripoti ya uchunguzi' },
    default_visibility: 'staff',
    allowed_mime: [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    max_size_mb: 25,
    active: true,
    console_allowed: true,
    intake_allowed: false,
  },
  {
    code: 'signed_resolution_form',
    label: { en: 'Signed resolution form', sw: 'Fomu ya utatuzi iliyosainiwa' },
    default_visibility: 'staff',
    allowed_mime: ['application/pdf', 'image/jpeg', 'image/png'],
    max_size_mb: 10,
    active: true,
    console_allowed: true,
    intake_allowed: false,
  },
  {
    code: 'acknowledgement',
    label: { en: 'Acknowledgement', sw: 'Uthibitisho' },
    default_visibility: 'public',
    allowed_mime: ['application/pdf'],
    max_size_mb: 5,
    active: true,
    console_allowed: true,
    intake_allowed: true,
  },
  {
    code: 'correspondence',
    label: { en: 'Correspondence', sw: 'Barua / mawasiliano' },
    default_visibility: 'staff',
    active: true,
    console_allowed: true,
    intake_allowed: false,
  },
  {
    code: 'committee_minutes',
    label: { en: 'Committee minutes', sw: 'Dakika za kamati' },
    default_visibility: 'staff',
    allowed_mime: ['application/pdf'],
    max_size_mb: 15,
    active: true,
    console_allowed: true,
    intake_allowed: false,
  },
  {
    code: 'legal',
    label: { en: 'Legal document', sw: 'Hati ya kisheria' },
    default_visibility: 'restricted',
    allowed_mime: ['application/pdf'],
    max_size_mb: 25,
    active: true,
    console_allowed: true,
    intake_allowed: false,
  },
  {
    code: 'other',
    label: { en: 'Other', sw: 'Nyingine' },
    default_visibility: 'staff',
    active: true,
    console_allowed: true,
    intake_allowed: false,
  },
];

export const DEFAULT_ATTACHMENT_POLICY: AttachmentPolicy = {
  max_files_per_action: 10,
  max_files_per_case: 200,
  max_total_case_size_mb: 500,
  allowed_mime_default: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  block_executable: true,
  malware_scan: false,
  duplicate_detection: 'warn',
  intake_enabled: true,
  intake_max_files: 5,
};

/** Which upload surface a kind is being selected for. */
export type AttachmentChannel = 'console' | 'intake';

/** Active document kinds permitted for a channel (spec 14 §3). */
export function kindsForChannel(
  cfg: { attachment_kinds: AttachmentKindDef[]; attachment_policy?: AttachmentPolicy },
  channel: AttachmentChannel,
): AttachmentKindDef[] {
  const kinds = mergeDefaultAttachmentKinds(cfg.attachment_kinds).filter((k) => k.active !== false);
  const policy = cfg.attachment_policy ?? DEFAULT_ATTACHMENT_POLICY;

  if (channel === 'intake') {
    if (!policy.intake_enabled) return [];
    let allowed = kinds.filter((k) => k.intake_allowed === true);
    if (policy.intake_kind_codes?.length) {
      const codes = new Set(policy.intake_kind_codes);
      allowed = allowed.filter((k) => codes.has(k.code));
    }
    return allowed;
  }

  let allowed = kinds.filter((k) => k.console_allowed !== false);
  if (policy.console_kind_codes?.length) {
    const codes = new Set(policy.console_kind_codes);
    allowed = allowed.filter((k) => codes.has(k.code));
  }
  return allowed;
}

/** Merge missing default kinds into a tenant payload (non-destructive). */
export function mergeDefaultAttachmentKinds(kinds: AttachmentKindDef[] | undefined): AttachmentKindDef[] {
  const existing = kinds ?? [];
  const codes = new Set(existing.map((k) => k.code));
  const merged = [...existing];
  for (const def of DEFAULT_ATTACHMENT_KINDS) {
    if (!codes.has(def.code)) merged.push({ ...def });
  }
  return merged;
}
