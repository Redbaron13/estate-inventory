import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';

test('email sign-in link establishes a session and registration is visible', async ({ page, request }) => {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await expect(page.getByLabel('Your name', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeVisible();
  // Admin link generation is allowed only against the isolated local demo stack.
  const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  expect(new URL(status.API_URL).hostname).toBe('127.0.0.1');
  const result = await request.post(`${status.API_URL}/auth/v1/admin/generate_link`, {
    headers: { Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`, apikey: status.SERVICE_ROLE_KEY },
    data: { type: 'magiclink', email: 'alex@example.com', redirect_to: 'http://127.0.0.1:4173/' },
  });
  expect(result.ok()).toBe(true);
  const link = (await result.json()).action_link;
  const verified = await request.get(link, { maxRedirects: 0 });
  expect(verified.status()).toBe(303);
  const callback = new URL(verified.headers().location);
  await page.goto(`/${callback.hash}`);
  await expect(page.getByRole('link', { name: "Photograph a room's items" })).toBeVisible({ timeout: 30000 });
  expect(page.url()).not.toContain('access_token');
  await page.reload();
  await expect(page.getByRole('link', { name: "Photograph a room's items" })).toBeVisible();
});
