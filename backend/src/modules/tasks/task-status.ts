import type { TaskStatus } from '../../generated/prisma/client.js';

/** Task statuses in display order, with the labels shown in the UI and the Excel file. */
export const TASK_STATUSES = [
  { value: 'TO_DO', label: 'To Do' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'ON_HOLD', label: 'On Hold' },
] as const satisfies readonly { value: TaskStatus; label: string }[];

export const TASK_STATUS_VALUES = TASK_STATUSES.map((status) => status.value) as [
  TaskStatus,
  ...TaskStatus[],
];

export function taskStatusLabel(status: TaskStatus): string {
  return TASK_STATUSES.find((entry) => entry.value === status)?.label ?? status;
}
