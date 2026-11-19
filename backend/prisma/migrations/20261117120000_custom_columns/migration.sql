-- Extra columns chosen by the user when creating a workbook, and their values per daily entry.

-- AlterTable
ALTER TABLE "workbooks" ADD COLUMN     "custom_columns" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "task_updates" ADD COLUMN     "custom_values" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "workbooks" ADD CONSTRAINT "workbooks_custom_columns_check"
  CHECK (jsonb_typeof("custom_columns") = 'array');
ALTER TABLE "task_updates" ADD CONSTRAINT "task_updates_custom_values_check"
  CHECK (jsonb_typeof("custom_values") = 'object');
