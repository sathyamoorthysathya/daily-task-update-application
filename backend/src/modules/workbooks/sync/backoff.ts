/**
 * Delay before retry number `attempt` (1 = first retry): exponential (base · 2^(attempt-1)),
 * capped at `maxMs`, with ±20 % jitter so that many failing jobs do not retry in lock-step.
 */
export function retryDelayMs(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  const jitter = 0.8 + random() * 0.4;
  return Math.max(1, Math.min(maxMs, Math.round(exponential * jitter)));
}
