ALTER TABLE "app_people" ADD COLUMN "linked_user_id" uuid;--> statement-breakpoint
ALTER TABLE "app_people" ADD CONSTRAINT "app_people_linked_user_id_app_users_id_fk" FOREIGN KEY ("linked_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_people_linked_idx" ON "app_people" USING btree ("owner_id","linked_user_id") WHERE "app_people"."linked_user_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE "app_trip_travellers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"person_id" uuid,
	"user_id" uuid,
	"invite_id" uuid,
	"name" text,
	"role" text DEFAULT 'suggest' NOT NULL,
	"status" text DEFAULT 'going' NOT NULL,
	"added_by_kind" text DEFAULT 'traveller' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_trip_travellers_who" CHECK ("app_trip_travellers"."person_id" IS NOT NULL OR "app_trip_travellers"."user_id" IS NOT NULL OR "app_trip_travellers"."invite_id" IS NOT NULL),
	CONSTRAINT "app_trip_travellers_role" CHECK ("app_trip_travellers"."role" IN ('owner', 'view', 'suggest', 'edit')),
	CONSTRAINT "app_trip_travellers_status" CHECK ("app_trip_travellers"."status" IN ('going', 'invited', 'declined'))
);
--> statement-breakpoint
ALTER TABLE "app_trip_travellers" ADD CONSTRAINT "app_trip_travellers_trip_id_app_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."app_trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_trip_travellers" ADD CONSTRAINT "app_trip_travellers_person_id_app_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."app_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_trip_travellers" ADD CONSTRAINT "app_trip_travellers_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_trip_travellers" ADD CONSTRAINT "app_trip_travellers_invite_id_app_circle_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."app_circle_invites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_trip_travellers_person_key" ON "app_trip_travellers" USING btree ("trip_id","person_id") WHERE "app_trip_travellers"."person_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "app_trip_travellers_user_key" ON "app_trip_travellers" USING btree ("trip_id","user_id") WHERE "app_trip_travellers"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "app_trip_travellers_user_idx" ON "app_trip_travellers" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "app_trip_travellers_invite_idx" ON "app_trip_travellers" USING btree ("invite_id");--> statement-breakpoint
CREATE TABLE "app_trip_sharing" (
	"trip_id" uuid PRIMARY KEY NOT NULL,
	"share_prices" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_trip_sharing" ADD CONSTRAINT "app_trip_sharing_trip_id_app_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."app_trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "app_plan_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"by_user_id" uuid NOT NULL,
	"by_thread_id" uuid,
	"owner_thread_id" uuid,
	"summary" text NOT NULL,
	"ops" jsonb NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"base_version" integer NOT NULL,
	"costs" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"decided_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_plan_change_requests_status" CHECK ("app_plan_change_requests"."status" IN ('pending', 'approved', 'declined', 'expired', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "app_plan_change_requests" ADD CONSTRAINT "app_plan_change_requests_trip_id_app_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."app_trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_plan_change_requests" ADD CONSTRAINT "app_plan_change_requests_plan_id_app_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."app_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_plan_change_requests" ADD CONSTRAINT "app_plan_change_requests_owner_id_app_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_plan_change_requests" ADD CONSTRAINT "app_plan_change_requests_by_user_id_app_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_plan_change_requests" ADD CONSTRAINT "app_plan_change_requests_by_thread_id_app_ask_threads_id_fk" FOREIGN KEY ("by_thread_id") REFERENCES "public"."app_ask_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_plan_change_requests" ADD CONSTRAINT "app_plan_change_requests_owner_thread_id_app_ask_threads_id_fk" FOREIGN KEY ("owner_thread_id") REFERENCES "public"."app_ask_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_plan_change_requests_trip_idx" ON "app_plan_change_requests" USING btree ("trip_id","status");--> statement-breakpoint
CREATE INDEX "app_plan_change_requests_by_idx" ON "app_plan_change_requests" USING btree ("by_user_id","created_at");--> statement-breakpoint
CREATE INDEX "app_plan_change_requests_open_idx" ON "app_plan_change_requests" USING btree ("expires_at") WHERE "app_plan_change_requests"."status" = 'pending';--> statement-breakpoint
-- Backfill: every trip's cached travellers become rows, the account holder as the owner (traveller_ids stays the cache).
INSERT INTO "app_trip_travellers" ("trip_id", "person_id", "role", "status", "added_by_kind")
SELECT t."id", p."id", CASE WHEN p."is_self" THEN 'owner' ELSE 'suggest' END, 'going', 'system'
FROM "app_trips" t
CROSS JOIN LATERAL unnest(t."traveller_ids") AS x(person_id)
JOIN "app_people" p ON p."id" = x.person_id AND p."owner_id" = t."owner_id"
ON CONFLICT DO NOTHING;
