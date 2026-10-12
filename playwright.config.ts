import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against a built app (vite preview) connected to a
// local Supabase stack with the seed data (supabase start / db reset).
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : undefined,
  },
  projects: [
    {
      name: 'phone',
      use: { ...devices['Pixel 7'], permissions: ['camera'] },
    },
  ],
});
