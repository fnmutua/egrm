import { z } from 'zod';
import { localizedText } from './cd01-identity.js';
import {
  attachmentKindDef,
  attachmentPolicy,
  DEFAULT_ATTACHMENT_KINDS,
  DEFAULT_ATTACHMENT_POLICY,
  mergeDefaultAttachmentKinds,
} from './attachment-kinds.js';

/** CD-06 Intake forms & data standards (spec 02, spec 05 §3). */
const fieldDef = z.object({
  key: z.string().min(1),
  type: z.enum(['text', 'textarea', 'select', 'multiselect', 'date', 'phone', 'email', 'number']),
  section: z.enum(['complainant', 'grievance', 'outcome']),
  enabled: z.boolean().default(true),
  required: z.boolean().default(false),
  label: localizedText,
  help: localizedText.optional(),
  /** For select/multiselect: inline options or a reference to a CD-03 list (e.g. `taxonomy:categories`). */
  options: z.array(z.object({ value: z.string(), label: localizedText })).optional(),
  options_ref: z.string().optional(),
});

export const cd06IntakeForms = z.object({
  case_type: z.string().default('grievance'),
  anonymous_allowed: z.boolean().default(true),
  consent_text: localizedText,
  fields: z.array(fieldDef).min(1),
  attachment_kinds: z.array(attachmentKindDef).min(1).default([...DEFAULT_ATTACHMENT_KINDS]),
  attachment_policy: attachmentPolicy.default({ ...DEFAULT_ATTACHMENT_POLICY }),
}).superRefine((form, ctx) => {
  const keys = form.fields.map((f) => f.key);
  if (new Set(keys).size !== keys.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fields'], message: 'Field keys must be unique' });
  }
  const kindCodes = form.attachment_kinds.map((k) => k.code);
  if (new Set(kindCodes).size !== kindCodes.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['attachment_kinds'], message: 'Document type codes must be unique' });
  }
  const kindSet = new Set(kindCodes);
  for (const code of form.attachment_policy.console_kind_codes ?? []) {
    if (!kindSet.has(code)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['attachment_policy', 'console_kind_codes'],
        message: `Unknown document type '${code}' in console limit`,
      });
    }
  }
  for (const code of form.attachment_policy.intake_kind_codes ?? []) {
    if (!kindSet.has(code)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['attachment_policy', 'intake_kind_codes'],
        message: `Unknown document type '${code}' in intake limit`,
      });
    }
  }
});

export type Cd06IntakeForms = z.infer<typeof cd06IntakeForms>;
export type IntakeFieldDef = z.infer<typeof fieldDef>;

/** Backfill attachment defaults for configs saved before CD-06 document types shipped. */
export function normalizeCd06IntakeForms(form: Cd06IntakeForms): Cd06IntakeForms {
  return {
    ...form,
    attachment_kinds: mergeDefaultAttachmentKinds(form.attachment_kinds),
    attachment_policy: { ...DEFAULT_ATTACHMENT_POLICY, ...(form.attachment_policy ?? {}) },
  };
}

export function mergeMissingIntakeFormDefaults(current: Cd06IntakeForms): { merged: Cd06IntakeForms; changed: boolean } {
  const merged = normalizeCd06IntakeForms(current);
  const kindsChanged = merged.attachment_kinds.length !== (current.attachment_kinds?.length ?? 0);
  const policyChanged = !current.attachment_policy;
  return { merged, changed: kindsChanged || policyChanged };
}

export { mergeDefaultAttachmentKinds };
