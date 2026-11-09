import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// findBy*/waitFor resolve as soon as the UI is ready; the longer ceiling (default 1 s) only
// prevents false failures on slow or busy machines such as shared CI runners.
configure({ asyncUtilTimeout: 5_000 });

afterEach(() => {
  cleanup();
});
