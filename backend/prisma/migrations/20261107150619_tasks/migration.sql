-- CreateEnum
CREATE TYPE "task_status" AS ENUM ('TO_DO', 'IN_PROGRESS', 'PENDING', 'COMPLETED', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "task_history_action" AS ENUM ('TASK_CREATED', 'ENTRY_ADDED', 'ENTRY_UPDATED');

-- AlterTable
ALTER TABLE "workbooks" ADD COLUMN     "data_version" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "last_synced_at" TIMESTAMPTZ(3),
ADD COLUMN     "last_task_number" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sync_error" VARCHAR(500),
ADD COLUMN     "synced_version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "workbook_id" UUID NOT NULL,
    "task_number" INTEGER NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "name_key" VARCHAR(200) NOT NULL,
    "status" "task_status" NOT NULL,
    "last_entry_date" DATE NOT NULL,
    "entry_count" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_updates" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "entry_date" DATE NOT NULL,
    "status" "task_status" NOT NULL,
    "description" VARCHAR(5000) NOT NULL,
    "reference" VARCHAR(2000),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "task_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_history" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "task_update_id" UUID,
    "user_id" UUID NOT NULL,
    "action" "task_history_action" NOT NULL,
    "changes" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_user_id_name_key_idx" ON "tasks"("user_id", "name_key");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_workbook_id_name_key_key" ON "tasks"("workbook_id", "name_key");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_workbook_id_task_number_key" ON "tasks"("workbook_id", "task_number");

-- CreateIndex
CREATE INDEX "task_updates_user_id_entry_date_idx" ON "task_updates"("user_id", "entry_date");

-- CreateIndex
CREATE UNIQUE INDEX "task_updates_task_id_entry_date_key" ON "task_updates"("task_id", "entry_date");

-- CreateIndex
CREATE INDEX "task_history_task_id_created_at_idx" ON "task_history"("task_id", "created_at");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workbook_id_fkey" FOREIGN KEY ("workbook_id") REFERENCES "workbooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_updates" ADD CONSTRAINT "task_updates_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_updates" ADD CONSTRAINT "task_updates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_history" ADD CONSTRAINT "task_history_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_history" ADD CONSTRAINT "task_history_task_update_id_fkey" FOREIGN KEY ("task_update_id") REFERENCES "task_updates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_history" ADD CONSTRAINT "task_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Data integrity (also enforced by the API; Prisma does not manage these)
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_values_check"
  CHECK ("task_number" >= 1 AND "entry_count" >= 1 AND length(trim("name")) > 0 AND length("name_key") > 0);
ALTER TABLE "task_updates" ADD CONSTRAINT "task_updates_values_check"
  CHECK (length(trim("description")) > 0 AND "version" >= 1);
ALTER TABLE "workbooks" ADD CONSTRAINT "workbooks_sync_check"
  CHECK ("last_task_number" >= 0 AND "synced_version" >= 0 AND "synced_version" <= "data_version");

-- The audit trail is append-only: rows can be inserted (and removed with their task), never changed.
CREATE FUNCTION "task_history_block_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'task_history is append-only';
END;
$$;
CREATE TRIGGER "task_history_no_update"
  BEFORE UPDATE ON "task_history"
  FOR EACH ROW EXECUTE FUNCTION "task_history_block_update"();
