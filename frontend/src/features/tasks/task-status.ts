import type { TaskStatus } from './task.types';

export const TASK_STATUSES: readonly { value: TaskStatus; label: string }[] = [
  { value: 'TO_DO', label: 'To Do' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'ON_HOLD', label: 'On Hold' },
];

export function statusLabel(status: TaskStatus): string {
  return TASK_STATUSES.find((entry) => entry.value === status)?.label ?? status;
}
