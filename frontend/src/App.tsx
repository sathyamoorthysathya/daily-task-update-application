import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { routes } from './app/routes';
import { NetworkStatus } from './components/NetworkStatus';
import { AuthProvider } from './features/auth/AuthProvider';

const router = createBrowserRouter(routes);

function App() {
  return (
    <AuthProvider>
      <NetworkStatus />
      <RouterProvider router={router} />
    </AuthProvider>
  );
}

export default App;
