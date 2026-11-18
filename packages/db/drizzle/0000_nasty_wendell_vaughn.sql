CREATE TYPE "public"."activity" AS ENUM('lesson', 'task', 'review');--> statement-breakpoint
CREATE TYPE "public"."card_source" AS ENUM('manual', 'lesson', 'claude');--> statement-breakpoint
CREATE TYPE "public"."card_state" AS ENUM('new', 'learning', 'review', 'relearning');--> statement-breakpoint
CREATE TYPE "public"."card_status" AS ENUM('pending', 'active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."card_type" AS ENUM('term', 'concept', 'cloze', 'comparison', 'snippet');--> statement-breakpoint
CREATE TYPE "public"."effort" AS ENUM('S', 'M', 'L');--> statement-breakpoint
CREATE TYPE "public"."grade" AS ENUM('again', 'hard', 'good', 'easy');--> statement-breakpoint
CREATE TYPE "public"."grading_mode" AS ENUM('self', 'claude');--> statement-breakpoint
CREATE TYPE "public"."module_kind" AS ENUM('core', 'optional');--> statement-breakpoint
CREATE TYPE "public"."progress_status" AS ENUM('not_started', 'in_progress', 'done');--> statement-breakpoint
CREATE TYPE "public"."review_mode" AS ENUM('copy_paste', 'bridge', 'api');--> statement-breakpoint
CREATE TYPE "public"."review_task_status" AS ENUM('open', 'done', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."run_stage" AS ENUM('checks', 'review');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'passed', 'failed', 'error', 'not_run');--> statement-breakpoint
CREATE TYPE "public"."submission_type" AS ENUM('repo', 'text', 'diagram');--> statement-breakpoint
CREATE TABLE "card_schedules" (
	"card_id" uuid PRIMARY KEY NOT NULL,
	"state" "card_state" DEFAULT 'new' NOT NULL,
	"due" timestamp with time zone DEFAULT now() NOT NULL,
	"stability" double precision DEFAULT 0 NOT NULL,
	"difficulty" double precision DEFAULT 0 NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"last_review_at" timestamp with time zone,
	"fsrs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_skills" (
	"card_id" uuid NOT NULL,
	"skill_id" text NOT NULL,
	CONSTRAINT "card_skills_card_id_skill_id_pk" PRIMARY KEY("card_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "card_type" NOT NULL,
	"front" text NOT NULL,
	"back" text NOT NULL,
	"source" "card_source" NOT NULL,
	"status" "card_status" DEFAULT 'active' NOT NULL,
	"lesson_id" text,
	"source_key" text,
	"suggested_by_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "check_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"criterion_id" text NOT NULL,
	"title" text NOT NULL,
	"passed" boolean NOT NULL,
	"log" text
);
--> statement-breakpoint
CREATE TABLE "lesson_progress" (
	"lesson_id" text PRIMARY KEY NOT NULL,
	"status" "progress_status" DEFAULT 'not_started' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" text PRIMARY KEY NOT NULL,
	"module_id" text NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	"present" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "modules" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"position" integer NOT NULL,
	"kind" "module_kind" NOT NULL,
	"effort" "effort" NOT NULL,
	"services" text[] DEFAULT '{}'::text[] NOT NULL,
	"present" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" text NOT NULL,
	"reason" text NOT NULL,
	"status" "review_task_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"grade" "grade" NOT NULL,
	"state_before" "card_state" NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answer_ms" integer,
	"mode" "grading_mode" DEFAULT 'self' NOT NULL,
	"fsrs_log" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rubric_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"rubric_item_id" text NOT NULL,
	"skill_id" text,
	"score" integer NOT NULL,
	"max_score" integer NOT NULL,
	"comment" text
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"review_mode" "review_mode" DEFAULT 'copy_paste' NOT NULL,
	"new_cards_per_day" integer DEFAULT 10 NOT NULL,
	"reviews_per_day" integer DEFAULT 100 NOT NULL,
	"desired_retention" double precision DEFAULT 0.9 NOT NULL,
	"lab_repo_path" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity" "activity" NOT NULL,
	"item_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"active_seconds" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" text NOT NULL,
	"type" "submission_type" NOT NULL,
	"folder" text,
	"commit_sha" text,
	"body" text,
	"file_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_skills" (
	"task_id" text NOT NULL,
	"skill_id" text NOT NULL,
	CONSTRAINT "task_skills_task_id_skill_id_pk" PRIMARY KEY("task_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"module_id" text NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	"submission_type" "submission_type" NOT NULL,
	"present" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"stage" "run_stage" NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"mode" "review_mode",
	"model" text,
	"prompt" text,
	"raw_output" text,
	"result" jsonb,
	"error" text,
	"duration_ms" integer,
	"cost_usd" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "card_schedules" ADD CONSTRAINT "card_schedules_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_skills" ADD CONSTRAINT "card_skills_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_skills" ADD CONSTRAINT "card_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_suggested_by_run_id_verification_runs_id_fk" FOREIGN KEY ("suggested_by_run_id") REFERENCES "public"."verification_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_results" ADD CONSTRAINT "check_results_run_id_verification_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."verification_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_scores" ADD CONSTRAINT "rubric_scores_run_id_verification_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."verification_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_scores" ADD CONSTRAINT "rubric_scores_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_skills" ADD CONSTRAINT "task_skills_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_skills" ADD CONSTRAINT "task_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_runs_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_schedules_due_idx" ON "card_schedules" USING btree ("due");--> statement-breakpoint
CREATE UNIQUE INDEX "cards_source_key_idx" ON "cards" USING btree ("source_key");--> statement-breakpoint
CREATE INDEX "cards_status_idx" ON "cards" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cards_lesson_idx" ON "cards" USING btree ("lesson_id");--> statement-breakpoint
CREATE INDEX "check_results_run_idx" ON "check_results" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "lessons_module_idx" ON "lessons" USING btree ("module_id","position");--> statement-breakpoint
CREATE INDEX "review_tasks_skill_idx" ON "review_tasks" USING btree ("skill_id","status");--> statement-breakpoint
CREATE INDEX "reviews_card_idx" ON "reviews" USING btree ("card_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "reviews_at_idx" ON "reviews" USING btree ("reviewed_at");--> statement-breakpoint
CREATE INDEX "rubric_scores_run_idx" ON "rubric_scores" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "rubric_scores_skill_idx" ON "rubric_scores" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "study_sessions_started_idx" ON "study_sessions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "submissions_task_idx" ON "submissions" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "tasks_module_idx" ON "tasks" USING btree ("module_id","position");--> statement-breakpoint
CREATE INDEX "verification_runs_submission_idx" ON "verification_runs" USING btree ("submission_id","created_at");