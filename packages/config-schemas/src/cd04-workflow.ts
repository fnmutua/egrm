import { z } from 'zod';
import { SEMANTIC_TAGS } from '@egrm/core';

/** CD-04 Workflow definition (spec 02 §4, spec 04). */
const statusDef = z.object({
  name: z.string().min(1),
  tag: z.enum(SEMANTIC_TAGS),
  label: z.record(z.string(), z.string()).optional(),
});

const transitionEffect = z.union([
  z.object({ move_level: z.enum(['up', 'down']) }),
  z.object({ restart_sla: z.enum(['stage', 'all']) }),
  z.object({ set_assignee: z.enum(['none', 'actor', 'role_default']) }),
]);

const transitionDef = z.object({
  from: z.array(z.string()).min(1),
  to: z.string(),
  roles: z.array(z.string()).min(1),
  levels: z.array(z.string()).optional(),
  requires: z
    .object({
      fields: z.array(z.string()).optional(),
      attachments: z.array(z.string()).optional(),
      note: z.boolean().optional(),
    })
    .optional(),
  effects: z.array(transitionEffect).optional(),
  guard: z.string().optional(),
});

export const cd04Workflow = z.object({
  case_type: z.string().min(1),
  statuses: z.array(statusDef).min(2),
  initial: z.object({
    default: z.string(),
    rules: z
      .array(
        z.object({
          if: z.record(z.string(), z.unknown()),
          then: z.union([z.string(), z.object({ status: z.string(), level: z.string().optional() })]),
        }),
      )
      .optional(),
  }),
  transitions: z.array(transitionDef).min(1),
  closure: z
    .object({
      confirmation: z
        .object({
          required_when: z.record(z.string(), z.unknown()),
          authority_level: z.string(),
        })
        .optional(),
      satisfaction: z.object({ enabled: z.boolean(), channels: z.array(z.string()).optional() }).optional(),
    })
    .optional(),
  appeal: z
    .object({
      enabled: z.boolean(),
      window_days: z.number().int().positive().optional(),
      routes_to: z.string().optional(),
      max_rounds: z.number().int().positive().optional(),
    })
    .optional(),
}).superRefine((wf, ctx) => {
  const names = new Set(wf.statuses.map((s) => s.name));
  if (!names.has(wf.initial.default)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['initial', 'default'],
      message: `Initial status '${wf.initial.default}' is not in the status set`,
    });
  }
  wf.transitions.forEach((t, i) => {
    for (const f of t.from) {
      if (!names.has(f)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['transitions', i, 'from'], message: `Unknown status '${f}'` });
      }
    }
    if (!names.has(t.to)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['transitions', i, 'to'], message: `Unknown status '${t.to}'` });
    }
  });
  // Reachability: every status must reach a closed/rejected-tagged status (spec 02 §3).
  const terminal = new Set(wf.statuses.filter((s) => s.tag === 'closed' || s.tag === 'rejected').map((s) => s.name));
  if (terminal.size === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['statuses'], message: 'Workflow needs at least one closed- or rejected-tagged status' });
    return;
  }
  const edges = new Map<string, string[]>();
  for (const t of wf.transitions) {
    for (const f of t.from) edges.set(f, [...(edges.get(f) ?? []), t.to]);
  }
  const reachesTerminal = (start: string): boolean => {
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop()!;
      if (terminal.has(cur)) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      stack.push(...(edges.get(cur) ?? []));
    }
    return false;
  };
  if (!reachesTerminal(wf.initial.default)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['transitions'],
      message: `No path from initial status '${wf.initial.default}' to any closed/rejected status`,
    });
  }
});

export type Cd04Workflow = z.infer<typeof cd04Workflow>;
