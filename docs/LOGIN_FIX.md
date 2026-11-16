# Email sign-in and registration

This change accepts Supabase email sign-in links and account-confirmation sessions. The sign-in screen describes a link, with a code-entry fallback for environments configured to send codes. Create an account is visible without discovering the password tab first. Password registration still requests a name, email and password.

The configured hosted Auth site URL and allowed redirect must include https://eiapp3.redbaronworks.com/. Email delivery, spam filtering and hosted signup settings are provider configuration; this UI change does not bypass them. An administrator must invite the new account to an estate before that account can see family records.

Validation includes a real locally generated Supabase magic link, session persistence after reload, registration form visibility and the existing responsive browser suite. No real email was sent to family members. This PR builds on PR #39; merge #39 first, then retarget this PR to mainbranch and merge after CI. Publishing still follows the protected Deploy workflow.
