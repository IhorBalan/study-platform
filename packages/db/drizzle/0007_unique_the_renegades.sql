CREATE TABLE "removed_lesson_cards" (
	"source_key" text PRIMARY KEY NOT NULL,
	"removed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "edited_at" timestamp with time zone;