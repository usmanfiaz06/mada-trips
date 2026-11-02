CREATE TABLE IF NOT EXISTS "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"for_name" text,
	"doc_date" date NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_created_idx" ON "documents" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_type_idx" ON "documents" ("type");
--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'documents.issue')
 WHERE "key" IN ('partner', 'partner_issuer', 'retail_agent', 'corporate_agent') AND NOT ('documents.issue' = ANY("permissions"));
