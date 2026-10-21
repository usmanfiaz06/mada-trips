CREATE TABLE "app_agent_presence_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"set_by" uuid
);
--> statement-breakpoint
ALTER TABLE "app_agent_shifts" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "app_agent_shifts" ADD COLUMN "repeat" text;--> statement-breakpoint
ALTER TABLE "app_desk_canned" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "desk_tickets" ADD COLUMN "csat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_agent_presence_log" ADD CONSTRAINT "app_agent_presence_log_agent_id_app_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."app_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_agent_presence_log" ADD CONSTRAINT "app_agent_presence_log_set_by_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_agent_presence_log_agent_idx" ON "app_agent_presence_log" USING btree ("agent_id","started_at");--> statement-breakpoint
CREATE INDEX "app_agent_shifts_series_idx" ON "app_agent_shifts" USING btree ("series_id") WHERE "series_id" IS NOT NULL;--> statement-breakpoint
-- Each agent's current status becomes the first open interval of their presence log.
INSERT INTO "app_agent_presence_log" ("agent_id", "status", "started_at")
  SELECT "id", "status", "status_at" FROM "app_agents" a
  WHERE NOT EXISTS (SELECT 1 FROM "app_agent_presence_log" l WHERE l."agent_id" = a."id");--> statement-breakpoint
-- desk.reports (the Performance page and every agent's stats) for the partners and anyone who runs the desk.
UPDATE "roles" SET "permissions" = array_append("permissions", 'desk.reports')
  WHERE ("key" IN ('partner', 'partner_issuer') OR 'desk.admin' = ANY("permissions")) AND NOT ('desk.reports' = ANY("permissions"));--> statement-breakpoint
-- The two support roles (DESK-PLAN.md §4.3, §7 default 1). Kept in step with SYSTEM_ROLES in lib/permissions.ts.
INSERT INTO "roles" ("key", "name", "name_ar", "description", "permissions", "is_system") VALUES
  ('support_agent', 'Support agent', 'موظف دعم',
   'Works the app desk: queue, chats, tickets and requests. Passports stay masked; no ticket issuing or refunds.',
   ARRAY['desk.view', 'desk.act', 'desk.ask.read'], true),
  ('support_lead', 'Support lead', 'قائد فريق الدعم',
   'Runs the app desk: agents, rota, saved replies and performance; issues tickets, approves refunds, reassigns and merges. Full passports behind an audited reveal.',
   ARRAY['desk.view', 'desk.act', 'desk.ask.read', 'desk.issue', 'desk.refund', 'desk.moderate', 'desk.admin', 'desk.tickets.manage', 'desk.reports'], true)
  ON CONFLICT ("key") DO NOTHING;
