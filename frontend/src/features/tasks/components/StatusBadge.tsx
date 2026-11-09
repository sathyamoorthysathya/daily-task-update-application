import { statusLabel } from '../task-status';
import type { TaskStatus } from '../task.types';

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={`task-status task-status--${status.toLowerCase()}`}>
      {statusLabel(status)}
    </span>
  );
}
