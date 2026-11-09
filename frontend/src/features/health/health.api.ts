import { apiClient } from '../../lib/api/http-client';
import type { HealthCheckResponse, ServiceState, SystemStatus } from './health.types';

export function getLiveness(signal?: AbortSignal) {
  return apiClient.get<HealthCheckResponse>('/health/live', { signal });
}

export function getReadiness(signal?: AbortSignal) {
  return apiClient.get<HealthCheckResponse>('/health', { signal });
}

/** Checks API liveness and database readiness in parallel. Never rejects. */
export async function fetchSystemStatus(signal?: AbortSignal): Promise<SystemStatus> {
  const [live, ready] = await Promise.allSettled([getLiveness(signal), getReadiness(signal)]);

  const api: ServiceState =
    live.status === 'fulfilled' && live.value.status === 'ok' ? 'up' : 'down';
  const database: ServiceState =
    ready.status === 'fulfilled' && ready.value.details.database?.status === 'up' ? 'up' : 'down';

  return { api, database, checkedAt: new Date() };
}
