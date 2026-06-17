import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Cd03Taxonomy, Cd14Features, Cd16Ai } from '@egrm/config-schemas';
import { db, schema } from '../db/client.js';
import { getActiveConfig } from './config.js';
import { chatCompletion } from './ai-completion.js';
import { hashRedactedPrompt, redactIntakeText } from './ai-redaction.js';
import { parseJsonFromModel, resolveProfileForCapability } from './ai-shared.js';

const triageResponseSchema = z.object({
  categories: z.array(z.string()).default([]),
  category_confidence: z.number().min(0).max(1).default(0),
  priority: z.string().default('normal'),
  priority_confidence: z.number().min(0).max(1).default(0),
  sensitivity_class: z.string().nullable().optional(),
  sensitivity_confidence: z.number().min(0).max(1).default(0),
  indicators: z.array(z.string()).default([]),
  rationale: z.string().optional(),
});

export type IntakeTriageSuggestion = z.infer<typeof triageResponseSchema> & {
  sensitivity_applied?: boolean;
  sensitivity_pending_confirm?: boolean;
  previous_sensitivity?: string;
  applied_sensitivity?: string;
};

function resolveProfile(
  ai: Cd16Ai,
  capKey: 'auto_categorize' | 'sensitivity_detect',
): { key: string; profile: Cd16Ai['provider_profiles'][string] } | null {
  return resolveProfileForCapability(ai, capKey);
}

function buildTriagePrompt(
  taxonomy: Cd03Taxonomy,
  caseRow: { reference: string; summary: string; description: string | null; categories: string[]; priority: string },
  redactedNarrative: string,
): string {
  const categoryLines = taxonomy.categories
    .filter((c) => c.active)
    .map((c) => `- ${c.code}: ${c.label.en ?? c.code}`)
    .join('\n');
  const priorityLines = taxonomy.priorities
    .map((p) => `- ${p.code}: ${p.label.en ?? p.code}`)
    .join('\n');
  const sensitivityLines = taxonomy.sensitivity_classes
    .map((s) => `- ${s.code}${s.restricted ? ' (restricted)' : ''}: ${s.label.en ?? s.code}`)
    .join('\n');

  return [
    'You triage incoming grievances for a government GRM system.',
    'Return ONLY valid JSON with this shape:',
    '{',
    '  "categories": ["code"],',
    '  "category_confidence": 0.0,',
    '  "priority": "code",',
    '  "priority_confidence": 0.0,',
    '  "sensitivity_class": "code or standard",',
    '  "sensitivity_confidence": 0.0,',
    '  "indicators": ["short reason"],',
    '  "rationale": "one sentence"',
    '}',
    '',
    `Allowed categories:\n${categoryLines}`,
    `Allowed priorities:\n${priorityLines}`,
    `Sensitivity classes (use "standard" when none apply):\n${sensitivityLines}`,
    '',
    `Case reference: ${caseRow.reference}`,
    `Submitter-selected categories: ${caseRow.categories.join(', ') || '(none)'}`,
    `Current priority: ${caseRow.priority}`,
    '',
    'Grievance narrative (PII redacted):',
    redactedNarrative,
  ].join('\n');
}

function normalizeSuggestion(
  raw: z.infer<typeof triageResponseSchema>,
  taxonomy: Cd03Taxonomy,
): IntakeTriageSuggestion {
  const categoryCodes = new Set(taxonomy.categories.filter((c) => c.active).map((c) => c.code));
  const priorityCodes = new Set(taxonomy.priorities.map((p) => p.code));
  const sensitivityCodes = new Set(taxonomy.sensitivity_classes.map((s) => s.code));

  const categories = raw.categories.filter((c) => categoryCodes.has(c));
  const priority = priorityCodes.has(raw.priority) ? raw.priority : taxonomy.priorities.find((p) => p.is_default)?.code ?? 'normal';
  let sensitivity_class = raw.sensitivity_class ?? 'standard';
  if (sensitivity_class === 'standard' || !sensitivityCodes.has(sensitivity_class)) {
    sensitivity_class = 'standard';
  }

  return {
    ...raw,
    categories,
    priority,
    sensitivity_class: sensitivity_class === 'standard' ? null : sensitivity_class,
    sensitivity_confidence: sensitivity_class === 'standard' ? 0 : raw.sensitivity_confidence,
  };
}

export type AiTriageDisabledReason = 'cd14_off' | 'cd16_off' | 'capabilities_off' | 'no_profile' | 'taxonomy_missing';

export interface AiTriageConfigStatus {
  ready: boolean;
  reason?: AiTriageDisabledReason;
  ai_assistance: boolean;
  cd16_enabled: boolean;
  auto_categorize: boolean;
  sensitivity_detect: boolean;
}

export async function getAiTriageConfigStatus(tenantId: string): Promise<AiTriageConfigStatus> {
  const [cd14, cd16] = await Promise.all([
    getActiveConfig<Cd14Features>(tenantId, 'cd14_features'),
    getActiveConfig<Cd16Ai>(tenantId, 'cd16_ai'),
  ]);
  const ai_assistance = Boolean(cd14?.ai_assistance);
  const cd16_enabled = Boolean(cd16?.enabled);
  const auto_categorize = Boolean(cd16?.capabilities.auto_categorize.enabled);
  const sensitivity_detect = Boolean(cd16?.capabilities.sensitivity_detect.enabled);

  if (!ai_assistance) return { ready: false, reason: 'cd14_off', ai_assistance, cd16_enabled, auto_categorize, sensitivity_detect };
  if (!cd16_enabled || !cd16) return { ready: false, reason: 'cd16_off', ai_assistance, cd16_enabled, auto_categorize, sensitivity_detect };
  if (!auto_categorize && !sensitivity_detect) {
    return { ready: false, reason: 'capabilities_off', ai_assistance, cd16_enabled, auto_categorize, sensitivity_detect };
  }
  const profileRef =
    resolveProfile(cd16, 'auto_categorize') ?? resolveProfile(cd16, 'sensitivity_detect');
  if (!profileRef) {
    return { ready: false, reason: 'no_profile', ai_assistance, cd16_enabled, auto_categorize, sensitivity_detect };
  }
  return { ready: true, ai_assistance, cd16_enabled, auto_categorize, sensitivity_detect };
}

async function isTriageEnabled(tenantId: string): Promise<{
  cd16: Cd16Ai;
  taxonomy: Cd03Taxonomy;
} | null> {
  const status = await getAiTriageConfigStatus(tenantId);
  if (!status.ready) return null;

  const [cd16, taxonomy] = await Promise.all([
    getActiveConfig<Cd16Ai>(tenantId, 'cd16_ai'),
    getActiveConfig<Cd03Taxonomy>(tenantId, 'cd03_taxonomy'),
  ]);
  if (!cd16 || !taxonomy) return null;
  return { cd16, taxonomy };
}

/** Fire-and-forget intake triage after case creation. */
export function scheduleIntakeTriage(tenantId: string, caseId: string): void {
  runIntakeTriage(tenantId, caseId).catch((err) => {
    console.error('[ai-triage] failed for case', caseId, err instanceof Error ? err.message : err);
  });
}

/** Run AI triage for a newly created case (auto_categorize + sensitivity_detect). */
export async function runIntakeTriage(tenantId: string, caseId: string): Promise<void> {
  const configStatus = await getAiTriageConfigStatus(tenantId);
  if (!configStatus.ready) {
    console.info('[ai-triage] skipped', caseId, configStatus.reason ?? 'not_ready');
    return;
  }

  const enabled = await isTriageEnabled(tenantId);
  if (!enabled) {
    console.info('[ai-triage] skipped', caseId, 'taxonomy_missing');
    return;
  }

  const { cd16, taxonomy } = enabled;
  const categorizeOn = cd16.capabilities.auto_categorize.enabled;
  const sensitivityOn = cd16.capabilities.sensitivity_detect.enabled;

  const profileRef =
    resolveProfile(cd16, 'auto_categorize') ?? resolveProfile(cd16, 'sensitivity_detect');
  if (!profileRef) return;

  const [caseRow] = await db
    .select()
    .from(schema.grmCase)
    .where(and(eq(schema.grmCase.tenantId, tenantId), eq(schema.grmCase.id, caseId)))
    .limit(1);
  if (!caseRow) return;

  const narrative = [caseRow.summary, caseRow.description].filter(Boolean).join('\n\n');
  const redacted = redactIntakeText(narrative, cd16.safety);
  if (!redacted.trim()) {
    await db.insert(schema.aiInteraction).values({
      tenantId,
      caseId,
      capability: 'auto_categorize',
      providerProfileId: profileRef.key,
      model: profileRef.profile.default_model,
      inputHash: hashRedactedPrompt(['empty']),
      suggestion: {},
      status: 'redacted_empty',
      decision: 'rejected',
      latencyMs: 0,
    });
    return;
  }

  const systemPrompt = buildTriagePrompt(taxonomy, caseRow, redacted);
  const inputHash = hashRedactedPrompt([systemPrompt]);

  const started = Date.now();
  let suggestion: IntakeTriageSuggestion;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let latencyMs: number;

  try {
    const result = await chatCompletion(
      profileRef.profile,
      [
        {
          role: 'system',
          content:
            'You are a grievance triage assistant. Respond with JSON only. Never include personal identifiers.',
        },
        { role: 'user', content: systemPrompt },
      ],
      { json_mode: true },
    );
    const parsed = triageResponseSchema.parse(parseJsonFromModel(result.content));
    suggestion = normalizeSuggestion(parsed, taxonomy);
    inputTokens = result.input_token_count;
    outputTokens = result.output_token_count;
    latencyMs = result.latency_ms;
  } catch (err) {
    await db.insert(schema.aiInteraction).values({
      tenantId,
      caseId,
      capability: 'auto_categorize',
      providerProfileId: profileRef.key,
      model: profileRef.profile.default_model,
      inputHash,
      suggestion: {},
      status: 'failed',
      error: err instanceof Error ? err.message : 'triage_failed',
      decision: 'rejected',
      latencyMs: Date.now() - started,
    });
    return;
  }

  const minCategoryConf = cd16.capabilities.auto_categorize.min_confidence ?? 0.6;
  const minSensitivityConf = cd16.capabilities.sensitivity_detect.min_confidence ?? 0.5;

  if (!categorizeOn) {
    suggestion.categories = [];
    suggestion.category_confidence = 0;
    suggestion.priority_confidence = 0;
  }

  let appliedEventId: string | undefined;
  if (
    sensitivityOn &&
    suggestion.sensitivity_class &&
    suggestion.sensitivity_confidence >= minSensitivityConf &&
    suggestion.sensitivity_class !== caseRow.sensitivity
  ) {
    suggestion.previous_sensitivity = caseRow.sensitivity;
    suggestion.applied_sensitivity = suggestion.sensitivity_class;
    suggestion.sensitivity_applied = true;
    suggestion.sensitivity_pending_confirm = true;

    const [ev] = await db
      .insert(schema.caseEvent)
      .values({
        tenantId,
        caseId,
        kind: 'field_edited',
        actorType: 'system',
        visibility: 'internal',
        data: {
          field: 'sensitivity',
          from: caseRow.sensitivity,
          to: suggestion.sensitivity_class,
          ai_auto_applied: true,
          pending_confirm: true,
          indicators: suggestion.indicators,
        },
      })
      .returning({ id: schema.caseEvent.id });

    await db
      .update(schema.grmCase)
      .set({ sensitivity: suggestion.sensitivity_class, updatedAt: new Date() })
      .where(eq(schema.grmCase.id, caseId));

    appliedEventId = ev?.id;
  }

  const overallConfidence = Math.max(
    categorizeOn ? suggestion.category_confidence : 0,
    sensitivityOn ? suggestion.sensitivity_confidence : 0,
  );

  const hasActionableCategory =
    categorizeOn &&
    suggestion.categories.length > 0 &&
    suggestion.category_confidence >= minCategoryConf;

  const hasSuggestionToReview =
    suggestion.categories.length > 0 ||
    Boolean(suggestion.sensitivity_pending_confirm) ||
    Boolean(suggestion.rationale?.trim()) ||
    (categorizeOn && suggestion.priority !== caseRow.priority);

  await db.insert(schema.aiInteraction).values({
    tenantId,
    caseId,
    capability: 'auto_categorize',
    providerProfileId: profileRef.key,
    model: profileRef.profile.default_model,
    inputHash,
    inputTokenCount: inputTokens,
    outputTokenCount: outputTokens,
    suggestion: {
      ...suggestion,
      min_category_confidence: minCategoryConf,
      min_sensitivity_confidence: minSensitivityConf,
      has_actionable_category: hasActionableCategory,
      categorize_enabled: categorizeOn,
      sensitivity_enabled: sensitivityOn,
    },
    confidence: overallConfidence,
    status: 'completed',
    decision: hasSuggestionToReview ? 'pending' : 'rejected',
    appliedEventId,
    latencyMs,
  });
}

export async function getCaseAiTriageView(tenantId: string, caseId: string) {
  const [config, interactions, taxonomy] = await Promise.all([
    getAiTriageConfigStatus(tenantId),
    listCaseAiInteractions(tenantId, caseId),
    getActiveConfig<Cd03Taxonomy>(tenantId, 'cd03_taxonomy'),
  ]);
  const pending = interactions.filter((i) => i.decision === 'pending');
  const latest = interactions[0] ?? null;
  const labels = taxonomy
    ? {
        categories: Object.fromEntries(taxonomy.categories.map((c) => [c.code, c.label.en ?? c.code])),
        priorities: Object.fromEntries(taxonomy.priorities.map((p) => [p.code, p.label.en ?? p.code])),
        sensitivity: Object.fromEntries(taxonomy.sensitivity_classes.map((s) => [s.code, s.label.en ?? s.code])),
      }
    : { categories: {}, priorities: {}, sensitivity: {} };
  return { config, interactions, pending, latest, labels };
}

export async function listCaseAiInteractions(
  tenantId: string,
  caseId: string,
  options?: { pendingOnly?: boolean },
) {
  const where = and(
    eq(schema.aiInteraction.tenantId, tenantId),
    eq(schema.aiInteraction.caseId, caseId),
    options?.pendingOnly ? eq(schema.aiInteraction.decision, 'pending') : undefined,
  );

  return db
    .select({
      id: schema.aiInteraction.id,
      capability: schema.aiInteraction.capability,
      suggestion: schema.aiInteraction.suggestion,
      confidence: schema.aiInteraction.confidence,
      status: schema.aiInteraction.status,
      decision: schema.aiInteraction.decision,
      error: schema.aiInteraction.error,
      model: schema.aiInteraction.model,
      latency_ms: schema.aiInteraction.latencyMs,
      created_at: schema.aiInteraction.createdAt,
    })
    .from(schema.aiInteraction)
    .where(where)
    .orderBy(desc(schema.aiInteraction.createdAt));
}

const decideBodySchema = z.object({
  decision: z.enum(['accepted', 'edited', 'rejected']),
  edited_payload: z
    .object({
      categories: z.array(z.string()).optional(),
      priority: z.string().optional(),
      clear_sensitivity: z.boolean().optional(),
      confirm_sensitivity: z.boolean().optional(),
    })
    .optional(),
});

export async function decideAiInteraction(
  tenantId: string,
  interactionId: string,
  actorId: string,
  body: z.infer<typeof decideBodySchema>,
) {
  const parsed = decideBodySchema.parse(body);
  const [row] = await db
    .select()
    .from(schema.aiInteraction)
    .where(and(eq(schema.aiInteraction.tenantId, tenantId), eq(schema.aiInteraction.id, interactionId)))
    .limit(1);
  if (!row || !row.caseId) {
    return { ok: false as const, code: 404 as const, error: 'not_found' };
  }
  if (row.decision !== 'pending') {
    return { ok: false as const, code: 409 as const, error: 'already_decided' };
  }

  if (row.capability === 'draft_response') {
    await db
      .update(schema.aiInteraction)
      .set({
        decision: parsed.decision,
        decidedBy: actorId,
        decidedAt: new Date(),
      })
      .where(eq(schema.aiInteraction.id, interactionId));
    return { ok: true as const, interaction_id: interactionId };
  }

  const suggestion = (row.suggestion ?? {}) as IntakeTriageSuggestion & Record<string, unknown>;
  const [caseRow] = await db
    .select()
    .from(schema.grmCase)
    .where(and(eq(schema.grmCase.tenantId, tenantId), eq(schema.grmCase.id, row.caseId)))
    .limit(1);
  if (!caseRow) return { ok: false as const, code: 404 as const, error: 'case_not_found' };

  const updates: Partial<typeof schema.grmCase.$inferInsert> = { updatedAt: new Date() };
  const eventData: Record<string, unknown> = {
    ai_interaction_id: row.id,
    decision: parsed.decision,
  };
  let eventKind: 'field_edited' = 'field_edited';

  if (parsed.decision === 'rejected') {
    if (parsed.edited_payload?.clear_sensitivity && suggestion.sensitivity_pending_confirm) {
      updates.sensitivity = suggestion.previous_sensitivity ?? 'standard';
      eventData.field = 'sensitivity';
      eventData.from = caseRow.sensitivity;
      eventData.to = updates.sensitivity;
      eventData.sensitivity_cleared = true;
    }
  } else if (parsed.decision === 'edited') {
    const payload = parsed.edited_payload ?? {};
    if (payload.categories?.length) {
      updates.categories = payload.categories;
      eventData.categories = { from: caseRow.categories, to: payload.categories };
    }
    if (payload.priority) {
      updates.priority = payload.priority;
      eventData.priority = { from: caseRow.priority, to: payload.priority };
    }
    if (payload.confirm_sensitivity && suggestion.sensitivity_pending_confirm) {
      eventData.sensitivity_confirmed = suggestion.applied_sensitivity ?? caseRow.sensitivity;
    }
    if (payload.clear_sensitivity && suggestion.sensitivity_pending_confirm) {
      updates.sensitivity = suggestion.previous_sensitivity ?? 'standard';
      eventData.sensitivity = { from: caseRow.sensitivity, to: updates.sensitivity, cleared: true };
    }
  } else {
    const categories = suggestion.categories ?? [];
    const priority = suggestion.priority;

    if (categories.length > 0) {
      updates.categories = categories;
      eventData.categories = { from: caseRow.categories, to: categories };
    }
    if (priority && priority !== caseRow.priority) {
      updates.priority = priority;
      eventData.priority = { from: caseRow.priority, to: priority };
    }

    if (parsed.edited_payload?.confirm_sensitivity && suggestion.sensitivity_pending_confirm) {
      eventData.sensitivity_confirmed = suggestion.applied_sensitivity ?? caseRow.sensitivity;
    }
    if (parsed.edited_payload?.clear_sensitivity && suggestion.sensitivity_pending_confirm) {
      updates.sensitivity = suggestion.previous_sensitivity ?? 'standard';
      eventData.sensitivity = { from: caseRow.sensitivity, to: updates.sensitivity, cleared: true };
    }
  }

  const [ev] = await db
    .insert(schema.caseEvent)
    .values({
      tenantId,
      caseId: row.caseId,
      kind: eventKind,
      actorType: 'staff',
      actorId,
      visibility: 'internal',
      data: eventData,
    })
    .returning({ id: schema.caseEvent.id });

  if (Object.keys(updates).length > 1) {
    await db.update(schema.grmCase).set(updates).where(eq(schema.grmCase.id, row.caseId));
  }

  await db
    .update(schema.aiInteraction)
    .set({
      decision: parsed.decision,
      decidedBy: actorId,
      decidedAt: new Date(),
      appliedEventId: ev?.id,
      suggestion: {
        ...suggestion,
        staff_edited: parsed.edited_payload ?? null,
      },
    })
    .where(eq(schema.aiInteraction.id, interactionId));

  const [updatedCase] = await db
    .select({
      id: schema.grmCase.id,
      categories: schema.grmCase.categories,
      priority: schema.grmCase.priority,
      sensitivity: schema.grmCase.sensitivity,
    })
    .from(schema.grmCase)
    .where(eq(schema.grmCase.id, row.caseId))
    .limit(1);

  return {
    ok: true as const,
    interaction_id: interactionId,
    case: updatedCase,
  };
}

export { decideBodySchema };
