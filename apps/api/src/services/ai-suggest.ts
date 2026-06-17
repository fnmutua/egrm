import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AiCapability } from '@egrm/config-schemas';
import { db, schema } from '../db/client.js';
import { chatCompletion } from './ai-completion.js';
import { hashRedactedPrompt, redactIntakeText } from './ai-redaction.js';
import { loadAiAssistanceConfig, parseJsonFromModel, resolveProfileForCapability } from './ai-shared.js';

const draftResponseParams = z
  .object({
    context: z.enum(['workflow_transition', 'thread_compose']).default('workflow_transition'),
    field: z.string().min(1).optional(),
    to_status: z.string().optional(),
    message_kind: z.string().optional(),
    bundle: z.boolean().optional(),
    extra_fields: z.array(z.string().min(1)).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.bundle) {
      if (!data.to_status?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to_status'], message: 'to_status required for bundle' });
      }
      return;
    }
    if (!data.field?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['field'], message: 'field is required' });
    }
  });

const draftResponseSchema = z.object({
  draft_text: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
});

const draftBundleSchema = z
  .object({
    action_taken: z.string().min(1),
    update_summary: z.string().min(1),
    confidence: z.number().min(0).max(1).optional(),
  })
  .passthrough();

export const suggestBodySchema = z.object({
  capability: z.enum(['draft_response', 'summarize_case', 'translate', 'kb_answer_assist'] as const),
  params: z.record(z.string(), z.unknown()).optional(),
});

const WORKFLOW_FIELD_GUIDANCE: Record<string, string> = {
  action_taken:
    'Describe what the officer did to advance this grievance (professional tone, 1–3 sentences, past tense).',
  update_summary:
    'Brief neutral summary of what changed on the case for the official record and complainant notification.',
  resolution_summary: 'Summarize how the grievance was resolved and any agreed outcomes.',
  investigation_summary: 'Summarize investigation findings without naming individuals.',
};

function fieldGuidance(field: string): string {
  return WORKFLOW_FIELD_GUIDANCE[field] ?? `Draft appropriate text for the case field "${field.replace(/_/g, ' ')}".`;
}

function redactEventSnippet(data: Record<string, unknown> | null | undefined): string {
  if (!data) return '';
  const parts: string[] = [];
  for (const key of ['action_taken', 'update_summary', 'note', 'body', 'from_status', 'to_status']) {
    const v = data[key];
    if (typeof v === 'string' && v.trim()) parts.push(`${key}: ${v.trim()}`);
  }
  return parts.join('; ');
}

export async function runCaseAiSuggest(
  tenantId: string,
  caseId: string,
  capability: AiCapability,
  params: Record<string, unknown> | undefined,
): Promise<
  | { ok: true; interaction_id: string; suggestion: Record<string, unknown>; confidence: number | null }
  | { ok: false; code: number; error: string; message?: string }
> {
  const cfg = await loadAiAssistanceConfig(tenantId);
  if (!cfg.ready || !cfg.cd16) {
    return { ok: false, code: 503, error: 'ai_disabled', message: cfg.reason ?? 'ai_disabled' };
  }

  if (capability !== 'draft_response') {
    return { ok: false, code: 501, error: 'capability_not_implemented', message: capability };
  }

  const profileRef = resolveProfileForCapability(cfg.cd16, 'draft_response');
  if (!profileRef) {
    return { ok: false, code: 403, error: 'ai_capability_disabled', message: 'draft_response' };
  }

  const parsedParams = draftResponseParams.safeParse(params ?? {});
  if (!parsedParams.success) {
    return { ok: false, code: 400, error: 'invalid_params', message: parsedParams.error.message };
  }

  const [caseRow] = await db
    .select()
    .from(schema.grmCase)
    .where(and(eq(schema.grmCase.tenantId, tenantId), eq(schema.grmCase.id, caseId)))
    .limit(1);
  if (!caseRow) return { ok: false, code: 404, error: 'case_not_found' };

  const events = await db
    .select({ kind: schema.caseEvent.kind, data: schema.caseEvent.data, createdAt: schema.caseEvent.createdAt })
    .from(schema.caseEvent)
    .where(eq(schema.caseEvent.caseId, caseId))
    .orderBy(asc(schema.caseEvent.createdAt))
    .limit(20);

  const narrative = redactIntakeText(
    [caseRow.summary, caseRow.description].filter(Boolean).join('\n\n'),
    cfg.cd16.safety,
  );

  const timeline = events
    .map((e) => {
      const data = (e.data ?? {}) as Record<string, unknown>;
      const snippet = redactIntakeText(redactEventSnippet(data), cfg.cd16!.safety);
      return snippet ? `${e.kind}: ${snippet}` : null;
    })
    .filter(Boolean)
    .slice(-8)
    .join('\n');

  const { field, to_status, context, message_kind, bundle, extra_fields } = parsedParams.data;

  const caseContext = [
    `Case reference: ${caseRow.reference}`,
    `Current status: ${caseRow.status}`,
    to_status ? `Proposed new status: ${to_status}` : '',
    `Categories: ${caseRow.categories.join(', ') || '(none)'}`,
    `Priority: ${caseRow.priority}`,
    message_kind ? `Message kind: ${message_kind}` : '',
    '',
    'Grievance summary (redacted):',
    narrative || '(none)',
    '',
    'Recent case timeline (redacted):',
    timeline || '(no prior events)',
  ]
    .filter(Boolean)
    .join('\n');

  const prompt = bundle
    ? (() => {
        const extras = extra_fields ?? [];
        const extraJsonLines = extras.map((f) => `  "${f}": "...",`);
        const extraGuidance = extras.map((f) => `Guidance for ${f}: ${fieldGuidance(f)}`).join('\n');
        return [
          'You assist government GRM officers drafting a workflow status transition.',
          'Return ONLY valid JSON:',
          '{',
          '  "action_taken": "what the officer did (1-3 sentences, past tense)",',
          '  "update_summary": "neutral summary of the status change for records",',
          ...extraJsonLines,
          '  "confidence": 0.0',
          '}',
          'Never include complainant names, phone numbers, email, or national IDs.',
          '',
          `Task: draft all fields for moving case from "${caseRow.status}" to "${to_status}".`,
          `Guidance for action_taken: ${fieldGuidance('action_taken')}`,
          `Guidance for update_summary: ${fieldGuidance('update_summary')}`,
          extraGuidance,
          '',
          caseContext,
        ]
          .filter(Boolean)
          .join('\n');
      })()
    : [
        'You assist government GRM officers drafting case documentation.',
        'Return ONLY valid JSON: { "draft_text": "...", "confidence": 0.0 }',
        'Never include complainant names, phone numbers, email, or national IDs.',
        'Use clear, respectful, factual language suitable for official records.',
        '',
        `Task context: ${context}`,
        `Target field: ${field}`,
        `Guidance: ${fieldGuidance(field!)}`,
        '',
        caseContext,
      ].join('\n');

  const inputHash = hashRedactedPrompt([prompt]);
  const started = Date.now();

  try {
    const result = await chatCompletion(
      profileRef.profile,
      [
        {
          role: 'system',
          content: 'You draft official grievance case text. Respond with JSON only.',
        },
        { role: 'user', content: prompt },
      ],
      { json_mode: true },
    );

    if (bundle) {
      const parsed = draftBundleSchema.parse(parseJsonFromModel(result.content));
      const drafts: Record<string, string> = {
        action_taken: parsed.action_taken.trim(),
        update_summary: parsed.update_summary.trim(),
      };
      for (const extra of extra_fields ?? []) {
        if (extra in parsed && typeof (parsed as Record<string, unknown>)[extra] === 'string') {
          drafts[extra] = String((parsed as Record<string, unknown>)[extra]).trim();
        }
      }
      const suggestion = {
        bundle: true,
        drafts,
        context,
        to_status: to_status ?? null,
        extra_fields: extra_fields ?? [],
      };

      const [row] = await db
        .insert(schema.aiInteraction)
        .values({
          tenantId,
          caseId,
          capability: 'draft_response',
          providerProfileId: profileRef.key,
          model: profileRef.profile.default_model,
          inputHash,
          inputTokenCount: result.input_token_count,
          outputTokenCount: result.output_token_count,
          suggestion,
          confidence: parsed.confidence ?? null,
          status: 'completed',
          decision: 'pending',
          latencyMs: result.latency_ms,
        })
        .returning({ id: schema.aiInteraction.id });

      return {
        ok: true,
        interaction_id: row!.id,
        suggestion,
        confidence: parsed.confidence ?? null,
      };
    }

    const parsed = draftResponseSchema.parse(parseJsonFromModel(result.content));
    const suggestion = {
      draft_text: parsed.draft_text.trim(),
      field,
      context,
      to_status: to_status ?? null,
      message_kind: message_kind ?? null,
    };

    const [row] = await db
      .insert(schema.aiInteraction)
      .values({
        tenantId,
        caseId,
        capability: 'draft_response',
        providerProfileId: profileRef.key,
        model: profileRef.profile.default_model,
        inputHash,
        inputTokenCount: result.input_token_count,
        outputTokenCount: result.output_token_count,
        suggestion,
        confidence: parsed.confidence ?? null,
        status: 'completed',
        decision: 'pending',
        latencyMs: result.latency_ms,
      })
      .returning({ id: schema.aiInteraction.id });

    return {
      ok: true,
      interaction_id: row!.id,
      suggestion,
      confidence: parsed.confidence ?? null,
    };
  } catch (err) {
    await db.insert(schema.aiInteraction).values({
      tenantId,
      caseId,
      capability: 'draft_response',
      providerProfileId: profileRef.key,
      model: profileRef.profile.default_model,
      inputHash,
      suggestion: { field, context, to_status: to_status ?? null },
      status: 'failed',
      error: err instanceof Error ? err.message : 'draft_failed',
      decision: 'rejected',
      latencyMs: Date.now() - started,
    });
    return {
      ok: false,
      code: 502,
      error: 'provider_failed',
      message: err instanceof Error ? err.message : 'draft_failed',
    };
  }
}