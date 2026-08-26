# Moving to a new Supabase project

Written for the move to West Oregon, but it works for any project-to-project
move. Nothing here modifies the old project, so it stays a working fallback
until the env vars are switched — and switching them back is the rollback.

## What has to move

| | Count at time of writing |
|---|---|
| Application rows | 84 across 17 tables |
| `auth.users` + `auth.identities` | 4 + 4 |
| Storage objects | 22 (18 invoice PDFs, 2 avatars, 2 ticket attachments) |

## 0. Confirm the region FIRST

A Supabase project's region cannot be changed after creation, so this is
checked before anything moves into it — a wrong region means recreating the
project, not editing it.

```bash
npx tsx scripts/check-region.mts
```

It reads the region out of the pooler hostname in the connection string
(`aws-0-us-west-2.pooler.supabase.com`), so it reports where the project
actually is rather than what was selected in a form.

## 1. Credentials

Add these to `.env` — do not paste them into chat or a commit:

```
NEW_DATABASE_URL="postgresql://...pooler...:6543/postgres?pgbouncer=true"
NEW_DIRECT_URL="postgresql://...:5432/postgres"
NEW_SUPABASE_URL="https://gmiznmzzzfltaffwjgcc.supabase.co"
NEW_SERVICE_ROLE_KEY="..."
```

`.env` is gitignored. Keep the existing values untouched — the scripts read
the old project from them.

## 2. Schema

Two halves, and the second is the one that gets forgotten:

```bash
DATABASE_URL="$NEW_DATABASE_URL" DIRECT_URL="$NEW_DIRECT_URL" npx prisma migrate deploy
DATABASE_URL="$NEW_DATABASE_URL" npx tsx scripts/apply-supabase-sql.mts --commit
```

Prisma creates the tables. `supabase/migrations/*.sql` carries everything
Prisma doesn't model — row-level security, the SECURITY DEFINER functions,
storage buckets and their policies. Skip the second and the app builds,
typechecks and deploys perfectly, then refuses every query at runtime.

## 3. Data

```bash
npx tsx scripts/migrate-to-new-supabase.mts              # dry run
npx tsx scripts/migrate-to-new-supabase.mts --commit
npx tsx scripts/migrate-to-new-supabase.mts --commit --storage
```

Passwords survive. `auth.users` is copied row by row including
`encrypted_password`, rather than through the Admin API, which can only
create a user with a *new* password. Nobody has to reset anything.

The script refuses to write into a database with no schema, copies
parent-first so foreign keys resolve, and uses `on conflict do nothing` so an
interrupted run can simply be repeated.

## 4. Function region

`vercel.json` sets `regions: ["pdx1"]` — Portland, the same metro as
us-west-2 — so the functions sit next to the database. It was `sfo1`.

This is the setting that matters for feel: a page can make several queries,
and each one is a round trip. Static assets still come from the CDN edge
nearest the visitor regardless, so this does not move anything else further
away.

Route-level `preferredRegion` is deprecated in Next 16, which is why this
lives in `vercel.json` rather than in the route files.

## 5. Switch over

In Vercel, replace `DATABASE_URL`, `DIRECT_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` with the new
project's, then redeploy.

Set `SAFE_MODE=1` for the cutover deploy. A cron firing mid-switch against a
half-populated database would email real clients from incomplete data.
Remove it once you have checked the app.

## 6. Verify before trusting it

- Sign in as each of the four users — this is what proves the password copy worked
- Open an invoice and download the PDF (storage + signed URLs)
- Submit a test ticket through the portal (anon RLS policies)
- Check Clients, Time Entries and Invoices all list

## Afterwards

Keep the old project for a couple of weeks, then delete it. While both exist,
be careful which one a stray `.env` points at.

Cron schedules live in `vercel.json`, not in Supabase, so they need nothing.
