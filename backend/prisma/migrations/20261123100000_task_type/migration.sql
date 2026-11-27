-- Task type: what kind of work a task is (feature, bug, research...), set once per task.

-- CreateEnum
CREATE TYPE "task_type" AS ENUM ('FEATURE', 'BUG', 'IMPROVEMENT', 'RESEARCH', 'TESTING', 'DOCUMENTATION', 'MEETING', 'SUPPORT', 'OTHER');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "task_type" "task_type";

-- The "Daily Tasks" sheet gains a "Task Type" column: mark every Excel file as behind so the
-- sync worker rebuilds it (its orphan recovery queues the jobs), and downloads rebuild it too.
UPDATE "workbooks" SET "data_version" = "data_version" + 1;
