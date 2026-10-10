-- Circles (src/db/app-schema-circles.ts). Pending: the lead folds this into one generated migration.
CREATE TABLE IF NOT EXISTS "app_circle_details" (
	"circle_id" uuid PRIMARY KEY NOT NULL REFERENCES "app_circles"("id") ON DELETE cascade,
	"cover" text,
	"dest" text,
	"dm" boolean DEFAULT false NOT NULL,
	"dm_key" text,
	"pinned_plan" text,
	"pinned_by" uuid REFERENCES "app_users"("id") ON DELETE set null,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_circle_details_dm_key" ON "app_circle_details" ("dm_key") WHERE "dm_key" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_circle_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"circle_id" uuid REFERENCES "app_circles"("id") ON DELETE cascade,
	"inviter_id" uuid NOT NULL REFERENCES "app_users"("id") ON DELETE cascade,
	"invitee_user_id" uuid REFERENCES "app_users"("id") ON DELETE cascade,
	"phone_hash" text,
	"phone_masked" text,
	"phone_enc" text,
	"channel" text NOT NULL,
	"lookup" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"accepted_by" uuid REFERENCES "app_users"("id") ON DELETE set null,
	"reminded_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_circle_invites_lookup_key" ON "app_circle_invites" ("lookup") WHERE "lookup" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_circle_invites_circle_idx" ON "app_circle_invites" ("circle_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_circle_invites_invitee_idx" ON "app_circle_invites" ("invitee_user_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_circle_invites_inviter_idx" ON "app_circle_invites" ("inviter_id","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_circle_votes" (
	"message_id" uuid NOT NULL REFERENCES "app_messages"("id") ON DELETE cascade,
	"user_id" uuid NOT NULL REFERENCES "app_users"("id") ON DELETE cascade,
	"option_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_circle_votes_message_id_user_id_pk" PRIMARY KEY("message_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_circle_split_shares" (
	"message_id" uuid NOT NULL REFERENCES "app_messages"("id") ON DELETE cascade,
	"key" text NOT NULL,
	"user_ids" uuid[] NOT NULL,
	"amount" bigint NOT NULL,
	"paid_at" timestamp with time zone,
	"paid_via" text,
	"marked_by" uuid REFERENCES "app_users"("id") ON DELETE set null,
	"payment_id" uuid,
	CONSTRAINT "app_circle_split_shares_message_id_key_pk" PRIMARY KEY("message_id","key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_friendships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" uuid NOT NULL REFERENCES "app_users"("id") ON DELETE cascade,
	"addressee_id" uuid NOT NULL REFERENCES "app_users"("id") ON DELETE cascade,
	"status" text DEFAULT 'pending' NOT NULL,
	"requester_tag" text,
	"addressee_tag" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "app_friendships_not_self" CHECK ("requester_id" <> "addressee_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_friendships_pair_key" ON "app_friendships" (least("requester_id","addressee_id"),greatest("requester_id","addressee_id"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_friendships_addressee_idx" ON "app_friendships" ("addressee_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_friendships_requester_idx" ON "app_friendships" ("requester_id","status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_follows" (
	"follower_id" uuid NOT NULL REFERENCES "app_users"("id") ON DELETE cascade,
	"followee_id" uuid NOT NULL REFERENCES "app_users"("id") ON DELETE cascade,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_follows_follower_id_followee_id_pk" PRIMARY KEY("follower_id","followee_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_follows_followee_idx" ON "app_follows" ("followee_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_blocks" (
	"blocker_id" uuid NOT NULL REFERENCES "app_users"("id") ON DELETE cascade,
	"blocked_id" uuid NOT NULL REFERENCES "app_users"("id") ON DELETE cascade,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_blocks_blocker_id_blocked_id_pk" PRIMARY KEY("blocker_id","blocked_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_blocks_blocked_idx" ON "app_blocks" ("blocked_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL REFERENCES "app_users"("id") ON DELETE cascade,
	"city" text NOT NULL,
	"place" text NOT NULL,
	"body" text NOT NULL,
	"kind" text NOT NULL,
	"audience" text NOT NULL,
	"photo_key" text,
	"has_photo" boolean DEFAULT false NOT NULL,
	"photo_consent" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"auto_approve_at" timestamp with time zone,
	"flagged" text,
	"moderated_at" timestamp with time zone,
	"moderated_by" text,
	"moderation_note" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_posts_city_idx" ON "app_posts" ("city","status","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_posts_author_idx" ON "app_posts" ("author_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_posts_status_idx" ON "app_posts" ("status","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_post_photos" (
	"post_id" uuid PRIMARY KEY NOT NULL REFERENCES "app_posts"("id") ON DELETE cascade,
	"mime" text NOT NULL,
	"data" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_post_thanks" (
	"post_id" uuid NOT NULL REFERENCES "app_posts"("id") ON DELETE cascade,
	"user_id" uuid NOT NULL REFERENCES "app_users"("id") ON DELETE cascade,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_post_thanks_post_id_user_id_pk" PRIMARY KEY("post_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_saved" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "app_users"("id") ON DELETE cascade,
	"kind" text NOT NULL,
	"ref_id" text NOT NULL,
	"city" text NOT NULL,
	"snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_saved_key" ON "app_saved" ("user_id","kind","ref_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_saved_ref_idx" ON "app_saved" ("kind","ref_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid NOT NULL REFERENCES "app_users"("id") ON DELETE cascade,
	"target_kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"target_user_id" uuid REFERENCES "app_users"("id") ON DELETE set null,
	"reason" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_reports_status_idx" ON "app_reports" ("status","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_presence" (
	"user_id" uuid PRIMARY KEY NOT NULL REFERENCES "app_users"("id") ON DELETE cascade,
	"city" text NOT NULL,
	"from_date" date,
	"to_date" date,
	"audience" text NOT NULL,
	"audience_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_presence_marks" (
	"user_id" uuid NOT NULL REFERENCES "app_users"("id") ON DELETE cascade,
	"other_id" uuid NOT NULL REFERENCES "app_users"("id") ON DELETE cascade,
	"mark" text NOT NULL,
	"city" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_presence_marks_user_id_other_id_pk" PRIMARY KEY("user_id","other_id")
);
