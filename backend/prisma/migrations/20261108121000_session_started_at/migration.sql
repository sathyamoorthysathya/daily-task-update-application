-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "session_started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;


-- Existing sessions start at their oldest remaining refresh token.
UPDATE "refresh_tokens" AS t SET "session_started_at" = s.started FROM (SELECT "family_id", MIN("created_at") AS started FROM "refresh_tokens" GROUP BY "family_id") AS s WHERE t."family_id" = s."family_id";
