import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deploymentSecrets } from '../scripts/import-deploy-secrets.mjs';

test('dotenv credentials are parsed as data and only approved keys are imported', () => {
  assert.deepEqual(Object.fromEntries(deploymentSecrets('PROD_SUPABASE_DB_PASSWORD="literal$(echo secret)"\nUNRELATED_SECRET=private\nVITE_SERVICE_ROLE_KEY=private\nGH_TOKEN=private\nAPPLE_TEAM_ID=team\nSUPABASE_ACCESS_TOKEN=\n')), { PROD_SUPABASE_DB_PASSWORD: 'literal$(echo secret)', APPLE_TEAM_ID: 'team' });
});
