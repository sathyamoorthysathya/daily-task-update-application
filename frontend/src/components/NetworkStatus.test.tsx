import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { trackRequest } from '../lib/api/network-activity';
import { NetworkStatus } from './NetworkStatus';
import { TaskListSkeleton } from './Skeletons';

/** A request that stays in flight until `finish` is called. */
function pendingRequest() {
  let finish!: () => void;
  const done = trackRequest(() => new Promise<void>((resolve) => (finish = resolve)));
  return {
    finish: async () => {
      finish();
      await done;
    },
  };
}

const progressBar = (container: HTMLElement) => container.querySelector('.top-progress')!;

describe('loading previews', () => {
  it('lay out placeholder shapes and announce what is loading', () => {
    const { container } = render(<TaskListSkeleton />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading tasks…');
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    // The shapes are visual only.
    expect(container.querySelector('.skeleton-shapes')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('.skeleton-bone').length).toBeGreaterThan(10);
  });
});

describe('NetworkStatus', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows the progress bar only for requests that are not instant', async () => {
    const { container } = render(<NetworkStatus />);
    expect(progressBar(container)).not.toHaveAttribute('data-active');

    let request!: ReturnType<typeof pendingRequest>;
    act(() => {
      request = pendingRequest();
    });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(progressBar(container)).not.toHaveAttribute('data-active');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(progressBar(container)).toHaveAttribute('data-active');

    await act(() => request.finish());
    expect(progressBar(container)).not.toHaveAttribute('data-active');
  });

  it('announces a slow connection while a request takes long', async () => {
    render(<NetworkStatus />);
    let request!: ReturnType<typeof pendingRequest>;
    act(() => {
      request = pendingRequest();
    });

    act(() => {
      vi.advanceTimersByTime(7999);
    });
    expect(screen.queryByText(/Slow connection/)).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Slow connection — still working on it…');

    await act(() => request.finish());
    expect(screen.queryByText(/Slow connection/)).not.toBeInTheDocument();
  });

  it('shows a banner while the browser is offline', () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(<NetworkStatus />);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('You’re offline.');

    onLine.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
