import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Uses the local seed data: alex@example.com (administrator of the demo estate).
const EMAIL = process.env.E2E_EMAIL ?? 'alex@example.com';
const PASSWORD = process.env.E2E_PASSWORD ?? 'estate-demo-pass';
const SHOTS = process.env.E2E_SCREENSHOTS;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Use a password instead' }).click();
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('link', { name: /Add an item/ })).toBeVisible();
}

test('records an item with a photo while offline, then uploads it', async ({ page, context }) => {
  await signIn(page);
  await expect(page.getByText('All saved')).toBeVisible({ timeout: 30_000 });
  await shot(page, '01-home');

  // Lose signal (basement, closet).
  await context.setOffline(true);
  await page.getByRole('link', { name: /Add an item/ }).click();
  await expect(page.getByRole('heading', { name: 'Add an item' })).toBeVisible();
  await page.locator('input[type=file][capture]').first().setInputFiles(path.join(HERE, 'fixtures', 'lamp.jpg'));
  await expect(page.locator('img').first()).toBeVisible();
  await shot(page, '02-capture-photo');
  await page.getByRole('button', { name: 'Continue to details' }).click();
  await page.getByLabel('Short description').fill('Brass desk lamp with green shade');
  await page.getByLabel('Kind of item').selectOption('DEC');
  await shot(page, '03-details');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'What should happen to it?' })).toBeVisible();
  await shot(page, '04-next-step');
  await page.getByRole('button', { name: 'Save item' }).click();

  const saved = page.getByRole('heading', { name: /Saved\. Item \d{4} is in the inventory\./ });
  await expect(saved).toBeVisible();
  const code = await page.locator('.tag').first().textContent();
  expect(code).toMatch(/^\d{4,}[A-Z]{2}-[A-Z0-9]{2}\d[A-Z]{3}-[0-9A-HJKMNP-TV-Z]{3}$/);
  expect(code).toContain('-');
  await expect(page.getByText(/Offline: \d+ waiting/)).toBeVisible();
  await shot(page, '05-saved-offline');

  // The item is browsable offline with its "not yet uploaded" marker.
  await page.getByRole('link', { name: 'View this item' }).click();
  await expect(page.getByRole('heading', { name: /Brass desk lamp/ })).toBeVisible();
  await expect(page.getByText('Not yet uploaded')).toBeVisible();
  await shot(page, '06-item-offline');

  // Signal returns: everything uploads in order and the marker clears.
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText('All saved')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('Not yet uploaded')).toHaveCount(0);
  await shot(page, '07-item-synced');
});

test('flags a possible duplicate before saving', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: /Add an item/ }).click();
  await page.getByRole('button', { name: /Enter description|Continue to details/ }).click();
  await page.getByLabel('Short description').fill('Grandfather clock');
  await page.getByLabel('Where was it found?').selectOption({ label: ' Living room' });
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Is this already in the inventory?' })).toBeVisible();
  await shot(page, '08-duplicate-check');
  await page.getByRole('button', { name: /Not sure/ }).click();
  await expect(page.getByRole('heading', { name: 'What should happen to it?' })).toBeVisible();
});

test('inventory search, decisions and reports render', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Inventory', exact: true }).click();
  await page.getByLabel('Search').fill('lamp');
  await expect(page.getByText(/Brass floor lamp/)).toBeVisible();
  await shot(page, '09-inventory-search');
  await page.getByRole('link', { name: 'Decisions' }).click();
  await expect(page.getByRole('heading', { name: 'Decisions' })).toBeVisible();
  await shot(page, '10-decisions');
  await page.goto(page.url().replace(/\/decisions$/, '/reports'));
  await page.getByRole('button', { name: 'View' }).first().click();
  await expect(page.getByRole('table')).toBeVisible();
  await shot(page, '11-reports');
});
