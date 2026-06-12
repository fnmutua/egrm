import { isValidPermissionPattern } from '@egrm/core';
import { z } from 'zod';

/**
 * CD-10 Org structure, roles & access (spec 02).
 * Role definitions are synced to the `role` table when this config is activated.
 */
const roleDef = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/, 'Use snake_case, e.g. grm_officer'),
  label: z.string().min(1),
  description: z.string().optional(),
  permissions: z.array(z.string().min(1)).min(1),
  /** Sensitivity classes this role may read/handle (codes from CD-03). */
  sensitive_classes: z.array(z.string()).default([]),
  mfa_required: z.boolean().default(false),
});

const department = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
});

const authPolicy = z.object({
  password_min_length: z.number().int().min(8).default(12),
  session_idle_minutes: z.number().int().min(5).default(60),
  mfa_required_roles: z.array(z.string()).default([]),
});

export const cd10OrgAccess = z
  .object({
    roles: z.array(roleDef).min(1),
    departments: z.array(department).default([]),
    auth_policy: authPolicy.default({}),
  })
  .superRefine((cfg, ctx) => {
    const names = cfg.roles.map((r) => r.name);
    if (new Set(names).size !== names.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['roles'], message: 'Role names must be unique' });
    }
    cfg.roles.forEach((role, i) => {
      role.permissions.forEach((perm, j) => {
        if (!isValidPermissionPattern(perm)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['roles', i, 'permissions', j],
            message: `Unknown permission pattern "${perm}"`,
          });
        }
      });
    });
    const roleSet = new Set(names);
    cfg.auth_policy.mfa_required_roles.forEach((name, i) => {
      if (!roleSet.has(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['auth_policy', 'mfa_required_roles', i],
          message: `Role "${name}" is not defined in roles[]`,
        });
      }
    });
  });

export type Cd10OrgAccess = z.infer<typeof cd10OrgAccess>;
