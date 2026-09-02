"use server";

import { revalidatePath } from "next/cache";
import { requireOrgContext } from "@/lib/auth";
import { withRLS } from "@/lib/db/rls";
import { timeEntryFormSchema, type TimeEntryFormValues } from "@/lib/validations/time-entry";
import { billableHours, isOnSiteCode } from "@/lib/billing/travel";

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

      // Billing minimum and the travel rule are the DB's to decide, never the
      // form's: the minimum comes from the service type and the client's
      // service area, and travel is billed one way in area, both ways outside
      // it. durationHours stores what is BILLED; travelMinutes keeps what was
      // actually driven, so changing the rule later cannot rewrite history.
      const client = await tx.client.findUniqueOrThrow({
        where: { id: data.clientId },
        select: { serviceArea: true },
      });
      const { hours: durationHours } = billableHours({
        workedHours: data.durationHours,
        travelMinutes: data.travelMinutes,
        serviceTypeMinimumHours: Number(serviceType.billingMinimumHours),
        serviceArea: client.serviceArea,
        isOnSite: isOnSiteCode(serviceType.code),
      });

      await tx.timeEntry.create({
        data: {
          organizationId: appUser.organizationId,
          clientId: data.clientId,
          serviceTypeId: data.serviceTypeId,
          date: new Date(data.date),
          durationHours,
          description: data.description,
          billableStatus: data.billableStatus,
          rateOverride: data.rateOverride,
          travelMinutes: data.travelMinutes,
          loggedByUserId: appUser.id,
          rawInput: rawInput ?? null,
          // Presence of rawInput is already this codebase's existing signal
          // for "came from the AI/voice parser" -- source just makes it a
          // proper queryable column instead of an implicit null check.
          source: rawInput ? "Voice" : "Manual",
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
      const client = await tx.client.findUniqueOrThrow({
        where: { id: data.clientId },
        select: { serviceArea: true },
      });
      const { hours: durationHours } = billableHours({
        workedHours: data.durationHours,
        travelMinutes: data.travelMinutes,
        serviceTypeMinimumHours: Number(serviceType.billingMinimumHours),
        serviceArea: client.serviceArea,
        isOnSite: isOnSiteCode(serviceType.code),
      });

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
          rateOverride: data.rateOverride,
          travelMinutes: data.travelMinutes,
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
  const { authUserId, appUser } = await requireOrgContext();

  try {
    await withRLS(authUserId, async (tx) => {
      // Check invoiceId explicitly first, so a technician trying to delete a
      // billed entry gets a clear message instead of a raw RLS-driven "record
      // not found" from the delete itself. Admins are still allowed through --
      // RLS ("staff can delete unbilled, admin can delete any") permits it
      // too; the UI just asks for stronger confirmation for them.
      const entry = await tx.timeEntry.findUniqueOrThrow({ where: { id } });
      if (entry.invoiceId && appUser.role !== "admin") {
        throw new AlreadyInvoicedError();
      }
      await tx.timeEntry.delete({ where: { id } });
    });
  } catch (err: unknown) {
    return { ok: false, error: errorMessage(err) };
  }

  revalidatePath("/time-entries");
  return { ok: true };
}

class AlreadyInvoicedError extends Error {}

function errorMessage(err: unknown): string {
  if (err instanceof AlreadyInvoicedError) {
    return "This entry has already been invoiced — ask an admin to void the invoice first.";
  }
  if (err instanceof Error) {
    if (err.message.includes("Record to update not found") || err.message.includes("No record")) {
      return "This entry is already billed and can no longer be edited by a technician.";
    }
    return err.message;
  }
  return "Something went wrong.";
}
