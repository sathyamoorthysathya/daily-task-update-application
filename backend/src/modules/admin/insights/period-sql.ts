import { Prisma } from '../../../generated/prisma/client.js';

/**
 * SQL building blocks for "per day" figures counted in the administrator's time zone (`tz` is
 * validated by the query schema and always passed as a bind parameter).
 */

/** Local calendar date (in `tz`) of a timestamptz column. */
export const localDay = (column: Prisma.Sql, tz: string) =>
  Prisma.sql`(${column} AT TIME ZONE ${tz})::date`;

/** The instant of local midnight `days - 1` days ago: the start of a period ending today. */
export const periodStart = (days: number, tz: string) =>
  Prisma.sql`((((now() AT TIME ZONE ${tz})::date - ${days - 1}::int)::timestamp) AT TIME ZONE ${tz})`;

/** One row per local calendar day of the period: (day date). */
export const daySeries = (days: number, tz: string) =>
  Prisma.sql`SELECT d::date AS day FROM generate_series(
    (now() AT TIME ZONE ${tz})::date - ${days - 1}::int,
    (now() AT TIME ZONE ${tz})::date,
    interval '1 day'
  ) AS d`;

export const DAY_MS = 86_400_000;

export const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);
