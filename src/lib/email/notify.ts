import { prisma } from "@/lib/db/prisma";
import { sendEmail, type SendResult } from "@/lib/email/client";
import {
  ticketConfirmationEmail,
  ticketInternalAlertEmail,
  ticketStatusChangeEmail,
  type Branding,
} from "@/lib/email/templates";

/**
 * Notification helpers used by server actions and cron routes.
 *
 * Plain module rather than "use server": nothing here should be callable from
 * a browser. Every function is fire-and-report -- they return a SendResult and
 * never throw, because a failed notification must not roll back the work that
 * triggered it.
 */

type OrgRow = {
  id: string;
  name: string;
  supportEmail: string;
  invoiceFromEmail: string | null;
  phone: string | null;
  logoUrl: string | null;
  brandColorPrimary: string;
  brandColorAccent: string;
  emailDomainVerified: boolean;
};

function brandingOf(org: OrgRow): Branding {
  return {
    organizationName: org.name,
    primaryColor: org.brandColorPrimary,
    accentColor: org.brandColorAccent,
    logoUrl: org.logoUrl,
    phone: org.phone,
  };
}

function appUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  return `${base}${path}`;
}

export async function notifyNewTicket(ticketId: string): Promise<{
  clientConfirmation: SendResult;
  internalAlert: SendResult;
}> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { organization: true },
  });

  if (!ticket) {
    const missing: SendResult = { ok: false, error: "Ticket not found." };
    return { clientConfirmation: missing, internalAlert: missing };
  }

  const org = ticket.organization as OrgRow;
  const branding = brandingOf(org);

  const confirmation = ticketConfirmationEmail(branding, {
    ticketNumber: ticket.ticketNumber,
    contactName: ticket.contactName,
    issueType: ticket.issueType,
    urgency: ticket.urgency,
    description: ticket.description,
  });

  const alert = ticketInternalAlertEmail(
    branding,
    {
      ticketNumber: ticket.ticketNumber,
      clientCompanyName: ticket.clientCompanyName,
      contactName: ticket.contactName,
      contactEmail: ticket.contactEmail,
      callbackNumber: ticket.callbackNumber,
      issueType: ticket.issueType,
      urgency: ticket.urgency,
      description: ticket.description,
    },
    appUrl(`/tickets/${ticket.id}`),
  );

  const [clientConfirmation, internalAlert] = await Promise.all([
    sendEmail({
      to: ticket.contactEmail,
      from: org.supportEmail,
      replyTo: org.supportEmail,
      subject: confirmation.subject,
      html: confirmation.html,
      emailDomainVerified: org.emailDomainVerified,
    }),
    sendEmail({
      to: org.supportEmail,
      from: org.supportEmail,
      replyTo: ticket.contactEmail,
      subject: alert.subject,
      html: alert.html,
      emailDomainVerified: org.emailDomainVerified,
    }),
  ]);

  return { clientConfirmation, internalAlert };
}

/**
 * Status-change notification.
 *
 * `notesForThisChange` is passed in by the caller rather than re-read from the
 * ticket, because the requirement is that the email carries the notes written
 * FOR THIS CHANGE. Re-reading internalNotes here would send the whole appended
 * history, and would also pick up anything written after the change.
 */
export async function notifyTicketStatusChange(
  ticketId: string,
  notesForThisChange: string | null,
): Promise<SendResult> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { organization: true },
  });
  if (!ticket) return { ok: false, error: "Ticket not found." };

  const org = ticket.organization as OrgRow;
  const email = ticketStatusChangeEmail(
    brandingOf(org),
    {
      ticketNumber: ticket.ticketNumber,
      contactName: ticket.contactName,
      status: ticket.status,
    },
    notesForThisChange,
  );

  return sendEmail({
    to: ticket.contactEmail,
    from: org.supportEmail,
    replyTo: org.supportEmail,
    subject: email.subject,
    html: email.html,
    emailDomainVerified: org.emailDomainVerified,
  });
}
