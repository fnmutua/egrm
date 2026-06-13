import type { FastifyInstance } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import multipart from '@fastify/multipart';
import type { Cd01Identity, Cd02Hierarchy, Cd03Taxonomy, Cd06IntakeForms } from '../types.js';
import type { Cd09Notifications } from '@egrm/config-schemas';
import { configuredPartyNotificationChannels, kindsForChannel } from '@egrm/config-schemas';
import type { Cd10OrgAccess } from '@egrm/config-schemas';
import { db, schema } from '../db/client.js';
import { getActiveConfig } from '../services/config.js';
import { createCase } from '../services/intake.js';
import { piiLookupHash } from '../services/crypto.js';
import { getAuthPolicy, validatePassword } from '../services/auth-policy.js';
import {
  buildStaffProfile,
  getUserModel,
  sanitizeProfile,
  selfRegistrationEnabled,
  selfRegistrationFieldSchema,
  validateProfile,
  validateProvisioningIdentity,
  validateStaffEmail,
} from '../services/user-model.js';
import { writeAudit } from '../services/audit.js';
import {
  createComplainantReply,
  listPublicThread,
  loadCorrespondenceConfig,
  verifyCaseByReference,
} from '../services/correspondence.js';

const submitBody = z.object({
  anonymous: z.boolean().default(false),
  consent: z.boolean().default(false),
  values: z.record(z.string(), z.unknown()),
});

const replyBody = z.object({
  reference: z.string().min(3).max(64),
  verifier: z.string().min(3).max(128),
  body: z.string().min(1),
});

const trackBody = z.object({
  reference: z.string().min(3).max(64),
  verifier: z.string().min(3).max(128),
});

const registerBody = z.object({
  email: z.string().email(),
  display_name: z.string().min(1).max(120),
  phone: z.string().min(1).max(32),
  password: z.string().min(8),
  profile: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

async function departmentCodes(tenantId: string): Promise<string[]> {
  const cfg = await getActiveConfig<Cd10OrgAccess>(tenantId, 'cd10_org_access');
  return (cfg?.departments ?? []).map((d) => d.code);
}

/** Public (unauthenticated) surface: intake metadata, submission, tracking. Rate-limited. */
export default async function publicRoutes(app: FastifyInstance) {
  const rateLimit = { rateLimit: { max: 30, timeWindow: '1 minute' } };
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 10 } });

  // Everything the portal needs to render the configured intake form.
  app.get('/api/v1/public/intake-meta', { config: rateLimit }, async (req, reply) => {
    const [identity, form, hierarchy, taxonomy, notifications, correspondence] = await Promise.all([
      getActiveConfig<Cd01Identity>(req.tenant.id, 'cd01_identity'),
      getActiveConfig<Cd06IntakeForms>(req.tenant.id, 'cd06_intake_forms'),
      getActiveConfig<Cd02Hierarchy>(req.tenant.id, 'cd02_hierarchy'),
      getActiveConfig<Cd03Taxonomy>(req.tenant.id, 'cd03_taxonomy'),
      getActiveConfig<Cd09Notifications>(req.tenant.id, 'cd09_notifications'),
      loadCorrespondenceConfig(req.tenant.id),
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
      categories: (taxonomy?.categories ?? []).filter((c) => c.active !== false),
      levels: hierarchy.levels,
      units,
      notification_channels: notifications ? configuredPartyNotificationChannels(notifications) : [],
      attachments: {
        enabled: form.attachment_policy.intake_enabled,
        max_files: form.attachment_policy.intake_max_files,
        kinds: kindsForChannel(form, 'intake').map((k) => ({
          code: k.code,
          label: k.label,
        })),
      },
      correspondence: {
        enabled: correspondence.correspondence_policy.enabled && correspondence.correspondence_policy.portal.enabled,
        allow_reply: correspondence.correspondence_policy.portal.allow_reply,
        max_body_length: correspondence.correspondence_policy.portal.max_body_length,
        reply_attachments_enabled: correspondence.correspondence_policy.attachments.complainant_reply_enabled,
        max_reply_files: correspondence.correspondence_policy.attachments.max_files_per_message,
        reply_kinds: kindsForChannel(form, 'intake')
          .filter((k) => {
            const codes = correspondence.correspondence_policy.attachments.reply_kind_codes;
            return !codes?.length || codes.includes(k.code);
          })
          .map((k) => ({ code: k.code, label: k.label })),
      },
    };
  });

  app.post('/api/v1/public/cases', { config: rateLimit }, async (req, reply) => {
    let anonymous = false;
    let consent = false;
    let values: Record<string, unknown> = {};
    const files: { kind: string; filename: string; mime: string; data: Buffer }[] = [];
    const kindsQueue: string[] = [];

    if (req.isMultipart()) {
      const parts = req.parts();
      for await (const part of parts) {
        if (part.type === 'file') {
          const data = await part.toBuffer();
          files.push({
            kind: 'evidence',
            filename: part.filename || 'upload',
            mime: part.mimetype || 'application/octet-stream',
            data,
          });
        } else if (part.fieldname === 'payload') {
          const raw = String(part.value);
          try {
            const parsed = submitBody.safeParse(JSON.parse(raw));
            if (!parsed.success) {
              return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
            }
            anonymous = parsed.data.anonymous;
            consent = parsed.data.consent;
            values = parsed.data.values;
          } catch {
            return reply.code(400).send({ error: 'invalid_body', message: 'Invalid payload JSON' });
          }
        } else if (part.fieldname === 'kinds') {
          kindsQueue.push(String(part.value));
        }
      }

      for (let i = 0; i < files.length; i++) {
        if (kindsQueue[i]) files[i]!.kind = kindsQueue[i]!;
      }
    } else {
      const parsed = submitBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
      anonymous = parsed.data.anonymous;
      consent = parsed.data.consent;
      values = parsed.data.values;
    }

    const result = await createCase({
      tenantId: req.tenant.id,
      channel: 'web',
      anonymous,
      consent,
      values,
      attachments: files.length ? files : undefined,
    });
    if (!result.ok) {
      return reply.code(result.code).send({ error: result.error, message: result.message, details: result.details });
    }

    return reply.code(201).send({
      reference: result.reference,
      status: result.status,
      tracking_pin: result.trackingPin,
      possible_duplicates: result.possibleDuplicates,
    });
  });

  app.post('/api/v1/public/cases/track', { config: rateLimit }, async (req, reply) => {
    const parsed = trackBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

    const verified = await verifyCaseByReference(req.tenant.id, parsed.data.reference, parsed.data.verifier);
    if (!verified) return reply.code(404).send({ error: 'case_not_found' });

    const c = verified.case;
    const correspondence = await loadCorrespondenceConfig(req.tenant.id);
    const policy = correspondence.correspondence_policy;

    const events = await db
      .select({
        kind: schema.caseEvent.kind,
        data: schema.caseEvent.data,
        createdAt: schema.caseEvent.createdAt,
      })
      .from(schema.caseEvent)
      .where(and(eq(schema.caseEvent.caseId, c.id), eq(schema.caseEvent.visibility, 'public')))
      .orderBy(asc(schema.caseEvent.createdAt));

    const messages =
      policy.enabled && policy.portal.show_messages_on_track
        ? await listPublicThread(req.tenant.id, c.id, c.sensitivity)
        : [];

    const replyAllowed =
      policy.enabled
      && policy.portal.enabled
      && policy.portal.allow_reply
      && c.statusTag !== 'closed'
      && c.statusTag !== 'rejected';

    return {
      reference: c.reference,
      status: c.status,
      status_tag: c.statusTag,
      level: c.levelCode,
      submitted_at: c.createdAt,
      timeline: events,
      messages,
      reply_allowed: replyAllowed,
    };
  });

  app.post('/api/v1/public/cases/:ref/reply', { config: rateLimit }, async (req, reply) => {
    const { ref } = req.params as { ref: string };
    let reference = ref;
    let verifier = '';
    let body = '';
    const files: { kind: string; filename: string; mime: string; data: Buffer }[] = [];
    const kindsQueue: string[] = [];

    if (req.isMultipart()) {
      const parts = req.parts();
      for await (const part of parts) {
        if (part.type === 'file') {
          const data = await part.toBuffer();
          files.push({
            kind: 'evidence',
            filename: part.filename || 'upload',
            mime: part.mimetype || 'application/octet-stream',
            data,
          });
        } else if (part.fieldname === 'payload') {
          try {
            const parsed = replyBody.safeParse(JSON.parse(String(part.value)));
            if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
            reference = parsed.data.reference;
            verifier = parsed.data.verifier;
            body = parsed.data.body;
          } catch {
            return reply.code(400).send({ error: 'invalid_body' });
          }
        } else if (part.fieldname === 'kinds') {
          kindsQueue.push(String(part.value));
        }
      }
      for (let i = 0; i < files.length; i++) {
        if (kindsQueue[i]) files[i]!.kind = kindsQueue[i]!;
      }
    } else {
      const parsed = replyBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
      reference = parsed.data.reference;
      verifier = parsed.data.verifier;
      body = parsed.data.body;
    }

    const verified = await verifyCaseByReference(req.tenant.id, reference, verifier);
    if (!verified) return reply.code(404).send({ error: 'case_not_found' });

    const result = await createComplainantReply({
      tenantId: req.tenant.id,
      caseId: verified.case.id,
      partyId: verified.case.partyId,
      body,
      attachments: files.length ? files : undefined,
    });
    if ('error' in result) return reply.code(result.code).send({ error: result.error, message: result.message });

    return reply.code(201).send({ ok: true, id: result.id });
  });

  app.get('/api/v1/public/staff-register-meta', { config: rateLimit }, async (req) => {
    const model = await getUserModel(req.tenant.id);
    if (!selfRegistrationEnabled(model)) {
      return { enabled: false };
    }
    return {
      enabled: true,
      approval_required: model.registration_approval.required,
      pending_message: model.registration_approval.pending_message,
      fields: selfRegistrationFieldSchema(model),
    };
  });

  app.post('/api/v1/public/staff-register', { config: rateLimit }, async (req, reply) => {
    const parsed = registerBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }

    const model = await getUserModel(req.tenant.id);
    if (!selfRegistrationEnabled(model)) {
      return reply.code(403).send({ error: 'self_registration_disabled' });
    }

    const policy = await getAuthPolicy(req.tenant.id);
    if (!policy.local_login.enabled) {
      return reply.code(403).send({ error: 'local_login_disabled' });
    }

    const pwError = validatePassword(policy, parsed.data.password);
    if (pwError) return reply.code(400).send({ error: 'weak_password', message: pwError });

    const email = parsed.data.email.toLowerCase();
    const identityError = validateProvisioningIdentity({
      email,
      display_name: parsed.data.display_name,
      phone: parsed.data.phone,
    });
    if (identityError) {
      return reply.code(400).send({ error: 'invalid_identity', message: identityError });
    }

    const domainError = validateStaffEmail(model, email);
    if (domainError) return reply.code(400).send({ error: 'email_domain_not_allowed', message: domainError });

    const mergedProfile = buildStaffProfile(model, {
      phone: parsed.data.phone,
      profile: parsed.data.profile,
    });
    const deptCodes = await departmentCodes(req.tenant.id);
    const profileError = validateProfile(model, mergedProfile, deptCodes);
    if (profileError) return reply.code(400).send({ error: 'invalid_profile', message: profileError });

    const [existing] = await db
      .select({ id: schema.appUser.id })
      .from(schema.appUser)
      .where(and(eq(schema.appUser.tenantId, req.tenant.id), eq(schema.appUser.email, email)))
      .limit(1);
    if (existing) return reply.code(409).send({ error: 'email_taken' });

    const needsApproval = model.registration_approval.required;
    const [user] = await db
      .insert(schema.appUser)
      .values({
        tenantId: req.tenant.id,
        email,
        displayName: parsed.data.display_name,
        passwordHash: await bcrypt.hash(parsed.data.password, 10),
        active: !needsApproval,
        registrationStatus: needsApproval ? 'pending' : 'approved',
        passwordChangedAt: new Date(),
        profile: sanitizeProfile(model, mergedProfile),
      })
      .returning();

    await writeAudit({
      tenantId: req.tenant.id,
      action: 'user.self_registered',
      entity: 'app_user',
      entityId: user!.id,
      data: { email, pending: needsApproval },
    });

    return reply.code(201).send({
      status: needsApproval ? 'pending' : 'approved',
      message: needsApproval ? model.registration_approval.pending_message : 'Registration complete. You may sign in.',
      user_id: user!.id,
    });
  });
}
