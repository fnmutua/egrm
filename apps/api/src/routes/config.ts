import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { CONFIG_DOMAINS, canAccessConfigDomain, configDomainPermission, type ConfigDomain } from '@egrm/core';
import { validateConfig, type Cd10OrgAccess } from '@egrm/config-schemas';
import { db, schema } from '../db/client.js';
import { writeAudit } from '../services/audit.js';
import { invalidateConfigCache } from '../services/config.js';
import { syncRolesFromOrgAccess } from '../services/org-access.js';

function parseDomain(value: string): ConfigDomain | undefined {
  return (CONFIG_DOMAINS as readonly string[]).includes(value) ? (value as ConfigDomain) : undefined;
}

/**
 * Config registry v1 (GEN-CFG-01/02/03): versioned domains, validate-before-activate,
 * atomic activation, full history. Public read of the *active* identity config is allowed
 * (the portal needs branding before login); everything else requires domain permissions.
 */
export default async function configRoutes(app: FastifyInstance) {
  // Registry overview: one row per domain with active version + draft count (admin console grid).
  app.get('/api/v1/config', { onRequest: [app.requireAdminConsole] }, async (req) => {
    const rows = await db
      .select({
        domain: schema.configVersion.domain,
        status: schema.configVersion.status,
        version: schema.configVersion.version,
        createdAt: schema.configVersion.createdAt,
        activatedAt: schema.configVersion.activatedAt,
      })
      .from(schema.configVersion)
      .where(eq(schema.configVersion.tenantId, req.tenant.id));

    const domains = CONFIG_DOMAINS.filter((domain) =>
      canAccessConfigDomain(req.user.permissions, domain),
    ).map((domain) => {
      const mine = rows.filter((r) => r.domain === domain);
      const active = mine.find((r) => r.status === 'active');
      const drafts = mine.filter((r) => r.status === 'draft');
      const latest = mine.reduce<number>((m, r) => Math.max(m, r.version), 0);
      return {
        domain,
        active_version: active?.version ?? null,
        activated_at: active?.activatedAt ?? null,
        draft_count: drafts.length,
        latest_version: latest || null,
      };
    });
    return { domains };
  });

  // A specific version's full payload (history viewing / edit-from-version).
  app.get(
    '/api/v1/config/:domain/versions/:version',
    { onRequest: [app.requireConfigDomain] },
    async (req, reply) => {
      const params = req.params as { domain: string; version: string };
      const domain = parseDomain(params.domain);
      const version = Number(params.version);
      if (!domain || !Number.isInteger(version)) return reply.code(404).send({ error: 'unknown_domain_or_version' });
      const [row] = await db
        .select()
        .from(schema.configVersion)
        .where(
          and(
            eq(schema.configVersion.tenantId, req.tenant.id),
            eq(schema.configVersion.domain, domain),
            eq(schema.configVersion.version, version),
          ),
        )
        .limit(1);
      if (!row) return reply.code(404).send({ error: 'version_not_found' });
      return {
        domain,
        version: row.version,
        status: row.status,
        payload: row.payload,
        change_note: row.changeNote,
        created_at: row.createdAt,
        activated_at: row.activatedAt,
      };
    },
  );

  // Active version of a domain. cd01_identity + cd08_channels are publicly readable (portal landing).
  app.get('/api/v1/config/:domain', async (req, reply) => {
    const domain = parseDomain((req.params as { domain: string }).domain);
    if (!domain) return reply.code(404).send({ error: 'unknown_domain' });

    if (domain !== 'cd01_identity' && domain !== 'cd08_channels') {
      await app.authenticate(req, reply);
      if (reply.sent) return;
      if (!canAccessConfigDomain(req.user.permissions, domain)) {
        return reply.code(403).send({ error: 'forbidden', required: configDomainPermission(domain) });
      }
    }

    const [row] = await db
      .select()
      .from(schema.configVersion)
      .where(
        and(
          eq(schema.configVersion.tenantId, req.tenant.id),
          eq(schema.configVersion.domain, domain),
          eq(schema.configVersion.status, 'active'),
        ),
      )
      .limit(1);
    if (!row) return reply.code(404).send({ error: 'no_active_version' });
    return { domain, version: row.version, payload: row.payload, activated_at: row.activatedAt };
  });

  // Version history.
  app.get(
    '/api/v1/config/:domain/versions',
    { onRequest: [app.requireConfigDomain] },
    async (req, reply) => {
      const domain = parseDomain((req.params as { domain: string }).domain);
      if (!domain) return reply.code(404).send({ error: 'unknown_domain' });
      const rows = await db
        .select({
          version: schema.configVersion.version,
          status: schema.configVersion.status,
          changeNote: schema.configVersion.changeNote,
          changedBy: schema.configVersion.changedBy,
          createdAt: schema.configVersion.createdAt,
          activatedAt: schema.configVersion.activatedAt,
        })
        .from(schema.configVersion)
        .where(and(eq(schema.configVersion.tenantId, req.tenant.id), eq(schema.configVersion.domain, domain)))
        .orderBy(desc(schema.configVersion.version));
      return { domain, versions: rows };
    },
  );

  // Create a draft version (validated against the domain schema before it is even stored).
  app.post(
    '/api/v1/config/:domain',
    { onRequest: [app.requireConfigDomain] },
    async (req, reply) => {
      const domain = parseDomain((req.params as { domain: string }).domain);
      if (!domain) return reply.code(404).send({ error: 'unknown_domain' });

      const body = req.body as { payload: unknown; change_note?: string };
      const result = validateConfig(domain, body?.payload);
      if (!result.success) {
        return reply.code(422).send({ error: 'invalid_config', issues: result.error.issues });
      }

      const [latest] = await db
        .select({ version: schema.configVersion.version })
        .from(schema.configVersion)
        .where(and(eq(schema.configVersion.tenantId, req.tenant.id), eq(schema.configVersion.domain, domain)))
        .orderBy(desc(schema.configVersion.version))
        .limit(1);
      const nextVersion = (latest?.version ?? 0) + 1;

      const [created] = await db
        .insert(schema.configVersion)
        .values({
          tenantId: req.tenant.id,
          domain,
          version: nextVersion,
          status: 'draft',
          payload: result.data,
          changeNote: body.change_note,
          changedBy: req.user.sub,
        })
        .returning();

      await writeAudit({
        tenantId: req.tenant.id,
        actorId: req.user.sub,
        action: 'config.draft_created',
        entity: 'config_version',
        entityId: created!.id,
        data: { domain, version: nextVersion, note: body.change_note },
      });
      return reply.code(201).send({ domain, version: nextVersion, status: 'draft' });
    },
  );

  // Activate a draft atomically: re-validate, retire the current active version in the same tx.
  app.post(
    '/api/v1/config/:domain/:version/activate',
    { onRequest: [app.requireConfigDomain] },
    async (req, reply) => {
      const params = req.params as { domain: string; version: string };
      const domain = parseDomain(params.domain);
      const version = Number(params.version);
      if (!domain || !Number.isInteger(version)) return reply.code(404).send({ error: 'unknown_domain_or_version' });

      const outcome = await db.transaction(async (tx) => {
        const [draft] = await tx
          .select()
          .from(schema.configVersion)
          .where(
            and(
              eq(schema.configVersion.tenantId, req.tenant.id),
              eq(schema.configVersion.domain, domain),
              eq(schema.configVersion.version, version),
            ),
          )
          .limit(1);
        if (!draft) return { code: 404 as const, body: { error: 'version_not_found' } };
        if (draft.status === 'active') return { code: 409 as const, body: { error: 'already_active' } };

        const revalidated = validateConfig(domain, draft.payload);
        if (!revalidated.success) {
          return { code: 422 as const, body: { error: 'invalid_config', issues: revalidated.error.issues } };
        }

        await tx
          .update(schema.configVersion)
          .set({ status: 'retired' })
          .where(
            and(
              eq(schema.configVersion.tenantId, req.tenant.id),
              eq(schema.configVersion.domain, domain),
              eq(schema.configVersion.status, 'active'),
            ),
          );
        await tx
          .update(schema.configVersion)
          .set({ status: 'active', activatedAt: new Date() })
          .where(eq(schema.configVersion.id, draft.id));

        if (domain === 'cd10_org_access') {
          await syncRolesFromOrgAccess(req.tenant.id, revalidated.data as Cd10OrgAccess);
        }

        return { code: 200 as const, body: { domain, version, status: 'active' } };
      });

      if (outcome.code === 200) {
        invalidateConfigCache(req.tenant.id, domain);
        await writeAudit({
          tenantId: req.tenant.id,
          actorId: req.user.sub,
          action: 'config.activated',
          entity: 'config_version',
          data: { domain, version },
        });
      }
      return reply.code(outcome.code).send(outcome.body);
    },
  );
}
