import { expect, it, vi } from 'vitest';
it('separates account databases and refuses tokens from a different account', async () => {
  const scope = await vi.importActual<typeof import('../../src/lib/account-scope')>('../../src/lib/account-scope');
  expect(() => scope.accountDatabaseName()).toThrow('not been initialized');
  scope.initializeAccountScope('account-a');
  expect(scope.accountDatabaseName()).toBe('estate-inventory-account-account-a');
  expect(scope.accountMatches('account-b')).toBe(false);
  expect(() => scope.assertAccountUser('account-b')).toThrow('account changed');
  expect(() => scope.assertAccountUser(null)).toThrow('account changed');
  expect(() => scope.initializeAccountScope('account-b')).toThrow('already open');
  expect(() => scope.assertAccountUser('account-a')).not.toThrow();
});
