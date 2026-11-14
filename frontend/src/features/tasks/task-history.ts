import { priorityLabel, statusLabel } from './task-status';
import { formatTaskDate } from './tasks.schemas';
import type { TaskHistoryEntry, TaskPriority, TaskStatus } from './task.types';

const STATUS_VALUES = ['TO_DO', 'IN_PROGRESS', 'PENDING', 'COMPLETED', 'ON_HOLD'];

function asStatus(value: unknown): string {
  return typeof value === 'string' && STATUS_VALUES.includes(value)
    ? statusLabel(value as TaskStatus)
    : '—';
}

function asPriority(value: unknown): string {
  return typeof value === 'string' && ['LOW', 'MEDIUM', 'HIGH'].includes(value)
    ? priorityLabel(value as TaskPriority)
    : 'none';
}

function asDate(value: unknown): string {
  return typeof value === 'string' ? formatTaskDate(value) : '—';
}

interface Change {
  from: unknown;
  to: unknown;
}

function isChange(value: unknown): value is Change {
  return typeof value === 'object' && value !== null && 'from' in value && 'to' in value;
}

/** Human-readable title and details for an audit-trail entry. */
export function describeHistory(entry: TaskHistoryEntry): { title: string; details: string[] } {
  const changes = entry.changes;
  switch (entry.action) {
    case 'TASK_CREATED':
      return {
        title: `Task created for ${asDate(changes.entryDate)}`,
        details: [`Status: ${asStatus(changes.status)}`],
      };
    case 'ENTRY_ADDED':
      return {
        title: `Daily entry added for ${asDate(changes.entryDate)}`,
        details: [`Status: ${asStatus(changes.status)}`],
      };
    case 'ENTRY_UPDATED': {
      const details: string[] = [];
      if (isChange(changes.status)) {
        details.push(`Status: ${asStatus(changes.status.from)} → ${asStatus(changes.status.to)}`);
      }
      if (isChange(changes.description)) {
        details.push('Description changed');
      }
      if (isChange(changes.reference)) {
        details.push(
          changes.reference.to
            ? 'Documentation reference changed'
            : 'Documentation reference removed',
        );
      }
      if (isChange(changes.startTime) || isChange(changes.endTime)) {
        details.push('Working hours changed');
      }
      if (isChange(changes.remarks)) {
        details.push(changes.remarks.to ? 'Remarks changed' : 'Remarks removed');
      }
      return { title: `Entry for ${asDate(changes.entryDate)} updated`, details };
    }
    case 'TASK_RENAMED': {
      const name = isChange(changes.name) ? changes.name : { from: '', to: '' };
      return { title: 'Task renamed', details: [`“${String(name.from)}” → “${String(name.to)}”`] };
    }
    case 'TASK_UPDATED': {
      const details: string[] = [];
      if (isChange(changes.name)) {
        details.push(`Name: “${String(changes.name.from)}” → “${String(changes.name.to)}”`);
      }
      const text = (value: unknown) => (typeof value === 'string' && value ? value : 'none');
      for (const [field, label] of [
        ['assignedBy', 'Assigned by'],
        ['project', 'Project'],
      ] as const) {
        const change = changes[field];
        if (isChange(change)) {
          details.push(`${label}: ${text(change.from)} → ${text(change.to)}`);
        }
      }
      if (isChange(changes.priority)) {
        details.push(
          `Priority: ${asPriority(changes.priority.from)} → ${asPriority(changes.priority.to)}`,
        );
      }
      if (isChange(changes.dueDate)) {
        const due = (value: unknown) =>
          typeof value === 'string' ? formatTaskDate(value) : 'none';
        details.push(`Due date: ${due(changes.dueDate.from)} → ${due(changes.dueDate.to)}`);
      }
      return { title: 'Task details updated', details };
    }
    case 'TASK_DELETED':
      return { title: 'Task deleted', details: [] };
  }
}
