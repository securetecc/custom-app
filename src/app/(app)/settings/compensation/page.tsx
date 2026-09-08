import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOrgContext } from "@/lib/auth";
import { withRLS } from "@/lib/db/rls";
import { Button } from "@/components/ui/button";
import { CompensationSettings } from "@/components/app/compensation-settings";

/**
 * The figures behind the BBZ compensation report.
 *
 * Admin-only to edit — they decide what the business pays out. The report
 * itself is visible to everyone, which is the point of it.
 */
export default async function CompensationSettingsPage() {
  const { appUser, authUserId } = await requireOrgContext();
  if (appUser.role !== "admin") redirect("/dashboard?error=admin-only");

  const [org, bands] = await withRLS(authUserId, (tx) =>
    Promise.all([
      tx.organization.findUniqueOrThrow({
        where: { id: appUser.organizationId },
        select: { bbzRetainerAmount: true, bbzCommissionPercent: true },
      }),
      tx.bonusBand.findMany({ orderBy: { lowerExclusive: "asc" } }),
    ]),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Compensation</h1>
        <p className="text-muted-foreground">
          The retainer, the bonus escalator and the commission rate — the figures the BBZ Studio
          report calculates against.
        </p>
      </div>

      <CompensationSettings
        retainerAmount={Number(org.bbzRetainerAmount)}
        commissionPercent={Number(org.bbzCommissionPercent)}
        bands={bands.map((b) => ({
          lowerExclusive: Number(b.lowerExclusive),
          upperInclusive: b.upperInclusive === null ? null : Number(b.upperInclusive),
          ratePercent: Number(b.ratePercent),
        }))}
      />

      <div>
        <Button variant="ghost" render={<Link href="/settings" />}>
          ← Back to settings
        </Button>
      </div>
    </div>
  );
}
