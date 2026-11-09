-- CreateEnum
CREATE TYPE "audit_outcome" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "event" VARCHAR(64) NOT NULL,
    "outcome" "audit_outcome" NOT NULL,
    "user_id" UUID,
    "email" VARCHAR(254),
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(300),
    "request_id" VARCHAR(128),
    "resource_type" VARCHAR(32),
    "resource_id" UUID,
    "details" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_events_user_id_created_at_idx" ON "audit_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_event_created_at_idx" ON "audit_events"("event", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_created_at_idx" ON "audit_events"("created_at");

-- The audit log is append-only: rows can be inserted, and deleted by a retention job, never changed.
CREATE FUNCTION "audit_events_block_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;

CREATE TRIGGER "audit_events_no_update"
  BEFORE UPDATE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION "audit_events_block_update"();
