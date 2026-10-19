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
  await page.getByText('Shared details and family choices (optional)', { exact: true }).click();
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


test('photo batch survives reload, saves unnamed items, and fits this viewport', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signIn(page);
  const base = estateBase(page);
  await page.getByRole('link', { name: "Photograph a room's items" }).click();
  const fixture = new URL('./fixtures/lamp.jpg', import.meta.url).pathname;
  await page.getByLabel('Choose photos, one item per photo', { exact: true }).setInputFiles([fixture, fixture]);
  await expect(page.getByRole('heading', { name: 'In this batch (2)' })).toBeVisible();
  await expect(page.getByText(/^Batch saved on this device/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'In this batch (2)' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: `test-results/ui/${testInfo.project.name}-batch.png`, fullPage: true });
  await page.getByRole('button', { name: 'Save 2 new items', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Saved 2 of 2' })).toBeVisible();
  await page.getByRole('link', { name: 'Review unnamed items later' }).click();
  await expect(page.getByRole('heading', { name: 'Inventory', exact: true })).toBeVisible();
  await expect(page.getByText('Unnamed item (see photo)', { exact: false }).first()).toBeVisible();
  await page.goto(`${base}/more`);
  await expect(page.getByRole('heading', { name: 'Use it as an app' })).toBeVisible();
  await expect(page.getByText(/Deployment:/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('batch opens family choices and reports distinguish choices from handoffs', async ({ page }, testInfo) => {
  await signIn(page);
  const base = estateBase(page);
  await page.goto(`${base}/scan`);
  await page.getByLabel('Item name', { exact: true }).fill(`Family discussion ${Date.now().toString(36)}`);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByText('Shared details and family choices (optional)', { exact: true }).click();
  await page.getByLabel('Ask the family about these items').check();
  await page.getByRole('button', { name: 'Save 1 new item', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Saved 1 of 1' })).toBeVisible();
  await page.getByRole('link', { name: 'Open', exact: true }).click();
  await page.getByRole('button', { name: 'Discuss first', exact: true }).click();
  await expect(page.getByText(/Your answer:/)).toBeVisible();
  await page.goto(`${base}/reports/choices`);
  await expect(page.getByRole('heading', { name: 'Family choices', exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Family choices report' })).toBeVisible();
  await page.screenshot({ path: `test-results/ui/${testInfo.project.name}-choices.png`, fullPage: false });
  await page.goto(`${base}/reports/beneficiaries`);
  await expect(page.getByRole('heading', { name: 'Beneficiary summary', exact: true })).toBeVisible();
});
