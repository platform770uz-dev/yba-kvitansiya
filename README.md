# Kvitansiya — Yosh blogerlar akademiyasi

A lightweight static site for issuing payment receipts and checking authenticity by QR code.

## Deployment

- Publish the repository root from the `main` branch with GitHub Pages.
- Configure the public Supabase URL and publishable client key in `config.js`.
- Apply the additive SQL migration in `supabase/migrations/` to the intended Supabase project.
- Create an administrator account in Supabase Auth, then add its Auth UUID to `kv_admins` using the commented SQL example in the migration.

## Local checks

Run amount-to-words tests with `node --test tests/amount.test.cjs`. Serve this folder over HTTP for a local preview; do not open it with `file://`.

## Data and access

Receipt records are kept only in Supabase. Browser storage is not used for receipt data; Supabase Auth manages its own session, and a guarded storage call remembers the last payment method. Public verification returns only a masked payer name and child initials. Receipts are immutable after creation except for cancellation with a required reason.

The publishable client key is public by design. Never add a service-role key, password, or bot token to this repository.
