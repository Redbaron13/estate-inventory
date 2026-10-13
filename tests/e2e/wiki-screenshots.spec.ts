import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WIKI_IMAGES = path.resolve(HERE, '../../docs/wiki/images');

const EMAIL = process.env.E2E_EMAIL ?? 'alex@example.com';
const PASSWORD = process.env.E2E_PASSWORD ?? 'estate-demo-pass';

const estateBase = (page: Page) => page.url().replace(/\/e\/([^/]+).*$/, '/e/$1');

async function snap(page: Page, filename: string) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(WIKI_IMAGES, `${filename}.png`), fullPage: true });
}

test('capture comprehensive mobile-first wiki screenshots', async ({ page }) => {
  test.setTimeout(90_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.name));

  // 1. Sign in screen
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Use a password instead' }).click();
  await snap(page, '01-sign-in');

  // Fill credentials and sign in
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('link', { name: /Add an item/ })).toBeVisible();
  await expect(page.getByText('All saved')).toBeVisible({ timeout: 30_000 });

  const base = estateBase(page);

  // 2. Home Dashboard
  await snap(page, '02-home-dashboard');

  // 3. Add Item - Camera / Initial capture screen
  await page.getByRole('link', { name: /Add an item/ }).click();
  await expect(page.getByRole('heading', { name: 'Add an item' })).toBeVisible();
  await snap(page, '03-capture-camera');

  // 4. Add Item - Photo preview
  await page.locator('input[type=file][capture]').first().setInputFiles(path.join(HERE, 'fixtures', 'lamp.jpg'));
  await expect(page.locator('img').first()).toBeVisible();
  await snap(page, '04-capture-photo-staged');

  // 5. Add Item - Details step
  await page.getByRole('button', { name: 'Continue to details' }).click();
  await page.getByLabel('Short description').fill('Mid-century brass desk lamp with green glass shade');
  await page.getByLabel('Kind of item').selectOption('DEC');
  await snap(page, '05-capture-details');

  // 6. Duplicate check (or next step)
  await page.getByRole('button', { name: 'Next' }).click();
  const dupCheck = page.getByRole('heading', { name: 'Is this already in the inventory?' });
  const nextStep = page.getByRole('heading', { name: 'What should happen to it?' });
  await expect(dupCheck.or(nextStep)).toBeVisible();

  if (await dupCheck.isVisible()) {
    await snap(page, '06-duplicate-check');
    await page.getByRole('button', { name: /It's a different item/ }).click();
  }
  await expect(nextStep).toBeVisible();

  // 7. Next step selection (Up for grabs)
  await snap(page, '07-next-step');
  await page.getByText('Up for grabs', { exact: true }).click();
  await page.getByRole('button', { name: 'Save item' }).click();

  // 8. Item Saved with code tag
  const savedHeading = page.getByRole('heading', { name: /Saved\. Item \d+ is in the inventory\./ });
  await expect(savedHeading).toBeVisible();
  await snap(page, '08-item-saved-tag');

  // 9. Item Detail view
  await page.getByRole('link', { name: 'View this item' }).click();
  await expect(page.getByRole('heading', { name: /Mid-century brass/ })).toBeVisible();
  await snap(page, '10-item-detail-overview');

  // 10. Inventory list and search
  await page.goto(`${base}/items`);
  await expect(page.getByLabel('Search')).toBeVisible();
  await snap(page, '09-inventory-list');

  // 11. Batch Inventory / QuickScan
  await page.goto(`${base}/scan`);
  await expect(page.getByRole('heading', { name: 'Batch inventory' })).toBeVisible();
  await page.getByLabel('Kind of item').first().selectOption('CHN');
  await page.getByLabel('Brand or maker (optional)').fill('Wedgwood');
  await snap(page, '11-batch-inventory');

  // 12. Decisions & Grab Rounds
  await page.goto(`${base}/decisions`);
  await expect(page.getByRole('heading', { name: 'Decisions' })).toBeVisible();
  await snap(page, '12-decisions-dashboard');

  // 13. Places and Labels
  await page.goto(`${base}/places`);
  await expect(page.getByRole('heading', { name: 'Places and labels' })).toBeVisible();
  await snap(page, '13-places-locations');

  // 14. Place Detail with QR code
  const firstPlaceLink = page.getByRole('link', { name: /Living room|Basement|Office|Bedroom|Holding/ }).first();
  if (await firstPlaceLink.isVisible()) {
    await firstPlaceLink.click();
    await snap(page, '14-place-detail-qr');
  }

  // 15. Reports Hub
  await page.goto(`${base}/reports`);
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  await snap(page, '15-reports-hub');

  // 16. Valuation Report
  await page.goto(`${base}/reports/valuation`);
  await expect(page.getByRole('table')).toBeVisible();
  await snap(page, '16-report-valuation');

  // 17. Exceptions Report
  await page.goto(`${base}/reports/exceptions`);
  await expect(page.getByRole('heading', { name: 'Exceptions' })).toBeVisible();
  await snap(page, '17-report-exceptions');

  // 18. Uploads Queue
  await page.goto(`${base}/uploads`);
  await expect(page.getByRole('heading', { name: 'Upload queue' })).toBeVisible();
  await snap(page, '18-uploads-queue');

  // 19. Backup & Ledger Integrity
  await page.goto(`${base}/backup`);
  await expect(page.getByRole('heading', { name: 'Save a copy' })).toBeVisible();
  await snap(page, '19-backup-vault');

  // 20. Family & Settings
  await page.goto(`${base}/family`);
  const familyHeading = page.getByRole('heading', { name: 'Family and settings' });
  if (!(await familyHeading.isVisible().catch(() => false))) {
    const route = new URL(page.url()).pathname.replace(/\/e\/[^/]+/, '/e/:estateId');
    const details = {
      route,
      pageHeadingCount: await page.locator('h1').count(),
      crashBoundaryVisible: await page.getByRole('heading', { name: 'This screen could not open' }).isVisible().catch(() => false),
      signInFormVisible: await page.getByLabel('Email').isVisible().catch(() => false),
      openingStatusVisible: await page.getByText('Opening', { exact: true }).isVisible().catch(() => false),
      mainChildCount: await page.locator('main > *').count(),
      mainTextLength: await page.locator('main').innerText().then((text) => text.length).catch(() => -1),
      appRootChildren: await page.locator('#root').evaluate((root) => root.childElementCount),
      pageErrors: pageErrors.slice(-5),
    };
    console.log(`[e2e:family-route] ${JSON.stringify(details)}`);
  }
  await expect(familyHeading).toBeVisible();
  await snap(page, '20-family-settings');
});
