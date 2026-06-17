CREATE TABLE IF NOT EXISTS "staff_inbox_notification" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "user_id" uuid NOT NULL REFERENCES "app_user"("id"),
  "case_id" uuid REFERENCES "grm_case"("id"),
  "notification_log_id" uuid REFERENCES "notification_log"("id"),
  "event_kind" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "read_at" timestamp with time zone,
  "dismissed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "staff_inbox_user_created"
  ON "staff_inbox_notification" ("tenant_id", "user_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "staff_inbox_user_active"
  ON "staff_inbox_notification" ("tenant_id", "user_id", "created_at" DESC)
  WHERE "dismissed_at" IS NULL;
