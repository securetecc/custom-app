"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireOrgContext } from "@/lib/auth";
import { withRLS } from "@/lib/db/rls";
import {
  ticketStatusChangeSchema,
  type TicketStatusChangeValues,
} from "@/lib/validations/ticket";
import { getTicketAttachmentSignedUrl } from "@/lib/storage/ticket-attachments";

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

/**
 * Changes status and records the notes written for that change, in one write.
 *
 * This shape is the whole point: the proven system emails the client on a
 * status change and includes internalNotes as they were AT THAT MOMENT. Notes
 * added a minute later never appear in the already-sent email. Making the
 * notes part of the same action (rather than a separate "save notes" button)
 * is what stops that mistake. Phase 5 hangs the actual email off this action.
 */
export async function changeTicketStatus(
  id: string,
  input: TicketStatusChangeValues,
): Promise<ActionResult> {
  const parsed = ticketStatusChangeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { status, internalNotes } = parsed.data;

  const { authUserId } = await requireOrgContext();

  try {
    await withRLS(authUserId, async (tx) => {
      const ticket = await tx.ticket.findUniqueOrThrow({ where: { id } });

      const notes = internalNotes.trim();
      await tx.ticket.update({
        where: { id },
        data: {
          status,
          // Append rather than overwrite: the note history is what a later
          // reader needs to understand why a ticket moved.
          internalNotes: notes.length > 0 ? appendNote(ticket.internalNotes, status, notes) : ticket.internalNotes,
          // resolvedAt drives the 7-day auto-close, so it tracks the status.
          resolvedAt: status === "Resolved" ? new Date() : status === "Closed" ? ticket.resolvedAt : null,
        },
      });
    });
  } catch (err: unknown) {
    return { ok: false, error: errorMessage(err) };
  }

  revalidatePath("/tickets");
  revalidatePath(`/tickets/${id}`);
  return { ok: true };
}

export async function assignTicket(
  id: string,
  assignedToUserId: string | null,
): Promise<ActionResult> {
  const { authUserId } = await requireOrgContext();

  try {
    await withRLS(authUserId, (tx) =>
      tx.ticket.update({ where: { id }, data: { assignedToUserId } }),
    );
  } catch (err: unknown) {
    return { ok: false, error: errorMessage(err) };
  }

  revalidatePath("/tickets");
  revalidatePath(`/tickets/${id}`);
  return { ok: true };
}

export async function deleteTicket(id: string): Promise<ActionResult> {
  // Admin-only, matching the "tickets: staff can delete within org" policy,
  // which requires is_admin().
  await requireAdmin();
  const { authUserId } = await requireOrgContext();

  try {
    await withRLS(authUserId, (tx) => tx.ticket.delete({ where: { id } }));
  } catch (err: unknown) {
    return { ok: false, error: errorMessage(err) };
  }

  revalidatePath("/tickets");
  return { ok: true };
}

export async function getAttachmentUrl(path: string): Promise<ActionResult<string>> {
  const { authUserId } = await requireOrgContext();

  try {
    // Confirm the attachment belongs to a ticket this session can see before
    // minting a signed URL -- the signed URL itself bypasses RLS once issued.
    const attachment = await withRLS(authUserId, (tx) =>
      tx.ticketAttachment.findFirst({ where: { fileUrl: path }, select: { id: true } }),
    );
    if (!attachment) return { ok: false, error: "Attachment not found." };

    return { ok: true, data: await getTicketAttachmentSignedUrl(path) };
  } catch (err: unknown) {
    return { ok: false, error: errorMessage(err) };
  }
}

function appendNote(existing: string | null, status: string, note: string): string {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const entry = `[${stamp} · → ${status}] ${note}`;
  return existing && existing.trim().length > 0 ? `${existing}\n\n${entry}` : entry;
}

function errorMessage(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err) {
    if ((err as { code?: string }).code === "P2025") return "That ticket no longer exists.";
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}
