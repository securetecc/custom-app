# Google Workspace setup — invoice Gmail drafts

One-time setup so the app can create invoice drafts in `tgregory@securetecc.com`.
Everything here has to be done by someone with **Google Workspace super-admin**
access to `securetecc.com` — it can't be automated from the app side.

Until these env vars are set, the app degrades gracefully: the invoice page
shows "Google Workspace not connected" and the **Create Gmail draft** button is
disabled. Nothing else is affected.

## Why a service account instead of "Sign in with Google"

Both work. A service account with domain-wide delegation was chosen because it
has **no refresh token to expire** — user OAuth refresh tokens can be revoked or
expire, and the failure mode is invoice drafting silently breaking months later
with no warning. The tradeoff is a few more setup steps now, done once.

---

## 1. Create the Google Cloud project and service account

1. Go to <https://console.cloud.google.com/> and create a project (e.g.
   `securetecc-platform`).
2. **APIs & Services → Library** → enable the **Gmail API**.
   (Also enable the **Google Drive API** now if you want invoice archiving
   later — same service account will cover it.)
3. **IAM & Admin → Service Accounts → Create service account**
   - Name: `invoice-drafter`
   - Skip the optional role/user grants — domain-wide delegation is what
     actually grants access, not IAM roles.
4. Open the new service account → **Keys → Add key → Create new key → JSON**.
   A `.json` file downloads. **Treat this file like a password.**
5. On the service account's **Details** tab, copy the **Unique ID** (a long
   number). You need it in the next step.

## 2. Grant domain-wide delegation in the Workspace Admin console

1. Go to <https://admin.google.com/> → **Security → Access and data control →
   API controls → Domain-wide delegation → Manage domain-wide delegation**.
2. **Add new**:
   - **Client ID**: the service account's Unique ID from step 1.5
   - **OAuth scopes**: `https://www.googleapis.com/auth/gmail.compose`

   > Add `https://www.googleapis.com/auth/drive.file` to the same entry if
   > you're also doing Drive archiving.
3. Authorize.

`gmail.compose` lets the app **create drafts and send** but not read the
mailbox. The app only ever calls the drafts endpoint — there is deliberately no
send call in the code — but this is the narrowest scope Google offers that
covers draft creation.

## 3. Set the environment variables

From the downloaded JSON key file:

| Env var | Where it comes from |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | the JSON's `client_email` |
| `GOOGLE_PRIVATE_KEY` | the JSON's `private_key` |
| `GOOGLE_IMPERSONATED_USER` | `tgregory@securetecc.com` |

**Important formatting note:** `private_key` contains real newlines. Env vars
can't hold those, so escape them as literal `\n`. The app unescapes at read
time (`src/lib/google/auth.ts`). If you paste it into the Vercel dashboard,
Vercel handles multi-line values fine — but keep it consistent with whatever
`.env` locally uses.

Set all three in **Vercel → Project → Settings → Environment Variables** for
the Production environment (and locally in `.env` if you want to test).

## 4. Verify

Generate a draft invoice in the app, open it, and click **Create Gmail draft**.
A draft with the PDF attached should appear in `tgregory@securetecc.com`'s
Gmail. The toast includes an **Open draft** link straight to it.

Common failures:

| Error | Cause |
|---|---|
| `unauthorized_client` | Domain-wide delegation not granted, or the scope in step 2 doesn't match exactly |
| `invalid_grant` | `GOOGLE_IMPERSONATED_USER` isn't a real user on this Workspace domain |
| `Invalid JWT Signature` | The private key got mangled — usually the `\n` escaping |
| Draft appears in the wrong mailbox | `GOOGLE_IMPERSONATED_USER` points at a different user |

---

## Separately: Resend + the SPF gotcha

Ticket and digest email still go through **Resend**, which needs its own DNS
records on `securetecc.com` before anything sends (`emailDomainVerified` in
Settings → Organization is the gate).

⚠️ **`securetecc.com` is on Google Workspace, so it already has an SPF record.
A domain may only have ONE.** Adding a second standalone SPF record for Resend
will break delivery of your existing Google Workspace mail.

Merge them into a single record instead — something of the shape:

```
v=spf1 include:_spf.google.com include:amazonses.com ~all
```

(Use whatever `include:` Resend's dashboard actually tells you; the point is
that it goes *inside* the existing record, not alongside it.)

DKIM and DMARC records are separate and can coexist normally — SPF is the only
one with the single-record restriction.
