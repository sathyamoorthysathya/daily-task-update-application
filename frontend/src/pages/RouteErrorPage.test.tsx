import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageSkeleton } from '../components/Skeletons';
import { RouteErrorPage } from './RouteErrorPage';

function renderFailingPage(error: Error) {
  const Failing = () => {
    throw error;
  };
  const router = createMemoryRouter(
    [{ path: '/', element: <Failing />, errorElement: <RouteErrorPage /> }],
    { initialEntries: ['/'] },
  );
  render(<RouterProvider router={router} />);
}

describe('RouteErrorPage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('explains a page that could not be downloaded and offers to try again', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderFailingPage(new TypeError('Failed to fetch dynamically imported module: /x.js'));

    expect(screen.getByRole('heading', { name: 'This page couldn’t load' })).toBeInTheDocument();
    expect(screen.getByText(/Check your internet connection/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows a general message for other errors', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderFailingPage(new Error('boom'));

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
  });
});

describe('PageSkeleton', () => {
  it('previews a whole page while its code downloads', () => {
    const { container } = render(<PageSkeleton page="tasks" />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(container.firstElementChild).toHaveClass('app', 'app--tasks');
    expect(container.querySelectorAll('.skeleton-bone').length).toBeGreaterThan(10);
  });
});
