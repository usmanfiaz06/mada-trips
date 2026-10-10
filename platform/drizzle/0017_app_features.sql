-- Places search needs two contrib extensions: pg_trgm (fuzzy and substring matching) and unaccent (é = e).
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;--> statement-breakpoint
-- unaccent() is only STABLE (its dictionary could change), so indexes and the search use this IMMUTABLE wrapper.
CREATE OR REPLACE FUNCTION app_places_norm(t text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, t)) $$;--> statement-breakpoint
CREATE TABLE "app_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"supplier" text NOT NULL,
	"supplier_offer_id" text NOT NULL,
	"search" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"total" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_name" text,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"step" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"draft" jsonb NOT NULL,
	"snapshot" jsonb NOT NULL,
	"lines" jsonb NOT NULL,
	"traveller_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"subtotal" bigint NOT NULL,
	"discount" bigint DEFAULT 0 NOT NULL,
	"promo" text,
	"credit_used" bigint DEFAULT 0 NOT NULL,
	"total" bigint NOT NULL,
	"extra" bigint DEFAULT 0 NOT NULL,
	"plan" text DEFAULT 'full' NOT NULL,
	"payment_label" text NOT NULL,
	"payment_method" jsonb NOT NULL,
	"payment_id" uuid,
	"request_id" uuid,
	"trip_id" uuid,
	"ref" text,
	"supplier_ref" text,
	"agent_name" text,
	"confirmed_by_name" text,
	"question" jsonb,
	"fare_change" jsonb,
	"problem" text,
	"otp_tries" integer DEFAULT 0 NOT NULL,
	"demo" text[] DEFAULT '{}'::text[] NOT NULL,
	"autopilot_at" timestamp with time zone,
	"autopilot_done" text[] DEFAULT '{}'::text[] NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_payment_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"provider_ref" text NOT NULL,
	"payload_sha256" text NOT NULL,
	"result" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_trip_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"lines" jsonb NOT NULL,
	"paid" jsonb NOT NULL,
	"pay_plan" text DEFAULT 'full' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"booked_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_blocks" (
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_blocks_blocker_id_blocked_id_pk" PRIMARY KEY("blocker_id","blocked_id")
);
--> statement-breakpoint
CREATE TABLE "app_circle_details" (
	"circle_id" uuid PRIMARY KEY NOT NULL,
	"cover" text,
	"dest" text,
	"dm" boolean DEFAULT false NOT NULL,
	"dm_key" text,
	"pinned_plan" text,
	"pinned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_circle_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"circle_id" uuid,
	"inviter_id" uuid NOT NULL,
	"invitee_user_id" uuid,
	"phone_hash" text,
	"phone_masked" text,
	"phone_enc" text,
	"channel" text NOT NULL,
	"lookup" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"accepted_by" uuid,
	"reminded_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_circle_split_shares" (
	"message_id" uuid NOT NULL,
	"key" text NOT NULL,
	"user_ids" uuid[] NOT NULL,
	"amount" bigint NOT NULL,
	"paid_at" timestamp with time zone,
	"paid_via" text,
	"marked_by" uuid,
	"payment_id" uuid,
	CONSTRAINT "app_circle_split_shares_message_id_key_pk" PRIMARY KEY("message_id","key")
);
--> statement-breakpoint
CREATE TABLE "app_circle_votes" (
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"option_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_circle_votes_message_id_user_id_pk" PRIMARY KEY("message_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "app_follows" (
	"follower_id" uuid NOT NULL,
	"followee_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_follows_follower_id_followee_id_pk" PRIMARY KEY("follower_id","followee_id")
);
--> statement-breakpoint
CREATE TABLE "app_friendships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" uuid NOT NULL,
	"addressee_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requester_tag" text,
	"addressee_tag" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "app_friendships_not_self" CHECK ("app_friendships"."requester_id" <> "app_friendships"."addressee_id")
);
--> statement-breakpoint
CREATE TABLE "app_post_photos" (
	"post_id" uuid PRIMARY KEY NOT NULL,
	"mime" text NOT NULL,
	"data" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_post_thanks" (
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_post_thanks_post_id_user_id_pk" PRIMARY KEY("post_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "app_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"city" text NOT NULL,
	"place" text NOT NULL,
	"body" text NOT NULL,
	"kind" text NOT NULL,
	"audience" text NOT NULL,
	"photo_key" text,
	"has_photo" boolean DEFAULT false NOT NULL,
	"photo_consent" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"auto_approve_at" timestamp with time zone,
	"flagged" text,
	"moderated_at" timestamp with time zone,
	"moderated_by" text,
	"moderation_note" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_presence" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"city" text NOT NULL,
	"from_date" date,
	"to_date" date,
	"audience" text NOT NULL,
	"audience_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_presence_marks" (
	"user_id" uuid NOT NULL,
	"other_id" uuid NOT NULL,
	"mark" text NOT NULL,
	"city" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_presence_marks_user_id_other_id_pk" PRIMARY KEY("user_id","other_id")
);
--> statement-breakpoint
CREATE TABLE "app_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"target_user_id" uuid,
	"reason" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_saved" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ref_id" text NOT NULL,
	"city" text NOT NULL,
	"snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_agent_assignments" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"assigned_by" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_agent_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"covering_for_id" uuid,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_agent_shifts_order" CHECK ("app_agent_shifts"."ends_at" > "app_agent_shifts"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "app_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ops_user_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"display_name_ar" text,
	"photo_url" text,
	"languages" text[] DEFAULT '{en,ar}'::text[] NOT NULL,
	"pronoun" text DEFAULT 'he' NOT NULL,
	"status" text DEFAULT 'offline' NOT NULL,
	"status_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reply_minutes" integer DEFAULT 2 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_desk_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"blocked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lifted_at" timestamp with time zone,
	"lifted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "app_desk_canned" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body_en" text NOT NULL,
	"body_ar" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_desk_disruptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flight_number" text NOT NULL,
	"date" text NOT NULL,
	"status" text NOT NULL,
	"plan" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"voucher_amount" bigint DEFAULT 0 NOT NULL,
	"user_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"pushed_by" uuid,
	"agent_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_desk_items" (
	"item_kind" text NOT NULL,
	"item_id" text NOT NULL,
	"assigned_agent_id" uuid,
	"assigned_by" uuid,
	"assigned_at" timestamp with time zone,
	"escalated_at" timestamp with time zone,
	"escalated_by" uuid,
	"escalation_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_desk_items_item_kind_item_id_pk" PRIMARY KEY("item_kind","item_id")
);
--> statement-breakpoint
CREATE TABLE "app_desk_moderation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"author_user_id" uuid,
	"reporter_user_id" uuid,
	"reason" text,
	"note" text,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_desk_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_kind" text NOT NULL,
	"thread_id" uuid NOT NULL,
	"ops_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_desk_typing" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"thread_kind" text NOT NULL,
	"thread_id" uuid NOT NULL,
	"until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_place_airports" (
	"iata" text PRIMARY KEY NOT NULL,
	"icao" text,
	"name" text NOT NULL,
	"municipality" text,
	"country_code" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"size" text NOT NULL,
	"city_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_place_countries" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"capital" text,
	"continent" text,
	"currency_code" text,
	"currency_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_place_guides" (
	"place_id" integer PRIMARY KEY NOT NULL,
	"guide" jsonb NOT NULL,
	"status" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"refreshing_at" timestamp with time zone,
	"last_problem" text
);
--> statement-breakpoint
CREATE TABLE "app_place_names" (
	"place_id" integer NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"norm" text NOT NULL,
	"label" text,
	"rank" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "app_place_names_pk" PRIMARY KEY("place_id","kind","norm")
);
--> statement-breakpoint
CREATE TABLE "app_place_plans" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"place_id" integer NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_places" (
	"id" integer PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"region" text,
	"country_code" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"timezone" text NOT NULL,
	"population" bigint DEFAULT 0 NOT NULL,
	"feature_code" text NOT NULL,
	"is_capital" boolean DEFAULT false NOT NULL,
	"airports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"iata" text,
	"curation" text DEFAULT 'basic' NOT NULL,
	"served" boolean DEFAULT false NOT NULL,
	"photo" text,
	"booking_key" text,
	"wikipedia_title" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_idempotency_keys" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"request_hash" text NOT NULL,
	"state" text DEFAULT 'running' NOT NULL,
	"response_status" integer,
	"response_body" text,
	"response_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "app_idempotency_keys_scope_key_pk" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
CREATE TABLE "app_runtime" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_supplier_health" (
	"name" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"since" timestamp with time zone DEFAULT now() NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"last_problem" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_flight_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flight_number" text NOT NULL,
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"value" text,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_invoice_counters" (
	"series" text PRIMARY KEY NOT NULL,
	"next" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_invoice_details" (
	"invoice_id" uuid PRIMARY KEY NOT NULL,
	"charge_id" uuid,
	"kind" text NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"customer" text NOT NULL,
	"company" jsonb,
	"against_invoice_id" uuid,
	"paid_with" text,
	"lines" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_refund_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"trip_id" uuid,
	"title" text NOT NULL,
	"amount" bigint NOT NULL,
	"stage" text DEFAULT 'requested' NOT NULL,
	"destination" text NOT NULL,
	"provider" text,
	"card" text NOT NULL,
	"reason" text,
	"anyway" boolean DEFAULT false NOT NULL,
	"reject" text,
	"alt" text,
	"law" boolean DEFAULT false NOT NULL,
	"airline" text,
	"cancelled_count" integer DEFAULT 0 NOT NULL,
	"cancelled_amount" bigint DEFAULT 0 NOT NULL,
	"expected_by" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"client_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_refund_items" (
	"refund_id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"charge_id" uuid NOT NULL,
	"credited" bigint NOT NULL,
	"credit_note_id" uuid
);
--> statement-breakpoint
CREATE TABLE "app_tracked_extras" (
	"tracked_id" uuid PRIMARY KEY NOT NULL,
	"alerts" boolean DEFAULT false NOT NULL,
	"known" boolean DEFAULT false NOT NULL,
	"duration_min" integer,
	"brand" text,
	"last_alert_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app_trip_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"payment_id" uuid,
	"request_id" uuid,
	"item" text NOT NULL,
	"title" text NOT NULL,
	"sub" text DEFAULT '' NOT NULL,
	"amount" bigint NOT NULL,
	"method" text NOT NULL,
	"label" text,
	"plan" text DEFAULT 'full' NOT NULL,
	"instalments" jsonb,
	"credit_used" bigint DEFAULT 0 NOT NULL,
	"discount" bigint DEFAULT 0 NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"invoice_id" uuid,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_trip_facts" (
	"trip_id" uuid PRIMARY KEY NOT NULL,
	"agent_name" text DEFAULT 'Faisal' NOT NULL,
	"covering_name" text,
	"no_stay" jsonb,
	"company" jsonb,
	"rating" jsonb,
	"vouchers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bag_report" text,
	"rebooked" boolean DEFAULT false NOT NULL,
	"picks" text[] DEFAULT '{}'::text[] NOT NULL,
	"weather" jsonb,
	"disruption" jsonb,
	"stays" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pickups" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"segments" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"discount" bigint DEFAULT 0 NOT NULL,
	"booked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_trip_idempotency" (
	"owner_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_trip_idempotency_pk" PRIMARY KEY("owner_id","scope","key")
);
--> statement-breakpoint
CREATE TABLE "app_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
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
	"photo_file_id" uuid,
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
CREATE TABLE "app_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"brand" text NOT NULL,
	"last4" text NOT NULL,
	"exp" text NOT NULL,
	"provider" text NOT NULL,
	"token_enc" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_consent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"consent" text NOT NULL,
	"granted" boolean NOT NULL,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_data_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"file_id" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app_document_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"trip_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"valid_until" date,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"file_id" uuid,
	"source" text DEFAULT 'upload' NOT NULL,
	"removable" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_email_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
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
CREATE TABLE "app_person_details" (
	"person_id" uuid PRIMARY KEY NOT NULL,
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
CREATE TABLE "app_support_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"trip_id" uuid,
	"about" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"user_read_at" timestamp with time zone,
	"agent_read_at" timestamp with time zone,
	"assigned_ops_user_id" uuid,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_offers" ADD CONSTRAINT "app_offers_owner_id_app_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_order_events" ADD CONSTRAINT "app_order_events_order_id_app_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."app_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_orders" ADD CONSTRAINT "app_orders_owner_id_app_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_orders" ADD CONSTRAINT "app_orders_payment_id_app_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."app_payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_orders" ADD CONSTRAINT "app_orders_request_id_app_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."app_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_orders" ADD CONSTRAINT "app_orders_trip_id_app_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."app_trips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_trip_bookings" ADD CONSTRAINT "app_trip_bookings_trip_id_app_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."app_trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_trip_bookings" ADD CONSTRAINT "app_trip_bookings_order_id_app_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."app_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_blocks" ADD CONSTRAINT "app_blocks_blocker_id_app_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_blocks" ADD CONSTRAINT "app_blocks_blocked_id_app_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_circle_details" ADD CONSTRAINT "app_circle_details_circle_id_app_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."app_circles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_circle_details" ADD CONSTRAINT "app_circle_details_pinned_by_app_users_id_fk" FOREIGN KEY ("pinned_by") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_circle_invites" ADD CONSTRAINT "app_circle_invites_circle_id_app_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."app_circles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_circle_invites" ADD CONSTRAINT "app_circle_invites_inviter_id_app_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_circle_invites" ADD CONSTRAINT "app_circle_invites_invitee_user_id_app_users_id_fk" FOREIGN KEY ("invitee_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_circle_invites" ADD CONSTRAINT "app_circle_invites_accepted_by_app_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_circle_split_shares" ADD CONSTRAINT "app_circle_split_shares_message_id_app_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."app_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_circle_split_shares" ADD CONSTRAINT "app_circle_split_shares_marked_by_app_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_circle_votes" ADD CONSTRAINT "app_circle_votes_message_id_app_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."app_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_circle_votes" ADD CONSTRAINT "app_circle_votes_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_follows" ADD CONSTRAINT "app_follows_follower_id_app_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_follows" ADD CONSTRAINT "app_follows_followee_id_app_users_id_fk" FOREIGN KEY ("followee_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_friendships" ADD CONSTRAINT "app_friendships_requester_id_app_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_friendships" ADD CONSTRAINT "app_friendships_addressee_id_app_users_id_fk" FOREIGN KEY ("addressee_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_post_photos" ADD CONSTRAINT "app_post_photos_post_id_app_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."app_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_post_thanks" ADD CONSTRAINT "app_post_thanks_post_id_app_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."app_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_post_thanks" ADD CONSTRAINT "app_post_thanks_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_posts" ADD CONSTRAINT "app_posts_author_id_app_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_presence" ADD CONSTRAINT "app_presence_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_presence_marks" ADD CONSTRAINT "app_presence_marks_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_presence_marks" ADD CONSTRAINT "app_presence_marks_other_id_app_users_id_fk" FOREIGN KEY ("other_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_reports" ADD CONSTRAINT "app_reports_reporter_id_app_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_reports" ADD CONSTRAINT "app_reports_target_user_id_app_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_saved" ADD CONSTRAINT "app_saved_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_agent_assignments" ADD CONSTRAINT "app_agent_assignments_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_agent_assignments" ADD CONSTRAINT "app_agent_assignments_agent_id_app_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."app_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_agent_assignments" ADD CONSTRAINT "app_agent_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_agent_shifts" ADD CONSTRAINT "app_agent_shifts_agent_id_app_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."app_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_agent_shifts" ADD CONSTRAINT "app_agent_shifts_covering_for_id_app_agents_id_fk" FOREIGN KEY ("covering_for_id") REFERENCES "public"."app_agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_agent_shifts" ADD CONSTRAINT "app_agent_shifts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_agents" ADD CONSTRAINT "app_agents_ops_user_id_users_id_fk" FOREIGN KEY ("ops_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_desk_blocks" ADD CONSTRAINT "app_desk_blocks_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_desk_blocks" ADD CONSTRAINT "app_desk_blocks_blocked_by_users_id_fk" FOREIGN KEY ("blocked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_desk_blocks" ADD CONSTRAINT "app_desk_blocks_lifted_by_users_id_fk" FOREIGN KEY ("lifted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_desk_canned" ADD CONSTRAINT "app_desk_canned_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_desk_disruptions" ADD CONSTRAINT "app_desk_disruptions_pushed_by_users_id_fk" FOREIGN KEY ("pushed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_desk_items" ADD CONSTRAINT "app_desk_items_assigned_agent_id_app_agents_id_fk" FOREIGN KEY ("assigned_agent_id") REFERENCES "public"."app_agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_desk_items" ADD CONSTRAINT "app_desk_items_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_desk_items" ADD CONSTRAINT "app_desk_items_escalated_by_users_id_fk" FOREIGN KEY ("escalated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_desk_moderation" ADD CONSTRAINT "app_desk_moderation_author_user_id_app_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_desk_moderation" ADD CONSTRAINT "app_desk_moderation_reporter_user_id_app_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_desk_moderation" ADD CONSTRAINT "app_desk_moderation_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_desk_notes" ADD CONSTRAINT "app_desk_notes_ops_user_id_users_id_fk" FOREIGN KEY ("ops_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_desk_typing" ADD CONSTRAINT "app_desk_typing_agent_id_app_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."app_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_place_airports" ADD CONSTRAINT "app_place_airports_city_id_app_places_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."app_places"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_place_guides" ADD CONSTRAINT "app_place_guides_place_id_app_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."app_places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_place_names" ADD CONSTRAINT "app_place_names_place_id_app_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."app_places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_place_plans" ADD CONSTRAINT "app_place_plans_request_id_app_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."app_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_place_plans" ADD CONSTRAINT "app_place_plans_place_id_app_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."app_places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_place_plans" ADD CONSTRAINT "app_place_plans_owner_id_app_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_places" ADD CONSTRAINT "app_places_country_code_app_place_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."app_place_countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_invoice_details" ADD CONSTRAINT "app_invoice_details_invoice_id_app_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."app_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_invoice_details" ADD CONSTRAINT "app_invoice_details_charge_id_app_trip_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."app_trip_charges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_invoice_details" ADD CONSTRAINT "app_invoice_details_against_invoice_id_app_invoices_id_fk" FOREIGN KEY ("against_invoice_id") REFERENCES "public"."app_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_refund_groups" ADD CONSTRAINT "app_refund_groups_owner_id_app_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_refund_groups" ADD CONSTRAINT "app_refund_groups_trip_id_app_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."app_trips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_refund_items" ADD CONSTRAINT "app_refund_items_refund_id_app_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."app_refunds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_refund_items" ADD CONSTRAINT "app_refund_items_group_id_app_refund_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."app_refund_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_refund_items" ADD CONSTRAINT "app_refund_items_charge_id_app_trip_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."app_trip_charges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_refund_items" ADD CONSTRAINT "app_refund_items_credit_note_id_app_invoices_id_fk" FOREIGN KEY ("credit_note_id") REFERENCES "public"."app_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_tracked_extras" ADD CONSTRAINT "app_tracked_extras_tracked_id_app_tracked_flights_id_fk" FOREIGN KEY ("tracked_id") REFERENCES "public"."app_tracked_flights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_trip_charges" ADD CONSTRAINT "app_trip_charges_trip_id_app_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."app_trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_trip_charges" ADD CONSTRAINT "app_trip_charges_owner_id_app_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_trip_charges" ADD CONSTRAINT "app_trip_charges_payment_id_app_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."app_payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_trip_charges" ADD CONSTRAINT "app_trip_charges_request_id_app_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."app_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_trip_charges" ADD CONSTRAINT "app_trip_charges_invoice_id_app_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."app_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_trip_facts" ADD CONSTRAINT "app_trip_facts_trip_id_app_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."app_trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_trip_idempotency" ADD CONSTRAINT "app_trip_idempotency_owner_id_app_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_accounts" ADD CONSTRAINT "app_accounts_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_accounts" ADD CONSTRAINT "app_accounts_photo_file_id_app_files_id_fk" FOREIGN KEY ("photo_file_id") REFERENCES "public"."app_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_cards" ADD CONSTRAINT "app_cards_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_consent_events" ADD CONSTRAINT "app_consent_events_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_data_exports" ADD CONSTRAINT "app_data_exports_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_data_exports" ADD CONSTRAINT "app_data_exports_file_id_app_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."app_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_document_grants" ADD CONSTRAINT "app_document_grants_document_id_app_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."app_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_document_grants" ADD CONSTRAINT "app_document_grants_owner_id_app_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_document_grants" ADD CONSTRAINT "app_document_grants_trip_id_app_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."app_trips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_documents" ADD CONSTRAINT "app_documents_owner_id_app_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_documents" ADD CONSTRAINT "app_documents_person_id_app_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."app_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_documents" ADD CONSTRAINT "app_documents_file_id_app_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."app_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_email_codes" ADD CONSTRAINT "app_email_codes_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_files" ADD CONSTRAINT "app_files_owner_id_app_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_person_details" ADD CONSTRAINT "app_person_details_person_id_app_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."app_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_support_threads" ADD CONSTRAINT "app_support_threads_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_support_threads" ADD CONSTRAINT "app_support_threads_trip_id_app_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."app_trips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_offers_owner_idx" ON "app_offers" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "app_order_events_order_idx" ON "app_order_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "app_orders_idem_key" ON "app_orders" USING btree ("owner_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "app_orders_owner_idx" ON "app_orders" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "app_orders_status_idx" ON "app_orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "app_payment_webhooks_event_key" ON "app_payment_webhooks" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX "app_trip_bookings_trip_idx" ON "app_trip_bookings" USING btree ("trip_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_trip_bookings_order_key" ON "app_trip_bookings" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "app_blocks_blocked_idx" ON "app_blocks" USING btree ("blocked_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_circle_details_dm_key" ON "app_circle_details" USING btree ("dm_key") WHERE "app_circle_details"."dm_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "app_circle_invites_lookup_key" ON "app_circle_invites" USING btree ("lookup") WHERE "app_circle_invites"."lookup" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "app_circle_invites_circle_idx" ON "app_circle_invites" USING btree ("circle_id","status");--> statement-breakpoint
CREATE INDEX "app_circle_invites_invitee_idx" ON "app_circle_invites" USING btree ("invitee_user_id","status");--> statement-breakpoint
CREATE INDEX "app_circle_invites_inviter_idx" ON "app_circle_invites" USING btree ("inviter_id","created_at");--> statement-breakpoint
CREATE INDEX "app_follows_followee_idx" ON "app_follows" USING btree ("followee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_friendships_pair_key" ON "app_friendships" USING btree (least("requester_id", "addressee_id"),greatest("requester_id", "addressee_id"));--> statement-breakpoint
CREATE INDEX "app_friendships_addressee_idx" ON "app_friendships" USING btree ("addressee_id","status");--> statement-breakpoint
CREATE INDEX "app_friendships_requester_idx" ON "app_friendships" USING btree ("requester_id","status");--> statement-breakpoint
CREATE INDEX "app_posts_city_idx" ON "app_posts" USING btree ("city","status","created_at");--> statement-breakpoint
CREATE INDEX "app_posts_author_idx" ON "app_posts" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE INDEX "app_posts_status_idx" ON "app_posts" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "app_reports_status_idx" ON "app_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "app_saved_key" ON "app_saved" USING btree ("user_id","kind","ref_id");--> statement-breakpoint
CREATE INDEX "app_saved_ref_idx" ON "app_saved" USING btree ("kind","ref_id");--> statement-breakpoint
CREATE INDEX "app_agent_assignments_agent_idx" ON "app_agent_assignments" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "app_agent_shifts_time_idx" ON "app_agent_shifts" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "app_agent_shifts_agent_idx" ON "app_agent_shifts" USING btree ("agent_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "app_agents_ops_user_key" ON "app_agents" USING btree ("ops_user_id");--> statement-breakpoint
CREATE INDEX "app_desk_blocks_user_idx" ON "app_desk_blocks" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_desk_blocks_one_active" ON "app_desk_blocks" USING btree ("user_id") WHERE "app_desk_blocks"."lifted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "app_desk_disruptions_flight_idx" ON "app_desk_disruptions" USING btree ("flight_number","date");--> statement-breakpoint
CREATE INDEX "app_desk_items_agent_idx" ON "app_desk_items" USING btree ("assigned_agent_id");--> statement-breakpoint
CREATE INDEX "app_desk_moderation_status_idx" ON "app_desk_moderation" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "app_desk_notes_thread_idx" ON "app_desk_notes" USING btree ("thread_kind","thread_id","created_at");--> statement-breakpoint
CREATE INDEX "app_desk_typing_thread_idx" ON "app_desk_typing" USING btree ("thread_kind","thread_id");--> statement-breakpoint
CREATE INDEX "app_place_airports_city_idx" ON "app_place_airports" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "app_place_guides_expires_idx" ON "app_place_guides" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "app_place_names_trgm_idx" ON "app_place_names" USING gin ("norm" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "app_place_names_prefix_idx" ON "app_place_names" USING btree ("norm" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "app_place_plans_place_idx" ON "app_place_plans" USING btree ("place_id","created_at");--> statement-breakpoint
CREATE INDEX "app_place_plans_owner_idx" ON "app_place_plans" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "app_places_slug_idx" ON "app_places" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "app_places_country_idx" ON "app_places" USING btree ("country_code","population");--> statement-breakpoint
CREATE INDEX "app_idempotency_expires_idx" ON "app_idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "app_flight_events_key" ON "app_flight_events" USING btree ("flight_number","day","kind","value");--> statement-breakpoint
CREATE INDEX "app_invoice_details_charge_idx" ON "app_invoice_details" USING btree ("charge_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_refund_groups_key" ON "app_refund_groups" USING btree ("owner_id","client_key");--> statement-breakpoint
CREATE INDEX "app_refund_groups_owner_idx" ON "app_refund_groups" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "app_refund_items_group_idx" ON "app_refund_items" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "app_refund_items_charge_idx" ON "app_refund_items" USING btree ("charge_id");--> statement-breakpoint
CREATE INDEX "app_trip_charges_trip_idx" ON "app_trip_charges" USING btree ("trip_id","paid_at");--> statement-breakpoint
CREATE INDEX "app_trip_charges_owner_idx" ON "app_trip_charges" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "app_accounts_delete_idx" ON "app_accounts" USING btree ("delete_at") WHERE "app_accounts"."delete_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "app_cards_user_idx" ON "app_cards" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "app_consent_events_user_idx" ON "app_consent_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "app_data_exports_user_idx" ON "app_data_exports" USING btree ("user_id","requested_at");--> statement-breakpoint
CREATE INDEX "app_document_grants_doc_idx" ON "app_document_grants" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "app_documents_owner_idx" ON "app_documents" USING btree ("owner_id","person_id");--> statement-breakpoint
CREATE INDEX "app_email_codes_user_idx" ON "app_email_codes" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "app_files_owner_idx" ON "app_files" USING btree ("owner_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "app_support_threads_user_key" ON "app_support_threads" USING btree ("user_id") WHERE "app_support_threads"."trip_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "app_support_threads_trip_key" ON "app_support_threads" USING btree ("user_id","trip_id") WHERE "app_support_threads"."trip_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "app_support_threads_last_idx" ON "app_support_threads" USING btree ("status","last_message_at");
--> statement-breakpoint
-- Consent events are evidence: rows can be added, never edited (deletes stay possible for account erasure).
CREATE TRIGGER app_consent_events_no_update BEFORE UPDATE ON app_consent_events
  FOR EACH ROW EXECUTE FUNCTION app_append_only();--> statement-breakpoint
-- Desk capabilities for the built-in roles. Partners get the whole desk; the Riyadh counter and the Pakistan desk
-- work it (view and act). Issuing, refunds, moderation and the rota stay with partners unless a role grants them.
UPDATE "roles" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['desk.view','desk.act','desk.issue','desk.refund','desk.moderate','desk.admin']))
	WHERE "key" IN ('partner','partner_issuer');--> statement-breakpoint
UPDATE "roles" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['desk.view','desk.act']))
	WHERE "key" IN ('retail_agent','corporate_agent');
