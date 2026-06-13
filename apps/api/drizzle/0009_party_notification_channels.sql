ALTER TABLE "party" ADD COLUMN IF NOT EXISTS "notification_channels" text[] DEFAULT '{}' NOT NULL;
