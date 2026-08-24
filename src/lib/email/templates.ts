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

function shell(branding: Branding, bodyHtml: string): string {
  const logo = branding.logoUrl
    ? `<img src="${escapeHtml(branding.logoUrl)}" alt="${escapeHtml(branding.organizationName)}" width="180" style="display:block;margin:0 auto;max-width:180px;height:auto;" />`
    : `<div style="font-size:20px;font-weight:700;color:#ffffff;text-align:center;">${escapeHtml(branding.organizationName)}</div>`;

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#071E37;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 12px;">
      <tr><td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
          <tr>
            <td style="background:${escapeHtml(branding.primaryColor)};padding:22px 24px;border-bottom:3px solid ${escapeHtml(branding.accentColor)};">
              ${logo}
            </td>
          </tr>
          <tr><td style="padding:28px 24px;font-size:15px;line-height:1.6;">${bodyHtml}</td></tr>
          <tr>
            <td style="padding:18px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#5B6B7C;text-align:center;">
              ${escapeHtml(branding.organizationName)}${branding.phone ? ` · ${escapeHtml(branding.phone)}` : ""}
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function button(href: string, label: string, color: string): string {
  return `<p style="margin:20px 0;"><a href="${escapeHtml(href)}" style="display:inline-block;background:${escapeHtml(color)};color:#071E37;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px;">${escapeHtml(label)}</a></p>`;
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
    subject: `We received your request (${ticket.ticketNumber})`,
    html: shell(
      branding,
      `<h1 style="margin:0 0 12px;font-size:20px;">Thanks, ${escapeHtml(ticket.contactName)} — we've got it.</h1>
       <p style="margin:0 0 16px;">Your request has been logged as <strong>${escapeHtml(ticket.ticketNumber)}</strong> and our team has been notified. We'll follow up by email as soon as there's an update.</p>
       <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;border-top:1px solid #e2e8f0;margin-top:8px;">
         <tr><td style="padding:10px 0;color:#5B6B7C;width:120px;">Issue type</td><td style="padding:10px 0;">${escapeHtml(ticket.issueType)}</td></tr>
         <tr><td style="padding:10px 0;color:#5B6B7C;border-top:1px solid #e2e8f0;">Urgency</td><td style="padding:10px 0;border-top:1px solid #e2e8f0;">${escapeHtml(ticket.urgency)}</td></tr>
       </table>
       <div style="margin-top:16px;padding:14px 16px;background:#f8fafc;border-radius:8px;">
         <div style="font-size:12px;color:#5B6B7C;margin-bottom:6px;">What you told us</div>
         ${paragraphs(ticket.description)}
       </div>
       ${
         statusUrl
           ? button(statusUrl, "Check the status of this request", branding.accentColor) +
             `<p style="margin:0;font-size:13px;color:#5B6B7C;">You'll need ${escapeHtml(ticket.ticketNumber)} and this email address.</p>`
           : ""
       }`,
    ),
  };
}

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
  return {
    subject: `New ${ticket.urgency} ${ticket.ticketNumber} – ${ticket.clientCompanyName}`,
    html: shell(
      branding,
      `<h1 style="margin:0 0 12px;font-size:20px;">New support request</h1>
       <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;">
         <tr><td style="padding:8px 0;color:#5B6B7C;width:120px;">Ticket</td><td style="padding:8px 0;"><strong>${escapeHtml(ticket.ticketNumber)}</strong></td></tr>
         <tr><td style="padding:8px 0;color:#5B6B7C;">Company</td><td style="padding:8px 0;">${escapeHtml(ticket.clientCompanyName)}</td></tr>
         <tr><td style="padding:8px 0;color:#5B6B7C;">Contact</td><td style="padding:8px 0;">${escapeHtml(ticket.contactName)} &lt;${escapeHtml(ticket.contactEmail)}&gt;</td></tr>
         ${
           ticket.callbackNumber
             ? `<tr><td style="padding:8px 0;color:#5B6B7C;">Callback</td><td style="padding:8px 0;">${escapeHtml(ticket.callbackNumber)}</td></tr>`
             : ""
         }
         <tr><td style="padding:8px 0;color:#5B6B7C;">Issue</td><td style="padding:8px 0;">${escapeHtml(ticket.issueType)}</td></tr>
         <tr><td style="padding:8px 0;color:#5B6B7C;">Urgency</td><td style="padding:8px 0;"><strong>${escapeHtml(ticket.urgency)}</strong></td></tr>
       </table>
       <div style="margin-top:14px;padding:14px 16px;background:#f8fafc;border-radius:8px;">${paragraphs(ticket.description)}</div>
       ${button(ticketUrl, "Open ticket", branding.accentColor)}`,
    ),
  };
}

export function ticketStatusChangeEmail(
  branding: Branding,
  ticket: { ticketNumber: string; contactName: string; status: string },
  /** Notes AS OF the moment of the change -- see changeTicketStatus. */
  notesForThisChange: string | null,
): { subject: string; html: string } {
  const readable: Record<string, string> = {
    New: "reopened", InProgress: "in progress", Resolved: "resolved", Closed: "closed",
  };
  return {
    subject: `${ticket.ticketNumber} is now ${readable[ticket.status] ?? ticket.status}`,
    html: shell(
      branding,
      `<h1 style="margin:0 0 12px;font-size:20px;">Update on ${escapeHtml(ticket.ticketNumber)}</h1>
       <p style="margin:0 0 16px;">Hi ${escapeHtml(ticket.contactName)}, your request is now <strong>${escapeHtml(readable[ticket.status] ?? ticket.status)}</strong>.</p>
       ${
         notesForThisChange && notesForThisChange.trim().length > 0
           ? `<div style="padding:14px 16px;background:#f8fafc;border-radius:8px;"><div style="font-size:12px;color:#5B6B7C;margin-bottom:6px;">Notes from our team</div>${paragraphs(notesForThisChange)}</div>`
           : ""
       }
       <p style="margin:16px 0 0;">Reply to this email if anything still isn't right.</p>`,
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
