import { randomInt } from 'node:crypto';
import { and, eq, gte } from 'drizzle-orm';
import type { Cd02Hierarchy, Cd04Workflow, Cd06IntakeForms, Cd07Numbering } from '@egrm/config-schemas';
import { intakeLevels as hierarchyIntakeLevels } from '@egrm/config-schemas';
import { db, schema } from '../db/client.js';
import { encryptPII, piiLookupHash } from './crypto.js';
import { getActiveConfig } from './config.js';
import { allocateReference } from './reference.js';
import { enqueueNotifications } from './notifications.js';

export interface IntakeInput {
  tenantId: string;
  channel: string;
  anonymous: boolean;
  consent: boolean;
  /** Flat field values keyed by CD-06 field key. */
  values: Record<string, unknown>;
  /** Staff actor for assisted intake; null for public submissions. */
  staffActorId?: string | null;
}

export interface IntakeResult {
  ok: true;
  caseId: string;
  reference: string;
  status: string;
  /** One-time tracking PIN — only for anonymous cases, returned once, never stored in clear. */
  trackingPin?: string;
  possibleDuplicates: number;
}

export interface IntakeError {
  ok: false;
  code: number;
  error: string;
  details?: unknown;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export async function createCase(input: IntakeInput): Promise<IntakeResult | IntakeError> {
  const [form, workflow, hierarchy, numbering] = await Promise.all([
    getActiveConfig<Cd06IntakeForms>(input.tenantId, 'cd06_intake_forms'),
    getActiveConfig<Cd04Workflow>(input.tenantId, 'cd04_workflow'),
    getActiveConfig<Cd02Hierarchy>(input.tenantId, 'cd02_hierarchy'),
    getActiveConfig<Cd07Numbering>(input.tenantId, 'cd07_numbering'),
  ]);
  if (!form || !workflow || !hierarchy || !numbering) {
    return { ok: false, code: 503, error: 'tenant_not_configured' };
  }

  if (input.anonymous && !form.anonymous_allowed) {
    return { ok: false, code: 422, error: 'anonymous_not_allowed' };
  }

  // Validate required fields from the form definition (complainant section skipped when anonymous).
  const missing: string[] = [];
  for (const field of form.fields) {
    if (!field.enabled || !field.required) continue;
    if (input.anonymous && field.section === 'complainant') continue;
    const v = input.values[field.key];
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) missing.push(field.key);
  }
  if (missing.length > 0) {
    return { ok: false, code: 422, error: 'missing_required_fields', details: { fields: missing } };
  }

  const name = str(input.values.name);
  const phone = str(input.values.phone);
  const email = str(input.values.email);
  const hasPII = !input.anonymous && Boolean(name || phone || email);
  if (hasPII && !input.consent) {
    return { ok: false, code: 422, error: 'consent_required' };
  }

  // Initial status & level from config (CD-04 / CD-02).
  const initialStatus = workflow.initial.default;
  const statusTag = workflow.statuses.find((s) => s.name === initialStatus)?.tag ?? 'open';
  const intakeLevels = hierarchyIntakeLevels(hierarchy);
  const fallbackIntakeLevel = intakeLevels[0]!;

  // Resolve unit if provided.
  const unitId = str(input.values.unit_id);
  let unitRow = null;
  if (unitId) {
    [unitRow] = await db
      .select()
      .from(schema.unit)
      .where(and(eq(schema.unit.tenantId, input.tenantId), eq(schema.unit.id, unitId)))
      .limit(1);
    if (!unitRow) return { ok: false, code: 422, error: 'unknown_unit' };
    const unitLevelAllowsIntake = intakeLevels.some(
      (l) => l.code.toLowerCase() === unitRow!.levelCode.toLowerCase(),
    );
    if (!unitLevelAllowsIntake) {
      return { ok: false, code: 422, error: 'unit_not_at_intake_level' };
    }
  }

  // Tracking verifier: submitter phone/email, or a one-time PIN for anonymous cases.
  let trackingPin: string | undefined;
  let verifierSource = phone ?? email;
  if (input.anonymous || !verifierSource) {
    trackingPin = String(randomInt(100000, 999999));
    verifierSource = trackingPin;
  }
  const verifierHash = piiLookupHash(verifierSource);

  // Dedupe signal (GEN-INT-07, Phase 1 = warn): same phone within the last 14 days.
  let possibleDuplicates = 0;
  const phoneHash = piiLookupHash(phone);
  if (phoneHash) {
    const since = new Date(Date.now() - 14 * 24 * 3600 * 1000);
    const dupes = await db
      .select({ id: schema.grmCase.id })
      .from(schema.grmCase)
      .innerJoin(schema.party, eq(schema.grmCase.partyId, schema.party.id))
      .where(
        and(
          eq(schema.grmCase.tenantId, input.tenantId),
          eq(schema.party.phoneHash, phoneHash),
          gte(schema.grmCase.createdAt, since),
        ),
      );
    possibleDuplicates = dupes.length;
  }

  const reference = await allocateReference(input.tenantId, numbering);

  const result = await db.transaction(async (tx) => {
    let partyId: string | null = null;
    if (hasPII) {
      const [p] = await tx
        .insert(schema.party)
        .values({
          tenantId: input.tenantId,
          nameEnc: encryptPII(name),
          phoneEnc: encryptPII(phone),
          emailEnc: encryptPII(email),
          phoneHash,
          emailHash: piiLookupHash(email),
          gender: str(input.values.gender),
          ageBand: str(input.values.age_band),
          preferredLanguage: str(input.values.preferred_language),
        })
        .returning({ id: schema.party.id });
      partyId = p!.id;
    }

    const categories = Array.isArray(input.values.categories) ? (input.values.categories as string[]) : [];
    const [c] = await tx
      .insert(schema.grmCase)
      .values({
        tenantId: input.tenantId,
        reference,
        caseType: form.case_type,
        status: initialStatus,
        statusTag,
        levelCode: unitRow?.levelCode ?? fallbackIntakeLevel.code,
        unitId: unitRow?.id ?? null,
        partyId,
        anonymous: input.anonymous,
        channel: input.channel,
        categories,
        summary: str(input.values.summary) ?? '(no summary)',
        description: str(input.values.description),
        expectedOutcome: str(input.values.expected_outcome),
        dateOccurred: str(input.values.date_occurred) ? new Date(String(input.values.date_occurred)) : null,
        consent: input.consent,
        verifierHash,
      })
      .returning({ id: schema.grmCase.id });

    await tx.insert(schema.caseEvent).values({
      tenantId: input.tenantId,
      caseId: c!.id,
      kind: 'created',
      actorType: input.staffActorId ? 'staff' : 'complainant',
      actorId: input.staffActorId ?? null,
      visibility: 'public',
      data: { channel: input.channel, status: initialStatus, anonymous: input.anonymous },
    });

    await enqueueNotifications(
      {
        tenantId: input.tenantId,
        caseId: c!.id,
        event: 'case.created',
        case: {
          reference,
          status: initialStatus,
          sensitivity: 'standard',
          priority: str(input.values.priority) ?? 'normal',
          levelCode: unitRow?.levelCode ?? fallbackIntakeLevel.code,
          channel: input.channel,
          anonymous: input.anonymous,
          categories,
          unitId: unitRow?.id ?? null,
          assigneeId: null,
          partyId,
        },
        locale: str(input.values.preferred_language) ?? undefined,
      },
      tx,
    );

    return c!.id;
  });

  return { ok: true, caseId: result, reference, status: initialStatus, trackingPin, possibleDuplicates };
}
