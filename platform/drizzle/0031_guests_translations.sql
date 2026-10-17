CREATE TABLE "app_translations" (
	"key" text NOT NULL,
	"lang" text NOT NULL,
	"source_hash" text NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_offers" ALTER COLUMN "owner_id" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "app_translations_key_lang_idx" ON "app_translations" USING btree ("key","lang");