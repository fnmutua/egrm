import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client.js';
import { writeAudit } from '../services/audit.js';
import { loadUserAccess } from '../services/access.js';
import {
  getAuthPolicy,
  isConsoleIpAllowed,
  isPasswordExpired,
  normaliseClientIp,
  userRequiresMfa,
} from '../services/auth-policy.js';
import { getUserModel } from '../services/user-model.js';
import { createRefreshSession, consumeRefreshSession } from '../services/refresh-sessions.js';

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshBody = z.object({
  refresh_token: z.string().min(1),
});

async function issueTokens(
  app: FastifyInstance,
  tenantId: string,
  user: typeof schema.appUser.$inferSelect,
) {
  const policy = await getAuthPolicy(tenantId);
  const access = await loadUserAccess(user.id, tenantId);
  const expiresIn = `${policy.sessions.access_token_minutes}m`;

  const token = app.jwt.sign(
    {
      sub: user.id,
      tenantId,
      email: user.email,
      name: user.displayName,
      permissions: access.permissions,
      tenantWide: access.tenantWide,
      jurisdictionRoots: access.jurisdictionRoots,
      sensitiveClasses: access.sensitiveClasses,
    },
    { expiresIn },
  );

  const refreshToken = await createRefreshSession(tenantId, user.id, policy);
  return { token, refreshToken, access, expiresInMinutes: policy.sessions.access_token_minutes };
}

export default async function authRoutes(app: FastifyInstance) {
  app.post('/api/v1/auth/login', async (req, reply) => {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const { email, password } = parsed.data;
    const policy = await getAuthPolicy(req.tenant.id);
    const clientIp = normaliseClientIp(req.ip);

    if (!isConsoleIpAllowed(policy, clientIp)) {
      await writeAudit({
        tenantId: req.tenant.id,
        action: 'auth.login_denied_ip',
        entity: 'user',
        data: { email, ip: clientIp },
      });
      return reply.code(403).send({ error: 'ip_not_allowed' });
    }

    if (!policy.local_login.enabled) {
      return reply.code(403).send({ error: 'local_login_disabled', message: 'Use SSO to sign in' });
    }

    const [user] = await db
      .select()
      .from(schema.appUser)
      .where(and(eq(schema.appUser.tenantId, req.tenant.id), eq(schema.appUser.email, email.toLowerCase())))
      .limit(1);

    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      await writeAudit({ tenantId: req.tenant.id, action: 'auth.login_locked', entity: 'user', data: { email } });
      return reply.code(423).send({ error: 'account_locked', locked_until: user.lockedUntil });
    }

    const ok = user && user.active && (await bcrypt.compare(password, user.passwordHash));
    if (!ok) {
      if (user?.active) {
        const failures = (user.failedLoginCount ?? 0) + 1;
        const lockoutAt = policy.local_login.lockout_after_failures;
        const patch: Partial<typeof schema.appUser.$inferInsert> = { failedLoginCount: failures };
        if (failures >= lockoutAt) {
          patch.lockedUntil = new Date(Date.now() + policy.local_login.lockout_minutes * 60 * 1000);
          patch.failedLoginCount = 0;
        }
        await db.update(schema.appUser).set(patch).where(eq(schema.appUser.id, user.id));
      }
      await writeAudit({ tenantId: req.tenant.id, action: 'auth.login_failed', entity: 'user', data: { email } });
      return reply.code(401).send({ error: 'invalid_credentials' });
    }

    const userModel = await getUserModel(req.tenant.id);
    if (user.registrationStatus === 'pending') {
      return reply.code(403).send({
        error: 'registration_pending',
        message: userModel.registration_approval.pending_message,
      });
    }
    if (user.registrationStatus === 'rejected') {
      return reply.code(403).send({
        error: 'registration_rejected',
        message: userModel.registration_approval.rejected_message,
      });
    }

    if (isPasswordExpired(policy, user.passwordChangedAt)) {
      return reply.code(403).send({ error: 'password_expired', message: 'Password must be changed' });
    }

    const mfaRequired = await userRequiresMfa(user.id, req.tenant.id);
    if (mfaRequired && !user.mfaEnrolled) {
      return reply.code(403).send({
        error: 'mfa_enrollment_required',
        message: 'Multi-factor authentication must be enrolled before login',
      });
    }

    await db
      .update(schema.appUser)
      .set({ failedLoginCount: 0, lockedUntil: null })
      .where(eq(schema.appUser.id, user.id));

    const issued = await issueTokens(app, req.tenant.id, user);
    await writeAudit({
      tenantId: req.tenant.id,
      actorId: user.id,
      action: 'auth.login',
      entity: 'user',
      entityId: user.id,
    });

    return {
      token: issued.token,
      refresh_token: issued.refreshToken,
      expires_in_minutes: issued.expiresInMinutes,
      user: {
        id: user.id,
        email: user.email,
        name: user.displayName,
        permissions: issued.access.permissions,
        tenant_wide: issued.access.tenantWide,
        jurisdiction_roots: issued.access.jurisdictionRoots,
        sensitive_classes: issued.access.sensitiveClasses,
        roles: issued.access.assignments.map((a) => ({
          role_name: a.roleName,
          unit_id: a.unitId,
        })),
      },
    };
  });

  app.post('/api/v1/auth/refresh', async (req, reply) => {
    const parsed = refreshBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }

    const policy = await getAuthPolicy(req.tenant.id);
    const consumed = await consumeRefreshSession(req.tenant.id, parsed.data.refresh_token, policy);
    if (!consumed) {
      return reply.code(401).send({ error: 'invalid_refresh_token' });
    }

    const [user] = await db
      .select()
      .from(schema.appUser)
      .where(and(eq(schema.appUser.id, consumed.userId), eq(schema.appUser.tenantId, req.tenant.id)))
      .limit(1);

    if (!user?.active) {
      return reply.code(401).send({ error: 'invalid_refresh_token' });
    }

    const issued = await issueTokens(app, req.tenant.id, user);
    return {
      token: issued.token,
      refresh_token: issued.refreshToken,
      expires_in_minutes: issued.expiresInMinutes,
    };
  });

  app.get('/api/v1/me', { onRequest: [app.authenticate] }, async (req) => {
    const access = await loadUserAccess(req.user.sub, req.tenant.id);
    return {
      user: {
        ...req.user,
        permissions: access.permissions,
        tenant_wide: access.tenantWide,
        jurisdiction_roots: access.jurisdictionRoots,
        sensitive_classes: access.sensitiveClasses,
        roles: access.assignments.map((a) => ({
          role_name: a.roleName,
          unit_id: a.unitId,
        })),
      },
      tenant: req.tenant,
    };
  });
}
