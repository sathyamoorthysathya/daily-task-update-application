-- Work details for daily reporting: who assigned a task, its priority, project and due date
-- (once per task), and the working hours and remarks of each daily entry.

-- CreateEnum
CREATE TYPE "task_priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- AlterEnum
ALTER TYPE "task_history_action" ADD VALUE 'TASK_UPDATED';

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "assigned_by" VARCHAR(100),
ADD COLUMN     "priority" "task_priority",
ADD COLUMN     "project" VARCHAR(100),
ADD COLUMN     "due_date" DATE;

-- AlterTable
ALTER TABLE "task_updates" ADD COLUMN     "start_time" VARCHAR(5),
ADD COLUMN     "end_time" VARCHAR(5),
ADD COLUMN     "remarks" VARCHAR(2000);

-- Times are wall-clock "HH:MM" (24 hours). An end time needs a start time and comes after it.
ALTER TABLE "task_updates" ADD CONSTRAINT "task_updates_start_time_check"
  CHECK ("start_time" IS NULL OR "start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "task_updates" ADD CONSTRAINT "task_updates_end_time_check"
  CHECK ("end_time" IS NULL OR "end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "task_updates" ADD CONSTRAINT "task_updates_time_range_check"
  CHECK ("end_time" IS NULL OR ("start_time" IS NOT NULL AND "end_time" > "start_time"));
