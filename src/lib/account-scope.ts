// Set once before importing the database or application. Switching accounts
// starts a new page so no old subscriptions or writes survive into the new UI.
let owner: string | null | undefined;
export function initializeAccountScope(id: string | null) {
  if (owner !== undefined) throw new Error('Account storage is already open. Reload to switch accounts.');
  owner = id;
}
export function accountDatabaseName() {
  if (owner === undefined) throw new Error('Account storage has not been initialized.');
  return owner ? `estate-inventory-account-${encodeURIComponent(owner)}` : 'estate-inventory-signed-out';
}
export function accountMatches(id: string | null) { return owner !== undefined && owner === id; }
export function assertAccountUser(id: string | null) {
  if (!id || !accountMatches(id)) throw new Error('Your account changed. Reload the app before continuing. Your saved work is kept.');
}
