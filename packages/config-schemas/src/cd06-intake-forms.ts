import { z } from 'zod';
import { localizedText } from './cd01-identity.js';

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
}).superRefine((form, ctx) => {
  const keys = form.fields.map((f) => f.key);
  if (new Set(keys).size !== keys.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fields'], message: 'Field keys must be unique' });
  }
});

export type Cd06IntakeForms = z.infer<typeof cd06IntakeForms>;
export type IntakeFieldDef = z.infer<typeof fieldDef>;
