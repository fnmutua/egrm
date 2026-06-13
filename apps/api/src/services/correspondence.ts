import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Cd01Identity, Cd17Correspondence } from '@egrm/config-schemas';
import {
  DEFAULT_CORRESPONDENCE_POLICY,
  THREAD_LOGGED_CONTACT_CHANNELS,
  THREAD_OUTBOUND_CHANNELS,
} from '@egrm/config-schemas';
import { hasPermission } from '@egrm/core';
import { db, schema } from '../db/client.js';
import { getActiveConfig } from './config.js';
import type { UserAccess } from './access.js';
import { canAccessCase } from './access.js';
import { piiLookupHash } from './crypto.js';
import {
  kindLabel,
  linkPromotedAttachments,
  loadAttachmentConfig,
  promoteAttachments,
  validateAttachmentFile,
  type IntakeAttachmentInput,
} from './attachments.js';
import { kindsForChannel } from '@egrm/config-schemas';
import { enqueueNotifications } from './notifications.js';
import { scheduleOutboxDispatch } from './notification-queue.js';

export interface ThreadEntryRow {
  id: string;
  direction: string;
  message_kind: string;
  channel: string;
  body: string;
  body_display: string;
  visibility: string;
  author_name: string | null;
  in_reply_to_id: string | null;
  attachments: { id: string; filename: string; kind: string; kind_label: string }[];
  created_at: string;
}

export async function loadCorrespondenceConfig(tenantId: string): Promise<Cd17Correspondence> {
  const cfg = await getActiveConfig<Cd17Correspondence>(tenantId, 'cd17_correspondence');
  return {
    correspondence_policy: {
      ...DEFAULT_CORRESPONDENCE_POLICY,
      ...(cfg?.correspondence_policy ?? {}),
      portal: { ...DEFAULT_CORRESPONDENCE_POLICY.portal, ...(cfg?.correspondence_policy?.portal ?? {}) },
      staff: { ...DEFAULT_CORRESPONDENCE_POLICY.staff, ...(cfg?.correspondence_policy?.staff ?? {}) },
      attachments: { ...DEFAULT_CORRESPONDENCE_POLICY.attachments, ...(cfg?.correspondence_policy?.attachments ?? {}) },
      sensitive: { ...DEFAULT_CORRESPONDENCE_POLICY.sensitive, ...(cfg?.correspondence_policy?.sensitive ?? {}) },
      workflow: { ...DEFAULT_CORRESPONDENCE_POLICY.workflow, ...(cfg?.correspondence_policy?.workflow ?? {}) },
      notify: { ...DEFAULT_CORRESPONDENCE_POLICY.notify, ...(cfg?.correspondence_policy?.notify ?? {}) },
    },
  };
}

async function attachmentsForEntries(
  tenantId: string,
  caseId: string,
  entryIds: string[],
): Promise<Map<string, ThreadEntryRow['attachments']>> {
  const map = new Map<string, ThreadEntryRow['attachments']>();
  if (!entryIds.length) return map;
  const cfg = await import('./attachments.js').then((m) => m.loadAttachmentConfig(tenantId));
  const rows = await db
    .select({
      id: schema.caseAttachment.id,
      threadEntryId: schema.caseAttachment.threadEntryId,
      filename: schema.caseAttachment.filename,
      kind: schema.caseAttachment.kind,
    })
    .from(schema.caseAttachment)
    .where(
      and(
        eq(schema.caseAttachment.tenantId, tenantId),
        eq(schema.caseAttachment.caseId, caseId),
        inArray(schema.caseAttachment.threadEntryId, entryIds),
        eq(schema.caseAttachment.status, 'active'),
      ),
    );
  for (const r of rows) {
    if (!r.threadEntryId) continue;
    const list = map.get(r.threadEntryId) ?? [];
    list.push({
      id: r.id,
      filename: r.filename,
      kind: r.kind,
      kind_label: kindLabel(cfg, r.kind),
    });
    map.set(r.threadEntryId, list);
  }
  return map;
}

function partyDisplayBody(
  entry: { body: string; bodyRedacted: string | null; direction: string; visibility: string },
  sensitivity: string,
  policy: Cd17Correspondence['correspondence_policy'],
  locale: string,
): string {
  if (
    entry.direction === 'outbound'
    && entry.visibility === 'public'
    && sensitivity !== 'standard'
    && policy.sensitive.redact_outbound_for_party
  ) {
    return (
      entry.bodyRedacted
      ?? policy.sensitive.redacted_template[locale]
      ?? policy.sensitive.redacted_template.en
      ?? entry.body
    );
  }
  return entry.body;
}

export async function listCaseThread(
  tenantId: string,
  caseId: string,
  access: UserAccess,
  actorId: string,
): Promise<ThreadEntryRow[] | { error: string; code: number }> {
  const [caseRow] = await db
    .select({
      unitId: schema.grmCase.unitId,
      assigneeId: schema.grmCase.assigneeId,
      sensitivity: schema.grmCase.sensitivity,
    })
    .from(schema.grmCase)
    .where(and(eq(schema.grmCase.tenantId, tenantId), eq(schema.grmCase.id, caseId)))
    .limit(1);
  if (!caseRow) return { error: 'not_found', code: 404 };

  const allowed = await canAccessCase(tenantId, access, actorId, caseRow);
  if (!allowed) return { error: 'not_found', code: 404 };

  const canInternal = hasPermission(access.permissions, 'thread:note_internal');
  const rows = await db
    .select({
      id: schema.threadEntry.id,
      direction: schema.threadEntry.direction,
      messageKind: schema.threadEntry.messageKind,
      channel: schema.threadEntry.channel,
      body: schema.threadEntry.body,
      bodyRedacted: schema.threadEntry.bodyRedacted,
      visibility: schema.threadEntry.visibility,
      authorUserId: schema.threadEntry.authorUserId,
      inReplyToId: schema.threadEntry.inReplyToId,
      createdAt: schema.threadEntry.createdAt,
      authorName: schema.appUser.displayName,
    })
    .from(schema.threadEntry)
    .leftJoin(schema.appUser, eq(schema.threadEntry.authorUserId, schema.appUser.id))
    .where(and(eq(schema.threadEntry.tenantId, tenantId), eq(schema.threadEntry.caseId, caseId)))
    .orderBy(schema.threadEntry.createdAt);

  const filtered = rows.filter((r) => r.direction !== 'internal_note' || canInternal);
  const attMap = await attachmentsForEntries(
    tenantId,
    caseId,
    filtered.map((r) => r.id),
  );

  const policy = (await loadCorrespondenceConfig(tenantId)).correspondence_policy;
  const identity = await getActiveConfig<Cd01Identity>(tenantId, 'cd01_identity');
  const locale = identity?.locales?.default ?? 'en';

  return filtered.map((r) => ({
    id: r.id,
    direction: r.direction,
    message_kind: r.messageKind,
    channel: r.channel,
    body: r.body,
    body_display: partyDisplayBody(
      { body: r.body, bodyRedacted: r.bodyRedacted, direction: r.direction, visibility: r.visibility },
      caseRow.sensitivity,
      policy,
      locale,
    ),
    visibility: r.visibility,
    author_name: r.direction === 'inbound' ? 'Complainant' : r.authorName,
    in_reply_to_id: r.inReplyToId,
    attachments: attMap.get(r.id) ?? [],
    created_at: r.createdAt.toISOString(),
  }));
}

export async function createStaffThreadMessage(input: {
  tenantId: string;
  caseId: string;
  actorId: string;
  access: UserAccess;
  body: string;
  internal?: boolean;
  messageKind?: string;
  channel?: string;
  visibility?: 'public' | 'staff';
  attachmentIds?: string[];
  inReplyToId?: string;
}): Promise<{ id: string } | { error: string; code: number; message?: string }> {
  const cfg = await loadCorrespondenceConfig(input.tenantId);
  const policy = cfg.correspondence_policy;
  if (!policy.enabled) return { error: 'correspondence_disabled', code: 422 };

  const internal = input.internal === true;
  if (internal) {
    if (!hasPermission(input.access.permissions, 'thread:note_internal')) {
      return { error: 'forbidden', code: 403 };
    }
  } else if (!hasPermission(input.access.permissions, 'thread:reply_external')) {
    return { error: 'forbidden', code: 403 };
  }

  const body = input.body.trim();
  if (!body) return { error: 'thread_body_required', code: 422 };
  if (body.length > policy.staff.max_body_length) {
    return { error: 'thread_body_too_long', code: 422, message: 'Message exceeds maximum length' };
  }

  const [caseRow] = await db
    .select()
    .from(schema.grmCase)
    .where(and(eq(schema.grmCase.tenantId, input.tenantId), eq(schema.grmCase.id, input.caseId)))
    .limit(1);
  if (!caseRow) return { error: 'not_found', code: 404 };

  const allowed = await canAccessCase(input.tenantId, input.access, input.actorId, {
    unitId: caseRow.unitId,
    assigneeId: caseRow.assigneeId,
    sensitivity: caseRow.sensitivity,
  });
  if (!allowed) return { error: 'not_found', code: 404 };

  const messageKind = input.messageKind ?? (internal ? 'free_text' : policy.staff.default_outbound_kind);
  if (messageKind === 'logged_contact' && !policy.staff.allow_logged_contact) {
    return { error: 'logged_contact_disabled', code: 422 };
  }
  if (!internal && messageKind !== 'logged_contact' && !policy.staff.allow_outbound) {
    return { error: 'outbound_disabled', code: 422 };
  }

  const direction = internal ? 'internal_note' : 'outbound';
  const visibility = internal ? 'staff' : (input.visibility ?? 'public');
  let channel = input.channel ?? (internal ? 'console' : policy.staff.default_outbound_channel);
  if (internal) {
    channel = 'console';
  } else if (messageKind === 'logged_contact') {
    if (!THREAD_LOGGED_CONTACT_CHANNELS.includes(channel as (typeof THREAD_LOGGED_CONTACT_CHANNELS)[number])) {
      return { error: 'invalid_thread_channel', code: 422, message: 'Invalid logged-contact channel' };
    }
  } else {
    if (!THREAD_OUTBOUND_CHANNELS.includes(channel as (typeof THREAD_OUTBOUND_CHANNELS)[number])) {
      return { error: 'invalid_thread_channel', code: 422, message: 'Invalid outbound delivery channel' };
    }
    if (channel !== 'portal' && caseRow.partyId) {
      const [party] = await db
        .select({
          phoneEnc: schema.party.phoneEnc,
          emailEnc: schema.party.emailEnc,
        })
        .from(schema.party)
        .where(eq(schema.party.id, caseRow.partyId))
        .limit(1);
      const { decryptPII } = await import('./crypto.js');
      const hasPhone = Boolean(party?.phoneEnc && decryptPII(party.phoneEnc));
      const hasEmail = Boolean(party?.emailEnc && decryptPII(party.emailEnc));
      if ((channel === 'sms' || channel === 'whatsapp') && !hasPhone) {
        return { error: 'party_channel_unavailable', code: 422, message: 'Complainant has no phone on file for SMS/WhatsApp' };
      }
      if (channel === 'email' && !hasEmail) {
        return { error: 'party_channel_unavailable', code: 422, message: 'Complainant has no email on file' };
      }
    }
  }
  const attachmentIds = input.attachmentIds ?? [];

  let inReplyToId = input.inReplyToId ?? null;
  if (inReplyToId) {
    const [parent] = await db
      .select({ id: schema.threadEntry.id, direction: schema.threadEntry.direction })
      .from(schema.threadEntry)
      .where(
        and(
          eq(schema.threadEntry.tenantId, input.tenantId),
          eq(schema.threadEntry.caseId, input.caseId),
          eq(schema.threadEntry.id, inReplyToId),
        ),
      )
      .limit(1);
    if (!parent) return { error: 'reply_target_not_found', code: 422 };
    if (parent.direction !== 'inbound') {
      return { error: 'reply_target_not_inbound', code: 422, message: 'Can only reply to complainant messages' };
    }
  } else if (!internal && messageKind !== 'logged_contact') {
    const [latestInbound] = await db
      .select({ id: schema.threadEntry.id })
      .from(schema.threadEntry)
      .where(
        and(
          eq(schema.threadEntry.tenantId, input.tenantId),
          eq(schema.threadEntry.caseId, input.caseId),
          eq(schema.threadEntry.direction, 'inbound'),
        ),
      )
      .orderBy(desc(schema.threadEntry.createdAt))
      .limit(1);
    inReplyToId = latestInbound?.id ?? null;
  }

  const identity = await getActiveConfig<Cd01Identity>(input.tenantId, 'cd01_identity');
  const locale = identity?.locales?.default ?? 'en';
  let bodyRedacted: string | null = null;
  if (
    !internal
    && visibility === 'public'
    && caseRow.sensitivity !== 'standard'
    && policy.sensitive.redact_outbound_for_party
  ) {
    bodyRedacted =
      policy.sensitive.redacted_template[locale]
      ?? policy.sensitive.redacted_template.en
      ?? null;
  }

  let pendingOutboxId: string | null = null;
  const threadId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    const eventKind = internal ? 'note_internal' : 'message_external';
    const [ev] = await tx
      .insert(schema.caseEvent)
      .values({
        tenantId: input.tenantId,
        caseId: input.caseId,
        kind: eventKind,
        actorType: 'staff',
        actorId: input.actorId,
        visibility: internal ? 'internal' : 'public',
        data: { preview: body.slice(0, 200), message_kind: messageKind, channel },
      })
      .returning({ id: schema.caseEvent.id });

    await tx.insert(schema.threadEntry).values({
      id: threadId,
      tenantId: input.tenantId,
      caseId: input.caseId,
      caseEventId: ev!.id,
      direction,
      messageKind,
      channel,
      body,
      bodyRedacted,
      visibility,
      authorUserId: input.actorId,
      inReplyToId,
    });

    if (attachmentIds.length) {
      await promoteAttachments(tx, input.tenantId, input.caseId, attachmentIds, input.actorId);
      await linkPromotedAttachments(tx, attachmentIds, { threadEntryId: threadId, caseEventId: ev!.id });
    }

    if (!internal && policy.notify.on_outbound_message && channel !== 'portal') {
      const [party] = caseRow.partyId
        ? await tx.select({ notificationChannels: schema.party.notificationChannels }).from(schema.party).where(eq(schema.party.id, caseRow.partyId)).limit(1)
        : [undefined];
      const { outboxId } = await enqueueNotifications(
        {
          tenantId: input.tenantId,
          caseId: input.caseId,
          event: 'thread.reply_external',
          case: {
            reference: caseRow.reference,
            status: caseRow.status,
            sensitivity: caseRow.sensitivity,
            priority: caseRow.priority,
            levelCode: caseRow.levelCode,
            channel: caseRow.channel,
            anonymous: caseRow.anonymous,
            categories: caseRow.categories,
            unitId: caseRow.unitId,
            assigneeId: caseRow.assigneeId,
            partyId: caseRow.partyId,
            partyNotificationChannels: party?.notificationChannels as never,
          },
          data: { preview: body.slice(0, 120), notify_channel: channel },
        },
        tx,
      );
      pendingOutboxId = outboxId;
    }
  });

  if (pendingOutboxId) scheduleOutboxDispatch(pendingOutboxId).catch(console.error);
  return { id: threadId };
}

export async function verifyCaseByReference(
  tenantId: string,
  reference: string,
  verifier: string,
): Promise<
  | { case: typeof schema.grmCase.$inferSelect }
  | null
> {
  const [c] = await db
    .select()
    .from(schema.grmCase)
    .where(and(eq(schema.grmCase.tenantId, tenantId), eq(schema.grmCase.reference, reference.trim())))
    .limit(1);
  if (!c) return null;

  const verifierHash = piiLookupHash(verifier);
  let verified = Boolean(verifierHash && c.verifierHash === verifierHash);
  if (!verified && c.partyId && verifierHash) {
    const [p] = await db.select().from(schema.party).where(eq(schema.party.id, c.partyId)).limit(1);
    verified = Boolean(p && (p.phoneHash === verifierHash || p.emailHash === verifierHash));
  }
  if (!verified) return null;
  return { case: c };
}

export async function listPublicThread(
  tenantId: string,
  caseId: string,
  sensitivity: string,
): Promise<ThreadEntryRow[]> {
  const rows = await db
    .select()
    .from(schema.threadEntry)
    .where(
      and(
        eq(schema.threadEntry.tenantId, tenantId),
        eq(schema.threadEntry.caseId, caseId),
        eq(schema.threadEntry.visibility, 'public'),
        inArray(schema.threadEntry.direction, ['inbound', 'outbound']),
      ),
    )
    .orderBy(schema.threadEntry.createdAt);

  const attMap = await attachmentsForEntries(tenantId, caseId, rows.map((r) => r.id));
  const policy = (await loadCorrespondenceConfig(tenantId)).correspondence_policy;
  const identity = await getActiveConfig<Cd01Identity>(tenantId, 'cd01_identity');
  const locale = identity?.locales?.default ?? 'en';

  return rows.map((r) => ({
    id: r.id,
    direction: r.direction,
    message_kind: r.messageKind,
    channel: r.channel,
    body: partyDisplayBody(r, sensitivity, policy, locale),
    body_display: partyDisplayBody(r, sensitivity, policy, locale),
    visibility: r.visibility,
    author_name: r.direction === 'inbound' ? 'You' : 'GRM office',
    in_reply_to_id: r.inReplyToId,
    attachments: attMap.get(r.id) ?? [],
    created_at: r.createdAt.toISOString(),
  }));
}

export async function createComplainantReply(input: {
  tenantId: string;
  caseId: string;
  partyId: string | null;
  body: string;
  attachments?: IntakeAttachmentInput[];
}): Promise<{ id: string } | { error: string; code: number; message?: string }> {
  const cfg = await loadCorrespondenceConfig(input.tenantId);
  const policy = cfg.correspondence_policy;
  if (!policy.enabled || !policy.portal.enabled || !policy.portal.allow_reply) {
    return { error: 'reply_not_allowed', code: 422 };
  }

  const body = input.body.trim();
  if (!body) return { error: 'thread_body_required', code: 422 };
  if (body.length > policy.portal.max_body_length) {
    return { error: 'thread_body_too_long', code: 422 };
  }

  const files = input.attachments ?? [];
  if (files.length > policy.attachments.max_files_per_message) {
    return { error: 'attachment_policy_violation', code: 422, message: 'Too many attachments' };
  }
  if (files.length && !policy.attachments.complainant_reply_enabled) {
    return { error: 'reply_attachments_disabled', code: 422 };
  }
  if (files.length) {
    const intakeCfg = await loadAttachmentConfig(input.tenantId);
    const allowedCodes = new Set(
      policy.attachments.reply_kind_codes?.length
        ? policy.attachments.reply_kind_codes
        : kindsForChannel(intakeCfg, 'intake').map((k) => k.code),
    );
    for (const file of files) {
      if (!allowedCodes.has(file.kind)) {
        return { error: 'attachment_kind_not_allowed', code: 422 };
      }
      const err = validateAttachmentFile(intakeCfg, {
        channel: 'intake',
        kind: file.kind,
        filename: file.filename,
        mime: file.mime,
        sizeBytes: file.data.length,
      });
      if (err) return { error: err.error, code: 422, message: err.message };
    }
  }

  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [countRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.threadEntry)
    .where(
      and(
        eq(schema.threadEntry.tenantId, input.tenantId),
        eq(schema.threadEntry.caseId, input.caseId),
        eq(schema.threadEntry.direction, 'inbound'),
        gte(schema.threadEntry.createdAt, since),
      ),
    );
  if ((countRow?.n ?? 0) >= policy.portal.max_replies_per_day) {
    return { error: 'reply_rate_limited', code: 429, message: 'Too many replies today' };
  }

  const [caseRow] = await db
    .select()
    .from(schema.grmCase)
    .where(and(eq(schema.grmCase.tenantId, input.tenantId), eq(schema.grmCase.id, input.caseId)))
    .limit(1);
  if (!caseRow) return { error: 'not_found', code: 404 };
  if (caseRow.statusTag === 'closed' || caseRow.statusTag === 'rejected') {
    return { error: 'case_closed', code: 422, message: 'This case is closed' };
  }

  let pendingOutboxId: string | null = null;
  const threadId = crypto.randomUUID();

  const [latestOutbound] = await db
    .select({ id: schema.threadEntry.id })
    .from(schema.threadEntry)
    .where(
      and(
        eq(schema.threadEntry.tenantId, input.tenantId),
        eq(schema.threadEntry.caseId, input.caseId),
        eq(schema.threadEntry.direction, 'outbound'),
        eq(schema.threadEntry.visibility, 'public'),
      ),
    )
    .orderBy(desc(schema.threadEntry.createdAt))
    .limit(1);
  const inReplyToId = latestOutbound?.id ?? null;

  await db.transaction(async (tx) => {
    const [ev] = await tx
      .insert(schema.caseEvent)
      .values({
        tenantId: input.tenantId,
        caseId: input.caseId,
        kind: 'message_inbound',
        actorType: 'complainant',
        actorId: null,
        visibility: 'public',
        data: { preview: body.slice(0, 200), channel: 'portal' },
      })
      .returning({ id: schema.caseEvent.id });

    await tx.insert(schema.threadEntry).values({
      id: threadId,
      tenantId: input.tenantId,
      caseId: input.caseId,
      caseEventId: ev!.id,
      direction: 'inbound',
      messageKind: 'free_text',
      channel: 'portal',
      body,
      visibility: 'public',
      authorPartyId: input.partyId,
      inReplyToId,
    });

    if (files.length) {
      const { attachIntakeFiles } = await import('./attachments.js');
      const attached = await attachIntakeFiles(tx, {
        tenantId: input.tenantId,
        caseId: input.caseId,
        caseEventId: ev!.id,
        files,
      });
      await linkPromotedAttachments(
        tx,
        attached.summaries.map((s) => s.id),
        { threadEntryId: threadId, caseEventId: ev!.id },
      );
      await tx
        .update(schema.caseEvent)
        .set({
          data: {
            preview: body.slice(0, 200),
            channel: 'portal',
            attachment_summary: attached.summaries,
          },
        })
        .where(eq(schema.caseEvent.id, ev!.id));
    }

    if (policy.notify.on_inbound_reply) {
      const { outboxId } = await enqueueNotifications(
        {
          tenantId: input.tenantId,
          caseId: input.caseId,
          event: 'thread.reply_inbound',
          case: {
            reference: caseRow.reference,
            status: caseRow.status,
            sensitivity: caseRow.sensitivity,
            priority: caseRow.priority,
            levelCode: caseRow.levelCode,
            channel: caseRow.channel,
            anonymous: caseRow.anonymous,
            categories: caseRow.categories,
            unitId: caseRow.unitId,
            assigneeId: caseRow.assigneeId,
            partyId: caseRow.partyId,
          },
          data: { preview: body.slice(0, 120) },
        },
        tx,
      );
      pendingOutboxId = outboxId;
    }
  });

  if (pendingOutboxId) scheduleOutboxDispatch(pendingOutboxId).catch(console.error);
  return { id: threadId };
}
