import { formatCurrency } from "@/lib/format";

/**
 * Branded HTML emails.
 *
 * Table-based layout with inline styles on purpose -- that's what survives
 * Outlook and Gmail. Colors come from the org record so a second tenant gets
 * its own branding without touching this file.
 */

export type Branding = {
  organizationName: string;
  primaryColor: string;
  accentColor: string;
  logoUrl: string | null;
  phone: string | null;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Preserves author line breaks without letting user text inject markup. */
function paragraphs(value: string): string {
  return escapeHtml(value)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px;">${p.replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

/** Surfaces of the dark card. Fixed rather than derived from branding: the
 *  panel has to sit a shade above the card, and a brand colour alone can't
 *  say what "a shade above" is. */
const CARD = "#0A1E33";
const PANEL = "#0D2740";
const TEXT = "#FFFFFF";
const MUTED = "rgba(255,255,255,0.62)";

/** Status wording carries its own colour, so state reads before the word does. */
const STATUS_COLORS: Record<string, string> = {
  New: "#06E1DC",
  InProgress: "#F5B942",
  "In Progress": "#F5B942",
  Resolved: "#06E1DC",
  Closed: "rgba(255,255,255,0.62)",
};

/** The teal-bordered callout: a small uppercase label over a large value. */
function panel(label: string, value: string, valueColor = TEXT): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
    <tr><td style="background:${PANEL};border-left:4px solid #06E1DC;border-radius:8px;padding:18px 20px;">
      <div style="font-size:12px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:#06E1DC;margin-bottom:6px;">${escapeHtml(label)}</div>
      <div style="font-size:22px;font-weight:700;color:${valueColor};">${escapeHtml(value)}</div>
    </td></tr>
  </table>`;
}

/** Teal uppercase section heading, e.g. "UPDATE DETAILS". */
function sectionLabel(text: string): string {
  return `<div style="font-size:12px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:#06E1DC;margin:22px 0 8px;">${escapeHtml(text)}</div>`;
}

/**
 * The dark card every ticket email is built in.
 *
 * Dark rather than the white card this used to be, matching the design in
 * use: the logo is light-on-dark artwork, and on a white ground it needed its
 * own navy header band, which read as two separate blocks stacked together.
 *
 * `portalUrl` is threaded all the way down to the footer so the status
 * checker stays reachable from every message, not just the ones with a
 * button.
 */
function shell(branding: Branding, bodyHtml: string, portalUrl?: string): string {
  const logo = branding.logoUrl
    ? `<img src="${escapeHtml(branding.logoUrl)}" alt="${escapeHtml(branding.organizationName)}" width="240" style="display:block;margin:0 auto;max-width:240px;height:auto;" />`
    : `<div style="font-size:22px;font-weight:700;color:${TEXT};text-align:center;">${escapeHtml(branding.organizationName)}</div>`;

  const portalLink = portalUrl
    ? ` · <a href="${escapeHtml(portalUrl)}" style="color:${MUTED};text-decoration:underline;">Support Portal</a>`
    : "";

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#050F1D;font-family:Arial,Helvetica,sans-serif;color:${TEXT};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#050F1D;padding:24px 12px;">
      <tr><td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:${CARD};border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:32px 24px 28px;border-bottom:2px solid #06E1DC;">
              ${logo}
            </td>
          </tr>
          <tr><td style="padding:28px 26px;font-size:15px;line-height:1.6;color:${TEXT};">${bodyHtml}</td></tr>
          <tr>
            <td style="padding:18px 24px;border-top:2px solid #06E1DC;font-size:13px;color:${MUTED};text-align:center;">
              <span style="color:#06E1DC;font-weight:700;">${escapeHtml(branding.organizationName)}</span>${portalLink}${branding.phone ? ` · ${escapeHtml(branding.phone)}` : ""}
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function button(href: string, label: string, color: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0 6px;">
    <tr><td align="center">
      <a href="${escapeHtml(href)}" style="display:inline-block;background:${escapeHtml(color)};color:#071E37;text-decoration:none;font-weight:700;font-size:15px;padding:15px 34px;border-radius:8px;">${escapeHtml(label)}</a>
    </td></tr>
  </table>`;
}

// --- tickets ---------------------------------------------------------------

export function ticketConfirmationEmail(
  branding: Branding,
  ticket: { ticketNumber: string; contactName: string; issueType: string; urgency: string; description: string },
  /**
   * Public status-lookup URL (ticket.securetecc.com/status). Optional so the
   * email still sends if the portal URL isn't configured -- the ticket number
   * in the body is the part that actually matters.
   */
  statusUrl?: string,
): { subject: string; html: string } {
  return {
    subject: `We have received your request (${ticket.ticketNumber})`,
    html: shell(
      branding,
      `<p style="margin:0 0 16px;">Hi ${escapeHtml(ticket.contactName)},</p>
       <p style="margin:0;">Thanks for reaching out. Your support request has been logged.</p>
       ${panel("Ticket number", ticket.ticketNumber)}
       <p style="margin:0 0 12px;">${escapeHtml(branding.organizationName)} will respond <span style="color:#06E1DC;font-weight:700;">by the next business day</span>.</p>
       <p style="margin:0;color:${MUTED};font-size:14px;">If you need to reference this request, just include the ticket number above.</p>
       ${statusUrl ? button(statusUrl, "Visit Support Portal", branding.accentColor) : ""}`,
      statusUrl,
    ),
  };
}

/**
 * Internal new-ticket alert, to the shared support inbox.
 *
 * Same card as the client-facing mail, different priorities in the body: the
 * urgency, who it's from and how to reach them come first, because this one
 * is triaged rather than read.
 */
export function ticketInternalAlertEmail(
  branding: Branding,
  ticket: {
    ticketNumber: string; clientCompanyName: string; contactName: string; contactEmail: string;
    callbackNumber?: string | null; issueType: string; urgency: string; description: string;
  },
  ticketUrl: string,
): { subject: string; html: string } {
  // Urgency is always in the subject, not just for high-priority tickets:
  // the inbox is triaged by scanning subject lines, and "no prefix" reading as
  // "routine" only works if you already know the convention.
  const row = (label: string, value: string) =>
    `<tr><td style="padding:7px 0;color:${MUTED};width:110px;">${escapeHtml(label)}</td><td style="padding:7px 0;color:${TEXT};">${escapeHtml(value)}</td></tr>`;

  return {
    subject: `New ${ticket.urgency} ${ticket.ticketNumber} – ${ticket.clientCompanyName}`,
    html: shell(
      branding,
      `<p style="margin:0;">New support request.</p>
       ${panel(`Ticket ${ticket.ticketNumber}`, ticket.urgency, STATUS_COLORS[ticket.urgency] ?? "#F5B942")}
       <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;">
         ${row("Company", ticket.clientCompanyName)}
         ${row("Contact", `${ticket.contactName} <${ticket.contactEmail}>`)}
         ${ticket.callbackNumber ? row("Callback", ticket.callbackNumber) : ""}
         ${row("Issue", ticket.issueType)}
       </table>
       ${sectionLabel("What they told us")}
       ${paragraphs(ticket.description)}
       ${button(ticketUrl, "Open ticket", branding.accentColor)}`,
    ),
  };
}

/**
 * Tells a technician a ticket is now theirs.
 *
 * Internal, so it leads with what they need to act -- number, urgency,
 * company and the issue itself -- rather than the reassurance a client-facing
 * mail opens with.
 */
export function ticketAssignedEmail(
  branding: Branding,
  ticket: {
    ticketNumber: string; clientCompanyName: string; issueType: string;
    urgency: string; description: string; assigneeName: string; assignedByName: string;
  },
  ticketUrl: string,
): { subject: string; html: string } {
  return {
    subject: `Assigned to you: ${ticket.ticketNumber} – ${ticket.clientCompanyName}`,
    html: shell(
      branding,
      `<h1 style="margin:0 0 12px;font-size:20px;">${escapeHtml(ticket.ticketNumber)} is yours</h1>
       <p style="margin:0 0 16px;">${escapeHtml(ticket.assignedByName)} assigned this to ${escapeHtml(ticket.assigneeName)}.</p>
       <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;">
         <tr><td style="padding:8px 0;color:#5B6B7C;width:120px;">Company</td><td style="padding:8px 0;">${escapeHtml(ticket.clientCompanyName)}</td></tr>
         <tr><td style="padding:8px 0;color:#5B6B7C;">Issue</td><td style="padding:8px 0;">${escapeHtml(ticket.issueType)}</td></tr>
         <tr><td style="padding:8px 0;color:#5B6B7C;">Urgency</td><td style="padding:8px 0;"><strong>${escapeHtml(ticket.urgency)}</strong></td></tr>
       </table>
       <p style="margin:16px 0;padding:12px;background:#f6f8fa;border-radius:6px;white-space:pre-wrap;">${escapeHtml(ticket.description)}</p>
       ${button(ticketUrl, "Open ticket", branding.accentColor)}`,
    ),
  };
}

export function ticketStatusChangeEmail(
  branding: Branding,
  ticket: { ticketNumber: string; contactName: string; status: string },
  /** Notes AS OF the moment of the change -- see changeTicketStatus. */
  notesForThisChange: string | null,
  /** Status-lookup URL, so every update keeps a route back to the portal. */
  statusUrl?: string,
): { subject: string; html: string } {
  const readable: Record<string, string> = {
    New: "New", InProgress: "In Progress", Resolved: "Resolved", Closed: "Closed",
  };
  const label = readable[ticket.status] ?? ticket.status;
  const resolved = ticket.status === "Resolved";
  const notes = notesForThisChange?.trim();

  return {
    subject: `Ticket ${ticket.ticketNumber} update: ${label}`,
    html: shell(
      branding,
      `<p style="margin:0 0 16px;">Hi ${escapeHtml(ticket.contactName)},</p>
       <p style="margin:0;">There's an update on your support request.</p>
       ${panel(`Ticket ${ticket.ticketNumber}`, label, STATUS_COLORS[ticket.status] ?? TEXT)}
       ${
         notes
           ? sectionLabel(resolved ? "What we did to resolve this" : "Update details") +
             paragraphs(notes)
           : ""
       }
       ${
         resolved
           ? `<p style="margin:16px 0 0;color:${MUTED};">Thank you for your patience — please let us know if this fully resolves the issue.</p>`
           : ""
       }
       ${statusUrl ? button(statusUrl, "Visit Support Portal", branding.accentColor) : ""}`,
      statusUrl,
    ),
  };
}

// --- invoices --------------------------------------------------------------

/**
 * Covering note for an invoice PDF, as plain text.
 *
 * Deliberately not the branded HTML shell the other templates use: this is a
 * one-line note from Tony with the invoice attached, and the PDF already
 * carries the letterhead, totals and payment terms. Anything more here just
 * repeats the attachment in a worse format.
 */
export function invoiceEmail(
  branding: Branding,
  invoice: { invoiceNumber: string; clientName: string; periodStart: Date; periodEnd: Date; totalAmount: number },
): { subject: string; text: string } {
  const period = formatPeriodLabel(invoice.periodStart, invoice.periodEnd);

  // No sign-off: Tony reviews and sends these from his own mailbox, where his
  // Gmail signature is appended on send. Adding one here would double it up.
  return {
    subject: `Invoice ${invoice.invoiceNumber} from ${branding.organizationName}`,
    text: ["Hi,", "", `Please see the attached invoice for ${period}.`, ""].join("\n"),
  };
}

/** "July 2026", or "July – September 2026" when a period spans months. */
function formatPeriodLabel(start: Date, end: Date): string {
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
  const a = fmt(start);
  const b = fmt(end);
  return a === b ? a : `${a} – ${b}`;
}

// --- staff digests ---------------------------------------------------------

export function dailyReminderEmail(branding: Branding, staffName: string): { subject: string; html: string } {
  return {
    subject: "No time logged today",
    html: shell(
      branding,
      `<h1 style="margin:0 0 12px;font-size:20px;">No time logged yet today</h1>
       <p style="margin:0;">Hi ${escapeHtml(staffName)} — nothing has been logged against a client today. If you worked, a couple of minutes now saves reconstructing it at invoice time.</p>`,
    ),
  };
}

export function weeklyTicketDigestEmail(
  branding: Branding,
  rows: { ticketNumber: string; clientCompanyName: string; urgency: string; status: string; ageDays: number }[],
): { subject: string; html: string } {
  const body =
    rows.length === 0
      ? `<p style="margin:0;">No open tickets. Clean slate.</p>`
      : `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;border-collapse:collapse;">
           <tr style="text-align:left;color:#5B6B7C;font-size:12px;">
             <th style="padding:8px 0;">Ticket</th><th style="padding:8px 0;">Company</th>
             <th style="padding:8px 0;">Urgency</th><th style="padding:8px 0;">Status</th><th style="padding:8px 0;">Age</th>
           </tr>
           ${rows
             .map(
               (r) => `<tr style="border-top:1px solid #e2e8f0;">
                 <td style="padding:10px 0;"><strong>${escapeHtml(r.ticketNumber)}</strong></td>
                 <td style="padding:10px 0;">${escapeHtml(r.clientCompanyName)}</td>
                 <td style="padding:10px 0;">${escapeHtml(r.urgency)}</td>
                 <td style="padding:10px 0;">${escapeHtml(r.status)}</td>
                 <td style="padding:10px 0;">${r.ageDays}d</td>
               </tr>`,
             )
             .join("")}
         </table>`;

  return {
    subject: `Weekly ticket digest — ${rows.length} open`,
    html: shell(branding, `<h1 style="margin:0 0 14px;font-size:20px;">Open tickets</h1>${body}`),
  };
}

export function monthlySummaryEmail(
  branding: Branding,
  month: string,
  rows: { clientName: string; billableHours: number; nonBillableHours: number; invoicedAmount: number; uninvoicedAmount: number }[],
): { subject: string; html: string } {
  const totalInvoiced = rows.reduce((s, r) => s + r.invoicedAmount, 0);
  const totalUninvoiced = rows.reduce((s, r) => s + r.uninvoicedAmount, 0);

  return {
    subject: `Monthly summary — ${month}`,
    html: shell(
      branding,
      `<h1 style="margin:0 0 6px;font-size:20px;">${escapeHtml(month)} summary</h1>
       <p style="margin:0 0 16px;color:#5B6B7C;font-size:14px;">Invoiced ${escapeHtml(formatCurrency(totalInvoiced))} · not yet invoiced ${escapeHtml(formatCurrency(totalUninvoiced))}</p>
       <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;border-collapse:collapse;">
         <tr style="text-align:left;color:#5B6B7C;font-size:12px;">
           <th style="padding:8px 0;">Client</th><th style="padding:8px 0;">Billable</th>
           <th style="padding:8px 0;">Non-bill.</th><th style="padding:8px 0;">Invoiced</th><th style="padding:8px 0;">Pending</th>
         </tr>
         ${rows
           .map(
             (r) => `<tr style="border-top:1px solid #e2e8f0;">
               <td style="padding:10px 0;">${escapeHtml(r.clientName)}</td>
               <td style="padding:10px 0;">${r.billableHours}h</td>
               <td style="padding:10px 0;">${r.nonBillableHours}h</td>
               <td style="padding:10px 0;">${escapeHtml(formatCurrency(r.invoicedAmount))}</td>
               <td style="padding:10px 0;">${escapeHtml(formatCurrency(r.uninvoicedAmount))}</td>
             </tr>`,
           )
           .join("")}
       </table>`,
    ),
  };
}
