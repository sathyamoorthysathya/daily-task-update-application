import type { TaskStatus, TaskType } from '../../generated/prisma/client.js';

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

/** Task types (the kind of work) in display order, with their UI and Excel labels. */
export const TASK_TYPES = [
  { value: 'FEATURE', label: 'Feature' },
  { value: 'BUG', label: 'Bug' },
  { value: 'IMPROVEMENT', label: 'Improvement' },
  { value: 'RESEARCH', label: 'Research' },
  { value: 'TESTING', label: 'Testing' },
  { value: 'DOCUMENTATION', label: 'Documentation' },
  { value: 'MEETING', label: 'Meeting' },
  { value: 'SUPPORT', label: 'Support' },
  { value: 'OTHER', label: 'Other' },
] as const satisfies readonly { value: TaskType; label: string }[];

export const TASK_TYPE_VALUES = TASK_TYPES.map((type) => type.value) as [TaskType, ...TaskType[]];

export function taskTypeLabel(type: TaskType): string {
  return TASK_TYPES.find((entry) => entry.value === type)?.label ?? type;
}

/** What a task's type reads as: "Other - Code review" for the user's own type, else the label. */
export function taskTypeText(type: TaskType | null, other: string | null): string {
  if (!type) {
    return '';
  }
  return type === 'OTHER' && other ? `${taskTypeLabel('OTHER')} - ${other}` : taskTypeLabel(type);
}
