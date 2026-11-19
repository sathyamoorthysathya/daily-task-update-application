import { Link, useRouteError } from 'react-router';

/** A page's code could not be downloaded (offline, flaky network, or a new version deployed). */
function isLoadFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    /dynamically imported module|Importing a module script failed|Failed to fetch|Loading chunk/i.test(
      error.message,
    )
  );
}

/** Shown instead of a page that failed to load or crashed. */
export function RouteErrorPage() {
  const error = useRouteError();
  const loadFailure = isLoadFailure(error);

  return (
    <div className="app">
      <main className="card empty-state" role="alert">
        <h1>{loadFailure ? 'This page couldn’t load' : 'Something went wrong'}</h1>
        <p className="muted">
          {loadFailure
            ? 'Check your internet connection and try again.'
            : 'Please try again. If it keeps happening, reload the app.'}
        </p>
        <div className="form-actions">
          <button
            type="button"
            className="button button--primary"
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
          <Link to="/dashboard" className="button" reloadDocument>
            Go to dashboard
          </Link>
        </div>
      </main>
    </div>
  );
}
