CREATE TABLE IF NOT EXISTS "ai_interaction" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "case_id" uuid REFERENCES "grm_case"("id"),
  "chatbot_session_id" uuid,
  "capability" text NOT NULL,
  "provider_profile_id" text,
  "model" text,
  "input_hash" text,
  "input_token_count" integer,
  "output_token_count" integer,
  "suggestion" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "confidence" real,
  "status" text NOT NULL DEFAULT 'completed',
  "error" text,
  "decision" text DEFAULT 'pending',
  "decided_by" uuid REFERENCES "app_user"("id"),
  "decided_at" timestamptz,
  "applied_event_id" uuid REFERENCES "case_event"("id"),
  "latency_ms" integer,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ai_interaction_tenant_case_created"
  ON "ai_interaction" ("tenant_id", "case_id", "created_at");

CREATE INDEX IF NOT EXISTS "ai_interaction_tenant_capability_created"
  ON "ai_interaction" ("tenant_id", "capability", "created_at");

CREATE INDEX IF NOT EXISTS "ai_interaction_tenant_decision_capability"
  ON "ai_interaction" ("tenant_id", "decision", "capability");
