"use server";

import { revalidatePath } from "next/cache";
import { requireOrgContext } from "@/lib/auth";
import { withRLS } from "@/lib/db/rls";
import { parseMinutes } from "@/lib/timezones";
import {
  availabilityFormSchema,
  type AvailabilityFormValues,
} from "@/lib/validations/availability";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Replaces one person's working week.
 *
 * The whole week at once, not block by block: an edit is "here is my week
 * now", and reconciling additions against removals row by row is a bug
 * waiting for the day someone moves two shifts in one go.
 *
 * Times arrive as wall-clock strings and are stored as minutes in the
 * person's own zone. Nothing here converts to UTC -- see UserAvailability for
 * why storing an instant would be wrong.
 */
export async function saveAvailability(input: AvailabilityFormValues): Promise<ActionResult> {
  const parsed = availabilityFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const { authUserId, appUser } = await requireOrgContext();
  // Checked here for a readable message; the row-level policy enforces it.
  if (appUser.role !== "admin" && appUser.id !== data.userId) {
    return { ok: false, error: "You can only change your own hours." };
  }

  const blocks = data.blocks.map((b) => {
    const start = parseMinutes(b.start);
    const end = parseMinutes(b.end);
    if (start === null || end === null) throw new Error("bad time");
    return { weekday: b.weekday, startMinutes: start, endMinutes: end, label: b.label || null };
  });

  try {
    await withRLS(authUserId, async (tx) => {
      await tx.user.update({
        where: { id: data.userId },
        data: {
          timeZone: data.timeZone,
          jobTitle: data.jobTitle || null,
          offlineAfterMinutes: data.offlineAfter ? parseMinutes(data.offlineAfter) : null,
          availabilityNote: data.availabilityNote || null,
        },
      });
      await tx.userAvailability.deleteMany({ where: { userId: data.userId } });
      if (blocks.length > 0) {
        await tx.userAvailability.createMany({
          data: blocks.map((b) => ({ ...b, userId: data.userId })),
        });
      }
    });
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't save those hours.",
    };
  }

  revalidatePath("/team");
  revalidatePath("/today");
  return { ok: true };
}
