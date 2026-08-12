import { prisma } from "@/lib/db/prisma";

export const AUTO_CLOSE_AFTER_DAYS = 7;

/**
 * Closes tickets that have sat in Resolved for 7+ days.
 *
 * Deliberately a plain module, NOT a "use server" action: every export of a
 * server-action file is callable from the browser, and this runs with no
 * authenticated user and spans every organization. Phase 5's cron route
 * imports it behind a CRON_SECRET check.
 *
 * Uses the trusted client for the same reason -- a scheduled job has no
 * session for withRLS to scope to.
 */
export async function autoCloseResolvedTickets(): Promise<{ closed: number }> {
  const cutoff = new Date(Date.now() - AUTO_CLOSE_AFTER_DAYS * 24 * 60 * 60 * 1000);

  const result = await prisma.ticket.updateMany({
    where: { status: "Resolved", resolvedAt: { lte: cutoff } },
    data: { status: "Closed" },
  });

  return { closed: result.count };
}
