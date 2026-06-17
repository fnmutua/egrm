import { pool } from './client.js';

async function main() {
  const cases = await pool.query(`
    SELECT c.id, c.reference, c.summary, c.channel, c.unit_id, u.name AS unit_name, c.sensitivity, c.created_at
    FROM grm_case c
    LEFT JOIN unit u ON u.id = c.unit_id
    ORDER BY c.created_at DESC
    LIMIT 8
  `);
  console.log('Latest cases:');
  console.table(cases.rows);

  const sessions = await pool.query(`
    SELECT id, case_id, phase, intent, ended_at, created_at
    FROM chatbot_session
    ORDER BY created_at DESC
    LIMIT 5
  `);
  console.log('Latest chatbot sessions:');
  console.table(sessions.rows);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
