import type { Cd10OrgAccess } from '@egrm/config-schemas';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { getActiveConfig } from './config.js';

export type AuthPolicy = Cd10OrgAccess['auth_policy'];

const DEFAULT_AUTH_POLICY: AuthPolicy = {
  local_login: {
    enabled: true,
    password_min_length: 12,
    password_require_uppercase: false,
    password_require_number: false,
    password_rotation_days: 0,
    lockout_after_failures: 5,
    lockout_minutes: 15,
  },
  sessions: {
    access_token_minutes: 60,
    refresh_token_days: 7,
    idle_timeout_minutes: 60,
    absolute_timeout_hours: 12,
    max_concurrent_sessions: 0,
  },
  sso: {
    enabled: false,
    protocol: 'oidc',
    allowed_email_domains: [],
    group_role_mappings: [],
    jit_provisioning: true,
    fallback_local_login: true,
    claim_mapping: { email: 'email', name: 'name', phone: 'phone_number' },
  },
  console_ip_allowlist: [],
};

function resolveAuthPolicy(raw: Cd10OrgAccess['auth_policy'] | Record<string, unknown> | undefined): AuthPolicy {
  if (!raw) return DEFAULT_AUTH_POLICY;

  if ('local_login' in raw && raw.local_login) {
    const cfg = raw as Cd10OrgAccess['auth_policy'];
    return {
      local_login: { ...DEFAULT_AUTH_POLICY.local_login, ...cfg.local_login },
      sessions: { ...DEFAULT_AUTH_POLICY.sessions, ...cfg.sessions },
      sso: {
        ...DEFAULT_AUTH_POLICY.sso,
        ...cfg.sso,
        claim_mapping: {
          ...DEFAULT_AUTH_POLICY.sso.claim_mapping,
          ...cfg.sso?.claim_mapping,
        },
      },
      console_ip_allowlist: cfg.console_ip_allowlist ?? [],
    };
  }

  const legacy = raw as { password_min_length?: number; session_idle_minutes?: number };
  return {
    ...DEFAULT_AUTH_POLICY,
    local_login: {
      ...DEFAULT_AUTH_POLICY.local_login,
      password_min_length: legacy.password_min_length ?? DEFAULT_AUTH_POLICY.local_login.password_min_length,
    },
    sessions: {
      ...DEFAULT_AUTH_POLICY.sessions,
      idle_timeout_minutes: legacy.session_idle_minutes ?? DEFAULT_AUTH_POLICY.sessions.idle_timeout_minutes,
    },
  };
}

/** Active CD-10 auth policy with platform defaults when config is missing. */
export async function getAuthPolicy(tenantId: string): Promise<AuthPolicy> {
  const cfg = await getActiveConfig<Cd10OrgAccess>(tenantId, 'cd10_org_access');
  return resolveAuthPolicy(cfg?.auth_policy as Cd10OrgAccess['auth_policy'] | undefined);
}

/** Returns a human-readable validation error, or null when valid. */
export function validatePassword(policy: AuthPolicy, password: string): string | null {
  const local = policy.local_login;
  if (password.length < local.password_min_length) {
    return `Password must be at least ${local.password_min_length} characters`;
  }
  if (local.password_require_uppercase && !/[A-Z]/.test(password)) {
    return 'Password must include an uppercase letter';
  }
  if (local.password_require_number && !/\d/.test(password)) {
    return 'Password must include a number';
  }
  return null;
}

export function isPasswordExpired(policy: AuthPolicy, passwordChangedAt: Date | null): boolean {
  const days = policy.local_login.password_rotation_days;
  if (!days || days <= 0 || !passwordChangedAt) return false;
  const ageMs = Date.now() - passwordChangedAt.getTime();
  return ageMs > days * 24 * 60 * 60 * 1000;
}

/** Normalise Fastify/client IPs for allowlist checks. */
export function normaliseClientIp(ip: string | undefined): string {
  if (!ip) return '';
  return ip.replace(/^::ffff:/, '');
}

export function isConsoleIpAllowed(policy: AuthPolicy, clientIp: string | undefined): boolean {
  const list = policy.console_ip_allowlist.filter((e) => e.trim().length > 0);
  if (list.length === 0) return true;
  const ip = normaliseClientIp(clientIp);
  if (!ip) return false;
  return list.some((entry) => {
    const trimmed = entry.trim();
    if (trimmed.endsWith('*')) return ip.startsWith(trimmed.slice(0, -1));
    return ip === trimmed;
  });
}

/** True when any active role assignment requires MFA (spec 07 §1). */
export async function userRequiresMfa(userId: string, tenantId: string): Promise<boolean> {
  const rows = await db
    .select({
      mfaRequired: schema.role.mfaRequired,
      validFrom: schema.userRole.validFrom,
      validTo: schema.userRole.validTo,
    })
    .from(schema.userRole)
    .innerJoin(schema.role, eq(schema.userRole.roleId, schema.role.id))
    .where(and(eq(schema.userRole.userId, userId), eq(schema.role.tenantId, tenantId)));

  const now = new Date();
  return rows.some((r) => {
    if (r.validFrom && r.validFrom > now) return false;
    if (r.validTo && r.validTo < now) return false;
    return r.mfaRequired;
  });
}
