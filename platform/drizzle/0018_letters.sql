CREATE TABLE IF NOT EXISTS "letters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"subject" text NOT NULL,
	"recipient" text,
	"letter_date" date NOT NULL,
	"body_html" text DEFAULT '' NOT NULL,
	"design" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "letters_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "letters" ADD CONSTRAINT "letters_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "letters_created_idx" ON "letters" ("created_at");
--> statement-breakpoint
UPDATE "roles" SET "permissions" = array_append("permissions", 'letters.manage')
 WHERE "key" IN ('partner', 'partner_issuer') AND NOT ('letters.manage' = ANY("permissions"));
