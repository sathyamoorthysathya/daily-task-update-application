import type { Workbook, WorkbookList } from '../features/workbooks/workbook.types';

export function makeWorkbook(overrides: Partial<Workbook>): Workbook {
  return {
    id: '0190a000-0000-4000-8000-00000000000a',
    name: 'Daily Tasks',
    isDefault: false,
    taskCount: 0,
    nextTaskNumber: 1,
    sizeBytes: 6500,
    syncStatus: 'synced',
    syncError: null,
    lastSyncedAt: null,
    version: 1,
    createdAt: '2026-01-05T09:00:00.000Z',
    updatedAt: '2026-01-05T09:00:00.000Z',
    ...overrides,
  };
}

export function listOf(...workbooks: Workbook[]): WorkbookList {
  return {
    workbooks,
    defaultWorkbookId: workbooks.find((workbook) => workbook.isDefault)?.id ?? null,
    limit: 20,
  };
}
