-- The agent desk (src/db/app-schema-desk.ts). Pending: the lead folds this into one generated migration.
CREATE TABLE IF NOT EXISTS "app_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ops_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"display_name" text NOT NULL,
	"display_name_ar" text,
	"photo_url" text,
	"languages" text[] DEFAULT '{en,ar}'::text[] NOT NULL,
	"pronoun" text DEFAULT 'he' NOT NULL,
	"status" text DEFAULT 'offline' NOT NULL,
	"status_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reply_minutes" integer DEFAULT 2 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_agents_ops_user_key" ON "app_agents" ("ops_user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_agent_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL REFERENCES "app_agents"("id") ON DELETE cascade,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"covering_for_id" uuid REFERENCES "app_agents"("id") ON DELETE set null,
	"note" text,
	"created_by" uuid REFERENCES "users"("id") ON DELETE set null,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_agent_shifts_order" CHECK ("ends_at" > "starts_at")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_agent_shifts_time_idx" ON "app_agent_shifts" ("starts_at","ends_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_agent_shifts_agent_idx" ON "app_agent_shifts" ("agent_id","starts_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_agent_assignments" (
	"user_id" uuid PRIMARY KEY NOT NULL REFERENCES "app_users"("id") ON DELETE cascade,
	"agent_id" uuid NOT NULL REFERENCES "app_agents"("id") ON DELETE cascade,
	"assigned_by" uuid REFERENCES "users"("id") ON DELETE set null,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_agent_assignments_agent_idx" ON "app_agent_assignments" ("agent_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_desk_items" (
	"item_kind" text NOT NULL,
	"item_id" text NOT NULL,
	"assigned_agent_id" uuid REFERENCES "app_agents"("id") ON DELETE set null,
	"assigned_by" uuid REFERENCES "users"("id") ON DELETE set null,
	"assigned_at" timestamp with time zone,
	"escalated_at" timestamp with time zone,
	"escalated_by" uuid REFERENCES "users"("id") ON DELETE set null,
	"escalation_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_desk_items_item_kind_item_id_pk" PRIMARY KEY("item_kind","item_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_desk_items_agent_idx" ON "app_desk_items" ("assigned_agent_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_desk_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_kind" text NOT NULL,
	"thread_id" uuid NOT NULL,
	"ops_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_desk_notes_thread_idx" ON "app_desk_notes" ("thread_kind","thread_id","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_desk_canned" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body_en" text NOT NULL,
	"body_ar" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_by" uuid REFERENCES "users"("id") ON DELETE set null,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_desk_typing" (
	"agent_id" uuid PRIMARY KEY NOT NULL REFERENCES "app_agents"("id") ON DELETE cascade,
	"thread_kind" text NOT NULL,
	"thread_id" uuid NOT NULL,
	"until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_desk_typing_thread_idx" ON "app_desk_typing" ("thread_kind","thread_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_desk_moderation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"author_user_id" uuid REFERENCES "app_users"("id") ON DELETE set null,
	"reporter_user_id" uuid REFERENCES "app_users"("id") ON DELETE set null,
	"reason" text,
	"note" text,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"decided_by" uuid REFERENCES "users"("id") ON DELETE set null,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_desk_moderation_status_idx" ON "app_desk_moderation" ("status","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_desk_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "app_users"("id") ON DELETE cascade,
	"reason" text NOT NULL,
	"blocked_by" uuid REFERENCES "users"("id") ON DELETE set null,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lifted_at" timestamp with time zone,
	"lifted_by" uuid REFERENCES "users"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_desk_blocks_user_idx" ON "app_desk_blocks" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_desk_blocks_one_active" ON "app_desk_blocks" ("user_id") WHERE "lifted_at" IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_desk_disruptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flight_number" text NOT NULL,
	"date" text NOT NULL,
	"status" text NOT NULL,
	"plan" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"voucher_amount" bigint DEFAULT 0 NOT NULL,
	"user_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"pushed_by" uuid REFERENCES "users"("id") ON DELETE set null,
	"agent_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_desk_disruptions_flight_idx" ON "app_desk_disruptions" ("flight_number","date");
--> statement-breakpoint
-- Desk capabilities for the built-in roles. Partners get the whole desk; the Riyadh counter and the Pakistan desk
-- work it (view and act). Issuing, refunds, moderation and the rota stay with partners unless a role grants them.
UPDATE "roles" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['desk.view','desk.act','desk.issue','desk.refund','desk.moderate','desk.admin']))
	WHERE "key" IN ('partner','partner_issuer');
--> statement-breakpoint
UPDATE "roles" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['desk.view','desk.act']))
	WHERE "key" IN ('retail_agent','corporate_agent');
