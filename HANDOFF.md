# SecureTECC Platform — Handoff

This is a from-scratch rebuild of SecureTECC's Google Sheets + Apps Script system
(invoicing, time tracking, client support tickets) as a standalone Next.js +
Supabase app. The Sheets system stays live and untouched — this is a parallel
build with a one-time migration and cutover once it reaches feature parity.
It's also being built as BBZ Studio's polished reference build for future
client work, so treat UI polish as part of the deliverable, not an afterthought
— but never at the expense of billing correctness (see priority order below).

**Priority order: billing correctness > ticket reliability > polish.** This
handles real invoices with real dollar amounts. Get the math and RLS right
before making anything prettier.

If you're a fresh Claude Code session picking this up: read this whole file
before touching code, then read `AGENTS.md` (Next.js 16 has real breaking
changes vs. training-data Next.js) and the original build prompt context
below. Confirm scope with the user between phases rather than building
everything in one pass — that's an explicit instruction from the original
brief, not a suggestion.

## Stack (decided, not open for debate)

- Next.js 16 (App Router, TypeScript) — **not** Next 14/15. Read
  `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`
  before writing App Router code. Key differences already accounted for in
  this codebase:
  - `middleware.ts` is renamed to `proxy.ts` / `export function proxy()`.
    This project uses `src/proxy.ts`.
  - `params` / `searchParams` are fully async now (no sync fallback).
  - `next lint` is removed; lint runs via plain `eslint` (see
    `package.json`'s `lint` script).
- Supabase (Postgres + Auth + Storage), RLS enforced at the **database**
  level — this is a hard requirement from the client, not a nice-to-have.
- Prisma **6.19** (pinned — do not upgrade to Prisma 7 without deliberately
  re-evaluating; v7 changed the config file format and generator output
  structure enough that I judged it too new/undocumented to build a billing
  system against blind). Schema: `prisma/schema.prisma`. Client generator is
  the newer `prisma-client` provider outputting to `src/generated/prisma`
  (gitignored) — import from `@/generated/prisma/client`, **not**
  `@/generated/prisma` (there's no index at the folder root with this
  generator).
- shadcn/ui, but note: this shadcn install uses the **`base-nova`** style,
  which is built on `@base-ui/react`, not Radix. This changes some APIs vs.
  what you might expect from older shadcn knowledge:
  - No `asChild` prop on `Button`/`DialogTrigger`/etc. Use `render={<Link .../>}`
    instead (base-ui's polymorphic pattern). See `src/components/app/*.tsx`
    for examples.
  - `Select`'s `onValueChange` can hand back `string | null` — guard with
    `?? ""` when wiring into `react-hook-form`'s `setValue`.
- Resend (email), Google Gemini (`@google/generative-ai`, AI time-entry
  parsing), `@react-pdf/renderer` (invoice PDFs — not yet used), Zod +
  react-hook-form for forms, Vercel Cron (scheduled jobs — not yet used).

## What's built (Phase 1 + Phase 2 — committed)

Commits: `6b7549c` (raw scaffold) → `a0a13f9` (Phase 1+2). Both are on `main`.

### Phase 1 — Foundation
- **Prisma schema** (`prisma/schema.prisma`): `Organization`, `User`,
  `Client`, `ServiceType`, `TimeEntry`, `RecurringCharge`, `Invoice`,
  `Ticket`, `TicketAttachment`. Every tenant table carries `organizationId`.
  `Organization.supportEmail` is unique (used as an upsert key in seeding);
  `Organization.invoiceFromEmail` is a separate nullable field specifically
  for the invoice-send "from" address (see Open Decisions below — this was
  an explicit user answer, not a guess).
- **RLS**: `supabase/migrations/0001_rls_policies.sql`. This is hand-written
  SQL, applied separately from `prisma migrate` (Prisma owns table DDL, this
  file owns Postgres-level access control). It:
  - Defines `SECURITY DEFINER` helper functions (`current_org_id()`,
    `current_user_role()`, `is_admin()`) so policies on `public.users` don't
    recurse into RLS when resolving the caller's own row.
  - Scopes every tenant table to `organization_id = current_org_id()`.
  - Grants `anon` a narrow, `WITH CHECK`-restricted `INSERT` on `tickets` and
    `ticket_attachments` only (public ticket submission, no login) — DB-level
    guarantee that a public submission can only create a `New` ticket with no
    internal fields set, not just a UI-layer restriction.
  - Sets up the `ticket-attachments` Storage bucket with matching policies.
  - **Important — read this before assuming RLS "just works":** Prisma's
    `DATABASE_URL` connects as a privileged Postgres role (typically
    `postgres`), which bypasses RLS entirely regardless of what policies
    exist. `src/lib/db/rls.ts` (`withRLS()`) is what actually makes RLS real:
    every query that should be RLS-scoped runs inside a transaction that
    does `SET LOCAL ROLE authenticated` (or `anon`) plus sets the
    `request.jwt.claims` GUC that `auth.uid()` reads from. **Every new
    server action / route handler that touches tenant data must go through
    `withRLS()`, not the raw `prisma` singleton in `src/lib/db/prisma.ts`.**
    The raw singleton is only for trusted server-only bootstrap code
    (seeding, tenant onboarding) where there's no authenticated user yet.
- **Auth**: `src/lib/supabase/{client,server,admin}.ts` (browser / server /
  service-role clients), `src/proxy.ts` (session refresh + route gating —
  public paths are `/login`, `/support`, `/api/tickets`), `src/lib/auth.ts`
  (`requireAppUser`, `requireAdmin`, `requireOrgContext` — the last one is
  what server actions should call to get both the auth user id for
  `withRLS()` and the resolved app user/org in one shot).
- **App shell**: `src/app/(app)/layout.tsx` + `src/components/app/app-sidebar.tsx`,
  navy `#071E37` / teal `#06E1DC` theme wired into `src/app/globals.css` as
  CSS vars (`--brand-navy`, `--brand-teal`), light + dark mode both handled.

### Phase 2 — Clients + time tracking
- **Client CRUD**: `src/app/(app)/clients/**`, validation in
  `src/lib/validations/client.ts`. Note the comments in that file about why
  `.transform()` / `.default()` are deliberately avoided in the Zod schema —
  they make `zodResolver`'s input type diverge from its output type, which
  breaks `useForm<T>`'s single-type assumption. Null/NaN normalization
  happens explicitly in the server action instead.
- **ServiceType seed + management**: `prisma/seed.ts` seeds SecureTECC's five
  defaults (R-S, P-S, E-S, O-S, L-V, with L-V's $150/hr override) keyed to an
  org found/created by `supportEmail`. Admin-only CRUD UI at
  `src/app/(app)/settings/service-types/**`. Seed script also optionally
  bootstraps a first admin user via `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`
  env vars (uses the Supabase admin API, since Prisma alone can't create an
  `auth.users` row).
- **Manual time entry CRUD**: `src/app/(app)/time-entries/**`. Billing
  minimum rounding (`Math.max(enteredHours, serviceType.billingMinimumHours)`)
  happens **server-side** in the action, re-fetching the service type from
  the DB rather than trusting whatever the client submitted — this is the
  actual source of truth, not a UI nicety.
- **AI-assisted time entry**: `src/lib/ai/time-entry-prompt.ts` is a
  faithful port of the proven production prompt (Appendix A from the
  original brief) — read the comment at the top of that file before touching
  it, it explains the specific misclassification bug ("silently untagged
  entries") the prompt's wording exists to prevent. The acronym/minimum/rate
  table and client alias list are built dynamically per-org; the behavioral
  rules are fixed. `src/app/(app)/time-entries/ai-actions.ts` calls Gemini,
  recovers the service-type code from the required `"R-S — description"`
  prefix (there's no separate JSON field for it), resolves `clientShortName`
  → `clientId`, and returns a **draft** for the technician to review/correct
  — it never writes to the DB directly. `src/components/app/ai-time-entry-dialog.tsx`
  is the two-step (input → review) dialog UI.

All of the above type-checks clean (`npx tsc --noEmit`), lints clean (`npm
run lint` — only expected `react-hook-form` `watch()` react-compiler
warnings, zero errors), and `next build` succeeds.

## Open decisions already resolved with the user (don't re-litigate)

1. **Invoice send flow**: Draft status + manual "Send" button in the UI
   (not the old Gmail-drafts pattern). Confirmed.
2. **Invoice "from" address**: invoices specifically send from
   `tgregory@securetecc.com` (a named staff mailbox), not the org's general
   `supportEmail`. This is why `Organization.invoiceFromEmail` is a separate
   field from `supportEmail` in the schema. Other transactional emails
   (tickets, digests) use `supportEmail`.
3. **Domain/DKIM verification**: manual onboarding checklist item per
   tenant, not an in-app wizard for v1. `Organization.emailDomainVerified`
   boolean exists in the schema for this — the app should check it before
   allowing sends, but there's no UI/flow built for it yet (that's Phase 7,
   tenant onboarding).

## Open decisions NOT yet resolved — ask before guessing

- **Technician vs. admin permission split.** I made a judgment call in the
  RLS policies (see `0001_rls_policies.sql`) that wasn't explicitly specified
  in the original brief:
  - Technicians: full CRUD on Clients, ServiceTypes (read-only — admin
    manages rates), RecurringCharges, unbilled TimeEntries.
  - Admin-only: editing/deleting *billed* TimeEntries, changing Invoice
    status (Draft→Sent→Paid) or voiding/deleting an invoice, deleting
    Tickets, managing ServiceTypes and other staff Users.
  - This was flagged to the user once already but not explicitly confirmed
    beyond general agreement to proceed. **Confirm this is right before
    building more invoice/ticket workflows on top of it**, since changing it
    later means touching the RLS SQL, not just the UI.

## Architecture patterns to follow going forward

- **Every new server action that touches tenant data**: call
  `requireOrgContext()` (or `requireAdmin()` if admin-only) from
  `src/lib/auth.ts`, then wrap the actual query in `withRLS(authUserId, (tx) =>
  ...)` from `src/lib/db/rls.ts`. Never use the raw `prisma` singleton for
  request-scoped work.
- **Money/hours math belongs server-side.** Client-submitted numbers
  (hours, rates) are never trusted directly — always re-derive from the DB
  (see the time-entry billing-minimum pattern) or validate against it.
- **Review-before-finalize is a recurring pattern**, not just an invoicing
  quirk — AI-assisted time entry already follows it (parse → review/edit →
  save). Invoice generation (Phase 3) needs the same shape: pull unbilled
  entries + recurring charges → editable review screen → generate PDF, never
  skip straight from "generate" to final.
- **Zod schemas for react-hook-form**: avoid `.transform()` and `.default()`
  on fields used in a form resolved by `zodResolver` — see the comment in
  `src/lib/validations/client.ts`. Normalize in the server action instead.
- **shadcn/base-ui polymorphism**: use `render={<Component />}`, not
  `asChild`. Grep existing `src/components/app/*.tsx` files for the pattern
  before improvising.
- **Destructive actions**: the original brief requires a confirmation
  showing client/amount/count before voiding an invoice, and archiving (not
  hard-deleting) the PDF while nulling out the linked TimeEntries'
  `invoiceId` so they become re-invoiceable. Nothing about this is built yet
  — it's the first thing Phase 3 needs to get right.

## Remaining phases (in order — confirm scope with the user before each)

### Phase 3 — Invoicing (highest-risk phase; do not rush)
- Recurring charges CRUD (per client, Monthly / Annual-in-January).
- Invoice generation flow: select client + period → pull all unbilled
  billable `TimeEntry` rows + applicable `RecurringCharge` rows → **editable
  review screen** → generate PDF → save as `Draft`.
- PDF via `@react-pdf/renderer` (already installed, not yet used). Must
  handle, faithfully per the original brief:
  - Logo, invoice number (`{ClientShortName}-{00001}`, 5-digit zero-padded,
    sequential **per client** — there's a `@@unique([organizationId,
    clientId, invoiceNumber])` constraint already in the schema to support
    this, but the actual sequential-numbering logic isn't written yet), date.
  - Client billing block: company name, "ATTN: Accounting Department" line,
    Address1+Address2 combined onto one line with **no stray comma/blank
    line when Address2 is empty** (explicit proven-system requirement,
    watch for it), city/state/zip, phone — pulled live from the `Client`
    record at generation time, never cached/stale.
  - Line items (date, description, hours, rate, amount); Monthly/Annual
    recurring charges in clearly separated, bold, centered sections.
  - **Multi-page support that doesn't break formatting, duplicate, or
    misplace totals** — this is called out as the trickiest part of the
    whole build. Test this explicitly with a client that has enough time
    entries to span multiple pages before considering the phase done.
  - Detailed Work Log (every dated entry, full uncondensed description,
    chronological) followed by a Service Summary (2-4 sentence condensed
    narrative) — both at matching font size, not one large one small.
  - Total due, clearly displayed.
- Draft → Sent: manual "Send" button (confirmed pattern, see above), email
  from `invoiceFromEmail` (`tgregory@securetecc.com`), gated on
  `emailDomainVerified`.
- Void/delete invoice: confirmation dialog showing client, amount, and count
  of linked time entries; on confirm, null out those entries' `invoiceId`
  (already supported by the schema's `onDelete: SetNull` relation) and
  archive rather than hard-delete the PDF (`Invoice.voidedAt` field already
  exists for this).
- Test multi-page and recurring-charge edge cases explicitly before calling
  this phase done — this is the priority-one correctness surface for the
  whole app.

### Phase 4 — Support tickets
- Public submission page (no login) at whatever route matches `proxy.ts`'s
  `PUBLIC_PATHS` (`/support` is already reserved there): company name,
  contact name, email, issue type, urgency, description, multi-file
  image/PDF attachments. RLS for anon insert on `tickets`/`ticket_attachments`
  and the `ticket-attachments` storage bucket already exist in
  `0001_rls_policies.sql` — the UI/route just needs to be built to match.
- Sequential ticket numbering (`TKT-0001`, per-org) — not yet implemented.
- Internal management view: list/filter by status/urgency, detail view with
  internal notes, status changer, assignment.
- **Critical ordering requirement from the brief**: status-change emails
  must read `internalNotes` at the exact moment of the status change. Make
  the UI enforce (or at least strongly guide) filling in notes before/in the
  same action as the status change, not after — the proven system's exact
  behavior here is that notes-after-the-fact don't retroactively appear in
  an already-sent email.
- Auto-close: Resolved tickets untouched 7+ days → Closed, via a scheduled
  job (Phase 5 territory, but the logic can be written now).

### Phase 5 — Email automation
- All emails branded (org logo/colors), sent from the org's `supportEmail`
  (or `invoiceFromEmail` for invoices specifically), gated on
  `emailDomainVerified`.
- New ticket (client confirmation + internal alert), status-change email,
  weekly digest (staff), daily reminder (staff, "no time logged today"),
  monthly summary (staff: billable/non-billable hours + estimated revenue
  per client, invoiced vs. not).
- Vercel Cron for the recurring jobs + the ticket auto-close job from Phase 4.

### Phase 6 — Migration tooling
- One-time script to export SecureTECC's real Sheets data (Clients,
  TimeEntries, Invoices, RecurringCharges, Tickets) into this schema.
  **Must preserve invoice numbering continuity and historical billing data
  exactly.** Build and test against a copy of real data before any real
  cutover — this is explicitly not a "run it once and hope" step.

### Phase 7 — Polish + tenant onboarding
- Actual UI/flow for a second organization to get set up: org profile
  (logo, brand colors, `supportEmail`/`invoiceFromEmail`), DKIM/domain
  verification checklist (manual, per the resolved decision above), initial
  admin user, default `ServiceType` seeding for a non-SecureTECC tenant.

## Explicitly out of scope for v1 (don't add without checking in first)

- Client login/portal (matches the proven system — clients interact only via
  the public ticket form and email).
- Payment processing / online invoice payment.
- Anything else not listed in the phases above.

## Local setup (for whoever picks this up)

1. Create a Supabase project.
2. Copy `.env.example` → `.env`, fill in `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `DATABASE_URL` (Supabase Postgres connection string), `GEMINI_API_KEY`,
   `RESEND_API_KEY`.
3. `npm install`
4. `npx prisma migrate deploy` (creates tables from `prisma/schema.prisma`)
5. Apply `supabase/migrations/0001_rls_policies.sql` against the same
   database (via the Supabase SQL editor or `psql` — this is intentionally
   separate from Prisma's own migration history).
6. `npx prisma db seed` — seeds the SecureTECC org + default ServiceTypes.
   Set `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (and optionally
   `SEED_ADMIN_NAME`) first to also get a working login.
7. `npm run dev`, log in at `/login`.

## Verification commands

```bash
npx tsc --noEmit   # typecheck
npm run lint       # eslint — should be 0 errors (a few react-compiler/
                    # react-hook-form watch() warnings are expected and fine)
npx next build     # full production build
```
