-- Trigram matching for task-name search (trusted extension: the database owner can create it).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "task_history_action" ADD VALUE 'TASK_RENAMED';
ALTER TYPE "task_history_action" ADD VALUE 'TASK_DELETED';

-- DropIndex
DROP INDEX "tasks_user_id_name_key_idx";

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "deleted_at" TIMESTAMPTZ(3),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "name_key" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "tasks_user_id_last_entry_date_idx" ON "tasks"("user_id", "last_entry_date" DESC);

-- CreateIndex
CREATE INDEX "tasks_name_key_trgm_idx" ON "tasks" USING GIN ("name_key" gin_trgm_ops);


-- A deleted task releases its name: name_key is NULL exactly when the task is deleted.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_deleted_name_check"
  CHECK (("deleted_at" IS NULL) = ("name_key" IS NOT NULL));
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_version_check" CHECK ("version" >= 1);
