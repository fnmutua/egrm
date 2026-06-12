import type { FastifyInstance } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Cd01Identity, Cd02Hierarchy, Cd03Taxonomy, Cd06IntakeForms } from '../types.js';
import { db, schema } from '../db/client.js';
import { getActiveConfig } from '../services/config.js';
import { createCase } from '../services/intake.js';
import { piiLookupHash } from '../services/crypto.js';

const submitBody = z.object({
  anonymous: z.boolean().default(false),
  consent: z.boolean().default(false),
  values: z.record(z.string(), z.unknown()),
});

const trackBody = z.object({
  reference: z.string().min(3).max(64),
  verifier: z.string().min(3).max(128),
});

/** Public (unauthenticated) surface: intake metadata, submission, tracking. Rate-limited. */
export default async function publicRoutes(app: FastifyInstance) {
  const rateLimit = { rateLimit: { max: 30, timeWindow: '1 minute' } };

  // Everything the portal needs to render the configured intake form.
  app.get('/api/v1/public/intake-meta', { config: rateLimit }, async (req, reply) => {
    const [identity, form, hierarchy, taxonomy] = await Promise.all([
      getActiveConfig<Cd01Identity>(req.tenant.id, 'cd01_identity'),
      getActiveConfig<Cd06IntakeForms>(req.tenant.id, 'cd06_intake_forms'),
      getActiveConfig<Cd02Hierarchy>(req.tenant.id, 'cd02_hierarchy'),
      getActiveConfig<Cd03Taxonomy>(req.tenant.id, 'cd03_taxonomy'),
    ]);
    if (!form || !hierarchy) return reply.code(503).send({ error: 'tenant_not_configured' });

    const units = await db
      .select({
        id: schema.unit.id,
        levelCode: schema.unit.levelCode,
        parentId: schema.unit.parentId,
        name: schema.unit.name,
      })
      .from(schema.unit)
      .where(and(eq(schema.unit.tenantId, req.tenant.id), eq(schema.unit.active, true)))
      .orderBy(asc(schema.unit.name));

    return {
      locales: identity?.locales ?? { default: 'en', enabled: ['en'] },
      anonymous_allowed: form.anonymous_allowed,
      consent_text: form.consent_text,
      fields: form.fields.filter((f) => f.enabled),
      categories: taxonomy?.categories ?? [],
      levels: hierarchy.levels,
      units,
    };
  });

  app.post('/api/v1/public/cases', { config: rateLimit }, async (req, reply) => {
    const parsed = submitBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });

    const result = await createCase({
      tenantId: req.tenant.id,
      channel: 'web',
      anonymous: parsed.data.anonymous,
      consent: parsed.data.consent,
      values: parsed.data.values,
    });
    if (!result.ok) return reply.code(result.code).send({ error: result.error, details: result.details });

    return reply.code(201).send({
      reference: result.reference,
      status: result.status,
      tracking_pin: result.trackingPin,
      possible_duplicates: result.possibleDuplicates,
    });
  });

  // Status tracking: reference + verifier. Generic error in all failure modes (enumeration-resistant, GEN-INT-09).
  app.post('/api/v1/public/cases/track', { config: rateLimit }, async (req, reply) => {
    const parsed = trackBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

    const notFound = () => reply.code(404).send({ error: 'case_not_found' });

    const [c] = await db
      .select()
      .from(schema.grmCase)
      .where(and(eq(schema.grmCase.tenantId, req.tenant.id), eq(schema.grmCase.reference, parsed.data.reference.trim())))
      .limit(1);
    if (!c) return notFound();

    const verifierHash = piiLookupHash(parsed.data.verifier);
    let verified = Boolean(verifierHash && c.verifierHash === verifierHash);
    if (!verified && c.partyId && verifierHash) {
      const [p] = await db.select().from(schema.party).where(eq(schema.party.id, c.partyId)).limit(1);
      verified = Boolean(p && (p.phoneHash === verifierHash || p.emailHash === verifierHash));
    }
    if (!verified) return notFound();

    // Public timeline: public-visibility events only, PII-minimized payloads.
    const events = await db
      .select({
        kind: schema.caseEvent.kind,
        data: schema.caseEvent.data,
        createdAt: schema.caseEvent.createdAt,
      })
      .from(schema.caseEvent)
      .where(and(eq(schema.caseEvent.caseId, c.id), eq(schema.caseEvent.visibility, 'public')))
      .orderBy(asc(schema.caseEvent.createdAt));

    return {
      reference: c.reference,
      status: c.status,
      status_tag: c.statusTag,
      level: c.levelCode,
      submitted_at: c.createdAt,
      timeline: events,
    };
  });
}
