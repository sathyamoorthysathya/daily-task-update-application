import { apiClient, saveFile } from '../../lib/api/http-client';
import type { Workbook, WorkbookList, WorkbookSyncStatus } from './workbook.types';

const path = (id: string) => `/workbooks/${encodeURIComponent(id)}`;

export const workbooksApi = {
  list: () => apiClient.get<WorkbookList>('/workbooks'),
  create: (name: string, makeDefault?: boolean) =>
    apiClient.post<Workbook>('/workbooks', makeDefault ? { name, makeDefault } : { name }),
  rename: (workbook: Workbook, name: string) =>
    apiClient.patch<Workbook>(path(workbook.id), { name, version: workbook.version }),
  setDefault: (id: string) => apiClient.post<WorkbookList>(`${path(id)}/default`),
  /** Queues a rebuild of the Excel file from the saved tasks (recovery after failures). */
  syncNow: (id: string) => apiClient.post<WorkbookSyncStatus>(`${path(id)}/sync`),
  syncStatus: (id: string) => apiClient.get<WorkbookSyncStatus>(`${path(id)}/sync-status`),
  remove: (workbook: Workbook) =>
    apiClient.delete<void>(`${path(workbook.id)}?version=${workbook.version}`),
  download: async (workbook: Workbook) => {
    const file = await apiClient.download(`${path(workbook.id)}/download`);
    saveFile(file, `${workbook.name}.xlsx`);
  },
};
