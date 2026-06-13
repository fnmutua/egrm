import { createHash } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../env.js';

function storageRoot(): string {
  return path.resolve(env.ATTACHMENTS_STORAGE_PATH);
}

export function attachmentStorageKey(tenantId: string, caseId: string, attachmentId: string): string {
  return `${tenantId}/${caseId}/${attachmentId}`;
}

export function attachmentAbsolutePath(storageKey: string): string {
  return path.join(storageRoot(), storageKey);
}

export async function ensureStorageDir(storageKey: string): Promise<string> {
  const abs = attachmentAbsolutePath(storageKey);
  await mkdir(path.dirname(abs), { recursive: true });
  return abs;
}

export async function writeAttachmentBlob(storageKey: string, data: Buffer): Promise<string> {
  const abs = await ensureStorageDir(storageKey);
  await writeFile(abs, data);
  return createHash('sha256').update(data).digest('hex');
}

export async function readAttachmentBlob(storageKey: string): Promise<Buffer> {
  return readFile(attachmentAbsolutePath(storageKey));
}

export async function deleteAttachmentBlob(storageKey: string): Promise<void> {
  try {
    await unlink(attachmentAbsolutePath(storageKey));
  } catch {
    /* already gone */
  }
}

/** Block obvious executable MIME types and extensions. */
export function isBlockedExecutable(mime: string, filename: string): boolean {
  const lower = mime.toLowerCase();
  const ext = path.extname(filename).toLowerCase();
  const blockedMimes = [
    'application/x-msdownload',
    'application/x-executable',
    'application/javascript',
    'text/javascript',
    'application/x-sh',
    'application/vnd.microsoft.portable-executable',
  ];
  const blockedExt = ['.exe', '.bat', '.cmd', '.sh', '.js', '.msi', '.dll', '.com', '.scr'];
  return blockedMimes.includes(lower) || blockedExt.includes(ext);
}
