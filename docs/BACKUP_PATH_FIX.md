# Backup output paths

The first real backup run 43894073637 passed configuration and ledger verification and dumped the production database, then stopped before encryption/upload. Supabase CLI resolved relative dump filenames against the project directory even after the shell entered out/. The archive step therefore could not find roles.sql, schema.sql or data.sql.

Use absolute output paths for all three dumps. The archive now reads exactly the files produced in out/. No production database changes are needed. A local real CLI dump to an absolute path verified the behavior. The workflow must still complete an actual upload, media check and isolated restore drill before backup recovery is considered proven.

Release 0.2.5 contains this workflow repair. Account-storage PR #41 remains unmerged and must use the following release version before it is approved for deployment.

Validation: lint/types, 48 unit tests, 15 script tests, 84 database tests, production build, and 33 browser regressions passed. All three local dump outputs were archived, encrypted with the configured public recipient and decrypted with the matching recovery identity; decrypted bytes matched the original archive. This proves local packaging and key compatibility, not R2 upload or production recovery.
