# SecureTECC Managed Platform — System Brief

A reference description of what the platform is, how it is built, and the
rules it enforces. Written to be read by a person or given to an AI assistant
as context.

Last updated: 26 August 2026.

---

## 1. What it is

An internal operations platform for SecureTECC Solutions, a managed IT
services provider in Thousand Oaks, California. It replaces a Google
Sheets–based system ("the Operations Master Sheet") that handled client
records, time tracking, invoicing and support tickets.

It does four jobs:

1. **Time tracking** — logging billable hours against clients and service types
2. **Invoicing** — turning those hours, recurring charges and expenses into invoices
3. **Support tickets** — a public intake portal and an internal queue
4. **Reporting** — what each client is worth and where the hours go

It is a single-tenant application in practice (one organisation, SecureTECC)
but is modelled multi-tenant throughout: every table carries an
`organizationId` and every query is scoped to it.

---

## 2. Who uses it

| Person | Role | Notes |
|---|---|---|
| Tony Gregory | Owner / technician | Does the client work, billing and delegation |
| Zia Javier | VA / partner | Platform development, operations support |
| Ian Carlos Fajardo | VA / partner | Operations support |
| SecureTECC Admin | Service account | `webmaster@securetecc.com` |

All four hold the `admin` role. A separate `technician` role exists with
reduced permissions (cannot change invoice status or organisation settings).

Task delegation is gated on a per-user flag, `User.canDelegateTasks`, rather
than on role — because every current account is an admin, so a role check
would give the whole team the owner's function. Only Tony has the flag.

**Clients never log in.** They interact only through the public ticket portal
and the emails the system sends them.

---

## 3. Tech stack

### Application
- **Next.js 16.3.2** (App Router, React Server Components, Server Actions, Turbopack)
- **React 19.2.4**
- **TypeScript 5**
- **Tailwind CSS 4** with **shadcn/ui** components built on **Base UI**
- **react-hook-form** + **Zod 4** for form handling and validation
- **next-themes** for the light/dark toggle
- **lucide-react** icons, **sonner** toasts

### Data
- **PostgreSQL 17.6** hosted on **Supabase** (region `us-west-2`, West US Oregon)
- **Prisma 6.19.3** as the ORM, with a custom client output path (`src/generated/prisma`)
- **Row-Level Security (RLS)** enforced in Postgres on all 19 tables
- **Supabase Auth** for sign-in (email + password)
- **Supabase Storage** — three private buckets: `invoices`, `ticket-attachments`, `avatars`

### Hosting
- **Vercel**, serverless functions pinned to region `pdx1` (Portland) to sit
  next to the database
- **Vercel Cron** for scheduled jobs
- Repository: `securetecc/custom-app` on GitHub, private, deploys from `main`

### Integrations
- **Resend** — all transactional email, sent from `noreply@alerts.securetecc.com`
  with the display name "SecureTECC Support"
- **Google Workspace** via a service account with domain-wide delegation,
  impersonating `tgregory@securetecc.com`. Used for Gmail drafts and Google
  Drive/Sheets archiving. Authenticated with a JWT bearer flow signed using
  Node's built-in crypto rather than the `googleapis` SDK.
- **Google Gemini** (`gemini-2.5-flash`) — used only to map unfamiliar CSV
  column headers during import. It never interprets values.
- **Sentry** — error monitoring and tracing. Session Replay is deliberately
  off (the public form collects client problem descriptions).
- **@react-pdf/renderer** — invoice and report PDF generation

---

## 4. Security model

Access control lives in the database, not the application. Every table has RLS
enabled and policies scoped by `organizationId`, resolved through
`SECURITY DEFINER` functions:

- `current_org_id()` — the caller's organisation
- `current_user_role()` / `is_admin()` — the caller's role
- `current_app_user_id()` — the caller's application user row
- `can_delegate_tasks()` — the task-delegation flag
- `lookup_ticket_status()` — lets an anonymous caller check one ticket by
  number + email without granting `SELECT` on the tickets table
- `ticket_accepts_attachment()` — allows an anonymous attachment upload only
  within one hour of the ticket being created

Application code connects through `withRLS(authUserId, fn)`, which sets the
Postgres role and JWT claims for the transaction. A permission check in
TypeScript is treated as a UI convenience; the policy is the boundary.

An anonymous caller with the public API key can read **zero rows** from
`clients`, `invoices`, `time_entries`, `users`, `organizations`, `tickets`,
`tasks` and `recurring_charges` — verified directly.

---

## 5. Data model

Core entities, in dependency order:

**Organization** — branding (colours, logo), email senders, address block for
invoices, monthly revenue goal, per-org ticket counter.

**User** — mirrors a Supabase auth user. Holds name, email, role, avatar,
birthday (month/day only), daily-reminder preference, delegation flag.

**Client** — company name, `shortName` (used as the invoice-number prefix),
`reference` (the sheet's "CLI-016" id), owner name, billing contact name,
billing email, address, billing type (Hourly or Retainer), billing rate,
active flag, and a per-client invoice counter.

**ServiceType** — the work categories, each with a billing minimum and an
optional rate override:

| Code | Service | Rate | Minimum |
|---|---|---|---|
| R-S | Remote Service | client rate | 0.25h |
| O-S | On-Site Service | client rate | 1h |
| P-S | Phone Service | client rate | 0.25h |
| E-S | Email Service | client rate | 0.25h |
| V-S | Virtual Support | client rate | 0.5h |
| L-V | Low Voltage | $150/h | 1h |
| W-D | Website Development | $50/h | 0.25h |
| A-I | AI Automation | $50/h | 0.25h |

**TimeEntry** — date, client, service type, hours, description, billable
status (Billable / NonBillable / Residual), source (Manual / Voice /
CsvImport), and a nullable `invoiceId` that is set once billed.

**ReimbursableExpense** — costs paid on a client's behalf and billed back
(cable, shipping, hardware). Same shape as a time entry minus the hours.

**RecurringCharge** — monthly or annual add-ons per client (DMARC monitoring,
monitoring seats, remote monitoring). Carries `authorizedBy` and writes an
append-only `RecurringChargeAuditLog` row on every change.

**Invoice** — number, period, totals, status, PDF path, Gmail draft id.
Snapshots its recurring charges into `InvoiceRecurringCharge` so a later
price change cannot alter a historical invoice. `InvoiceCustomItem` holds
hand-added lines.

**Ticket** — public submission with ticket number, company, contact details,
issue type, urgency, description, status, internal notes, optional assignee,
and attachments.

**Task** — delegated work: title, description, priority, start/due dates,
assignee, creator, status.

**CronRun** — one row per scheduled job per occurrence, with a unique
constraint that acts as the lock preventing double execution.

---

## 6. Core workflows

### Logging time

Four ways in, all producing the same `TimeEntry`:

1. **Manual** — a form
2. **Voice Logger** — speak naturally; AI classifies the service type, applies
   the billing minimum and drafts the description
3. **AI entry** — paste or dictate a note, AI structures it
4. **CSV import** — upload a spreadsheet; unfamiliar column headers are mapped
   by AI, then every row is resolved against real clients and service types
   and validated server-side before anything is written

**Billing minimums are always applied server-side** from the service type,
never trusted from the form. A 10-minute on-site visit bills as 1 hour.

### Invoicing

The lifecycle is deliberately five states:

```
Draft → Invoiced → Sent → Paid
                 ↘ Voided (from any state)
```

- **Draft** — a working document. Editable; its time entries can still be pulled back.
- **Invoiced** — the commitment. Numbers are final and the document is real,
  whether or not it has been emailed. Stamps `issuedAt`.
- **Sent** — it reached the client.
- **Paid** — money received.

Two deliberate shortcuts: marking a Draft as Sent back-fills `issuedAt`
(sending necessarily issues it), and an Invoiced invoice can be marked Paid
directly without passing through Sent — money arriving against an invoice that
was handed over or posted is ordinary.

Generating an invoice:

1. Pick a client and a billing period
2. The system gathers unbilled time entries, reimbursable expenses and
   recurring charges due in that period
3. Confirm the selection; the invoice is created and its number allocated as
   `{ClientShortName}-{00001}`, incremented per client inside the same
   transaction. Numbers are never reused — a voided invoice keeps its number.
4. A PDF is rendered matching the company's master invoice template
5. Optionally, a Gmail **draft** is created with the PDF attached. The system
   never sends invoice email itself — a human reviews and sends it.
6. The PDF is archived to Google Drive under the client's folder

**Voiding** releases the time entries and expenses back to unbilled, removes
the recurring-charge snapshots, and archives rather than deletes the PDF.

### Tickets

Clients submit at `ticket.securetecc.com` (a separate hostname; the internal
app is never shown to clients). Submission is rate-limited and supports file
attachments.

Lifecycle:

```
New → In Progress → Waiting on Client → Completed → Closed
```

- **Waiting on Client** stops the clock honestly — a ticket blocked on
  information, access or approval is not "in progress". It still counts as
  open everywhere.
- **Completed** means the work is done. **Closed** means the ticket is
  finalised. Completed tickets auto-close after 7 days of no activity;
  Waiting-on-Client tickets never auto-close.

Every status change emails the client. The "Waiting on you" email asks for
what is needed and says work is paused; the closing email says the request is
closed and thanks them.

Clients can check status without an account at `/status` using their ticket
number and email.

---

## 7. Automation

Four scheduled jobs, all evaluated in **Pacific time** despite the servers
running on UTC:

| Job | Schedule (Pacific) | What it does |
|---|---|---|
| Daily reminder | 7pm, weekdays | Emails staff who logged no time today (opt-in per user) |
| Weekly digest | Monday 8am | Open-ticket summary to staff |
| Monthly summary | 1st, 7am | Per-client hours and billing summary to staff |
| Auto-close tickets | Midnight, daily | Closes tickets Completed for 7+ days |

Vercel Cron only accepts UTC, which drifts an hour twice a year. Each job is
therefore scheduled at **both** candidate UTC hours, and a Pacific-time gate
decides which firing is the real one. A `CronRun` row claims each occurrence,
so the second firing is a genuine retry rather than a duplicate — and a job
missed at its exact minute is still caught up to 3 hours later.

---

## 8. Business rules worth knowing

- **Billing minimums** come from the service type and are applied server-side
- **Rates** resolve as: service type override, else the client's rate
- **Invoice numbers** are per-client and never reused
- **Recurring charges are snapshotted** onto invoices, so changing a price
  later cannot alter history
- **Dates are date-only where they represent a calendar day** (invoice
  periods, task dates, birthdays) to avoid timezone drift
- **All scheduling, billing periods and greetings are Pacific**, never server time
- **Invoice email is never sent automatically** — only a Gmail draft
- `SAFE_MODE=1` disables all email, Gmail drafts and Drive writes, for
  migrations and testing

---

## 9. Current state

**Live and in use:** clients, time tracking (all four input methods),
reimbursable charges, recurring charges, invoicing, tickets (portal and
queue), reports, email signature generator, profile and settings.

**Built but placeholder:** Tasks (data model and permissions are live in the
database; the board UI is not built).

**Coming soon (placeholders only):** Today dashboard, Calendar (read-only sync
of email calendars), Analytics (Google Analytics for securetecc.com),
Subscriptions (SecureTECC's own outgoings), Reviews (Google Business Profile —
the "leave us a review" link builder on it does work), Documentation
(per-client network notes and credentials).

**Outstanding:** historical data from the Operations Master Sheet has not yet
been imported. The platform currently holds the client list and recurring
charges but only a handful of time entries and invoices, so it runs alongside
the Sheet rather than replacing it.

---

## 10. Glossary

- **Short name** — the client abbreviation used as the invoice-number prefix (`PCC`, `MWA`)
- **Reference** — the Operations Master Sheet's own client id (`CLI-016`)
- **Residual** — a billable status for work covered by an existing arrangement
- **Add-on** — a recurring charge (DMARC, monitoring seat, remote monitoring)
- **RLS** — Row-Level Security, the Postgres feature enforcing data access
- **Retainer client** — billed a fixed period amount rather than per hour
