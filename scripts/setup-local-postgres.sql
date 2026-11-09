-- Creates the application role and database on a natively installed PostgreSQL.
-- Safe to run more than once. Run as the `postgres` superuser:
--   psql -U postgres -h localhost -f scripts/setup-local-postgres.sql
-- Credentials must match DATABASE_URL in backend/.env.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dtu_user') THEN
    -- CREATEDB lets `prisma migrate dev` create its temporary shadow database.
    CREATE ROLE dtu_user WITH LOGIN PASSWORD 'dtu_password' CREATEDB;
  END IF;
END
$$;

SELECT 'CREATE DATABASE daily_task_update OWNER dtu_user'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'daily_task_update')\gexec
