ALTER TABLE "notification_log" ADD COLUMN IF NOT EXISTS "rule_id" text;
ALTER TABLE "notification_log" ADD COLUMN IF NOT EXISTS "recipient_selector" jsonb;
