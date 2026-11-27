-- Task type "Other": the user types their own type (e.g. "Code review").

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "task_type_other" VARCHAR(50);

-- The typed type belongs to "Other" only, and is never empty.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_task_type_other_check"
  CHECK ("task_type_other" IS NULL OR ("task_type" = 'OTHER' AND length(trim("task_type_other")) > 0));
