CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"source" text NOT NULL,
	"session_key" text,
	"name" text,
	"email" text,
	"phone" text,
	"services" text[] DEFAULT '{}' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"message" text,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lang" text,
	"page" text,
	"status" text DEFAULT 'new' NOT NULL,
	"assigned_to" uuid,
	"notes" text,
	"client_id" uuid,
	"user_agent" text,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leads_created_idx" ON "leads" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "leads_session_idx" ON "leads" USING btree ("source","session_key");--> statement-breakpoint
CREATE INDEX "leads_ip_idx" ON "leads" USING btree ("ip_hash","created_at");--> statement-breakpoint
-- Whoever handles clients also works website leads.
UPDATE "roles" SET "permissions" = array_append("permissions", 'leads.view')
  WHERE 'clients.manage' = ANY("permissions") AND NOT ('leads.view' = ANY("permissions"));--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'leads.manage')
  WHERE 'clients.manage' = ANY("permissions") AND NOT ('leads.manage' = ANY("permissions"));--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_values_ok" CHECK (
  "status" IN ('new','contacted','qualified','won','lost') AND "source" IN ('chat','form')
  AND ("lang" IS NULL OR "lang" IN ('en','ar')));
