import { expect, test, type Page } from '@playwright/test';
async function login(page: Page, email: string, saved = true) {
  await page.goto('/estates');
  const signOut = page.getByRole('button', { name: 'Sign out', exact: true });
  const passwordTab = page.getByRole('button', { name: 'Password', exact: true });
  await expect(signOut.or(passwordTab)).toBeVisible();
  if (await signOut.isVisible()) {
    await signOut.click();
    const confirm = page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true });
    await expect(passwordTab.or(confirm)).toBeVisible();
    if (await confirm.isVisible()) await confirm.click();
    await expect(passwordTab).toBeVisible();
  }
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Password', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('estate-demo-pass');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('link', { name: "Photograph a room's items" })).toBeVisible({ timeout: 30000 });
  if (saved) await expect(page.getByText('All saved', { exact: true })).toBeVisible({ timeout: 30000 });
}
test('switching accounts preserves the first account queue without exposing or replaying it', async ({ page }) => {
  await login(page, 'alex@example.com');
  const first = 'estate-inventory-account-11111111-1111-4111-8111-111111111111';
  await page.evaluate(async name => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open(name);
      open.onsuccess = () => {
        const db = open.result; const tx = db.transaction(['meta', 'outbox'], 'readwrite');
        tx.objectStore('meta').put({ key: 'private-sentinel', value: 'account A only' });
        tx.objectStore('outbox').add({ id: 'isolation-test', estate_id: 'test', kind: 'api', method: 'POST', path: '/account-a-only', body: {}, status: 'pending', attempts: 0, created_at: new Date().toISOString(), label: 'Account A unsent work', entity_id: null });
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
      }; open.onerror = () => reject(open.error);
    });
  }, first);
  // Simulate a dropped connection for this queued operation only.
  const attemptedUsers: string[] = [];
  await page.route('**/account-a-only', async route => {
    const token = route.request().headers().authorization?.split(' ')[1];
    if (token) attemptedUsers.push(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub);
    await route.abort();
  });
  await login(page, 'blair@example.com');
  const currentNames = await page.evaluate(() => indexedDB.databases().then(rows => rows.map(row => row.name)));
  expect(currentNames).toContain(first);
  expect(currentNames).toContain('estate-inventory-account-22222222-2222-4222-8222-222222222222');
  await expect(page.getByText('Account A unsent work')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('link', { name: "Photograph a room's items" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('All saved', { exact: true })).toBeVisible({ timeout: 30000 });
  expect(attemptedUsers).not.toContain('22222222-2222-4222-8222-222222222222');
  await login(page, 'alex@example.com', false);
  const preserved = await page.evaluate(async name => new Promise(resolve => {
    const open = indexedDB.open(name); open.onsuccess = () => {
      const db = open.result; const tx = db.transaction('outbox');
      const result = tx.objectStore('outbox').index('id').get('isolation-test');
      result.onsuccess = () => { db.close(); resolve(!!result.result); };
    };
  }), first);
  expect(preserved).toBe(true);
});

test('legacy shared data is quarantined and never submitted by the new account', async ({ page }) => {
  await page.goto('/sign-in');
  await page.evaluate(async () => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('estate-inventory');
    open.onupgradeneeded = () => open.result.createObjectStore('outbox', { keyPath: 'id' });
    open.onsuccess = () => {
      const db = open.result; const tx = db.transaction('outbox', 'readwrite');
      tx.objectStore('outbox').put({ id: 'legacy-private', status: 'pending' });
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
  }));
  await login(page, 'blair@example.com');
  await expect(page.getByText(/Earlier device data has been kept separately/)).toBeVisible();
  const preserved = await page.evaluate(async () => new Promise(resolve => {
    const open = indexedDB.open('estate-inventory'); open.onsuccess = () => {
      const db = open.result; const request = db.transaction('outbox').objectStore('outbox').get('legacy-private');
      request.onsuccess = () => { db.close(); resolve(!!request.result); };
    };
  }));
  expect(preserved).toBe(true);
});
