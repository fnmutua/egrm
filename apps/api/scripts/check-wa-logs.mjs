import pg from 'pg';
import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:Admin%402011@localhost:5432/egrm',
});

const logs = await pool.query(`
  SELECT nl.status, nl.channel, nl.provider_message_id, nl.rendered_preview, nl.updated_at, c.reference
  FROM notification_log nl
  LEFT JOIN grm_case c ON c.id = nl.case_id
  WHERE nl.channel = 'whatsapp'
  ORDER BY nl.updated_at DESC
  LIMIT 15
`);
console.log('=== Recent WhatsApp logs ===');
console.log(JSON.stringify(logs.rows, null, 2));

const wa = await pool.query(`
  SELECT cv.payload->'senders'->'whatsapp' as wa
  FROM config_version cv JOIN tenant t ON t.id = cv.tenant_id
  WHERE t.code = 'kisip' AND cv.domain = 'cd09_notifications' AND cv.status = 'active' LIMIT 1
`);
console.log('\n=== Active WA sender config ===');
console.log(JSON.stringify(wa.rows[0].wa, null, 2));

await pool.end();
