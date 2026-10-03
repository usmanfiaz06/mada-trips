-- Record which partner physically made a manual deposit / withdrawal / transfer, so each
-- bank movement can be mapped to the person who did it.
ALTER TABLE "bank_transactions" ADD COLUMN "partner_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;
