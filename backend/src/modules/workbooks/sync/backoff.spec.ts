import { retryDelayMs } from './backoff.js';

describe('retryDelayMs', () => {
  const noJitter = () => 0.5; // jitter factor 1.0

  it('doubles the delay after every failed attempt', () => {
    expect([1, 2, 3, 4, 5].map((attempt) => retryDelayMs(attempt, 1000, 60_000, noJitter))).toEqual(
      [1000, 2000, 4000, 8000, 16_000],
    );
  });

  it('never exceeds the maximum delay', () => {
    expect(retryDelayMs(30, 1000, 60_000, noJitter)).toBe(60_000);
    expect(retryDelayMs(30, 1000, 60_000, () => 0.999)).toBe(60_000);
  });

  it('adds ±20 % jitter so retries of many jobs do not align', () => {
    expect(retryDelayMs(3, 1000, 60_000, () => 0)).toBe(3200);
    expect(retryDelayMs(3, 1000, 60_000, () => 1)).toBe(4800);
  });

  it('is never negative or fractional', () => {
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      const delay = retryDelayMs(attempt, 7, 100_000);
      expect(Number.isInteger(delay)).toBe(true);
      expect(delay).toBeGreaterThan(0);
    }
  });
});
