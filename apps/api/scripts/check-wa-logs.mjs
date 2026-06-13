import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:Admin%402011@localhost:5432/egrm',
});

const logs = await pool.query(`
  SELECT status, template_id, rendered_preview, provider_message_id, attempts, updated_at
  FROM notification_log
  WHERE channel = 'whatsapp'
  ORDER BY updated_at DESC
  LIMIT 15
`);
console.log('=== WhatsApp notification_log (latest) ===');
for (const row of logs.rows) {
  console.log(JSON.stringify(row, null, 2));
}

const active = await pool.query(`
  SELECT cv.version, cv.status,
         cv.payload->'senders'->'whatsapp'->'mode' as mode,
         cv.payload->'senders'->'whatsapp'->'phone_number_id' as phone_number_id,
         cv.payload->'senders'->'whatsapp'->'template_name' as template_name,
         length(cv.payload->'senders'->'whatsapp'->'headers'->0->>'value') as auth_len
  FROM config_version cv
  JOIN tenant t ON t.id = cv.tenant_id
  WHERE t.code = 'kisip' AND cv.domain = 'cd09_notifications' AND cv.status = 'active'
  LIMIT 1
`);
console.log('\n=== Active CD-09 WhatsApp config ===');
console.log(JSON.stringify(active.rows[0] ?? null, null, 2));

await pool.end();
