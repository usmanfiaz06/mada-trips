ALTER TABLE "app_ask_threads" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "app_ask_threads" ADD COLUMN "titled_by" text;--> statement-breakpoint
ALTER TABLE "app_ask_threads" ADD COLUMN "trip_id" uuid;--> statement-breakpoint
ALTER TABLE "app_ask_threads" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_ask_threads" ADD COLUMN "last_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "app_ask_threads" ADD COLUMN "preview" text;--> statement-breakpoint
ALTER TABLE "app_ask_threads" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_ask_threads" ADD CONSTRAINT "app_ask_threads_trip_id_app_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."app_trips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_ask_threads_list_idx" ON "app_ask_threads" USING btree ("owner_id","archived_at","last_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "app_ask_threads_trip_idx" ON "app_ask_threads" USING btree ("owner_id","trip_id");--> statement-breakpoint
-- Existing chats: the list orders them by when they were last written, shows their last line (already redacted when it
-- was stored), and marks the full ones (60 turns) as ended. Titles stay null and are written on their next turn.
UPDATE "app_ask_threads" SET
  "last_at" = "updated_at",
  "preview" = (
    SELECT left(regexp_replace(x.e->>'text', '\s+', ' ', 'g'), 140)
    FROM jsonb_array_elements("transcript") WITH ORDINALITY AS x(e, n)
    WHERE coalesce(x.e->>'text', '') <> '' AND x.e->>'who' IN ('me', 'mada', 'agent')
    ORDER BY x.n DESC LIMIT 1
  ),
  "ended_at" = CASE WHEN "turns" >= 60 AND "mode" <> 'agent' THEN "updated_at" ELSE NULL END;
