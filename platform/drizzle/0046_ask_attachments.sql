ALTER TABLE "app_people" ADD COLUMN "passport_fingerprint" text;--> statement-breakpoint
ALTER TABLE "app_documents" ADD COLUMN "fingerprint" text;--> statement-breakpoint
CREATE INDEX "app_people_fingerprint_idx" ON "app_people" USING btree ("owner_id","passport_fingerprint");--> statement-breakpoint
CREATE INDEX "app_documents_fingerprint_idx" ON "app_documents" USING btree ("owner_id","fingerprint");--> statement-breakpoint
CREATE TABLE "app_ask_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid,
	"owner_id" uuid NOT NULL,
	"file_id" uuid,
	"kind_guess" text NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fields_enc" text,
	"fingerprint" text,
	"person_id" uuid,
	"document_id" uuid,
	"status" text DEFAULT 'read' NOT NULL,
	"wipe_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_doc_share_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"trip_id" uuid,
	"thread_id" uuid,
	"kind" text DEFAULT 'passport' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"person_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"answered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_ask_attachments" ADD CONSTRAINT "app_ask_attachments_thread_id_app_ask_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."app_ask_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_ask_attachments" ADD CONSTRAINT "app_ask_attachments_owner_id_app_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_ask_attachments" ADD CONSTRAINT "app_ask_attachments_file_id_app_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."app_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_ask_attachments" ADD CONSTRAINT "app_ask_attachments_person_id_app_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."app_people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_ask_attachments" ADD CONSTRAINT "app_ask_attachments_document_id_app_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."app_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_doc_share_requests" ADD CONSTRAINT "app_doc_share_requests_owner_id_app_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_doc_share_requests" ADD CONSTRAINT "app_doc_share_requests_to_user_id_app_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_doc_share_requests" ADD CONSTRAINT "app_doc_share_requests_trip_id_app_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."app_trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_doc_share_requests" ADD CONSTRAINT "app_doc_share_requests_thread_id_app_ask_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."app_ask_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_doc_share_requests" ADD CONSTRAINT "app_doc_share_requests_person_id_app_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."app_people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_ask_attachments_owner_idx" ON "app_ask_attachments" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "app_ask_attachments_thread_idx" ON "app_ask_attachments" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "app_ask_attachments_status_idx" ON "app_ask_attachments" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "app_doc_share_owner_idx" ON "app_doc_share_requests" USING btree ("owner_id","trip_id");--> statement-breakpoint
CREATE INDEX "app_doc_share_to_idx" ON "app_doc_share_requests" USING btree ("to_user_id","status");
-- Existing passports get their fingerprint from the documents job (lib/app/jobs.ts "documents"): it needs APP_DATA_KEY
-- to read each number once, which SQL can't.
