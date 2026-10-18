import { expect, test, type Page } from '@playwright/test';

// Regression and feature tests on a phone-sized browser against the local
// stack and demo seed (alex@example.com, administrator of the demo estate).
const EMAIL = process.env.E2E_EMAIL ?? 'alex@example.com';
const PASSWORD = process.env.E2E_PASSWORD ?? 'estate-demo-pass';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Use a password instead' }).click();
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('link', { name: /Add an item/ })).toBeVisible();
  await expect(page.getByText('All saved')).toBeVisible({ timeout: 30_000 });
}

const estateBase = (page: Page) => page.url().replace(/\/e\/([^/]+).*$/, '/e/$1');

test('Family settings opens after its estate data loads', async ({ page }) => {
  await signIn(page);
  await page.goto(`${estateBase(page)}/family`);
  await expect(page.getByRole('heading', { name: 'Family and settings' })).toBeVisible();
});

test('password recovery uses an email code before setting a new password', async ({ page }) => {
  const requests: { url: string; body: string }[] = [];
  await page.route('**/auth/v1/recover', async (route) => {
    requests.push({ url: route.request().url(), body: route.request().postData() ?? '' });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });
  await page.route('**/auth/v1/verify', async (route) => {
    requests.push({ url: route.request().url(), body: route.request().postData() ?? '' });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: 'recovery-access-token',
        token_type: 'bearer',
        expires_in: 3600,
        refresh_token: 'recovery-refresh-token',
        user: { id: 'recovery-user', aud: 'authenticated', role: 'authenticated', email: 'family@example.com' },
      }),
    });
  });
  await page.route('**/auth/v1/user', async (route) => {
    requests.push({ url: route.request().url(), body: route.request().postData() ?? '' });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'recovery-user', aud: 'authenticated', role: 'authenticated', email: 'family@example.com' }),
    });
  });

  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Use a password instead' }).click();
  await page.getByLabel('Email').fill('family@example.com');
  await page.getByRole('button', { name: 'Forgot your password?' }).click();
  await page.getByRole('button', { name: 'Email me a reset code' }).click();
  await expect(page.getByText(/We sent a 6-digit password reset code/)).toBeVisible();
  await page.getByLabel('6-digit code').fill('123456');
  await page.getByRole('button', { name: 'Verify code' }).click();
  await page.getByLabel('New password').fill('a-new-secure-password');
  await page.getByRole('button', { name: 'Set new password' }).click();

  await expect.poll(() => requests.length).toBe(3);
  expect(JSON.parse(requests[0].body)).toMatchObject({ email: 'family@example.com' });
  expect(JSON.parse(requests[1].body)).toMatchObject({ email: 'family@example.com', token: '123456', type: 'recovery' });
  expect(JSON.parse(requests[2].body)).toMatchObject({ password: 'a-new-secure-password' });
});

test('an item saved as up for grabs opens a round (local database transaction regression)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page);
  await page.getByRole('link', { name: /Add an item/ }).click();
  await page.getByRole('button', { name: /Enter description|Continue to details/ }).click();
  const title = `Copper kettle ${Date.now().toString(36)}`;
  await page.getByLabel('Short description').fill(title);
  await page.getByRole('button', { name: 'Next' }).click();
  const dup = page.getByRole('heading', { name: 'Is this already in the inventory?' });
  const next = page.getByRole('heading', { name: 'What should happen to it?' });
  await expect(dup.or(next)).toBeVisible();
  if (await dup.isVisible()) await page.getByRole('button', { name: /It's a different item/ }).click();
  await page.getByText('Up for grabs', { exact: true }).click();
  await page.getByRole('button', { name: 'Save item' }).click();
  await expect(page.getByRole('heading', { name: /Saved\. Item \d{4,} is in the inventory\./ })).toBeVisible();
  await page.getByRole('link', { name: 'View this item' }).click();
  await expect(page.getByRole('heading', { name: 'Up for grabs', exact: true })).toBeVisible();
  expect(errors.filter((e) => /objectStore|IDB|NotFoundError/i.test(e))).toEqual([]);
});

test('batch inventory saves several items with shared traits', async ({ page }) => {
  await signIn(page);
  await page.goto(`${estateBase(page)}/scan`);
  await expect(page.getByRole('heading', { name: 'Batch inventory' })).toBeVisible();
  await page.getByLabel('Kind of item').first().selectOption('CHN');
  await page.getByLabel('Brand or maker (optional)').fill('Lenox');
  const stamp = Date.now().toString(36);
  for (const n of [`Dinner plate ${stamp}`, `Soup bowl ${stamp}`, `Gravy boat ${stamp}`]) {
    await page.getByLabel('Item name').fill(n);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'In this batch (3)' })).toBeVisible();
  await page.getByRole('button', { name: /Save 3 new items/ }).click();
  await expect(page.getByRole('heading', { name: 'Saved 3 of 3' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'In this batch (0)' })).toBeVisible();
  // The shared kind and brand were applied.
  await page.getByRole('link', { name: 'Open' }).first().click();
  await expect(page.getByText('China, glass and crystal (CHN)')).toBeVisible();
  await expect(page.getByText('Lenox')).toBeVisible();
});

test('reports open on their own screen, readable, and save as files', async ({ page }) => {
  await signIn(page);
  await page.goto(`${estateBase(page)}/reports`);
  await page.getByRole('navigation', { name: 'Reports' }).getByRole('link', { name: /^Inventory/ }).click();
  await expect(page.getByRole('heading', { name: 'Inventory', exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Inventory report' }).getByRole('listitem').first()).toBeVisible();
  const csv = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Spreadsheet' }).click();
  expect((await csv).suggestedFilename()).toMatch(/inventory-\d{4}-\d{2}-\d{2}\.csv$/);
  const pdf = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save PDF' }).click();
  expect((await pdf).suggestedFilename()).toMatch(/inventory-\d{4}-\d{2}-\d{2}\.pdf$/);

  await page.goto(`${estateBase(page)}/reports/valuation`);
  await expect(page.getByRole('table')).toBeVisible();
  await page.goto(`${estateBase(page)}/reports/exceptions`);
  await expect(page.getByRole('list', { name: 'Exceptions report' }).getByRole('listitem').first()).toBeVisible();
  await page.goto(`${estateBase(page)}/reports/activity`);
  await expect(page.getByRole('list', { name: 'Activity history report' }).getByRole('listitem').first()).toBeVisible({ timeout: 20_000 });
});
