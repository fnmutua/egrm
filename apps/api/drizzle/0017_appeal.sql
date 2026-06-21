ALTER TABLE "grm_case" ADD COLUMN IF NOT EXISTS "resolved_at" timestamp with time zone;

CREATE TABLE IF NOT EXISTS "case_appeal" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "case_id" uuid NOT NULL REFERENCES "grm_case"("id"),
  "round" integer NOT NULL,
  "raised_by" text NOT NULL,
  "reason" text NOT NULL,
  "raised_at" timestamp with time zone DEFAULT now() NOT NULL,
  "routed_to_level_code" text,
  "routed_to_unit_id" uuid REFERENCES "unit"("id"),
  "status" text DEFAULT 'open' NOT NULL,
  "decision" text,
  "decision_note" text,
  "decided_by" uuid REFERENCES "app_user"("id"),
  "decided_at" timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS "case_appeal_case_round" ON "case_appeal" ("tenant_id", "case_id", "round");
