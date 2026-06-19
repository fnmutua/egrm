/**
 * Enable portal chatbot for the kisip dev tenant (CD-16 only).
 * Run: pnpm --filter @egrm/api db:enable-chatbot
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Cd16Ai } from '@egrm/config-schemas';
import { DEFAULT_CD16_AI, validateConfig } from '@egrm/config-schemas';
import type { ConfigDomain } from '@egrm/core';
import { db, pool, schema } from './client.js';
import { invalidateConfigCache } from '../services/config.js';

async function activateMergedConfig(
  tenantId: string,
  domain: ConfigDomain,
  merge: (current: Record<string, unknown>) => Record<string, unknown>,
  changedBy: string,
  note: string,
): Promise<boolean> {
  const [active] = await db
    .select({
      id: schema.configVersion.id,
      version: schema.configVersion.version,
      payload: schema.configVersion.payload,
    })
    .from(schema.configVersion)
    .where(
      and(
        eq(schema.configVersion.tenantId, tenantId),
        eq(schema.configVersion.domain, domain),
        eq(schema.configVersion.status, 'active'),
      ),
    )
    .limit(1);

  if (!active) {
    console.warn(`  ${domain}: no active config — run db:seed first`);
    return false;
  }

  const merged = merge(active.payload as Record<string, unknown>);
  const parsed = validateConfig(domain, merged);
  if (!parsed.success) {
    throw new Error(`${domain} invalid: ${JSON.stringify(parsed.error.issues)}`);
  }

  const [maxRow] = await db
    .select({ max: sql<number>`coalesce(max(${schema.configVersion.version}), 0)::int` })
    .from(schema.configVersion)
    .where(and(eq(schema.configVersion.tenantId, tenantId), eq(schema.configVersion.domain, domain)));

  const nextVersion = (maxRow?.max ?? 0) + 1;

  await db.transaction(async (tx) => {
    await tx.update(schema.configVersion).set({ status: 'retired' }).where(eq(schema.configVersion.id, active.id));
    await tx.insert(schema.configVersion).values({
      tenantId,
      domain,
      version: nextVersion,
      status: 'active',
      payload: parsed.data,
      changeNote: note,
      changedBy,
      activatedAt: new Date(),
    });
  });

  invalidateConfigCache(tenantId, domain);
  console.log(`  ${domain}: activated v${nextVersion}`);
  return true;
}

async function main() {
  const [tenant] = await db.select().from(schema.tenant).where(eq(schema.tenant.code, 'kisip')).limit(1);
  if (!tenant) {
    console.error('Tenant "kisip" not found. Run pnpm db:seed first.');
    process.exitCode = 1;
    return;
  }

  const [admin] = await db
    .select({ id: schema.appUser.id })
    .from(schema.appUser)
    .where(eq(schema.appUser.tenantId, tenant.id))
    .limit(1);

  const changedBy = admin?.id ?? tenant.id;

  console.log('Enabling chatbot for tenant kisip…');

  await activateMergedConfig(
    tenant.id,
    'cd16_ai',
    (current) => {
      const c = current as Cd16Ai;
      return {
        ...c,
        enabled: true,
        chatbot: {
          ...DEFAULT_CD16_AI.chatbot,
          ...c.chatbot,
          enabled: true,
          mode: 'conversational',
          profile: c.chatbot?.profile ?? DEFAULT_CD16_AI.chatbot?.profile ?? 'openai_primary',
        },
      };
    },
    changedBy,
    'enable-chatbot: CD-16 staff AI + portal chatbot',
  );

  console.log('Done. Refresh the portal — the Chat button should appear bottom-right.');
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
