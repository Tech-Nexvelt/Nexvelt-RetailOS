# Do not apply these migrations to the shared Supabase project

These 14 files are the **original** RetailOS design, written for a project of its own (schema `public`). They are preserved unchanged (sealed in `SHA256SUMS`) as the reference for `supabase/retailos/migrations`.

Applied to the shared Tirumala project they would:
* run `revoke all on all tables in schema public from anon, authenticated` (migration 0003), removing Tirumala's access to its own tables;
* change default privileges project-wide (migration 0001);
* collide with Tirumala's `invoices`, `invoice_items`, `payments`, `products`, `categories`, `profiles`;
* add a second trigger on `auth.users` next to Tirumala's.

Use `supabase/retailos/` instead, and only after approval. The Supabase CLI is not linked to the project; do not run `supabase db push` from this repository.
