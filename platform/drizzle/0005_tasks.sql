CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"assignee_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"due_date" date,
	"waiting_on" text,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"link_type" text,
	"link_id" uuid,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_assignee_status_idx" ON "tasks" USING btree ("assignee_id","status");--> statement-breakpoint
CREATE INDEX "tasks_due_idx" ON "tasks" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "tasks_link_idx" ON "tasks" USING btree ("link_type","link_id");--> statement-breakpoint
-- Partners see and assign everyone's tasks.
UPDATE "roles" SET "permissions" = array_append("permissions", 'tasks.manage')
  WHERE "key" IN ('partner', 'partner_issuer') AND NOT ('tasks.manage' = ANY("permissions"));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_values_ok" CHECK (
  "status" IN ('open','in_progress','waiting','done','cancelled') AND "priority" IN ('normal','high','urgent')
  AND char_length("title") BETWEEN 2 AND 160 AND ("link_type" IS NULL OR "link_type" IN ('booking','client','expense')));
