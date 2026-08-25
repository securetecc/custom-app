import { prisma } from "@/lib/db/prisma";
import { sendEmail, type SendResult } from "@/lib/email/client";
import {
  ticketAssignedEmail,
  ticketConfirmationEmail,
  ticketInternalAlertEmail,
  ticketStatusChangeEmail,
  taskAssignedEmail,
  taskForReviewEmail,
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
  notificationFromEmail: string | null;
  invoiceFromEmail: string | null;
  phone: string | null;
  logoUrl: string | null;
  brandColorPrimary: string;
  brandColorAccent: string;
  emailDomainVerified: boolean;
};

/**
 * The `from:` for automated mail -- a noreply sender on the alerts subdomain.
 * NEVER use this for `to:` or `replyTo:`: nobody reads a noreply mailbox, so
 * doing so silently black-holes internal alerts and client replies alike.
 * Falls back to supportEmail so an unconfigured org still sends.
 */
function senderOf(org: OrgRow): string {
  return org.notificationFromEmail ?? org.supportEmail;
}

function brandingOf(org: OrgRow): Branding {
  return {
    organizationName: org.name,
    primaryColor: org.brandColorPrimary,
    accentColor: org.brandColorAccent,
    logoUrl: org.logoUrl,
    phone: org.phone,
  };
}

/**
 * Absolute URL into the staff app, for "Open ticket" style buttons in mail.
 *
 * Falls back to Vercel's own production URL when NEXT_PUBLIC_APP_URL isn't
 * configured. Without that fallback the base was "" and the button emitted a
 * bare "/tickets/xyz" -- a relative href in an email client, which simply
 * doesn't resolve. A working deployment URL beats a dead link while the real
 * domain is still being attached.
 */
function appUrl(path: string): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (configured) return `${configured}${path}`;

  const vercelHost =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL ?? "";
  return vercelHost ? `https://${vercelHost}${path}` : path;
}

/**
 * Public ticket portal (ticket.securetecc.com) -- a different host from
 * NEXT_PUBLIC_APP_URL, which points at the staff app. Client-facing email
 * must never link into manage.*, where they'd hit a login screen.
 * Returns undefined when unset so callers can omit the link entirely rather
 * than emitting a broken relative URL.
 */
function portalUrl(path: string): string | undefined {
  const base = process.env.NEXT_PUBLIC_TICKET_PORTAL_URL?.replace(/\/$/, "");
  return base ? `${base}${path}` : undefined;
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
  }, portalUrl("/status"));

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
      from: senderOf(org),
      replyTo: org.supportEmail,
      subject: confirmation.subject,
      html: confirmation.html,
      emailDomainVerified: org.emailDomainVerified,
    }),
    sendEmail({
      to: org.supportEmail,
      from: senderOf(org),
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
    // Keeps the status checker reachable from every update, not just the
    // original confirmation.
    portalUrl("/status"),
  );

  return sendEmail({
    to: ticket.contactEmail,
    from: senderOf(org),
    replyTo: org.supportEmail,
    subject: email.subject,
    html: email.html,
    emailDomainVerified: org.emailDomainVerified,
  });
}

/**
 * Emails a technician when a ticket is assigned to them.
 *
 * Goes to the person, not the support inbox: the point is that one named
 * human now owns it, which a shared mailbox can't convey. Silently does
 * nothing when a ticket is UNassigned, or when someone assigns a ticket to
 * themselves -- they already know.
 */
export async function notifyTicketAssigned(
  ticketId: string,
  assignedByUserId: string,
): Promise<SendResult> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { organization: true, assignedToUser: true },
  });
  // Unassigning notifies nobody, and assigning to yourself tells you what you
  // just did -- both are "nothing to send", not failures.
  if (!ticket?.assignedToUser) return { ok: false, skipped: true, error: "No assignee" };
  if (ticket.assignedToUser.id === assignedByUserId) {
    return { ok: false, skipped: true, error: "Self-assigned" };
  }

  const assignedBy = await prisma.user.findUnique({
    where: { id: assignedByUserId },
    select: { name: true },
  });

  const email = ticketAssignedEmail(
    brandingOf(ticket.organization),
    {
      ticketNumber: ticket.ticketNumber,
      clientCompanyName: ticket.clientCompanyName,
      issueType: ticket.issueType,
      urgency: ticket.urgency,
      description: ticket.description,
      assigneeName: ticket.assignedToUser.name,
      assignedByName: assignedBy?.name ?? "Someone",
    },
    appUrl(`/tickets/${ticket.id}`),
  );

  return sendEmail({
    to: ticket.assignedToUser.email,
    from: senderOf(ticket.organization),
    replyTo: ticket.organization.supportEmail,
    subject: email.subject,
    html: email.html,
    emailDomainVerified: ticket.organization.emailDomainVerified,
  });
}

/** yyyy-mm-dd -> "26 Aug 2026", read in UTC because the column is date-only. */
function formatTaskDate(d: Date | null): string | null {
  if (!d) return null;
  return d.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    // UTC, not Pacific: @db.Date values come back as UTC midnight, and
    // rendering them in Pacific would show the previous day.
    timeZone: "UTC",
  });
}

/**
 * Emails the assignee when a task is delegated to them.
 *
 * Silent when someone assigns a task to themselves -- they already know, and
 * a notification for your own action reads as a bug.
 */
export async function notifyTaskAssigned(taskId: string): Promise<SendResult> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { organization: true, assignedToUser: true, createdByUser: true },
  });
  if (!task) return { ok: false, error: "Task not found." };
  if (task.assignedToUserId === task.createdByUserId) {
    return { ok: false, skipped: true, error: "Self-assigned" };
  }

  const org = task.organization as OrgRow;
  const email = taskAssignedEmail(
    brandingOf(org),
    {
      title: task.title,
      description: task.description,
      priority: task.priority,
      assigneeName: task.assignedToUser.name,
      assignedByName: task.createdByUser.name,
      startDate: formatTaskDate(task.startDate),
      dueDate: formatTaskDate(task.dueDate),
    },
    appUrl("/tasks"),
  );

  return sendEmail({
    to: task.assignedToUser.email,
    from: senderOf(org),
    // Replies go to the person who delegated it, not into a noreply void --
    // "quick question about this task" is the likeliest response.
    replyTo: task.createdByUser.email,
    subject: email.subject,
    html: email.html,
    emailDomainVerified: org.emailDomainVerified,
  });
}

/** Tells the delegator that a task is waiting on their review. */
export async function notifyTaskForReview(taskId: string): Promise<SendResult> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { organization: true, assignedToUser: true, createdByUser: true },
  });
  if (!task) return { ok: false, error: "Task not found." };
  if (task.assignedToUserId === task.createdByUserId) {
    return { ok: false, skipped: true, error: "Self-assigned" };
  }

  const org = task.organization as OrgRow;
  const email = taskForReviewEmail(
    brandingOf(org),
    { title: task.title, assigneeName: task.assignedToUser.name },
    appUrl("/tasks"),
  );

  return sendEmail({
    to: task.createdByUser.email,
    from: senderOf(org),
    replyTo: task.assignedToUser.email,
    subject: email.subject,
    html: email.html,
    emailDomainVerified: org.emailDomainVerified,
  });
}
