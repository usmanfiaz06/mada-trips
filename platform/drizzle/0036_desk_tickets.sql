CREATE TABLE "desk_ticket_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"actor_id" uuid,
	"kind" text NOT NULL,
	"from" text,
	"to" text,
	"body" text,
	"data" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "desk_ticket_links" (
	"ticket_id" uuid NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" text NOT NULL,
	"label" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "desk_ticket_links_ticket_id_entity_kind_entity_id_pk" PRIMARY KEY("ticket_id","entity_kind","entity_id")
);
--> statement-breakpoint
CREATE TABLE "desk_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" serial NOT NULL,
	"kind" text NOT NULL,
	"source_kind" text,
	"source_id" text,
	"customer_id" uuid,
	"subject" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"need" text DEFAULT '' NOT NULL,
	"href" text,
	"amount" bigint,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"category" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"owner_agent_id" uuid,
	"owner_reason" text DEFAULT 'queue' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_response_at" timestamp with time zone,
	"sla_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sla_minutes" integer NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"paused_at" timestamp with time zone,
	"escalation_level" integer DEFAULT 0 NOT NULL,
	"escalated_at" timestamp with time zone,
	"escalation_note" text,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"reopened_count" integer DEFAULT 0 NOT NULL,
	"merged_into_id" uuid,
	"csat" integer,
	"csat_comment" text,
	"created_by" uuid,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "desk_tickets_csat" CHECK ("desk_tickets"."csat" IS NULL OR "desk_tickets"."csat" BETWEEN 1 AND 5)
);
--> statement-breakpoint
ALTER TABLE "app_desk_notes" ADD COLUMN "ticket_id" uuid;--> statement-breakpoint
ALTER TABLE "desk_ticket_events" ADD CONSTRAINT "desk_ticket_events_ticket_id_desk_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."desk_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desk_ticket_events" ADD CONSTRAINT "desk_ticket_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desk_ticket_links" ADD CONSTRAINT "desk_ticket_links_ticket_id_desk_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."desk_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desk_ticket_links" ADD CONSTRAINT "desk_ticket_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desk_tickets" ADD CONSTRAINT "desk_tickets_customer_id_app_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desk_tickets" ADD CONSTRAINT "desk_tickets_owner_agent_id_app_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."app_agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desk_tickets" ADD CONSTRAINT "desk_tickets_merged_into_id_desk_tickets_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."desk_tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desk_tickets" ADD CONSTRAINT "desk_tickets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "desk_ticket_events_ticket_idx" ON "desk_ticket_events" USING btree ("ticket_id","at");--> statement-breakpoint
CREATE INDEX "desk_ticket_links_entity_idx" ON "desk_ticket_links" USING btree ("entity_kind","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "desk_tickets_number_key" ON "desk_tickets" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "desk_tickets_source_open_key" ON "desk_tickets" USING btree ("source_kind","source_id") WHERE "desk_tickets"."status" <> 'closed' AND "desk_tickets"."source_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "desk_tickets_queue_idx" ON "desk_tickets" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "desk_tickets_owner_idx" ON "desk_tickets" USING btree ("owner_agent_id","status");--> statement-breakpoint
CREATE INDEX "desk_tickets_customer_idx" ON "desk_tickets" USING btree ("customer_id","opened_at");--> statement-breakpoint
ALTER TABLE "app_desk_notes" ADD CONSTRAINT "app_desk_notes_ticket_id_desk_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."desk_tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_desk_notes_ticket_idx" ON "app_desk_notes" USING btree ("ticket_id","created_at");--> statement-breakpoint
-- Leads manage tickets (reassign anyone's, merge). Partners have every desk right; DESK-PLAN.md §4.3.
-- The tickets for what is open on the desk today are made by the queue's first sync (lib/app/desk/tickets.ts
-- syncTickets: the "desk" job every 5 minutes, or the first visit to My queue), carrying over app_desk_items'
-- hand assignments and escalations.
UPDATE "roles" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['desk.tickets.manage']))
	WHERE "key" IN ('partner','partner_issuer');
