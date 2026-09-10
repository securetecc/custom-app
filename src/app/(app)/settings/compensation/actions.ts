"use server";

import { revalidatePath } from "next/cache";
import { requireAdminContext } from "@/lib/auth";
import { withRLS } from "@/lib/db/rls";
import {
  bonusBandsFormSchema,
  compensationSettingsSchema,
  type BonusBandsFormValues,
  type CompensationSettingsValues,
} from "@/lib/validations/compensation";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** The retainer and the commission percentage. */
export async function updateCompensationSettings(
  input: CompensationSettingsValues,
): Promise<ActionResult> {
  const parsed = compensationSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { authUserId, appUser } = await requireAdminContext();

  try {
    await withRLS(authUserId, (tx) =>
      tx.organization.update({
        where: { id: appUser.organizationId },
        data: {
          bbzRetainerAmount: parsed.data.retainerAmount,
          bbzCommissionPercent: parsed.data.commissionPercent,
          bbzBountyPercent: parsed.data.bountyPercent,
        },
      }),
    );
  } catch {
    return { ok: false, error: "Couldn't save those figures." };
  }

  revalidate();
  return { ok: true };
}

/**
 * Replaces ONE vintage of the escalator in one transaction.
 *
 * All-or-nothing rather than row by row: a half-applied edit could leave a
 * gap or an overlap between bands, and the report would quietly calculate
 * against it.
 *
 * Scoped to a single effectiveFrom, because the ladders are dated sets. A
 * delete across the whole organization would take the August ladder with it
 * and restate every bonus already paid.
 */
export async function replaceBonusBands(input: BonusBandsFormValues): Promise<ActionResult> {
  const parsed = bonusBandsFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const bands = [...parsed.data.bands].sort((a, b) => a.lowerExclusive - b.lowerExclusive);

  // Contiguity is checked here rather than left to the database: a gap means
  // some qualifying base falls in no band at all and silently pays nothing.
  for (let i = 0; i < bands.length - 1; i++) {
    const current = bands[i];
    const next = bands[i + 1];
    if (current.upperInclusive === null) {
      return { ok: false, error: "Only the last band can be open-ended." };
    }
    if (current.upperInclusive !== next.lowerExclusive) {
      return {
        ok: false,
        error:
          `Bands must meet: one ends at ${current.upperInclusive} and the next starts above ` +
          `${next.lowerExclusive}, which leaves a gap or an overlap.`,
      };
    }
  }

  const { authUserId, appUser } = await requireAdminContext();

  try {
    await withRLS(authUserId, async (tx) => {
      await tx.bonusBand.deleteMany({
        where: {
          organizationId: appUser.organizationId,
          effectiveFrom: parsed.data.effectiveFrom,
        },
      });
      await tx.bonusBand.createMany({
        data: bands.map((b) => ({
          organizationId: appUser.organizationId,
          effectiveFrom: parsed.data.effectiveFrom,
          ...b,
        })),
      });
    });
  } catch {
    return { ok: false, error: "Couldn't save the bands." };
  }

  revalidate();
  return { ok: true };
}

function revalidate(): void {
  revalidatePath("/settings/compensation");
  revalidatePath("/reports/compensation");
}
