import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { decryptPII, piiLookupHash } from './crypto.js';
import { writeAudit } from './audit.js';

export interface PortalDataErasureInput {
  tenantId: string;
  name: string;
  phone: string;
  email: string;
}

export type PortalDataErasureResult =
  | { ok: true; parties_affected: number; cases_affected: number }
  | { ok: false; code: number; error: string; message?: string };

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Try common Kenya phone shapes so +254 / 07… formats match stored intake values. */
function phoneLookupHashes(raw: string): string[] {
  const hashes = new Set<string>();
  const add = (v: string | null | undefined) => {
    const h = piiLookupHash(v);
    if (h) hashes.add(h);
  };
  add(raw);
  const digits = raw.replace(/\D/g, '');
  add(digits);
  if (digits.length === 12 && digits.startsWith('254')) add(`0${digits.slice(3)}`);
  if (digits.length === 9 && digits.startsWith('7')) add(`0${digits}`);
  if (digits.length === 10 && digits.startsWith('0')) add(digits);
  return [...hashes];
}

function partyMatches(
  row: {
    nameEnc: string | null;
    phoneHash: string | null;
    emailHash: string | null;
  },
  name: string,
  phoneHashes: string[],
  emailHash: string | null,
): boolean {
  const decryptedName = row.nameEnc ? decryptPII(row.nameEnc) : null;
  if (!decryptedName || normalizeName(decryptedName) !== normalizeName(name)) return false;
  if (!row.phoneHash || !phoneHashes.includes(row.phoneHash)) return false;
  if (row.emailHash) {
    if (!emailHash || row.emailHash !== emailHash) return false;
  }
  return true;
}

function partyAlreadyErased(row: {
  nameEnc: string | null;
  phoneEnc: string | null;
  emailEnc: string | null;
  phoneHash: string | null;
  emailHash: string | null;
}): boolean {
  return !row.nameEnc && !row.phoneEnc && !row.emailEnc && !row.phoneHash && !row.emailHash;
}

export async function requestPortalDataErasure(input: PortalDataErasureInput): Promise<PortalDataErasureResult> {
  const name = input.name.trim();
  const phone = input.phone.trim();
  const email = input.email.trim().toLowerCase();
  if (name.length < 2) {
    return { ok: false, code: 422, error: 'invalid_name', message: 'Enter the full name used when you submitted your case.' };
  }
  if (phone.length < 9) {
    return { ok: false, code: 422, error: 'invalid_phone', message: 'Enter a valid phone number.' };
  }
  if (!email.includes('@')) {
    return { ok: false, code: 422, error: 'invalid_email', message: 'Enter a valid email address.' };
  }

  const phoneHashes = phoneLookupHashes(phone);
  const emailHash = piiLookupHash(email);
  if (!phoneHashes.length || !emailHash) {
    return { ok: false, code: 422, error: 'invalid_body', message: 'Could not process the contact details provided.' };
  }

  const phoneCandidates = await db
    .select()
    .from(schema.party)
    .where(and(eq(schema.party.tenantId, input.tenantId), inArray(schema.party.phoneHash, phoneHashes)));

  const matchingParties = phoneCandidates.filter((row) => partyMatches(row, name, phoneHashes, emailHash));
  if (!matchingParties.length) {
    return {
      ok: false,
      code: 404,
      error: 'no_match',
      message: 'We could not verify these details against our records. Check the information and try again, or contact us using the details below.',
    };
  }

  const partiesToErase = matchingParties.filter((row) => !partyAlreadyErased(row));
  if (!partiesToErase.length) {
    return {
      ok: false,
      code: 409,
      error: 'already_erased',
      message: 'Personal contact details matching this information have already been removed.',
    };
  }

  const partyIds = partiesToErase.map((p) => p.id);
  const caseRows = await db
    .select({ id: schema.grmCase.id, partyId: schema.grmCase.partyId })
    .from(schema.grmCase)
    .where(and(eq(schema.grmCase.tenantId, input.tenantId), inArray(schema.grmCase.partyId, partyIds)));

  await db.transaction(async (tx) => {
    for (const partyId of partyIds) {
      await tx
        .update(schema.party)
        .set({
          nameEnc: null,
          phoneEnc: null,
          emailEnc: null,
          phoneHash: null,
          emailHash: null,
          notificationChannels: [],
        })
        .where(and(eq(schema.party.tenantId, input.tenantId), eq(schema.party.id, partyId)));
    }

    const caseIds = [...new Set(caseRows.map((c) => c.id))];
    for (const caseId of caseIds) {
      await tx
        .update(schema.grmCase)
        .set({
          verifierHash: null,
          anonymous: true,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.grmCase.tenantId, input.tenantId), eq(schema.grmCase.id, caseId)));

      await tx.insert(schema.caseEvent).values({
        tenantId: input.tenantId,
        caseId,
        kind: 'field_edited',
        actorType: 'complainant',
        visibility: 'internal',
        data: { field: 'complainant.pii_erasure', source: 'portal_self_service' },
      });
    }
  });

  await writeAudit({
    tenantId: input.tenantId,
    actorId: null,
    action: 'portal.data_erasure',
    entity: 'party',
    data: {
      parties_affected: partyIds.length,
      cases_affected: caseRows.length,
    },
  });

  return {
    ok: true,
    parties_affected: partyIds.length,
    cases_affected: caseRows.length,
  };
}
