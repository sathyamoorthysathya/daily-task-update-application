import { formatTaskDate } from '../tasks.schemas';
import type { RecentTaskUpdate } from '../task.types';
import { StatusBadge } from './StatusBadge';

interface Props {
  updates: RecentTaskUpdate[] | null;
  workbookName?: string;
}

/** The latest entries of the selected workbook (same rows as its Excel sheet). */
export function RecentUpdates({ updates, workbookName }: Props) {
  return (
    <section className="card" aria-labelledby="recent-heading">
      <h2 id="recent-heading">Recent entries{workbookName ? ` in ${workbookName}` : ''}</h2>
      {updates === null && <p className="muted">Loading…</p>}
      {updates?.length === 0 && (
        <p className="muted">No tasks yet. Your first task will appear here.</p>
      )}
      {updates && updates.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Task #</th>
                <th scope="col">Date</th>
                <th scope="col">Task</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {updates.map((update) => (
                <tr key={update.id}>
                  <td className="task-number">#{update.taskNumber}</td>
                  <td>{formatTaskDate(update.entryDate)}</td>
                  <td>
                    <span className="recent-name">{update.taskName}</span>
                    <span className="recent-description muted">{update.description}</span>
                  </td>
                  <td>
                    <StatusBadge status={update.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
