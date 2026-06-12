CREATE TABLE "case_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"visibility" text DEFAULT 'internal' NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_sequence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"scope_key" text NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grm_case" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"case_type" text DEFAULT 'grievance' NOT NULL,
	"status" text NOT NULL,
	"status_tag" text NOT NULL,
	"level_code" text NOT NULL,
	"unit_id" uuid,
	"party_id" uuid,
	"anonymous" boolean DEFAULT false NOT NULL,
	"channel" text DEFAULT 'web' NOT NULL,
	"categories" text[] DEFAULT '{}' NOT NULL,
	"sensitivity" text DEFAULT 'standard' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"summary" text NOT NULL,
	"description" text,
	"expected_outcome" text,
	"date_occurred" timestamp with time zone,
	"consent" boolean DEFAULT false NOT NULL,
	"verifier_hash" text,
	"assignee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "party" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name_enc" text,
	"phone_enc" text,
	"email_enc" text,
	"phone_hash" text,
	"email_hash" text,
	"gender" text,
	"age_band" text,
	"vulnerability_tags" text[],
	"preferred_language" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"level_code" text NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "case_event" ADD CONSTRAINT "case_event_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_event" ADD CONSTRAINT "case_event_case_id_grm_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."grm_case"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_sequence" ADD CONSTRAINT "case_sequence_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grm_case" ADD CONSTRAINT "grm_case_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grm_case" ADD CONSTRAINT "grm_case_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grm_case" ADD CONSTRAINT "grm_case_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grm_case" ADD CONSTRAINT "grm_case_assignee_id_app_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party" ADD CONSTRAINT "party_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit" ADD CONSTRAINT "unit_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "case_sequence_scope" ON "case_sequence" USING btree ("tenant_id","scope_key");--> statement-breakpoint
CREATE UNIQUE INDEX "grm_case_tenant_reference" ON "grm_case" USING btree ("tenant_id","reference");--> statement-breakpoint
CREATE UNIQUE INDEX "unit_tenant_code" ON "unit" USING btree ("tenant_id","code");