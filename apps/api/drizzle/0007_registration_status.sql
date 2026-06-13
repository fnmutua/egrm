ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "registration_status" text DEFAULT 'approved' NOT NULL;
