-- AlterTable
ALTER TABLE "users" ADD COLUMN     "default_workbook_id" UUID;

-- CreateTable
CREATE TABLE "workbooks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "name_key" VARCHAR(100) NOT NULL,
    "storage_key" VARCHAR(255) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "task_count" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workbooks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workbooks_storage_key_key" ON "workbooks"("storage_key");

-- CreateIndex
CREATE INDEX "workbooks_user_id_created_at_idx" ON "workbooks"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "workbooks_user_id_name_key_key" ON "workbooks"("user_id", "name_key");

-- CreateIndex
CREATE UNIQUE INDEX "users_default_workbook_id_key" ON "users"("default_workbook_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_default_workbook_id_fkey" FOREIGN KEY ("default_workbook_id") REFERENCES "workbooks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workbooks" ADD CONSTRAINT "workbooks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Data integrity (also enforced by the API; Prisma does not manage CHECK constraints)
ALTER TABLE "workbooks" ADD CONSTRAINT "workbooks_storage_key_check"
  CHECK ("storage_key" = "user_id"::text || '/' || "id"::text || '.xlsx');
ALTER TABLE "workbooks" ADD CONSTRAINT "workbooks_name_key_check"
  CHECK ("name_key" = lower("name") AND length(trim("name")) > 0);
ALTER TABLE "workbooks" ADD CONSTRAINT "workbooks_counters_check"
  CHECK ("size_bytes" > 0 AND "task_count" >= 0 AND "version" >= 1);
