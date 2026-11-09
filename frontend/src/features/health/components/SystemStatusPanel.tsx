import type { ServiceState } from '../health.types';
import { useSystemStatus } from '../use-system-status';

const STATE_LABEL: Record<ServiceState, string> = {
  checking: 'Checking…',
  up: 'Operational',
  down: 'Unavailable',
};

function StatusRow({ label, state }: { label: string; state: ServiceState }) {
  return (
    <li className="status-row">
      <span>{label}</span>
      <span className={`status-badge status-badge--${state}`} data-testid={`status-${label}`}>
        {STATE_LABEL[state]}
      </span>
    </li>
  );
}

export function SystemStatusPanel() {
  const { status, refresh } = useSystemStatus();
  const isChecking = status.api === 'checking' || status.database === 'checking';

  return (
    <section className="card" aria-labelledby="system-status-heading">
      <div className="card-header">
        <h2 id="system-status-heading">System status</h2>
        <button type="button" onClick={refresh} disabled={isChecking}>
          Refresh
        </button>
      </div>
      <ul className="status-list">
        <StatusRow label="API server" state={status.api} />
        <StatusRow label="Database" state={status.database} />
      </ul>
      <p className="muted" aria-live="polite">
        {status.checkedAt
          ? `Last checked at ${status.checkedAt.toLocaleTimeString()}`
          : 'Contacting the API…'}
      </p>
    </section>
  );
}
