-- Each corporate workspace gets a short, shareable sign-in address: madatrips.sa/corporate/<slug>.
ALTER TABLE "clients" ADD COLUMN "portal_slug" text;--> statement-breakpoint
CREATE UNIQUE INDEX "clients_portal_slug_once" ON "clients" USING btree ("portal_slug") WHERE "portal_slug" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_portal_slug_ok" CHECK ("portal_slug" IS NULL OR ("portal_slug" ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$' AND "portal_slug" <> 'login'));
