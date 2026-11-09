/** Response shape of the backend's Terminus health endpoints. */
export interface HealthIndicatorResult {
  status: 'up' | 'down';
  [key: string]: unknown;
}

export interface HealthCheckResponse {
  status: 'ok' | 'error' | 'degraded' | 'shutting_down';
  info?: Record<string, HealthIndicatorResult>;
  error?: Record<string, HealthIndicatorResult>;
  details: Record<string, HealthIndicatorResult>;
}

export type ServiceState = 'checking' | 'up' | 'down';

export interface SystemStatus {
  api: ServiceState;
  database: ServiceState;
  checkedAt?: Date;
}
