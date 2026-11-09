-- CreateEnum
CREATE TYPE "excel_sync_job_status" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "excel_sync_reason" AS ENUM ('TASK_CREATED', 'ENTRY_ADDED', 'ENTRY_UPDATED', 'TASK_RENAMED', 'TASK_DELETED', 'MANUAL', 'RECOVERY');

-- CreateTable
CREATE TABLE "excel_sync_jobs" (
    "id" UUID NOT NULL,
    "workbook_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "task_id" UUID,
    "reason" "excel_sync_reason" NOT NULL,
    "status" "excel_sync_job_status" NOT NULL DEFAULT 'PENDING',
    "target_data_version" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(3),
    "locked_by" VARCHAR(100),
    "last_error" VARCHAR(1000),
    "resolved_by_job_id" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "excel_sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "excel_sync_jobs_status_next_attempt_at_idx" ON "excel_sync_jobs"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "excel_sync_jobs_workbook_id_status_idx" ON "excel_sync_jobs"("workbook_id", "status");

-- AddForeignKey
ALTER TABLE "excel_sync_jobs" ADD CONSTRAINT "excel_sync_jobs_workbook_id_fkey" FOREIGN KEY ("workbook_id") REFERENCES "workbooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "excel_sync_jobs" ADD CONSTRAINT "excel_sync_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "excel_sync_jobs" ADD CONSTRAINT "excel_sync_jobs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Data integrity (also enforced by the worker; Prisma does not manage CHECK constraints)
ALTER TABLE "excel_sync_jobs" ADD CONSTRAINT "excel_sync_jobs_values_check"
  CHECK ("attempts" >= 0 AND "max_attempts" >= 1 AND "target_data_version" >= 0);
