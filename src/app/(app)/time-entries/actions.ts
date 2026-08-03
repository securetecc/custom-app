"use server";

import { revalidatePath } from "next/cache";
import { requireOrgContext } from "@/lib/auth";
import { withRLS } from "@/lib/db/rls";
import { timeEntryFormSchema, type TimeEntryFormValues } from "@/lib/validations/time-entry";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function createTimeEntry(
  input: TimeEntryFormValues,
  rawInput?: string,
): Promise<ActionResult> {
  const parsed = timeEntryFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const { authUserId, appUser } = await requireOrgContext();

  try {
    await withRLS(authUserId, async (tx) => {
      const serviceType = await tx.serviceType.findUniqueOrThrow({
        where: { id: data.serviceTypeId },
      });

      // Billing minimum is the DB-side source of truth, not whatever the
      // client submitted -- always applied here, never trusted from the form.
      const minimum = Number(serviceType.billingMinimumHours);
      const durationHours = Math.max(data.durationHours, minimum);

      await tx.timeEntry.create({
        data: {
          organizationId: appUser.organizationId,
          clientId: data.clientId,
          serviceTypeId: data.serviceTypeId,
          date: new Date(data.date),
          durationHours,
          description: data.description,
          billableStatus: data.billableStatus,
          loggedByUserId: appUser.id,
          rawInput: rawInput ?? null,
        },
      });
    });
  } catch (err: unknown) {
    return { ok: false, error: errorMessage(err) };
  }

  revalidatePath("/time-entries");
  return { ok: true };
}

export async function updateTimeEntry(id: string, input: TimeEntryFormValues): Promise<ActionResult> {
  const parsed = timeEntryFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const { authUserId } = await requireOrgContext();

  try {
    await withRLS(authUserId, async (tx) => {
      const serviceType = await tx.serviceType.findUniqueOrThrow({
        where: { id: data.serviceTypeId },
      });
      const minimum = Number(serviceType.billingMinimumHours);
      const durationHours = Math.max(data.durationHours, minimum);

      // RLS ("time_entries: staff can update unbilled, admin can update any")
      // is what actually blocks a technician from editing a billed entry --
      // this update will simply affect 0 rows if the policy denies it.
      await tx.timeEntry.update({
        where: { id },
        data: {
          clientId: data.clientId,
          serviceTypeId: data.serviceTypeId,
          date: new Date(data.date),
          durationHours,
          description: data.description,
          billableStatus: data.billableStatus,
        },
      });
    });
  } catch (err: unknown) {
    return { ok: false, error: errorMessage(err) };
  }

  revalidatePath("/time-entries");
  return { ok: true };
}

export async function deleteTimeEntry(id: string): Promise<ActionResult> {
  const { authUserId } = await requireOrgContext();

  try {
    await withRLS(authUserId, (tx) => tx.timeEntry.delete({ where: { id } }));
  } catch (err: unknown) {
    return { ok: false, error: errorMessage(err) };
  }

  revalidatePath("/time-entries");
  return { ok: true };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.message.includes("Record to update not found") || err.message.includes("No record")) {
      return "This entry is already billed and can no longer be edited by a technician.";
    }
    return err.message;
  }
  return "Something went wrong.";
}
