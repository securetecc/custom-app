"use server";

import { prisma } from "@/lib/db/prisma";
import { withRLS } from "@/lib/db/rls";
import {
  ALLOWED_ATTACHMENT_TYPES,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  publicTicketSchema,
} from "@/lib/validations/ticket";
import {
  ticketAttachmentPath,
  uploadTicketAttachment,
} from "@/lib/storage/ticket-attachments";

// NOTE: every export from a "use server" file is a callable server action.
// Keep this file to exactly the one action the public form needs.

export type SubmitResult =
  | { ok: true; ticketNumber: string }
  | { ok: false; error: string };

/**
 * Public, unauthenticated ticket submission.
 *
 * Security shape:
 *  - organizationId is resolved SERVER-SIDE and never read from the form, so a
 *    crafted payload can't file into another tenant.
 *  - The ticket row is inserted through withRLS(null), i.e. as the Postgres
 *    `anon` role, so the "tickets: anon can submit new tickets" policy in
 *    0001_rls_policies.sql actually gates it (status must be New, and
 *    assignedToUserId/internalNotes/resolvedAt must be null). Using the
 *    privileged client here would bypass exactly the guarantee that policy
 *    exists to provide.
 *  - The ticket-number counter lives on `organizations`, which anon has no
 *    rights to touch, so that single increment uses the trusted client -- the
 *    same category as seeding/bootstrap code. A later failure can leave a
 *    number unused, which is fine: numbers are sequential, not gapless.
 */
export async function submitPublicTicket(formData: FormData): Promise<SubmitResult> {
  const parsed = publicTicketSchema.safeParse({
    clientCompanyName: formData.get("clientCompanyName"),
    contactName: formData.get("contactName"),
    contactEmail: formData.get("contactEmail"),
    issueType: formData.get("issueType"),
    urgency: formData.get("urgency"),
    description: formData.get("description"),
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }
  const data = parsed.data;

  const files = formData
    .getAll("attachments")
    .filter((f): f is File => f instanceof File && f.size > 0);

  if (files.length > MAX_ATTACHMENTS) {
    return { ok: false, error: `Please attach at most ${MAX_ATTACHMENTS} files.` };
  }
  for (const file of files) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return { ok: false, error: `"${file.name}" is larger than 10MB.` };
    }
    if (
      !ALLOWED_ATTACHMENT_TYPES.includes(file.type as (typeof ALLOWED_ATTACHMENT_TYPES)[number])
    ) {
      return { ok: false, error: `"${file.name}" must be an image or PDF.` };
    }
  }

  // Single-tenant for now; Phase 7 (tenant onboarding) turns this into
  // per-domain/per-slug resolution.
  const organization = await prisma.organization.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!organization) {
    return { ok: false, error: "Support is not configured yet. Please call us instead." };
  }

  let ticketNumber: string;
  try {
    const org = await prisma.organization.update({
      where: { id: organization.id },
      data: { lastTicketSequence: { increment: 1 } },
      select: { lastTicketSequence: true },
    });
    ticketNumber = `TKT-${String(org.lastTicketSequence).padStart(4, "0")}`;
  } catch {
    return { ok: false, error: "Something went wrong submitting your request. Please try again." };
  }

  // Raw INSERT rather than tx.ticket.create(), deliberately.
  //
  // Prisma's create() always compiles to INSERT ... RETURNING, and a RETURNING
  // clause is evaluated against the SELECT policy. `anon` has no SELECT policy
  // on tickets (by design -- the public must never read tickets back), so the
  // ORM path fails with 42501 "new row violates row-level security policy"
  // even though the INSERT itself is permitted. Generating the id here and
  // skipping RETURNING keeps the write inside the anon role instead of
  // widening anon's read access to make an ORM convenience work.
  const ticketId = crypto.randomUUID();
  try {
    await withRLS(null, (tx) =>
      tx.$executeRaw`
        insert into public.tickets
          (id, "organizationId", "ticketNumber", "clientCompanyName", "contactName",
           "contactEmail", "issueType", urgency, description, status, "createdAt")
        values (
          ${ticketId}, ${organization.id}, ${ticketNumber}, ${data.clientCompanyName},
          ${data.contactName}, ${data.contactEmail}, ${data.issueType},
          ${data.urgency}::"TicketUrgency", ${data.description},
          'New'::"TicketStatus", now()
        )
      `,
    );
  } catch {
    return { ok: false, error: "Something went wrong submitting your request. Please try again." };
  }

  // Attachments upload after the ticket exists. A failure here must not lose
  // the request itself -- the description is the important part.
  const failed: string[] = [];
  for (const file of files) {
    try {
      const path = ticketAttachmentPath(
        organization.id,
        data.clientCompanyName,
        ticketNumber,
        file.name,
      );
      await uploadTicketAttachment(path, Buffer.from(await file.arrayBuffer()), file.type);
      // Same no-RETURNING reasoning as the ticket insert above.
      await withRLS(null, (tx) =>
        tx.$executeRaw`
          insert into public.ticket_attachments (id, "ticketId", "fileUrl", "fileName", "uploadedAt")
          values (${crypto.randomUUID()}, ${ticketId}, ${path}, ${file.name}, now())
        `,
      );
    } catch {
      failed.push(file.name);
    }
  }

  if (failed.length > 0) {
    return {
      ok: false,
      error:
        `Your request was submitted as ${ticketNumber}, but ${failed.join(", ")} ` +
        "couldn't be attached. Please reply to the confirmation email with the files.",
    };
  }

  return { ok: true, ticketNumber };
}
