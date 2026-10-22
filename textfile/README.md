# Deployment credentials

Keep the private `.env` file in this folder. Git ignores it. Never upload its contents to an issue, commit or frontend environment.

With Node 22 and the GitHub CLI installed, preview the supported keys, then copy them into repository secrets:

```sh
node scripts/import-deploy-secrets.mjs
node scripts/import-deploy-secrets.mjs --apply
```

Use `--file=/absolute/path/to/.env` if the file lives elsewhere. The command parses dotenv as data and prints key names only. Authenticate with `gh auth login`, or provide `GH_TOKEN` in the private file with permission to manage this repository's secrets. The token itself is never imported.

For production, use `SUPABASE_ACCESS_TOKEN`, `PROD_SUPABASE_PROJECT_REF`, `PROD_SUPABASE_DB_PASSWORD`, `PROD_SUPABASE_URL` and `PROD_SUPABASE_ANON_KEY`. These are already present in the current GitHub deployment environment. Existing environment secrets take precedence over repository secrets, so replace them in that environment if rotating credentials.

For staging, use `STAGING_SUPABASE_PROJECT_REF`, `STAGING_SUPABASE_DB_PASSWORD`, `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY`, `STAGING_SITE_URL`, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Staging requires a separate Supabase project.

For signed Mac releases, use `APPLE_CERTIFICATE_P12_BASE64` (Developer ID Application certificate, including private key), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`. Encode the certificate locally with `base64 < certificate.p12 | tr -d '\n'` and store the result in the private file. Do not put a certificate or private key in the repository.

Other keys are ignored. The file is never loaded into Vite. Custom SMTP remains a Supabase project setting; once configured, deployment detects it and applies the six-digit code templates.
