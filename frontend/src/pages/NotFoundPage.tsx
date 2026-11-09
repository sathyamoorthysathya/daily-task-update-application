import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="auth-page">
      <main className="auth-card card">
        <h1>Page not found</h1>
        <p className="muted">The page you are looking for doesn't exist.</p>
        <Link to="/dashboard">Go to the dashboard</Link>
      </main>
    </div>
  );
}
