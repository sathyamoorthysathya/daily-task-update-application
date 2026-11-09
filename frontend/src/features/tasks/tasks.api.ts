import { apiClient } from '../../lib/api/http-client';
import type {
  CreateTaskInput,
  ExcelSync,
  RecentTaskUpdate,
  SaveTaskResult,
  Task,
  TaskDetail,
  TaskEntryInput,
  TaskListQuery,
  TaskMatch,
  TaskPage,
  TaskStatus,
  TaskUpdate,
} from './task.types';

const taskPath = (id: string) => `/tasks/${encodeURIComponent(id)}`;

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
  editUpdate: (
    update: TaskUpdate,
    changes: { description: string; reference: string | null; status: TaskStatus },
  ) =>
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
  rename: (task: Task, name: string) =>
    apiClient.patch<{ task: Task; excelSync: ExcelSync }>(taskPath(task.id), {
      name,
      version: task.version,
    }),
  remove: (task: Task) =>
    apiClient.delete<{ taskId: string; excelSync: ExcelSync }>(
      `${taskPath(task.id)}?version=${task.version}`,
    ),
};
