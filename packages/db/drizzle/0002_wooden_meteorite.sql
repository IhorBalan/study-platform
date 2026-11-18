-- Two replies pasted at the same moment could store a review's scores twice.
-- Keep one row per rubric item so the unique index below can be created.
DELETE FROM "rubric_scores" a USING "rubric_scores" b
  WHERE a."run_id" = b."run_id" AND a."rubric_item_id" = b."rubric_item_id" AND a."id" > b."id";--> statement-breakpoint
DROP INDEX "rubric_scores_run_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "rubric_scores_run_item_idx" ON "rubric_scores" USING btree ("run_id","rubric_item_id");