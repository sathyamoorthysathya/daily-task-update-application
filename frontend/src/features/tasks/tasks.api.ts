import { apiClient, saveFile } from '../../lib/api/http-client';
import type {
  CreateTaskInput,
  ExcelSync,
  RecentTaskUpdate,
  SaveTaskResult,
  Task,
  TaskDetail,
  TaskDetails,
  TaskEntryInput,
  TaskListQuery,
  TaskMatch,
  TaskPage,
  TaskReport,
  TaskUpdate,
  TaskWorkInput,
} from './task.types';

const taskPath = (id: string) => `/tasks/${encodeURIComponent(id)}`;

/** "?from=…&to=…" for the set bounds of a report period; "" for all work. */
function rangeQuery(range: { from?: string; to?: string }): string {
  const query = new URLSearchParams();
  if (range.from) {
    query.set('from', range.from);
  }
  if (range.to) {
    query.set('to', range.to);
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

/** Query string without empty values. */
function toQuery(query: TaskListQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

export const tasksApi = {
  create: (input: CreateTaskInput) => apiClient.post<SaveTaskResult>('/tasks', input),
  lookup: (workbookId: string, name: string, entryDate?: string) => {
    const query = new URLSearchParams({ workbookId, name });
    if (entryDate) {
      query.set('entryDate', entryDate);
    }
    return apiClient.get<{ match: TaskMatch | null }>(`/tasks/lookup?${query.toString()}`);
  },
  /** "Create New Daily Task Entry" for an existing task. */
  addUpdate: (taskId: string, input: TaskEntryInput) =>
    apiClient.post<SaveTaskResult>(`/tasks/${encodeURIComponent(taskId)}/updates`, input),
  /** "Update Existing Task": edits one dated entry. */
  editUpdate: (update: TaskUpdate, changes: TaskWorkInput) =>
    apiClient.patch<SaveTaskResult>(
      `/tasks/${encodeURIComponent(update.taskId)}/updates/${encodeURIComponent(update.id)}`,
      { ...changes, version: update.version },
    ),
  recent: (workbookId: string, limit = 10) =>
    apiClient.get<{ updates: RecentTaskUpdate[] }>(
      `/tasks/recent-updates?${new URLSearchParams({ workbookId, limit: String(limit) }).toString()}`,
    ),
  list: (query: TaskListQuery, signal?: AbortSignal) =>
    apiClient.get<TaskPage>(`/tasks?${toQuery(query)}`, { signal }),
  get: (id: string) => apiClient.get<TaskDetail>(taskPath(id)),
  /** Renames the task and/or changes its details (details left out stay as they are). */
  rename: (task: Task, name: string, details: Partial<TaskDetails> = {}) =>
    apiClient.patch<{ task: Task; excelSync: ExcelSync }>(taskPath(task.id), {
      name,
      ...details,
      version: task.version,
    }),
  /** Work report: the entries dated in [from, to]; without bounds, everything. */
  report: (range: { from?: string; to?: string }, signal?: AbortSignal) =>
    apiClient.get<TaskReport>(`/tasks/report${rangeQuery(range)}`, { signal }),
  /** Downloads the same report as an Excel or PDF file. */
  downloadReport: async (range: { from?: string; to?: string }, format: 'xlsx' | 'pdf') => {
    const query = rangeQuery(range);
    const file = await apiClient.download(
      `/tasks/report/download${query ? `${query}&` : '?'}format=${format}`,
    );
    saveFile(file, `Work report.${format}`);
  },
  remove: (task: Task) =>
    apiClient.delete<{ taskId: string; excelSync: ExcelSync }>(
      `${taskPath(task.id)}?version=${task.version}`,
    ),
};
