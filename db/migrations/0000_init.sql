CREATE TYPE "public"."day_type" AS ENUM('weeknight', 'weekend', 'special');--> statement-breakpoint
CREATE TYPE "public"."operator_role" AS ENUM('owner', 'host');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('held', 'confirmed', 'cancelled', 'expired', 'seated', 'no_show');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"venue_id" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"reservation_id" uuid,
	"amount_cents" integer,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blackout" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"venue_id" text NOT NULL,
	"table_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"during" "tstzrange" GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blackout_range" CHECK ("blackout"."ends_at" > "blackout"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "email_message" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"to" text NOT NULL,
	"subject" text NOT NULL,
	"html" text NOT NULL,
	"text" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tag" text NOT NULL,
	"reservation_id" uuid,
	"provider" text NOT NULL,
	"provider_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flag" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guest" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"mobile" text NOT NULL,
	"occasion" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "magic_link" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"operator_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"venue_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "operator_role" NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_rule" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"venue_id" text NOT NULL,
	"tier" text NOT NULL,
	"daypart" text NOT NULL,
	"day_type" "day_type" NOT NULL,
	"special_date" date,
	"fee_cents" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "price_rule_fee" CHECK ("price_rule"."fee_cents" >= 0 AND "price_rule"."fee_cents" <= 100000),
	CONSTRAINT "price_rule_special" CHECK (("price_rule"."day_type" = 'special') = ("price_rule"."special_date" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "rate_limit_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "reservation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"venue_id" text NOT NULL,
	"table_id" uuid NOT NULL,
	"party_size" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"during" "tstzrange" GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED NOT NULL,
	"daypart" text NOT NULL,
	"day_type" "day_type" NOT NULL,
	"status" "reservation_status" NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"guest_id" uuid,
	"price_cents" integer NOT NULL,
	"application_fee_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"payment_intent_id" text,
	"card_brand" text,
	"card_last4" text,
	"device_hash" text NOT NULL,
	"ip_hash" text NOT NULL,
	"email_norm" text,
	"manage_nonce" text NOT NULL,
	"seated_table_id" uuid,
	"refund_cents" integer DEFAULT 0 NOT NULL,
	"refund_id" text,
	"refunded_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"seated_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_range" CHECK ("reservation"."ends_at" > "reservation"."starts_at"),
	CONSTRAINT "reservation_party" CHECK ("reservation"."party_size" BETWEEN 1 AND 20),
	CONSTRAINT "reservation_price" CHECK ("reservation"."price_cents" >= 0 AND "reservation"."application_fee_cents" >= 0 AND "reservation"."application_fee_cents" <= "reservation"."price_cents"),
	CONSTRAINT "reservation_refund" CHECK ("reservation"."refund_cents" >= 0 AND "reservation"."refund_cents" <= "reservation"."price_cents"),
	CONSTRAINT "reservation_hold_expiry_set" CHECK ("reservation"."status" <> 'held' OR "reservation"."hold_expires_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"operator_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sim_event" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sim_payment_intent" (
	"id" text PRIMARY KEY NOT NULL,
	"client_secret" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"application_fee_amount" integer NOT NULL,
	"destination" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"last_error" jsonb,
	"card_brand" text,
	"card_last4" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sim_refund" (
	"id" text PRIMARY KEY NOT NULL,
	"payment_intent_id" text NOT NULL,
	"amount" integer NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "turn_time" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"venue_id" text NOT NULL,
	"min_party" integer NOT NULL,
	"max_party" integer NOT NULL,
	"minutes" integer NOT NULL,
	CONSTRAINT "turn_time_valid" CHECK ("turn_time"."min_party" >= 1 AND "turn_time"."max_party" >= "turn_time"."min_party" AND "turn_time"."minutes" BETWEEN 30 AND 360)
);
--> statement-breakpoint
CREATE TABLE "venue" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"stripe_account_id" text,
	"application_fee_bps" integer DEFAULT 3000 NOT NULL,
	"live" boolean DEFAULT false NOT NULL,
	"went_live_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venue_table" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"venue_id" text NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"tier" text NOT NULL,
	"seats" integer NOT NULL,
	"min_party" integer NOT NULL,
	"max_party" integer NOT NULL,
	"attributes" text[] DEFAULT '{}'::text[] NOT NULL,
	"photo_id" text,
	"bookable" boolean NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venue_table_party" CHECK ("venue_table"."min_party" >= 1 AND "venue_table"."min_party" <= "venue_table"."max_party" AND "venue_table"."max_party" <= "venue_table"."seats")
);
--> statement-breakpoint
CREATE TABLE "webhook_event" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "blackout" ADD CONSTRAINT "blackout_venue_id_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blackout" ADD CONSTRAINT "blackout_table_id_venue_table_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."venue_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "magic_link" ADD CONSTRAINT "magic_link_operator_id_operator_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operator"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator" ADD CONSTRAINT "operator_venue_id_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_rule" ADD CONSTRAINT "price_rule_venue_id_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_venue_id_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_table_id_venue_table_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."venue_table"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_guest_id_guest_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guest"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation" ADD CONSTRAINT "reservation_seated_table_id_venue_table_id_fk" FOREIGN KEY ("seated_table_id") REFERENCES "public"."venue_table"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_operator_id_operator_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operator"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn_time" ADD CONSTRAINT "turn_time_venue_id_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_table" ADD CONSTRAINT "venue_table_venue_id_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_venue" ON "audit_log" USING btree ("venue_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_reservation" ON "audit_log" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "blackout_venue" ON "blackout" USING btree ("venue_id","starts_at");--> statement-breakpoint
CREATE INDEX "email_message_created" ON "email_message" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "magic_link_token" ON "magic_link" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "operator_email" ON "operator" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "price_rule_key" ON "price_rule" USING btree ("venue_id","tier","daypart","day_type",coalesce("special_date", '1970-01-01'::date));--> statement-breakpoint
CREATE UNIQUE INDEX "reservation_payment_intent" ON "reservation" USING btree ("payment_intent_id");--> statement-breakpoint
CREATE INDEX "reservation_venue_start" ON "reservation" USING btree ("venue_id","starts_at");--> statement-breakpoint
CREATE INDEX "reservation_hold_expiry" ON "reservation" USING btree ("status","hold_expires_at");--> statement-breakpoint
CREATE INDEX "reservation_device_active" ON "reservation" USING btree ("device_hash","status");--> statement-breakpoint
CREATE INDEX "reservation_email_active" ON "reservation" USING btree ("email_norm","status");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token" ON "session" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "sim_pi_idempotency" ON "sim_payment_intent" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "sim_refund_idempotency" ON "sim_refund" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "turn_time_range" ON "turn_time" USING btree ("venue_id","min_party");--> statement-breakpoint
CREATE UNIQUE INDEX "venue_table_code" ON "venue_table" USING btree ("venue_id","code");