CREATE TABLE IF NOT EXISTS "thread_entry" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "case_id" uuid NOT NULL REFERENCES "grm_case"("id"),
  "case_event_id" uuid REFERENCES "case_event"("id"),
  "direction" text NOT NULL,
  "message_kind" text NOT NULL DEFAULT 'free_text',
  "channel" text NOT NULL DEFAULT 'console',
  "body" text NOT NULL,
  "body_redacted" text,
  "visibility" text NOT NULL DEFAULT 'public',
  "author_user_id" uuid REFERENCES "app_user"("id"),
  "author_party_id" uuid REFERENCES "party"("id"),
  "in_reply_to_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "thread_entry_case_idx" ON "thread_entry" ("case_id", "created_at");
CREATE INDEX IF NOT EXISTS "thread_entry_tenant_case_idx" ON "thread_entry" ("tenant_id", "case_id");

ALTER TABLE "case_attachment" ADD COLUMN IF NOT EXISTS "thread_entry_id" uuid;
