import { createHash, randomBytes } from 'node:crypto';
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import type { AuthPolicy } from './auth-policy.js';
import { db, schema } from '../db/client.js';

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function createRefreshSession(
  tenantId: string,
  userId: string,
  policy: AuthPolicy,
): Promise<string> {
  const token = generateRefreshToken();
  const tokenHash = hashRefreshToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + policy.sessions.refresh_token_days * 24 * 60 * 60 * 1000);

  const max = policy.sessions.max_concurrent_sessions;
  if (max > 0) {
    const active = await db
      .select({ id: schema.refreshSession.id })
      .from(schema.refreshSession)
      .where(
        and(
          eq(schema.refreshSession.userId, userId),
          eq(schema.refreshSession.tenantId, tenantId),
          isNull(schema.refreshSession.revokedAt),
          gt(schema.refreshSession.expiresAt, now),
        ),
      )
      .orderBy(asc(schema.refreshSession.createdAt));

    const excess = active.length - max + 1;
    if (excess > 0) {
      for (const row of active.slice(0, excess)) {
        await db
          .update(schema.refreshSession)
          .set({ revokedAt: now })
          .where(eq(schema.refreshSession.id, row.id));
      }
    }
  }

  await db.insert(schema.refreshSession).values({
    tenantId,
    userId,
    tokenHash,
    expiresAt,
    lastUsedAt: now,
  });

  return token;
}

export async function consumeRefreshSession(
  tenantId: string,
  refreshToken: string,
  policy: AuthPolicy,
): Promise<{ userId: string } | null> {
  const tokenHash = hashRefreshToken(refreshToken);
  const now = new Date();

  const [session] = await db
    .select()
    .from(schema.refreshSession)
    .where(
      and(
        eq(schema.refreshSession.tenantId, tenantId),
        eq(schema.refreshSession.tokenHash, tokenHash),
        isNull(schema.refreshSession.revokedAt),
        gt(schema.refreshSession.expiresAt, now),
      ),
    )
    .limit(1);

  if (!session) return null;

  const idleMs = policy.sessions.idle_timeout_minutes * 60 * 1000;
  if (now.getTime() - session.lastUsedAt.getTime() > idleMs) {
    await db
      .update(schema.refreshSession)
      .set({ revokedAt: now })
      .where(eq(schema.refreshSession.id, session.id));
    return null;
  }

  const absoluteMs = policy.sessions.absolute_timeout_hours * 60 * 60 * 1000;
  if (now.getTime() - session.createdAt.getTime() > absoluteMs) {
    await db
      .update(schema.refreshSession)
      .set({ revokedAt: now })
      .where(eq(schema.refreshSession.id, session.id));
    return null;
  }

  await db
    .update(schema.refreshSession)
    .set({ lastUsedAt: now })
    .where(eq(schema.refreshSession.id, session.id));

  return { userId: session.userId };
}

export async function revokeUserRefreshSessions(tenantId: string, userId: string): Promise<void> {
  await db
    .update(schema.refreshSession)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.refreshSession.tenantId, tenantId),
        eq(schema.refreshSession.userId, userId),
        isNull(schema.refreshSession.revokedAt),
      ),
    );
}
