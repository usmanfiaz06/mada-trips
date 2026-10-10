ALTER TABLE "app_users" ADD COLUMN "supabase_user_id" text;--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN "phone_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN "auth_providers" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "app_users_supabase_key" ON "app_users" USING btree ("supabase_user_id") WHERE "app_users"."supabase_user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "app_users_email_idx" ON "app_users" USING btree (lower("email"));--> statement-breakpoint
-- Numbers already on accounts were proven by a sign-in code; Apple and Google accounts carry their provider.
UPDATE "app_users" SET "phone_verified" = true WHERE "phone" IS NOT NULL;--> statement-breakpoint
UPDATE "app_users" SET "auth_providers" = array_remove(ARRAY[
  CASE WHEN "phone" IS NOT NULL THEN 'phone' END,
  CASE WHEN "apple_sub" IS NOT NULL THEN 'apple' END,
  CASE WHEN "google_sub" IS NOT NULL THEN 'google' END
]::text[], NULL);
