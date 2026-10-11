CREATE TABLE "app_circle_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"circle_id" uuid NOT NULL,
	"user_id" uuid,
	"actor_id" uuid,
	"kind" text NOT NULL,
	"ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_circle_reactions" (
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_circle_reactions_message_id_user_id_emoji_pk" PRIMARY KEY("message_id","user_id","emoji")
);
--> statement-breakpoint
CREATE TABLE "app_rate_counters" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"n" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "app_rate_counters_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
ALTER TABLE "app_circle_invites" ADD COLUMN "max_uses" integer;--> statement-breakpoint
ALTER TABLE "app_circle_invites" ADD COLUMN "uses" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_circle_reactions" ADD CONSTRAINT "app_circle_reactions_message_id_app_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."app_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_circle_reactions" ADD CONSTRAINT "app_circle_reactions_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_circle_events_circle_idx" ON "app_circle_events" USING btree ("circle_id","id");--> statement-breakpoint
CREATE INDEX "app_circle_events_user_idx" ON "app_circle_events" USING btree ("user_id","id") WHERE "app_circle_events"."user_id" IS NOT NULL;--> statement-breakpoint
-- The live channel's feed: every change in a circle writes one app_circle_events row, from the database itself, so
-- no code path can forget (lib/app/circles/live.ts reads them). Rows name what changed, never the content.
CREATE OR REPLACE FUNCTION app_circle_event(p_circle uuid, p_kind text, p_ref text, p_actor uuid, p_user uuid) RETURNS void AS $$
BEGIN
  INSERT INTO app_circle_events (circle_id, kind, ref, actor_id, user_id) VALUES (p_circle, p_kind, p_ref, p_actor, p_user);
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_circle_events_messages() RETURNS trigger AS $$
BEGIN
  IF NEW.thread_kind = 'circle' THEN
    PERFORM app_circle_event(NEW.thread_id,
      CASE WHEN TG_OP = 'UPDATE' AND coalesce(NEW.card->>'t', '') IN ('vote', 'split') THEN NEW.card->>'t' ELSE 'message' END,
      NEW.id::text, NEW.author_user_id, NULL);
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER app_messages_circle_events AFTER INSERT OR UPDATE ON app_messages FOR EACH ROW EXECUTE FUNCTION app_circle_events_messages();--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_circle_events_on_message() RETURNS trigger AS $$
DECLARE r record; c uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  SELECT thread_id INTO c FROM app_messages WHERE id = r.message_id AND thread_kind = 'circle';
  IF c IS NOT NULL THEN PERFORM app_circle_event(c, TG_ARGV[0], r.message_id::text, r.user_id, NULL); END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER app_circle_votes_events AFTER INSERT OR UPDATE OR DELETE ON app_circle_votes FOR EACH ROW EXECUTE FUNCTION app_circle_events_on_message('vote');--> statement-breakpoint
CREATE TRIGGER app_circle_reactions_events AFTER INSERT OR DELETE ON app_circle_reactions FOR EACH ROW EXECUTE FUNCTION app_circle_events_on_message('reaction');--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_circle_events_split() RETURNS trigger AS $$
DECLARE c uuid;
BEGIN
  SELECT thread_id INTO c FROM app_messages WHERE id = NEW.message_id AND thread_kind = 'circle';
  IF c IS NOT NULL THEN PERFORM app_circle_event(c, 'split', NEW.message_id::text, NEW.marked_by, NULL); END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER app_circle_split_shares_events AFTER UPDATE ON app_circle_split_shares FOR EACH ROW EXECUTE FUNCTION app_circle_events_split();--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_circle_events_members() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM app_circle_event(NEW.circle_id, 'member', NEW.user_id::text, NEW.user_id, NEW.user_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM app_circle_event(OLD.circle_id, 'member', OLD.user_id::text, NULL, OLD.user_id);
  ELSE
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      PERFORM app_circle_event(NEW.circle_id, 'member', NEW.user_id::text, NULL, NULL);
    END IF;
    -- A read receipt moves only when the reader passed someone else's message.
    IF NEW.last_read_at IS NOT NULL AND NEW.last_read_at IS DISTINCT FROM OLD.last_read_at AND EXISTS (
      SELECT 1 FROM app_messages m WHERE m.thread_kind = 'circle' AND m.thread_id = NEW.circle_id
        AND m.created_at > coalesce(OLD.last_read_at, '-infinity'::timestamptz) AND m.created_at <= NEW.last_read_at
        AND m.author_user_id IS NOT NULL AND m.author_user_id <> NEW.user_id) THEN
      PERFORM app_circle_event(NEW.circle_id, 'read', NULL, NEW.user_id, NULL);
    END IF;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER app_circle_members_events AFTER INSERT OR UPDATE OR DELETE ON app_circle_members FOR EACH ROW EXECUTE FUNCTION app_circle_events_members();--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_circle_events_circles() RETURNS trigger AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN PERFORM app_circle_event(NEW.id, 'circle', NULL, NULL, NULL); END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER app_circles_events AFTER UPDATE ON app_circles FOR EACH ROW EXECUTE FUNCTION app_circle_events_circles();--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_circle_events_details() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.cover IS DISTINCT FROM OLD.cover OR NEW.dest IS DISTINCT FROM OLD.dest OR NEW.pinned_plan IS DISTINCT FROM OLD.pinned_plan THEN
    PERFORM app_circle_event(NEW.circle_id, 'circle', NULL, NEW.pinned_by, NULL);
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER app_circle_details_events AFTER INSERT OR UPDATE ON app_circle_details FOR EACH ROW EXECUTE FUNCTION app_circle_events_details();--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_circle_events_invites() RETURNS trigger AS $$
BEGIN
  IF NEW.circle_id IS NOT NULL THEN
    PERFORM app_circle_event(NEW.circle_id, 'invite', NEW.id::text, NEW.inviter_id, NEW.invitee_user_id);
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER app_circle_invites_events AFTER INSERT OR UPDATE ON app_circle_invites FOR EACH ROW EXECUTE FUNCTION app_circle_events_invites();
