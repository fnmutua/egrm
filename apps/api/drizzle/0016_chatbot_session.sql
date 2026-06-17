CREATE TABLE IF NOT EXISTS "chatbot_session" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "channel" text NOT NULL DEFAULT 'web_widget',
  "external_thread_id" text,
  "locale" text NOT NULL DEFAULT 'en',
  "intent" text,
  "phase" text NOT NULL DEFAULT 'welcome',
  "slots" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "transcript" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "case_id" uuid REFERENCES "grm_case"("id"),
  "handoff_reason" text,
  "handoff_task_id" uuid,
  "sensitivity_flagged" boolean NOT NULL DEFAULT false,
  "ended_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "chatbot_session_tenant_created"
  ON "chatbot_session" ("tenant_id", "created_at");

ALTER TABLE "ai_interaction"
  ADD CONSTRAINT "ai_interaction_chatbot_session_id_chatbot_session_id_fk"
  FOREIGN KEY ("chatbot_session_id") REFERENCES "chatbot_session"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
