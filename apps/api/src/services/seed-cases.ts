import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Cd02Hierarchy, Cd03Taxonomy, Cd04Workflow, Cd07Numbering } from '@egrm/config-schemas';
import { intakeLevels as hierarchyIntakeLevels } from '@egrm/config-schemas';
import { db, schema } from '../db/client.js';
import { encryptPII, piiLookupHash } from './crypto.js';
import { getActiveConfig } from './config.js';
import { allocateReference } from './reference.js';
import { deleteAttachmentBlob } from './attachment-storage.js';

/** Channel marker for synthetic test cases — used to clear seed data without touching real cases. */
export const SEED_CHANNEL = 'seed';

const SUMMARIES = [
  'Delayed compensation payment',
  'Noise from construction site',
  'Boundary dispute with neighbour',
  'Water supply interruption',
  'Unfair treatment at project office',
  'Environmental damage near settlement',
  'Missing project documentation',
  'Harassment complaint',
  'Road access blocked',
  'Community meeting grievance',
];

const DESCRIPTIONS = [
  'The complainant reports repeated follow-ups without a formal response from the project team.',
  'Residents near the worksite experience dust and noise outside agreed hours.',
  'A land parcel was measured differently from what was agreed during enumeration.',
  'Piped water has been unavailable for several weeks despite prior assurances.',
  'Staff at the coordination office allegedly refused to register the complaint.',
  'Vegetation was cleared without prior notice to affected households.',
  'Requested records have not been shared after multiple written requests.',
  'The complainant alleges intimidation when raising concerns at a public forum.',
  'Access road repairs left the route impassable during rainy season.',
  'Concerns raised at a community meeting were not reflected in project minutes.',
];

const OUTCOMES = [
  'Compensation reassessment and written explanation',
  'Enforce agreed working hours and dust control',
  'Independent survey and mediation',
  'Restore water supply within two weeks',
  'Formal apology and staff retraining',
  'Environmental remediation plan',
  'Release of requested documents',
  'Investigation and protective measures',
  'Road repair and drainage improvement',
  'Updated community engagement record',
];

const GENDERS = ['female', 'male', 'prefer_not_say'];
const AGE_BANDS = ['18-24', '25-34', '35-44', '45-54', '55+'];
const LANGUAGES = ['en', 'sw'];

function pick<T>(items: T[], index: number): T {
  return items[index % items.length]!;
}

function pickSome<T>(items: T[], count: number, seed: number): T[] {
  if (items.length === 0) return [];
  const out: T[] = [];
  for (let i = 0; i < count; i++) out.push(pick(items, seed + i));
  return [...new Set(out)];
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

export async function countSeedCases(tenantId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.grmCase)
    .where(and(eq(schema.grmCase.tenantId, tenantId), eq(schema.grmCase.channel, SEED_CHANNEL)));
  return Number(row?.count ?? 0);
}

export async function seedCases(
  tenantId: string,
  count: number,
  actorId?: string | null,
): Promise<{ created: number; by_status: Record<string, number> }> {
  const [workflow, hierarchy, numbering, taxonomy] = await Promise.all([
    getActiveConfig<Cd04Workflow>(tenantId, 'cd04_workflow'),
    getActiveConfig<Cd02Hierarchy>(tenantId, 'cd02_hierarchy'),
    getActiveConfig<Cd07Numbering>(tenantId, 'cd07_numbering'),
    getActiveConfig<Cd03Taxonomy>(tenantId, 'cd03_taxonomy'),
  ]);
  if (!workflow || !hierarchy || !numbering) {
    throw new Error('tenant_not_configured');
  }

  const statuses = workflow.statuses;
  const intakeLevelCodes = hierarchyIntakeLevels(hierarchy).map((l) => l.code.toLowerCase());
  const fallbackLevel = hierarchyIntakeLevels(hierarchy)[0]?.code ?? 'settlement';

  const units = intakeLevelCodes.length
    ? await db
        .select({ id: schema.unit.id, levelCode: schema.unit.levelCode })
        .from(schema.unit)
        .where(
          and(
            eq(schema.unit.tenantId, tenantId),
            inArray(sql`lower(${schema.unit.levelCode})`, intakeLevelCodes),
          ),
        )
        .limit(200)
    : [];

  const staff = await db
    .select({ id: schema.appUser.id })
    .from(schema.appUser)
    .where(and(eq(schema.appUser.tenantId, tenantId), eq(schema.appUser.active, true)))
    .limit(20);

  const categories = (taxonomy?.categories ?? []).filter((c) => c.active).map((c) => c.code);
  const priorities = (taxonomy?.priorities ?? []).map((p) => p.code);
  const sensitivities = ['standard', ...(taxonomy?.sensitivity_classes ?? []).map((s) => s.code)];

  const byStatus: Record<string, number> = {};
  let created = 0;

  for (let i = 0; i < count; i++) {
    const statusDef = pick(statuses, i);
    const anonymous = i % 4 === 0;
    const unit = units.length ? pick(units, i) : null;
    const levelCode = unit?.levelCode ?? pick(
      hierarchy.levels.map((l) => l.code),
      i,
    ) ?? fallbackLevel;
    const categoryPick = categories.length ? pickSome(categories, 1 + (i % 2), i) : ['other'];
    const priority = priorities.length ? pick(priorities, i) : 'normal';
    const sensitivity = pick(sensitivities, i);
    const assignee = staff.length && i % 3 === 0 ? pick(staff, i).id : null;
    const summary = `[Seed] ${pick(SUMMARIES, i)}`;
    const description = pick(DESCRIPTIONS, i);
    const expectedOutcome = i % 2 === 0 ? pick(OUTCOMES, i) : null;
    const reference = await allocateReference(tenantId, numbering);
    const verifierHash = piiLookupHash(anonymous ? `seed-pin-${i}-${tenantId}` : `seed-${i}@example.test`);

    await db.transaction(async (tx) => {
      let partyId: string | null = null;
      if (!anonymous) {
        const name = `Seed Complainant ${i + 1}`;
        const phone = `+2547${String(10000000 + (i % 90000000)).slice(0, 8)}`;
        const email = `seed${i + 1}@example.test`;
        const [party] = await tx
          .insert(schema.party)
          .values({
            tenantId,
            nameEnc: encryptPII(name),
            phoneEnc: encryptPII(phone),
            emailEnc: encryptPII(email),
            phoneHash: piiLookupHash(phone),
            emailHash: piiLookupHash(email),
            gender: pick(GENDERS, i),
            ageBand: pick(AGE_BANDS, i),
            preferredLanguage: pick(LANGUAGES, i),
            notificationChannels: [],
          })
          .returning({ id: schema.party.id });
        partyId = party!.id;
      }

      const [createdCase] = await tx
        .insert(schema.grmCase)
        .values({
          tenantId,
          reference,
          caseType: workflow.case_type,
          status: statusDef.name,
          statusTag: statusDef.tag,
          levelCode,
          unitId: unit?.id ?? null,
          partyId,
          anonymous,
          channel: SEED_CHANNEL,
          categories: categoryPick,
          sensitivity,
          priority,
          summary,
          description,
          expectedOutcome,
          dateOccurred: daysAgo(1 + (i % 90)),
          consent: !anonymous,
          verifierHash,
          assigneeId: assignee,
          createdAt: daysAgo(i % 120),
          updatedAt: daysAgo(i % 30),
        })
        .returning({ id: schema.grmCase.id });

      await tx.insert(schema.caseEvent).values({
        tenantId,
        caseId: createdCase!.id,
        kind: 'created',
        actorType: actorId ? 'staff' : 'system',
        actorId: actorId ?? null,
        visibility: 'internal',
        data: {
          channel: SEED_CHANNEL,
          status: statusDef.name,
          anonymous,
          seed: true,
        },
      });
    });

    byStatus[statusDef.name] = (byStatus[statusDef.name] ?? 0) + 1;
    created++;
  }

  return { created, by_status: byStatus };
}

export async function clearSeedCases(tenantId: string): Promise<{
  cases: number;
  parties: number;
  attachments: number;
}> {
  const seedCases = await db
    .select({ id: schema.grmCase.id, partyId: schema.grmCase.partyId })
    .from(schema.grmCase)
    .where(and(eq(schema.grmCase.tenantId, tenantId), eq(schema.grmCase.channel, SEED_CHANNEL)));

  if (!seedCases.length) {
    return { cases: 0, parties: 0, attachments: 0 };
  }

  const caseIds = seedCases.map((c) => c.id);
  const partyIds = [...new Set(seedCases.map((c) => c.partyId).filter((id): id is string => Boolean(id)))];

  const attachmentRows = await db
    .select({ storageKey: schema.caseAttachment.storageKey })
    .from(schema.caseAttachment)
    .where(and(eq(schema.caseAttachment.tenantId, tenantId), inArray(schema.caseAttachment.caseId, caseIds)));

  for (const row of attachmentRows) {
    try {
      await deleteAttachmentBlob(row.storageKey);
    } catch {
      // Missing blob is fine during cleanup.
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(schema.notificationLog).where(
      and(eq(schema.notificationLog.tenantId, tenantId), inArray(schema.notificationLog.caseId, caseIds)),
    );
    await tx.delete(schema.notificationOutbox).where(
      and(eq(schema.notificationOutbox.tenantId, tenantId), inArray(schema.notificationOutbox.caseId, caseIds)),
    );
    await tx.delete(schema.caseAttachment).where(
      and(eq(schema.caseAttachment.tenantId, tenantId), inArray(schema.caseAttachment.caseId, caseIds)),
    );
    await tx.delete(schema.threadEntry).where(
      and(eq(schema.threadEntry.tenantId, tenantId), inArray(schema.threadEntry.caseId, caseIds)),
    );
    await tx.delete(schema.caseEvent).where(
      and(eq(schema.caseEvent.tenantId, tenantId), inArray(schema.caseEvent.caseId, caseIds)),
    );
    await tx.delete(schema.grmCase).where(
      and(eq(schema.grmCase.tenantId, tenantId), inArray(schema.grmCase.id, caseIds)),
    );

    if (partyIds.length) {
      const remaining = await tx
        .select({ partyId: schema.grmCase.partyId })
        .from(schema.grmCase)
        .where(and(eq(schema.grmCase.tenantId, tenantId), inArray(schema.grmCase.partyId, partyIds)));
      const stillUsed = new Set(remaining.map((r) => r.partyId).filter(Boolean));
      const orphanPartyIds = partyIds.filter((id) => !stillUsed.has(id));
      if (orphanPartyIds.length) {
        await tx.delete(schema.party).where(
          and(eq(schema.party.tenantId, tenantId), inArray(schema.party.id, orphanPartyIds)),
        );
      }
    }
  });

  return {
    cases: caseIds.length,
    parties: partyIds.length,
    attachments: attachmentRows.length,
  };
}
