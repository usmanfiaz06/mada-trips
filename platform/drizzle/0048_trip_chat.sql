ALTER TABLE "app_ask_threads" ADD COLUMN "kind" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_ask_threads" ADD CONSTRAINT "app_ask_threads_kind" CHECK ("app_ask_threads"."kind" IN ('private', 'trip'));--> statement-breakpoint
CREATE UNIQUE INDEX "app_ask_threads_trip_chat_idx" ON "app_ask_threads" USING btree ("trip_id") WHERE "app_ask_threads"."kind" = 'trip';
