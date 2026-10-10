-- Wallet and account (src/db/app-schema-wallet.ts). Pending: the lead folds this into one generated migration.
CREATE TABLE IF NOT EXISTS "app_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL REFERENCES "app_users"("id") ON DELETE cascade,
	"purpose" text NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage" text NOT NULL,
	"storage_key" text NOT NULL,
	"key_enc" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_files_owner_idx" ON "app_files" ("owner_id","purpose");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL REFERENCES "app_users"("id") ON DELETE cascade,
	"person_id" uuid NOT NULL REFERENCES "app_people"("id") ON DELETE cascade,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"valid_until" date,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"file_id" uuid REFERENCES "app_files"("id") ON DELETE set null,
	"source" text DEFAULT 'upload' NOT NULL,
	"removable" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_documents_owner_idx" ON "app_documents" ("owner_id","person_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_document_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL REFERENCES "app_documents"("id") ON DELETE cascade,
	"owner_id" uuid NOT NULL REFERENCES "app_users"("id") ON DELETE cascade,
	"trip_id" uuid REFERENCES "app_trips"("id") ON DELETE set null,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_document_grants_doc_idx" ON "app_document_grants" ("document_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_person_details" (
	"person_id" uuid PRIMARY KEY NOT NULL REFERENCES "app_people"("id") ON DELETE cascade,
	"relation_label" text,
	"meal" text,
	"iqama_enc" text,
	"iqama_masked" text,
	"iqama_at" timestamp with time zone,
	"exit_kind" text DEFAULT 'none' NOT NULL,
	"exit_until" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL REFERENCES "app_users"("id") ON DELETE cascade,
	"preferred_name" text,
	"preferred_at" timestamp with time zone,
	"home" text DEFAULT 'RUH' NOT NULL,
	"home_at" timestamp with time zone,
	"currency" text DEFAULT 'SAR' NOT NULL,
	"arabic_notify" boolean DEFAULT false NOT NULL,
	"prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"face_id" boolean DEFAULT true NOT NULL,
	"marketing" boolean DEFAULT false NOT NULL,
	"analytics" boolean DEFAULT true NOT NULL,
	"photo_file_id" uuid REFERENCES "app_files"("id") ON DELETE set null,
	"photo_at" timestamp with time zone,
	"email_verified_at" timestamp with time zone,
	"phone_verified_at" timestamp with time zone,
	"default_card" text DEFAULT 'applepay' NOT NULL,
	"delete_at" timestamp with time zone,
	"export_requested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_accounts_delete_idx" ON "app_accounts" ("delete_at") WHERE "delete_at" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_consent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "app_users"("id") ON DELETE cascade,
	"consent" text NOT NULL,
	"granted" boolean NOT NULL,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_consent_events_user_idx" ON "app_consent_events" ("user_id","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_email_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "app_users"("id") ON DELETE cascade,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_email_codes_user_idx" ON "app_email_codes" ("user_id","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "app_users"("id") ON DELETE cascade,
	"brand" text NOT NULL,
	"last4" text NOT NULL,
	"exp" text NOT NULL,
	"provider" text NOT NULL,
	"token_enc" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_cards_user_idx" ON "app_cards" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_data_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "app_users"("id") ON DELETE cascade,
	"email" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"file_id" uuid REFERENCES "app_files"("id") ON DELETE set null,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_data_exports_user_idx" ON "app_data_exports" ("user_id","requested_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_support_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "app_users"("id") ON DELETE cascade,
	"trip_id" uuid REFERENCES "app_trips"("id") ON DELETE set null,
	"about" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"user_read_at" timestamp with time zone,
	"agent_read_at" timestamp with time zone,
	"assigned_ops_user_id" uuid,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_support_threads_user_key" ON "app_support_threads" ("user_id") WHERE "trip_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_support_threads_trip_key" ON "app_support_threads" ("user_id","trip_id") WHERE "trip_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_support_threads_last_idx" ON "app_support_threads" ("status","last_message_at");
--> statement-breakpoint
DROP TRIGGER IF EXISTS app_consent_events_no_update ON app_consent_events;
--> statement-breakpoint
CREATE TRIGGER app_consent_events_no_update BEFORE UPDATE ON app_consent_events
  FOR EACH ROW EXECUTE FUNCTION app_append_only();
