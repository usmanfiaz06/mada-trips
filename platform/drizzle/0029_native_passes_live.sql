CREATE TABLE "app_boarding_passes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"segment_id" uuid NOT NULL,
	"person_id" uuid,
	"passenger_name" text NOT NULL,
	"format" text NOT NULL,
	"message" text NOT NULL,
	"pnr" text NOT NULL,
	"seat" text NOT NULL,
	"sequence" text NOT NULL,
	"compartment" text NOT NULL,
	"source" text NOT NULL,
	"added_by" text,
	"file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_live_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"segment_id" uuid NOT NULL,
	"activity_id" text NOT NULL,
	"platform" text NOT NULL,
	"push_token" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"last_state" jsonb,
	"last_pushed_at" timestamp with time zone,
	"last_error" text,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_wallet_pass_versions" (
	"serial" text PRIMARY KEY NOT NULL,
	"pass_type_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_wallet_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" text NOT NULL,
	"push_token" text NOT NULL,
	"pass_type_id" text NOT NULL,
	"serial" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_boarding_passes" ADD CONSTRAINT "app_boarding_passes_owner_id_app_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_boarding_passes" ADD CONSTRAINT "app_boarding_passes_trip_id_app_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."app_trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_boarding_passes" ADD CONSTRAINT "app_boarding_passes_segment_id_app_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."app_segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_boarding_passes" ADD CONSTRAINT "app_boarding_passes_person_id_app_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."app_people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_boarding_passes" ADD CONSTRAINT "app_boarding_passes_file_id_app_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."app_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_live_activities" ADD CONSTRAINT "app_live_activities_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_live_activities" ADD CONSTRAINT "app_live_activities_trip_id_app_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."app_trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_live_activities" ADD CONSTRAINT "app_live_activities_segment_id_app_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."app_segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_boarding_passes_trip_idx" ON "app_boarding_passes" USING btree ("trip_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_boarding_passes_leg_key" ON "app_boarding_passes" USING btree ("segment_id","passenger_name");--> statement-breakpoint
CREATE UNIQUE INDEX "app_live_activities_activity_key" ON "app_live_activities" USING btree ("user_id","activity_id");--> statement-breakpoint
CREATE INDEX "app_live_activities_segment_idx" ON "app_live_activities" USING btree ("segment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_wallet_registrations_key" ON "app_wallet_registrations" USING btree ("device_id","pass_type_id","serial");--> statement-breakpoint
CREATE INDEX "app_wallet_registrations_serial_idx" ON "app_wallet_registrations" USING btree ("serial");