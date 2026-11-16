import 'fake-indexeddb/auto';

import { vi } from 'vitest';
vi.mock('../../src/lib/account-scope', () => ({ accountDatabaseName: () => 'estate-inventory-unit-test', assertAccountUser: vi.fn(), accountMatches: () => true }));
