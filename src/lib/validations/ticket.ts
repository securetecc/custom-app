import { z } from "zod";

export const ISSUE_TYPES = [
  "Computer / Workstation",
  "Network / Internet",
  "Email",
  "Printer",
  "Phone System",
  "Security / Virus",
  "Software",
  "Other",
] as const;

export const URGENCY_LABELS: Record<string, string> = {
  Critical: "Critical — business stopped",
  High: "High — major disruption",
  Medium: "Medium — working, but impaired",
  Low: "Low — question or request",
};

// Public submission. Deliberately carries NO organizationId, status,
// assignedToUserId, or internalNotes: those are either resolved server-side or
// forbidden outright, and the anon RLS policy in 0001_rls_policies.sql enforces
// the same thing at the database level.
export const publicTicketSchema = z.object({
  clientCompanyName: z.string().min(1, "Company name is required"),
  contactName: z.string().min(1, "Your name is required"),
  contactEmail: z.string().email("Enter a valid email address"),
  issueType: z.enum(ISSUE_TYPES),
  urgency: z.enum(["Critical", "High", "Medium", "Low"]),
  description: z.string().min(10, "Please describe the issue in a little more detail"),
});

export type PublicTicketValues = z.infer<typeof publicTicketSchema>;

/**
 * Status change always carries the notes written for it.
 *
 * The proven system emails the client on a status change and includes
 * internalNotes *as of that moment* -- notes added afterwards never appear in
 * the already-sent email. Binding them into one action is what stops a
 * technician writing the explanation a minute too late.
 */
export const ticketStatusChangeSchema = z.object({
  status: z.enum(["New", "InProgress", "Resolved", "Closed"]),
  internalNotes: z.string(),
});

export type TicketStatusChangeValues = z.infer<typeof ticketStatusChangeSchema>;

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB each
export const MAX_ATTACHMENTS = 5;
export const ALLOWED_ATTACHMENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
] as const;
