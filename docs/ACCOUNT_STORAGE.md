# Separate account storage and rollout

Each account now has its own local IndexedDB database, including photos, batch lists, number reservations, witnesses and pending uploads. Signing out keeps that account's work. Signing in with another account opens a different database. Cross-tab account changes reload into the matching account, and API tokens from a different account are rejected before sending queued work.

The older shared database is left untouched. Its queued operations have no reliable account owner, so the app must not automatically replay or copy them into the next account. A notice explains that old device work is preserved separately. This change prevents ordinary account switching from displaying or uploading another account's local work. It is not encryption against someone with access to browser developer tools or the device itself.

## Before deployment

On each phone or browser that used the old app, sign in as its original user, upload pending changes, save the current batch, and verify the upload queue is empty. Save a readable backup as an extra precaution. Do not clear browser storage or uninstall the old app to troubleshoot this upgrade. If unsent work cannot upload, stop the rollout for that device and recover it with the administrator before making replacement records.

Already uploaded records download into the new account database. Unsent legacy work requires supervised recovery because its owner cannot be proven from the old queue. No automatic migration is claimed. This is a rollout prerequisite, not permission to discard old data.

This PR is stacked on #39. Merge that reviewed infrastructure PR first, then retarget this PR to mainbranch. The login-link PR is separate and should be released before or together with account storage.

## Operational progress

HTTPS was repaired by resetting GitHub Pages domain provisioning and enabling HTTPS enforcement. The live custom domain returns 200 over certificate-validating HTTPS and serves release 0.2.2 from 0ea0a884. HTTP redirects to HTTPS.

Backup encryption recipient and restore identity are now configured in the github-pages environment. The owner has a private recovery file outside the repository, under Documents/Estate Inventory Recovery. Copy it to secure offline storage; it is required to decrypt backups. Never attach it to a PR or chat. The first actual backup and isolated restore drill still require merging #39. No backup-success claim is made until those jobs complete.
