-- AlterTable
ALTER TABLE "auth_accounts" ADD COLUMN     "name" VARCHAR(100),
ADD COLUMN     "picture_url" VARCHAR(1024);

-- CreateTable
CREATE TABLE "user_profiles" (
    "user_id" UUID NOT NULL,
    "phone" VARCHAR(32),
    "company_name" VARCHAR(120),
    "job_role" VARCHAR(100),
    "industry" VARCHAR(60),
    "years_of_experience" SMALLINT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "user_avatars" (
    "user_id" UUID NOT NULL,
    "data" BYTEA NOT NULL,
    "mime_type" VARCHAR(32) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_avatars_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_avatars" ADD CONSTRAINT "user_avatars_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data integrity (enforced in the API too; Prisma does not manage CHECK constraints)
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_years_of_experience_check"
  CHECK ("years_of_experience" IS NULL OR "years_of_experience" BETWEEN 0 AND 60);
ALTER TABLE "user_avatars" ADD CONSTRAINT "user_avatars_size_bytes_check"
  CHECK ("size_bytes" > 0 AND "size_bytes" <= 2097152);
ALTER TABLE "user_avatars" ADD CONSTRAINT "user_avatars_mime_type_check"
  CHECK ("mime_type" IN ('image/webp'));

-- Backfill: every existing user gets an (empty) profile
INSERT INTO "user_profiles" ("user_id", "updated_at")
SELECT "id", CURRENT_TIMESTAMP FROM "users"
ON CONFLICT ("user_id") DO NOTHING;
