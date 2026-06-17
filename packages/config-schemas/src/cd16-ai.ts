import { z } from 'zod';
import { localizedText } from './cd01-identity.js';

/** Supported LLM provider integrations (spec 16 §9). */
export const AI_PROVIDER_KINDS = [
  'openai',
  'azure_openai',
  'xai',
  'anthropic',
  'ollama',
  'custom',
] as const;

export type AiProviderKind = (typeof AI_PROVIDER_KINDS)[number];

export const AI_CAPABILITIES = [
  'auto_categorize',
  'sensitivity_detect',
  'semantic_dedupe',
  'summarize_case',
  'translate',
  'draft_response',
  'kb_answer_assist',
] as const;

export type AiCapability = (typeof AI_CAPABILITIES)[number];

export const CHATBOT_INTENTS = ['file_case', 'check_status', 'kb_faq', 'handoff'] as const;

export const AI_DATA_RESIDENCY = ['us', 'eu', 'uk', 'apac', 'on_prem', 'unknown'] as const;

const profileKey = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'Use lowercase letters, numbers, and underscores (e.g. openai_primary)');

/** Token / request limits for a provider profile. */
export const aiTokenLimits = z
  .object({
    /** Max completion tokens per API call (output). */
    max_output_tokens: z.number().int().positive().max(128_000).default(4096),
    /** Soft cap on prompt + completion per call; provider may reject above model context. */
    max_context_tokens: z.number().int().positive().max(2_000_000).optional(),
    /** Default sampling temperature (0–2). */
    temperature: z.number().min(0).max(2).default(0.2),
    /** HTTP timeout for provider round-trip. */
    timeout_ms: z.number().int().positive().max(600_000).default(60_000),
    /** Embedding vector size when using this profile for RAG (pgvector). */
    embedding_dimensions: z.number().int().positive().max(4096).default(1536),
  })
  .default({});

export const aiProviderProfile = z.object({
  label: z.string().min(1).max(120),
  kind: z.enum(AI_PROVIDER_KINDS),
  /** OpenAI-compatible base URL (includes /v1 where applicable). */
  endpoint: z.string().url(),
  /**
   * Production: reference only — e.g. `env:OPENAI_API_KEY`, `env:XAI_API_KEY`.
   * Never log or return in API responses.
   */
  api_key_ref: z.string().max(200).optional(),
  /** Dev / console override when api_key_ref unset or env missing. Masked in admin UI. */
  api_key: z.string().max(500).optional(),
  /** Azure: resource name or full endpoint override. */
  azure_resource: z.string().max(120).optional(),
  /** Azure: API version query param. */
  azure_api_version: z.string().max(40).optional(),
  default_model: z.string().min(1).max(120),
  embedding_model: z.string().min(1).max(120).optional(),
  data_residency: z.enum(AI_DATA_RESIDENCY).default('unknown'),
  /** Contractual no-training / no-retention flag (declared, enforced by provider choice). */
  no_training: z.boolean().default(true),
  enabled: z.boolean().default(true),
  limits: aiTokenLimits,
});

export type AiProviderProfile = z.infer<typeof aiProviderProfile>;

const capabilityConfig = z.object({
  enabled: z.boolean().default(false),
  profile: profileKey.optional(),
  min_confidence: z.number().min(0).max(1).optional(),
  similarity_threshold: z.number().min(0).max(1).optional(),
  lookback_days: z.number().int().positive().max(3650).optional(),
  max_citations: z.number().int().positive().max(20).optional(),
});

export const aiTokenBudget = z
  .object({
    /** Soft monthly token budget (input + output) per tenant; 0 = unlimited. */
    monthly_token_limit: z.number().int().nonnegative().default(0),
    /** Optional daily cap. */
    daily_token_limit: z.number().int().nonnegative().default(0),
    /** Alert admins when usage exceeds this % of monthly limit. */
    alert_threshold_percent: z.number().int().min(1).max(100).default(80),
    /** Pause new AI calls when monthly limit exceeded (kill switch). */
    hard_stop_at_limit: z.boolean().default(false),
  })
  .default({});

export const cd16Ai = z
  .object({
    /** Master switch; CD-14 `ai_assistance` / `chatbot_intake` must also be on. */
    enabled: z.boolean().default(false),
    provider_profiles: z.record(profileKey, aiProviderProfile).default({}),
    capabilities: z
      .object({
        auto_categorize: capabilityConfig.default({}),
        sensitivity_detect: capabilityConfig.default({}),
        semantic_dedupe: capabilityConfig.default({}),
        summarize_case: capabilityConfig.default({}),
        translate: capabilityConfig.default({}),
        draft_response: capabilityConfig.default({}),
        kb_answer_assist: capabilityConfig.default({ max_citations: 3 }),
      })
      .default({}),
    token_budget: aiTokenBudget,
    chatbot: z
      .object({
        enabled: z.boolean().default(false),
        profile: profileKey.optional(),
        locales: z.array(z.string().min(2).max(8)).default(['en']),
        automated_agent_disclosure: localizedText.default({
          en: 'You are chatting with an automated assistant. A human officer will review your grievance.',
        }),
        allowed_intents: z.array(z.enum(CHATBOT_INTENTS)).default(['file_case', 'check_status', 'kb_faq', 'handoff']),
        channel_minimum: z
          .object({
            fields: z.array(z.string().min(1)).default(['unit_id', 'summary', 'categories']),
          })
          .default({}),
        handoff: z
          .object({
            mode: z.enum(['callback_task', 'hotline_display']).default('callback_task'),
            hotline_contact_ref: z.string().max(64).optional(),
          })
          .default({}),
        persona: z
          .object({
            name: z.string().max(80).default('GRM Assistant'),
            tone: z.enum(['respectful', 'neutral', 'formal']).default('respectful'),
          })
          .default({}),
        limits: aiTokenLimits.default({
          max_output_tokens: 1024,
          temperature: 0.3,
        }),
      })
      .default({}),
    safety: z
      .object({
        pii_redaction: z
          .object({
            strip_fields: z
              .array(z.string().min(1))
              .default(['name', 'phone', 'email', 'national_id', 'address']),
            pseudonymize_party: z.boolean().default(true),
          })
          .default({}),
        sensitive_processing: z
          .object({
            default: z.enum(['block', 'allow_with_profile']).default('block'),
            allowed_classes: z.array(z.string().min(1)).default([]),
          })
          .default({}),
        allow_machine_translation_outbound: z.boolean().default(false),
        moderation: z
          .object({
            enabled: z.boolean().default(true),
            block_on_violence: z.boolean().default(true),
          })
          .default({}),
      })
      .default({}),
    rag: z
      .object({
        sources: z.array(z.enum(['knowledge_article', 'document_corpus'])).default(['knowledge_article']),
        reindex_on_publish: z.boolean().default(true),
        chunk_size_tokens: z.number().int().positive().max(8192).default(512),
        chunk_overlap_tokens: z.number().int().nonnegative().max(2048).default(64),
      })
      .default({}),
  })
  .superRefine((data, ctx) => {
    const profiles = Object.keys(data.provider_profiles);

    const requireProfile = (path: (string | number)[], profile: string | undefined, label: string) => {
      if (!profile) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path, message: `${label}: profile is required when enabled` });
        return;
      }
      if (!profiles.includes(profile)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: `${label}: unknown profile "${profile}"`,
        });
      }
    };

    if (data.chatbot.enabled) {
      requireProfile(['chatbot', 'profile'], data.chatbot.profile, 'Chatbot');
    }

    for (const cap of AI_CAPABILITIES) {
      const cfg = data.capabilities[cap];
      if (cfg?.enabled) {
        requireProfile(['capabilities', cap, 'profile'], cfg.profile, cap);
      }
    }
  });

export type Cd16Ai = z.infer<typeof cd16Ai>;

export interface AiProviderPreset extends Omit<AiProviderProfile, 'limits'> {
  limits?: Partial<AiProviderProfile['limits']>;
}

/** Default endpoints and models per provider kind. */
export const AI_PROVIDER_PRESETS: Record<AiProviderKind, AiProviderPreset> = {
  openai: {
    label: 'OpenAI (ChatGPT)',
    kind: 'openai',
    endpoint: 'https://api.openai.com/v1',
    api_key_ref: 'env:OPENAI_API_KEY',
    default_model: 'gpt-4o-mini',
    embedding_model: 'text-embedding-3-small',
    data_residency: 'us',
    no_training: true,
    enabled: true,
    limits: { max_output_tokens: 4096, embedding_dimensions: 1536 },
  },
  azure_openai: {
    label: 'Azure OpenAI',
    kind: 'azure_openai',
    endpoint: 'https://YOUR_RESOURCE.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT',
    api_key_ref: 'env:AZURE_OPENAI_API_KEY',
    azure_resource: 'YOUR_RESOURCE',
    azure_api_version: '2024-08-01-preview',
    default_model: 'gpt-4o-mini',
    embedding_model: 'text-embedding-3-small',
    data_residency: 'eu',
    no_training: true,
    enabled: true,
    limits: { max_output_tokens: 4096 },
  },
  xai: {
    label: 'xAI (Grok)',
    kind: 'xai',
    endpoint: 'https://api.x.ai/v1',
    api_key_ref: 'env:XAI_API_KEY',
    default_model: 'grok-2-1212',
    embedding_model: undefined,
    data_residency: 'us',
    no_training: true,
    enabled: true,
    limits: { max_output_tokens: 4096, temperature: 0.2 },
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    kind: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1',
    api_key_ref: 'env:ANTHROPIC_API_KEY',
    default_model: 'claude-3-5-haiku-latest',
    data_residency: 'us',
    no_training: true,
    enabled: true,
    limits: { max_output_tokens: 4096 },
  },
  ollama: {
    label: 'Ollama (local)',
    kind: 'ollama',
    endpoint: 'http://127.0.0.1:11434/v1',
    default_model: 'llama3.1:8b',
    embedding_model: 'nomic-embed-text',
    data_residency: 'on_prem',
    no_training: true,
    enabled: true,
    limits: { max_output_tokens: 2048, timeout_ms: 120_000 },
  },
  custom: {
    label: 'Custom OpenAI-compatible',
    kind: 'custom',
    endpoint: 'https://api.example.com/v1',
    default_model: 'default',
    data_residency: 'unknown',
    no_training: true,
    enabled: true,
    limits: {},
  },
};

export const AI_CAPABILITY_LABELS: Record<AiCapability, string> = {
  auto_categorize: 'Auto-categorization',
  sensitivity_detect: 'Sensitivity detection',
  semantic_dedupe: 'Semantic duplicate detection',
  summarize_case: 'Case summarization',
  translate: 'Translation (staff)',
  draft_response: 'Draft responses',
  kb_answer_assist: 'Knowledge base answer assist',
};

/** Apply a provider preset to a profile object (preserves api_key when keepSecrets). */
export function applyAiProviderPreset(
  target: Record<string, unknown>,
  kind: AiProviderKind,
  opts?: { keepSecrets?: boolean },
) {
  const preset = AI_PROVIDER_PRESETS[kind];
  const prevKey = typeof target.api_key === 'string' ? target.api_key : '';

  Object.assign(target, {
    label: preset.label,
    kind: preset.kind,
    endpoint: preset.endpoint,
    api_key_ref: preset.api_key_ref,
    azure_resource: preset.azure_resource,
    azure_api_version: preset.azure_api_version,
    default_model: preset.default_model,
    embedding_model: preset.embedding_model,
    data_residency: preset.data_residency,
    no_training: preset.no_training,
    enabled: preset.enabled ?? true,
    limits: { ...aiTokenLimits.parse({}), ...preset.limits },
  });

  if (opts?.keepSecrets && prevKey) {
    target.api_key = prevKey;
  } else if (!opts?.keepSecrets) {
    target.api_key = '';
  }
}

/** Resolve API key from profile (env ref first, then inline secret). */
export function resolveAiApiKey(
  profile: Pick<AiProviderProfile, 'api_key_ref' | 'api_key'>,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const ref = profile.api_key_ref?.trim();
  if (ref?.startsWith('env:')) {
    const varName = ref.slice(4).trim();
    const fromEnv = env[varName];
    if (fromEnv?.trim()) return fromEnv.trim();
  }
  const inline = profile.api_key?.trim();
  return inline || undefined;
}

export const DEFAULT_CD16_AI: Cd16Ai = cd16Ai.parse({
  enabled: false,
  provider_profiles: {
    openai_primary: {
      ...AI_PROVIDER_PRESETS.openai,
      limits: aiTokenLimits.parse(AI_PROVIDER_PRESETS.openai.limits ?? {}),
    },
    xai_primary: {
      ...AI_PROVIDER_PRESETS.xai,
      limits: aiTokenLimits.parse(AI_PROVIDER_PRESETS.xai.limits ?? {}),
    },
    ollama_local: {
      ...AI_PROVIDER_PRESETS.ollama,
      enabled: false,
      limits: aiTokenLimits.parse(AI_PROVIDER_PRESETS.ollama.limits ?? {}),
    },
  },
  capabilities: {
    auto_categorize: { enabled: false, profile: 'openai_primary', min_confidence: 0.6 },
    sensitivity_detect: { enabled: false, profile: 'openai_primary', min_confidence: 0.5 },
    semantic_dedupe: {
      enabled: false,
      profile: 'openai_primary',
      similarity_threshold: 0.85,
      lookback_days: 90,
    },
    summarize_case: { enabled: true, profile: 'openai_primary' },
    translate: { enabled: false, profile: 'openai_primary' },
    draft_response: { enabled: false, profile: 'openai_primary' },
    kb_answer_assist: { enabled: true, profile: 'openai_primary', max_citations: 3 },
  },
  token_budget: {
    monthly_token_limit: 0,
    daily_token_limit: 0,
    alert_threshold_percent: 80,
    hard_stop_at_limit: false,
  },
  chatbot: {
    enabled: false,
    profile: 'openai_primary',
    locales: ['en', 'sw'],
    automated_agent_disclosure: {
      en: 'You are chatting with an automated assistant. A human officer will review your grievance.',
      sw: 'Unazungumza na msaidizi wa kiotomatiki. Afisa wa binadamu atapitia malalamiko yako.',
    },
  },
});
