CREATE TABLE "app_recovery_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"old_kind" text NOT NULL,
	"old_value" text NOT NULL,
	"new_kind" text NOT NULL,
	"new_value" text NOT NULL,
	"note" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"matched_user_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_recovery_requests_kinds" CHECK ("app_recovery_requests"."old_kind" IN ('phone', 'email') AND "app_recovery_requests"."new_kind" IN ('phone', 'email')),
	CONSTRAINT "app_recovery_requests_status" CHECK ("app_recovery_requests"."status" IN ('open', 'approved', 'declined'))
);
--> statement-breakpoint
ALTER TABLE "app_recovery_requests" ADD CONSTRAINT "app_recovery_requests_matched_user_id_app_users_id_fk" FOREIGN KEY ("matched_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_recovery_requests" ADD CONSTRAINT "app_recovery_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_recovery_requests_status_idx" ON "app_recovery_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "app_recovery_requests_old_idx" ON "app_recovery_requests" USING btree ("old_value","created_at");--> statement-breakpoint
CREATE INDEX "app_recovery_requests_ip_idx" ON "app_recovery_requests" USING btree ("ip_hash","created_at");