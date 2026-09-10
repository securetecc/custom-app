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
        select: {
          bbzRetainerAmount: true,
          bbzCommissionPercent: true,
          bbzBountyPercent: true,
        },
      }),
      tx.bonusBand.findMany({
        orderBy: [{ effectiveFrom: "asc" }, { lowerExclusive: "asc" }],
      }),
    ]),
  );

  // One editor per vintage. The ladders are dated sets and a closed month
  // must never restate, so editing has to name which set it means rather
  // than silently rewriting whichever one happens to be loaded.
  const vintages = [...new Set(bands.map((b) => b.effectiveFrom))].sort();

  const monthLabel = (from: string) =>
    new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(`${from}-01T00:00:00Z`),
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

      {vintages.map((from, index) => (
        <CompensationSettings
          key={from}
          // The retainer and the percentages are single values, not dated, so
          // they are shown once beside the ladder in force now.
          showRates={index === vintages.length - 1}
          heading={
            vintages.length === 1
              ? "Bonus escalator"
              : `Bonus escalator from ${monthLabel(from)}`
          }
          note={
            index === 0 && vintages.length > 1
              ? "The ladder months before the next one are calculated against. Kept so a closed month never restates."
              : index === vintages.length - 1 && vintages.length > 1
                ? "Re-based for the new rate card. Read in hours the rungs are unchanged — 100 hours reaches the first either side."
                : null
          }
          retainerAmount={Number(org.bbzRetainerAmount)}
          commissionPercent={Number(org.bbzCommissionPercent)}
          bountyPercent={Number(org.bbzBountyPercent)}
          bandsEffectiveFrom={from}
          bands={bands
            .filter((b) => b.effectiveFrom === from)
            .map((b) => ({
              lowerExclusive: Number(b.lowerExclusive),
              upperInclusive: b.upperInclusive === null ? null : Number(b.upperInclusive),
              ratePercent: Number(b.ratePercent),
            }))}
        />
      ))}

      <div>
        <Button variant="ghost" render={<Link href="/settings" />}>
          ← Back to settings
        </Button>
      </div>
    </div>
  );
}
