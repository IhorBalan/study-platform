-- Two evaluations at the same moment could open two refreshes for one skill.
-- Close all but the oldest so the unique index below can be created.
UPDATE "review_tasks" a SET "status" = 'done', "closed_at" = now()
  WHERE a."status" = 'open' AND EXISTS (
    SELECT 1 FROM "review_tasks" b
    WHERE b."skill_id" = a."skill_id" AND b."status" = 'open'
      AND (b."created_at", b."id") < (a."created_at", a."id")
  );--> statement-breakpoint
CREATE UNIQUE INDEX "review_tasks_open_skill_idx" ON "review_tasks" USING btree ("skill_id") WHERE "review_tasks"."status" = 'open';