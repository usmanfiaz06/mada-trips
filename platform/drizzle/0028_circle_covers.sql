ALTER TABLE "app_circle_details" ADD COLUMN "cover_kind" text;--> statement-breakpoint
ALTER TABLE "app_circle_details" ADD COLUMN "cover_icon" text;--> statement-breakpoint
ALTER TABLE "app_circle_details" ADD COLUMN "cover_color" text;--> statement-breakpoint
ALTER TABLE "app_circle_details" ADD COLUMN "cover_file_id" uuid;--> statement-breakpoint
ALTER TABLE "app_circle_details" ADD COLUMN "cover_status" text;--> statement-breakpoint
ALTER TABLE "app_circle_details" ADD COLUMN "cover_by" uuid;--> statement-breakpoint
ALTER TABLE "app_circle_details" ADD COLUMN "cover_auto_approve_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_circle_details" ADD COLUMN "cover_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_circle_details" ADD COLUMN "cover_checked_by" text;--> statement-breakpoint
ALTER TABLE "app_circle_details" ADD COLUMN "cover_note" text;--> statement-breakpoint
ALTER TABLE "app_circle_details" ADD CONSTRAINT "app_circle_details_cover_by_app_users_id_fk" FOREIGN KEY ("cover_by") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_circle_details_cover_queue_idx" ON "app_circle_details" USING btree ("cover_status","created_at") WHERE "app_circle_details"."cover_status" = 'pending';--> statement-breakpoint
ALTER TABLE "app_circle_details" ADD CONSTRAINT "app_circle_details_cover_kind" CHECK ("app_circle_details"."cover_kind" IS NULL OR "app_circle_details"."cover_kind" IN ('icon', 'photo', 'upload'));--> statement-breakpoint
ALTER TABLE "app_circle_details" ADD CONSTRAINT "app_circle_details_cover_status" CHECK ("app_circle_details"."cover_status" IS NULL OR "app_circle_details"."cover_status" IN ('pending', 'approved', 'rejected'));--> statement-breakpoint
-- Older circles: a cover key is one of the photos we ship; no cover stays plain green.
UPDATE "app_circle_details" SET "cover_kind" = 'photo' WHERE "cover" IN ('istanbul', 'alula', 'riyadh') AND "cover_kind" IS NULL;
