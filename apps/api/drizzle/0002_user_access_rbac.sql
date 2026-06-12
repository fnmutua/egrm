ALTER TABLE "role" ADD COLUMN IF NOT EXISTS "sensitive_classes" text[] DEFAULT '{}' NOT NULL;
