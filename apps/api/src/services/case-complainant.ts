import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Cd06IntakeForms, Cd09Notifications } from '@egrm/config-schemas';
import {
  configuredPartyNotificationChannels,
  normalizePartyNotificationChannels,
} from '@egrm/config-schemas';
import { db, schema } from '../db/client.js';
import { decryptPII, encryptPII, piiLookupHash } from './crypto.js';
import { getActiveConfig } from './config.js';
import { canAccessCase, type UserAccess } from './access.js';
import { writeAudit } from './audit.js';
import { coerceIntakeString, coerceIntakeStringArray } from './intake-values.js';

const EDITABLE_FIELDS = new Set([
  'name',
  'phone',
  'email',
  'gender',
  'age_band',
  'preferred_language',
  'notification_channels',
]);

export const patchCaseComplainantBody = z.object({
  fields: z
    .record(z.string(), z.unknown())
    .refine((fields) => Object.keys(fields).length > 0, 'fields_required')
    .refine((fields) => Object.keys(fields).every((key) => EDITABLE_FIELDS.has(key)), 'invalid_field'),
});

export type ComplainantFieldOptions = {
  gender: { value: string; label: string }[];
  age_band: { value: string; label: string }[];
  preferred_language: { value: string; label: string }[];
  notification_channels: { value: string; label: string }[];
};

function formSelectOptions(form: Cd06IntakeForms, key: string): { value: string; label: string }[] {
  const field = form.fields.find((f) => f.key === key && f.enabled !== false);
  if (!field?.options?.length) return [];
  return field.options.map((o) => ({ value: o.value, label: o.label.en ?? o.value }));
}

export async function getComplainantFieldOptions(tenantId: string): Promise<ComplainantFieldOptions | null> {
  const [form, notifications, identity] = await Promise.all([
    getActiveConfig<Cd06IntakeForms>(tenantId, 'cd06_intake_forms'),
    getActiveConfig<Cd09Notifications>(tenantId, 'cd09_notifications'),
    getActiveConfig<{ locales?: { enabled?: string[] } }>(tenantId, 'cd01_identity'),
  ]);
  if (!form) return null;

  const locales = identity?.locales?.enabled?.length ? identity.locales.enabled : ['en', 'sw'];
  const languageLabels: Record<string, string> = { en: 'English', sw: 'Kiswahili' };

  return {
    gender: formSelectOptions(form, 'gender'),
    age_band: formSelectOptions(form, 'age_band'),
    preferred_language: locales.map((code) => ({
      value: code,
      label: languageLabels[code] ?? code,
    })),
    notification_channels: notifications
      ? configuredPartyNotificationChannels(notifications).map((ch) => ({
          value: ch.value,
          label: ch.label.en ?? ch.value,
        }))
      : [],
  };
}

function valuesEqual(field: string, from: unknown, to: unknown): boolean {
  if (field === 'notification_channels') {
    const a = [...coerceIntakeStringArray(from)].sort().join(',');
    const b = [...coerceIntakeStringArray(to)].sort().join(',');
    return a === b;
  }
  const a = from === null || from === undefined ? '' : String(from);
  const b = to === null || to === undefined ? '' : String(to);
  return a === b;
}

export type ComplainantPatchResult = {
  name: string | null;
  phone: string | null;
  email: string | null;
  gender: string | null;
  age_band: string | null;
  preferred_language: string | null;
  notification_channels: string[];
};

function partyToComplainant(p: typeof schema.party.$inferSelect): ComplainantPatchResult {
  return {
    name: decryptPII(p.nameEnc),
    phone: decryptPII(p.phoneEnc),
    email: decryptPII(p.emailEnc),
    gender: p.gender,
    age_band: p.ageBand,
    preferred_language: p.preferredLanguage,
    notification_channels: p.notificationChannels ?? [],
  };
}

export async function updateCaseComplainant(
  tenantId: string,
  caseId: string,
  actorId: string,
  access: UserAccess,
  rawBody: unknown,
): Promise<
  | { ok: false; code: 400 | 403 | 404 | 422 | 503; error: string; message?: string }
  | { ok: true; complainant: ComplainantPatchResult }
> {
  const parsed = patchCaseComplainantBody.safeParse(rawBody);
  if (!parsed.success) {
    return { ok: false, code: 400, error: 'invalid_body', message: parsed.error.message };
  }

  const [caseRow] = await db
    .select()
    .from(schema.grmCase)
    .where(and(eq(schema.grmCase.tenantId, tenantId), eq(schema.grmCase.id, caseId)))
    .limit(1);
  if (!caseRow) return { ok: false, code: 404, error: 'not_found' };

  const allowed = await canAccessCase(tenantId, access, actorId, {
    unitId: caseRow.unitId,
    assigneeId: caseRow.assigneeId,
    sensitivity: caseRow.sensitivity,
  });
  if (!allowed) return { ok: false, code: 404, error: 'not_found' };

  if (caseRow.anonymous) {
    return { ok: false, code: 422, error: 'anonymous_case', message: 'Anonymous cases have no complainant details to edit.' };
  }
  if (!caseRow.partyId) {
    return { ok: false, code: 422, error: 'no_complainant', message: 'This case has no complainant record.' };
  }

  const [partyRow] = await db
    .select()
    .from(schema.party)
    .where(and(eq(schema.party.tenantId, tenantId), eq(schema.party.id, caseRow.partyId)))
    .limit(1);
  if (!partyRow) return { ok: false, code: 422, error: 'no_complainant' };

  const [form, notifications] = await Promise.all([
    getActiveConfig<Cd06IntakeForms>(tenantId, 'cd06_intake_forms'),
    getActiveConfig<Cd09Notifications>(tenantId, 'cd09_notifications'),
  ]);
  if (!form) return { ok: false, code: 503, error: 'tenant_not_configured' };

  const current = partyToComplainant(partyRow);
  const merged = { ...current };
  for (const [field, rawValue] of Object.entries(parsed.data.fields)) {
    if (field === 'notification_channels') {
      merged.notification_channels = coerceIntakeStringArray(rawValue);
    } else if (field === 'email') {
      merged.email = coerceIntakeString(rawValue);
    } else {
      merged[field as keyof Omit<ComplainantPatchResult, 'notification_channels'>] = coerceIntakeString(rawValue);
    }
  }

  const updates: Partial<typeof schema.party.$inferInsert> = {};
  const caseUpdates: Partial<typeof schema.grmCase.$inferInsert> = { updatedAt: new Date() };
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  for (const [field, rawValue] of Object.entries(parsed.data.fields)) {
    if (field === 'name') {
      const name = coerceIntakeString(rawValue);
      if (!name) {
        return { ok: false, code: 422, error: 'name_required', message: 'Name cannot be empty.' };
      }
      if (!valuesEqual('name', current.name, name)) {
        changes.name = { from: current.name, to: name };
        updates.nameEnc = encryptPII(name);
      }
      continue;
    }

    if (field === 'phone') {
      const phone = coerceIntakeString(rawValue);
      if (!phone) {
        return { ok: false, code: 422, error: 'phone_required', message: 'Phone cannot be empty.' };
      }
      if (!valuesEqual('phone', current.phone, phone)) {
        changes.phone = { from: current.phone, to: phone };
        updates.phoneEnc = encryptPII(phone);
        updates.phoneHash = piiLookupHash(phone);
      }
      continue;
    }

    if (field === 'email') {
      const email = coerceIntakeString(rawValue);
      if (!valuesEqual('email', current.email, email)) {
        changes.email = { from: current.email, to: email };
        updates.emailEnc = encryptPII(email);
        updates.emailHash = piiLookupHash(email);
      }
      continue;
    }

    if (field === 'gender') {
      const gender = coerceIntakeString(rawValue);
      const genderCodes = new Set(formSelectOptions(form, 'gender').map((o) => o.value));
      if (gender && genderCodes.size > 0 && !genderCodes.has(gender)) {
        return { ok: false, code: 422, error: 'invalid_gender' };
      }
      const next = gender || null;
      if (!valuesEqual('gender', current.gender, next)) {
        changes.gender = { from: current.gender, to: next };
        updates.gender = next;
      }
      continue;
    }

    if (field === 'age_band') {
      const ageBand = coerceIntakeString(rawValue);
      const ageCodes = new Set(formSelectOptions(form, 'age_band').map((o) => o.value));
      if (ageBand && ageCodes.size > 0 && !ageCodes.has(ageBand)) {
        return { ok: false, code: 422, error: 'invalid_age_band' };
      }
      const next = ageBand || null;
      if (!valuesEqual('age_band', current.age_band, next)) {
        changes.age_band = { from: current.age_band, to: next };
        updates.ageBand = next;
      }
      continue;
    }

    if (field === 'preferred_language') {
      const lang = coerceIntakeString(rawValue);
      const next = lang || null;
      if (!valuesEqual('preferred_language', current.preferred_language, next)) {
        changes.preferred_language = { from: current.preferred_language, to: next };
        updates.preferredLanguage = next;
      }
      continue;
    }

    if (field === 'notification_channels') {
      if (!notifications) {
        return { ok: false, code: 503, error: 'tenant_not_configured' };
      }
      const channelResult = normalizePartyNotificationChannels(
        rawValue,
        notifications,
        { phone: merged.phone, email: merged.email },
      );
      if (!channelResult.ok) {
        return {
          ok: false,
          code: 422,
          error: channelResult.error,
          message:
            channelResult.error === 'notification_channels_required'
              ? 'Choose at least one notification channel.'
              : undefined,
        };
      }
      const channels = channelResult.channels;
      if (!valuesEqual('notification_channels', current.notification_channels, channels)) {
        changes.notification_channels = { from: current.notification_channels, to: channels };
        updates.notificationChannels = channels;
      }
    }
  }

  if (Object.keys(changes).length === 0) {
    return { ok: true, complainant: current };
  }

  const phoneOrEmailChanged = Boolean(changes.phone || changes.email);
  if (phoneOrEmailChanged) {
    const verifierSource = merged.phone ?? merged.email;
    if (verifierSource) {
      caseUpdates.verifierHash = piiLookupHash(verifierSource);
    }
  }

  await db.transaction(async (tx) => {
    await tx.update(schema.party).set(updates).where(eq(schema.party.id, partyRow.id));
    await tx.update(schema.grmCase).set(caseUpdates).where(eq(schema.grmCase.id, caseId));

    for (const [field, change] of Object.entries(changes)) {
      await tx.insert(schema.caseEvent).values({
        tenantId,
        caseId,
        kind: 'field_edited',
        actorType: 'staff',
        actorId,
        visibility: 'internal',
        data: { field: `complainant.${field}`, from: change.from, to: change.to },
      });
    }
  });

  await writeAudit({
    tenantId,
    actorId,
    action: 'case.complainant_updated',
    entity: 'grm_case',
    entityId: caseId,
    data: { fields: Object.keys(changes) },
  });

  const [updatedParty] = await db
    .select()
    .from(schema.party)
    .where(eq(schema.party.id, partyRow.id))
    .limit(1);

  return { ok: true, complainant: partyToComplainant(updatedParty!) };
}
