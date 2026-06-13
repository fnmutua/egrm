import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Cd06IntakeForms } from '@egrm/config-schemas';
import { kindsForChannel, mergeDefaultAttachmentKinds } from '@egrm/config-schemas';
import { hasPermission } from '@egrm/core';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { db, schema } from '../db/client.js';
import { getActiveConfig } from './config.js';
import {
  attachmentStorageKey,
  deleteAttachmentBlob,
  isBlockedExecutable,
  readAttachmentBlob,
  writeAttachmentBlob,
} from './attachment-storage.js';
import type { UserAccess } from './access.js';
import { canAccessCase } from './access.js';

type Db = NodePgDatabase<typeof schema>;
type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface AttachmentRow {
  id: string;
  case_id: string;
  case_event_id: string | null;
  kind: string;
  kind_label: string;
  title: string | null;
  filename: string;
  mime: string;
  size_bytes: number;
  visibility: string;
  status: string;
  uploaded_by_name: string | null;
  created_at: string;
}

export async function loadAttachmentConfig(tenantId: string): Promise<Cd06IntakeForms> {
  const cfg = await getActiveConfig<Cd06IntakeForms>(tenantId, 'cd06_intake_forms');
  if (!cfg) throw new Error('tenant_not_configured');
  return {
    ...cfg,
    attachment_kinds: mergeDefaultAttachmentKinds(cfg.attachment_kinds),
  };
}

function kindByCode(cfg: Cd06IntakeForms, code: string, channel: 'console' | 'intake' = 'console') {
  return kindsForChannel(cfg, channel).find((k) => k.code === code);
}

export function kindLabel(cfg: Cd06IntakeForms, code: string): string {
  return mergeDefaultAttachmentKinds(cfg.attachment_kinds).find((k) => k.code === code)?.label?.en ?? code;
}

function mimeAllowed(mime: string, allowed: string[] | undefined, defaults: string[]): boolean {
  const list = allowed?.length ? allowed : defaults;
  return list.some((a) => a.toLowerCase() === mime.toLowerCase());
}

async function caseAttachmentStats(tenantId: string, caseId: string) {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${schema.caseAttachment.sizeBytes}), 0)::int`,
    })
    .from(schema.caseAttachment)
    .where(
      and(
        eq(schema.caseAttachment.tenantId, tenantId),
        eq(schema.caseAttachment.caseId, caseId),
        inArray(schema.caseAttachment.status, ['staging', 'active']),
      ),
    );
  return { count: row?.count ?? 0, totalBytes: row?.total ?? 0 };
}

export async function stageCaseAttachment(input: {
  tenantId: string;
  caseId: string;
  actorId: string;
  kind: string;
  filename: string;
  mime: string;
  data: Buffer;
  visibility?: string;
  channel?: 'console' | 'intake';
}): Promise<{ id: string } | { error: string; message?: string }> {
  const cfg = await loadAttachmentConfig(input.tenantId);
  const channel = input.channel ?? 'console';
  const kindDef = kindByCode(cfg, input.kind, channel);
  if (!kindDef) {
    return { error: 'attachment_kind_not_allowed', message: 'This document type is not allowed for upload here' };
  }

  const policy = cfg.attachment_policy;
  if (policy.block_executable && isBlockedExecutable(input.mime, input.filename)) {
    return { error: 'attachment_policy_violation', message: 'Executable file types are not allowed' };
  }

  const maxMb = kindDef.max_size_mb ?? policy.max_total_case_size_mb;
  const maxBytes = maxMb * 1024 * 1024;
  if (input.data.length > maxBytes) {
    return { error: 'attachment_policy_violation', message: `File exceeds ${maxMb} MB limit` };
  }

  if (!mimeAllowed(input.mime, kindDef.allowed_mime, policy.allowed_mime_default)) {
    return { error: 'attachment_policy_violation', message: 'File type not allowed for this document type' };
  }

  const stats = await caseAttachmentStats(input.tenantId, input.caseId);
  if (stats.count >= policy.max_files_per_case) {
    return { error: 'attachment_policy_violation', message: 'Case attachment limit reached' };
  }
  if (stats.totalBytes + input.data.length > policy.max_total_case_size_mb * 1024 * 1024) {
    return { error: 'attachment_policy_violation', message: 'Case total attachment size limit reached' };
  }

  if (policy.duplicate_detection !== 'off') {
    const { createHash } = await import('node:crypto');
    const sha = createHash('sha256').update(input.data).digest('hex');
    const [dup] = await db
      .select({ id: schema.caseAttachment.id })
      .from(schema.caseAttachment)
      .where(
        and(
          eq(schema.caseAttachment.tenantId, input.tenantId),
          eq(schema.caseAttachment.caseId, input.caseId),
          eq(schema.caseAttachment.sha256, sha),
          inArray(schema.caseAttachment.status, ['staging', 'active']),
        ),
      )
      .limit(1);
    if (dup && policy.duplicate_detection === 'block') {
      return { error: 'duplicate_attachment', message: 'This file was already uploaded to this case' };
    }
  }

  const id = crypto.randomUUID();
  const storageKey = attachmentStorageKey(input.tenantId, input.caseId, id);
  const sha256 = await writeAttachmentBlob(storageKey, input.data);
  const visibility = (input.visibility ?? kindDef.default_visibility) as 'public' | 'staff' | 'restricted';

  await db.insert(schema.caseAttachment).values({
    id,
    tenantId: input.tenantId,
    caseId: input.caseId,
    kind: input.kind,
    title: input.filename,
    filename: input.filename,
    mime: input.mime,
    sizeBytes: input.data.length,
    sha256,
    storageKey,
    visibility,
    status: 'staging',
    malwareScanStatus: policy.malware_scan ? 'pending' : 'skipped',
    uploadedBy: input.actorId,
    uploadChannel: channel === 'intake' ? 'portal' : 'console',
  });

  return { id };
}

export async function listCaseAttachments(
  tenantId: string,
  caseId: string,
  access: UserAccess,
  actorId: string,
): Promise<AttachmentRow[]> {
  const [caseRow] = await db
    .select({ unitId: schema.grmCase.unitId, assigneeId: schema.grmCase.assigneeId, sensitivity: schema.grmCase.sensitivity })
    .from(schema.grmCase)
    .where(and(eq(schema.grmCase.tenantId, tenantId), eq(schema.grmCase.id, caseId)))
    .limit(1);
  if (!caseRow) return [];

  const allowed = await canAccessCase(tenantId, access, actorId, caseRow);
  if (!allowed) return [];

  const cfg = await loadAttachmentConfig(tenantId);
  const rows = await db
    .select({
      id: schema.caseAttachment.id,
      caseId: schema.caseAttachment.caseId,
      caseEventId: schema.caseAttachment.caseEventId,
      kind: schema.caseAttachment.kind,
      title: schema.caseAttachment.title,
      filename: schema.caseAttachment.filename,
      mime: schema.caseAttachment.mime,
      sizeBytes: schema.caseAttachment.sizeBytes,
      visibility: schema.caseAttachment.visibility,
      status: schema.caseAttachment.status,
      uploadedBy: schema.caseAttachment.uploadedBy,
      createdAt: schema.caseAttachment.createdAt,
      uploaderName: schema.appUser.displayName,
    })
    .from(schema.caseAttachment)
    .leftJoin(schema.appUser, eq(schema.caseAttachment.uploadedBy, schema.appUser.id))
    .where(
      and(
        eq(schema.caseAttachment.tenantId, tenantId),
        eq(schema.caseAttachment.caseId, caseId),
        eq(schema.caseAttachment.status, 'active'),
      ),
    )
    .orderBy(schema.caseAttachment.createdAt);

  const canRestricted = hasPermission(access.permissions, 'attachment:read_protected');
  return rows
    .filter((r) => r.visibility !== 'restricted' || canRestricted)
    .map((r) => ({
      id: r.id,
      case_id: r.caseId,
      case_event_id: r.caseEventId,
      kind: r.kind,
      kind_label: kindLabel(cfg, r.kind),
      title: r.title,
      filename: r.filename,
      mime: r.mime,
      size_bytes: r.sizeBytes,
      visibility: r.visibility,
      status: r.status,
      uploaded_by_name: r.uploaderName,
      created_at: r.createdAt.toISOString(),
    }));
}

export async function getAttachmentDownload(
  tenantId: string,
  caseId: string,
  attachmentId: string,
  access: UserAccess,
  actorId: string,
): Promise<
  | { filename: string; mime: string; data: Buffer }
  | { error: string; code: number }
> {
  const [caseRow] = await db
    .select({ unitId: schema.grmCase.unitId, assigneeId: schema.grmCase.assigneeId, sensitivity: schema.grmCase.sensitivity })
    .from(schema.grmCase)
    .where(and(eq(schema.grmCase.tenantId, tenantId), eq(schema.grmCase.id, caseId)))
    .limit(1);
  if (!caseRow) return { error: 'not_found', code: 404 };

  const allowed = await canAccessCase(tenantId, access, actorId, caseRow);
  if (!allowed) return { error: 'not_found', code: 404 };

  const [row] = await db
    .select()
    .from(schema.caseAttachment)
    .where(
      and(
        eq(schema.caseAttachment.tenantId, tenantId),
        eq(schema.caseAttachment.caseId, caseId),
        eq(schema.caseAttachment.id, attachmentId),
        eq(schema.caseAttachment.status, 'active'),
      ),
    )
    .limit(1);
  if (!row) return { error: 'not_found', code: 404 };

  if (row.visibility === 'restricted' && !hasPermission(access.permissions, 'attachment:read_protected')) {
    return { error: 'forbidden', code: 403 };
  }
  if (!hasPermission(access.permissions, 'attachment:download')) {
    return { error: 'forbidden', code: 403 };
  }

  const data = await readAttachmentBlob(row.storageKey);
  return { filename: row.filename, mime: row.mime, data };
}

export async function commitStandaloneAttachments(input: {
  tenantId: string;
  caseId: string;
  actorId: string;
  attachmentIds: string[];
  note?: string;
}): Promise<{ ok: true } | { error: string; code: number; message?: string }> {
  if (input.attachmentIds.length === 0) return { error: 'attachment_ids_required', code: 400 };

  await db.transaction(async (tx) => {
    const eventRows = await promoteAttachments(tx, input.tenantId, input.caseId, input.attachmentIds, input.actorId);
    const [ev] = await tx
      .insert(schema.caseEvent)
      .values({
        tenantId: input.tenantId,
        caseId: input.caseId,
        kind: 'attachment_added',
        actorType: 'staff',
        actorId: input.actorId,
        visibility: 'internal',
        data: {
          attachment_ids: input.attachmentIds,
          attachment_summary: eventRows,
          note: input.note?.trim() ?? null,
        },
      })
      .returning({ id: schema.caseEvent.id });

    if (ev?.id) {
      await tx
        .update(schema.caseAttachment)
        .set({ caseEventId: ev.id })
        .where(inArray(schema.caseAttachment.id, input.attachmentIds));
    }
  });

  return { ok: true };
}

export async function promoteAttachments(
  tx: DbTx,
  tenantId: string,
  caseId: string,
  attachmentIds: string[],
  _actorId: string,
): Promise<{ id: string; kind: string; filename: string }[]> {
  if (attachmentIds.length === 0) return [];

  const rows = await tx
    .select()
    .from(schema.caseAttachment)
    .where(
      and(
        eq(schema.caseAttachment.tenantId, tenantId),
        eq(schema.caseAttachment.caseId, caseId),
        inArray(schema.caseAttachment.id, attachmentIds),
      ),
    );

  if (rows.length !== attachmentIds.length) throw new Error('invalid_attachment_ids');

  for (const row of rows) {
    if (row.status !== 'staging') throw new Error('attachment_not_staging');
  }

  await tx
    .update(schema.caseAttachment)
    .set({ status: 'active' })
    .where(inArray(schema.caseAttachment.id, attachmentIds));

  return rows.map((r) => ({ id: r.id, kind: r.kind, filename: r.filename }));
}

export function validateTransitionAttachments(
  requiredKinds: string[] | undefined,
  allowedKinds: string[] | undefined,
  attachmentIds: string[] | undefined,
  stagedKinds: Map<string, string>,
): string | null {
  const ids = attachmentIds ?? [];
  const kindsPresent = new Set(
    ids.map((id) => stagedKinds.get(id)).filter((k): k is string => typeof k === 'string'),
  );

  if (requiredKinds?.length) {
    for (const kind of requiredKinds) {
      if (!kindsPresent.has(kind)) return 'required_attachment_missing';
    }
  }

  if (allowedKinds?.length) {
    const allowed = new Set(allowedKinds);
    for (const kind of kindsPresent) {
      if (!allowed.has(kind)) return 'attachment_kind_not_allowed';
    }
  }

  return null;
}

export async function loadStagedAttachmentKinds(
  tenantId: string,
  caseId: string,
  attachmentIds: string[],
): Promise<Map<string, string>> {
  if (attachmentIds.length === 0) return new Map();
  const rows = await db
    .select({ id: schema.caseAttachment.id, kind: schema.caseAttachment.kind, status: schema.caseAttachment.status })
    .from(schema.caseAttachment)
    .where(
      and(
        eq(schema.caseAttachment.tenantId, tenantId),
        eq(schema.caseAttachment.caseId, caseId),
        inArray(schema.caseAttachment.id, attachmentIds),
      ),
    );
  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.status === 'staging') map.set(r.id, r.kind);
  }
  return map;
}

export async function deleteStagedAttachment(
  tenantId: string,
  caseId: string,
  attachmentId: string,
  actorId: string,
): Promise<{ ok: true } | { error: string; code: number }> {
  const [row] = await db
    .select()
    .from(schema.caseAttachment)
    .where(
      and(
        eq(schema.caseAttachment.tenantId, tenantId),
        eq(schema.caseAttachment.caseId, caseId),
        eq(schema.caseAttachment.id, attachmentId),
        eq(schema.caseAttachment.status, 'staging'),
      ),
    )
    .limit(1);
  if (!row) return { error: 'not_found', code: 404 };
  if (row.uploadedBy && row.uploadedBy !== actorId) return { error: 'forbidden', code: 403 };

  await deleteAttachmentBlob(row.storageKey);
  await db.delete(schema.caseAttachment).where(eq(schema.caseAttachment.id, attachmentId));
  return { ok: true };
}
