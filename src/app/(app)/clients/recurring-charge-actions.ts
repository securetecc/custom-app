"use server";

import { revalidatePath } from "next/cache";
import { requireOrgContext } from "@/lib/auth";
import { withRLS } from "@/lib/db/rls";
import {
  recurringChargeFormSchema,
  type RecurringChargeFormValues,
} from "@/lib/validations/recurring-charge";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function createRecurringCharge(
  clientId: string,
  input: RecurringChargeFormValues,
): Promise<ActionResult> {
  const parsed = recurringChargeFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const { authUserId, appUser } = await requireOrgContext();

  try {
    await withRLS(authUserId, (tx) =>
      tx.recurringCharge.create({
        data: {
          organizationId: appUser.organizationId,
          clientId,
          description: data.description,
          amount: data.amount,
          billingFrequency: data.billingFrequency,
          activeStatus: data.activeStatus,
        },
      }),
    );
  } catch (err: unknown) {
    return { ok: false, error: errorMessage(err) };
  }

  revalidatePath(`/clients/${clientId}`);
  return { ok: true };
}

export async function updateRecurringCharge(
  id: string,
  clientId: string,
  input: RecurringChargeFormValues,
): Promise<ActionResult> {
  const parsed = recurringChargeFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const { authUserId } = await requireOrgContext();

  try {
    // Editing a template never rewrites history: past invoices carry their own
    // snapshot rows in invoice_recurring_charges, so changing the amount here
    // only affects future invoices.
    await withRLS(authUserId, (tx) =>
      tx.recurringCharge.update({
        where: { id },
        data: {
          description: data.description,
          amount: data.amount,
          billingFrequency: data.billingFrequency,
          activeStatus: data.activeStatus,
        },
      }),
    );
  } catch (err: unknown) {
    return { ok: false, error: errorMessage(err) };
  }

  revalidatePath(`/clients/${clientId}`);
  return { ok: true };
}

export async function deleteRecurringCharge(
  id: string,
  clientId: string,
): Promise<ActionResult> {
  const { authUserId } = await requireOrgContext();

  try {
    await withRLS(authUserId, (tx) => tx.recurringCharge.delete({ where: { id } }));
  } catch (err: unknown) {
    return { ok: false, error: errorMessage(err) };
  }

  revalidatePath(`/clients/${clientId}`);
  return { ok: true };
}

function errorMessage(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code?: string }).code;
    // Foreign key violation: snapshot rows on past invoices still reference it.
    if (code === "P2003") {
      return "This charge has been billed on past invoices and can't be deleted. Mark it inactive instead.";
    }
    if (code === "P2025") {
      return "That recurring charge no longer exists.";
    }
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}
