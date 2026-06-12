CREATE TABLE IF NOT EXISTS "notification_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "case_id" uuid REFERENCES "grm_case"("id"),
  "event_kind" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "notification_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "case_id" uuid REFERENCES "grm_case"("id"),
  "outbox_id" uuid REFERENCES "notification_outbox"("id"),
  "event_kind" text NOT NULL,
  "recipient_kind" text NOT NULL,
  "recipient_address_hash" text,
  "channel" text NOT NULL,
  "template_id" text NOT NULL,
  "locale" text DEFAULT 'en' NOT NULL,
  "rendered_preview" text,
  "status" text DEFAULT 'queued' NOT NULL,
  "provider_message_id" text,
  "attempts" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "notification_log_tenant_created" ON "notification_log" ("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "notification_outbox_pending" ON "notification_outbox" ("status", "created_at");
