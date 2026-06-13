import pg from 'pg';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const encKey = crypto.scryptSync(process.env.PII_SECRET ?? 'change-me-pii-in-prod', 'egrm-pii-enc', 32);

function decryptPII(stored) {
  if (!stored) return null;
  const [version, ivB64, tagB64, dataB64] = stored.split(':');
  if (version !== 'v1') return null;
  const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:Admin%402011@localhost:5432/egrm',
});

const cfg = await pool.query(`
  SELECT cv.payload->'senders'->'whatsapp' as wa
  FROM config_version cv JOIN tenant t ON t.id = cv.tenant_id
  WHERE t.code = 'kisip' AND cv.domain = 'cd09_notifications' AND cv.status = 'active' LIMIT 1
`);
const wa = cfg.rows[0].wa;
const authRow = (wa.headers ?? []).find((h) => h.key?.toLowerCase() === 'authorization');
const raw = (authRow?.value ?? '').trim();
console.log('=== Auth header from CD-09 ===');
console.log('raw length:', raw.length);
console.log('starts with Bearer:', raw.startsWith('Bearer '));
console.log('prefix:', raw.slice(0, 20));
console.log('formed:', raw.startsWith('Bearer ') ? raw.slice(0, 27) + '…' : `Bearer ${raw.slice(0, 20)}…`);
console.log('api_url:', wa.api_url || '(default v23.0)');
console.log('mode:', wa.mode);

const caseRow = await pool.query(`
  SELECT c.reference, p.phone_enc, nl.rendered_preview, nl.provider_message_id, nl.status, nl.updated_at
  FROM grm_case c
  LEFT JOIN party p ON p.id = c.party_id
  LEFT JOIN notification_log nl ON nl.case_id = c.id AND nl.channel = 'whatsapp'
  WHERE c.reference IN ('GRM-2026-0018', 'GRM-2026-0017')
  ORDER BY c.reference DESC, nl.updated_at DESC
`);
console.log('\n=== Cases + WhatsApp logs ===');
for (const row of caseRow.rows) {
  console.log({
    reference: row.reference,
    phone: decryptPII(row.phone_enc),
    status: row.status,
    provider_message_id: row.provider_message_id,
    updated_at: row.updated_at,
  });
}

await pool.end();
