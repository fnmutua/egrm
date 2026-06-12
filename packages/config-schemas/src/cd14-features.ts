import { z } from 'zod';

/** CD-14 Feature flags (spec 02). Everything defaults off except the baseline. */
export const cd14Features = z.object({
  knowledge_base: z.boolean().default(false),
  tasks: z.boolean().default(false),
  committees: z.boolean().default(false),
  appeals: z.boolean().default(true),
  satisfaction_survey: z.boolean().default(true),
  transparency_page: z.boolean().default(false),
  complainant_accounts: z.boolean().default(false),
  organizations: z.boolean().default(false),
  ussd: z.boolean().default(false),
  hotline: z.boolean().default(false),
  public_api: z.boolean().default(false),
  custom_dashboards: z.boolean().default(false),
  chatbot_intake: z.boolean().default(false),
  ai_assistance: z.boolean().default(false),
});

export type Cd14Features = z.infer<typeof cd14Features>;
