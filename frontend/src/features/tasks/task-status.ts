import type { TaskPriority, TaskStatus } from './task.types';

export const TASK_PRIORITIES: readonly { value: TaskPriority; label: string }[] = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
];

export function priorityLabel(priority: TaskPriority): string {
  return TASK_PRIORITIES.find((entry) => entry.value === priority)?.label ?? priority;
}

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
