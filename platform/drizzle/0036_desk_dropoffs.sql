CREATE TABLE "app_dropoff_marks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"note" text,
	"by_ops_user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_search_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"value" bigint,
	"results" integer,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_dropoff_marks" ADD CONSTRAINT "app_dropoff_marks_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_dropoff_marks" ADD CONSTRAINT "app_dropoff_marks_by_ops_user_id_users_id_fk" FOREIGN KEY ("by_ops_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_search_log" ADD CONSTRAINT "app_search_log_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_dropoff_marks_key_idx" ON "app_dropoff_marks" USING btree ("key","at");--> statement-breakpoint
CREATE INDEX "app_dropoff_marks_user_idx" ON "app_dropoff_marks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "app_search_log_user_idx" ON "app_search_log" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "app_search_log_at_idx" ON "app_search_log" USING btree ("at");