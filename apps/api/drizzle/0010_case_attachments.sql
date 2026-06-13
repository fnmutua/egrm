CREATE TABLE IF NOT EXISTS "case_attachment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "case_id" uuid NOT NULL REFERENCES "grm_case"("id"),
  "case_event_id" uuid REFERENCES "case_event"("id"),
  "kind" text NOT NULL,
  "title" text,
  "filename" text NOT NULL,
  "mime" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "sha256" text NOT NULL,
  "storage_key" text NOT NULL,
  "visibility" text NOT NULL DEFAULT 'staff',
  "status" text NOT NULL DEFAULT 'staging',
  "malware_scan_status" text NOT NULL DEFAULT 'skipped',
  "uploaded_by" uuid REFERENCES "app_user"("id"),
  "upload_channel" text NOT NULL DEFAULT 'console',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "case_attachment_case_idx" ON "case_attachment" ("case_id", "status");
CREATE INDEX IF NOT EXISTS "case_attachment_tenant_case_idx" ON "case_attachment" ("tenant_id", "case_id");
