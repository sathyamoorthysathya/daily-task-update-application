import { apiClient } from '../../lib/api/http-client';
import type { TaskStatus } from '../tasks/task.types';

export type StatusCounts = Record<TaskStatus, number>;

export interface ActivityDay {
  date: string;
  entries: number;
  completed: number;
}

export interface TaskSummary {
  today: string;
  totals: {
    tasks: number;
    entries: number;
    workbooks: number;
    completed: number;
    open: number;
    completionRate: number;
  };
  byStatus: StatusCounts;
  /** One item per day, oldest first. */
  activity: ActivityDay[];
  periods: { today: number; last7Days: number; previous7Days: number };
  workbooks: {
    id: string;
    name: string;
    tasks: number;
    completed: number;
    byStatus: StatusCounts;
  }[];
}

export const dashboardApi = {
  /** `today` is the user's local date, so "today" and the activity days match their calendar. */
  summary: (today: string, days = 14) =>
    apiClient.get<TaskSummary>(
      `/tasks/summary?${new URLSearchParams({ today, days: String(days) }).toString()}`,
    ),
};
