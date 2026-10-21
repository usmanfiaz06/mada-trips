ALTER TABLE "app_ask_threads" ADD COLUMN "mode" text DEFAULT 'ai' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_ask_threads" ADD COLUMN "taken_by" uuid;--> statement-breakpoint
ALTER TABLE "app_ask_threads" ADD COLUMN "taken_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_ask_threads" ADD COLUMN "handed_off_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_ask_threads" ADD COLUMN "desk_note" text;--> statement-breakpoint
ALTER TABLE "app_ask_threads" ADD CONSTRAINT "app_ask_threads_taken_by_users_id_fk" FOREIGN KEY ("taken_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_ask_threads_updated_idx" ON "app_ask_threads" USING btree ("updated_at");--> statement-breakpoint
-- Threads the model already handed to the desk (talk_to_human in their history) count as handed off.
UPDATE "app_ask_threads" SET "handed_off_at" = "updated_at" WHERE position('talk_to_human' in "messages"::text) > 0;
