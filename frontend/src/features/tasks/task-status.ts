import type { TaskPriority, TaskStatus, TaskType } from './task.types';

/** Kinds of work, in the order the form lists them. */
export const TASK_TYPES: readonly { value: TaskType; label: string }[] = [
  { value: 'FEATURE', label: 'Feature' },
  { value: 'BUG', label: 'Bug' },
  { value: 'IMPROVEMENT', label: 'Improvement' },
  { value: 'RESEARCH', label: 'Research' },
  { value: 'TESTING', label: 'Testing' },
  { value: 'DOCUMENTATION', label: 'Documentation' },
  { value: 'MEETING', label: 'Meeting' },
  { value: 'SUPPORT', label: 'Support' },
  { value: 'OTHER', label: 'Other' },
];

export function taskTypeLabel(type: TaskType): string {
  return TASK_TYPES.find((entry) => entry.value === type)?.label ?? type;
}

/** What a task's type reads as: "Other - Code review" for the user's own type, else the label. */
export function taskTypeText(task: { taskType: TaskType | null; taskTypeOther: string | null }) {
  if (!task.taskType) {
    return '';
  }
  return task.taskType === 'OTHER' && task.taskTypeOther
    ? `${taskTypeLabel('OTHER')} - ${task.taskTypeOther}`
    : taskTypeLabel(task.taskType);
}

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
