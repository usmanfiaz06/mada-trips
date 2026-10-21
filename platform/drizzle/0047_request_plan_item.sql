ALTER TABLE "app_requests" ADD COLUMN "plan_item_id" uuid;
--> statement-breakpoint
ALTER TABLE "app_requests" ADD CONSTRAINT "app_requests_plan_item_id_app_plan_items_id_fk" FOREIGN KEY ("plan_item_id") REFERENCES "public"."app_plan_items"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "app_requests_plan_item_idx" ON "app_requests" USING btree ("plan_item_id");
