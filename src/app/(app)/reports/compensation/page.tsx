import Link from "next/link";
import { Suspense } from "react";
import { requireOrgContext } from "@/lib/auth";
import { withRLS } from "@/lib/db/rls";
import { PACIFIC_TZ, pacificDayStart } from "@/lib/cron/pacific";
import { loadCompensationReport } from "@/lib/reports/compensation";
import { MonthPicker } from "@/components/app/month-picker";
import { LEAD_SOURCE_LABELS } from "@/lib/bounty/qualify";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const hrs = (n: number) => n.toFixed(2);

/**
 * BBZ Studio's compensation for a month: retainer, performance bonus and
 * commission, with the working shown.
 *
 * Visible to every staff member, not admin-only. That is deliberate and it is
 * in the schedule: BBZ should be able to see exactly which work moved the
 * number rather than being handed a total to take on trust.
 */
export default async function CompensationReportPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: requested } = await searchParams;
  // Defaults to the month just ended, which is the one being paid: the
  // schedule says the figure is calculated in the first five business days
  // of the month for the month before it.
  const today = pacificDayStart();
  const previous = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const fallback = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone: PACIFIC_TZ,
  })
    .format(previous)
    .slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(requested ?? "") ? requested! : fallback;

  const { authUserId } = await requireOrgContext();
  const report = await withRLS(authUserId, (tx) => loadCompensationReport(tx, month));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">BBZ Studio compensation</h1>
          <p className="text-muted-foreground">
            Retainer, performance bonus and commission for one month, with the work behind it.
          </p>
        </div>
        <Suspense fallback={null}>
          <MonthPicker month={month} />
        </Suspense>
      </div>

      {!report ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Pick a month.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{report.monthLabel}</CardTitle>
              <CardDescription>
                {hrs(report.billableHours)} billable hours across {report.entryCount}{" "}
                {report.entryCount === 1 ? "entry" : "entries"}
                {report.unbilledHours > 0 && (
                  <>
                    {" · "}
                    {hrs(report.unbilledHours)}h not yet invoiced, counted anyway — an hour counts
                    in the month it was worked
                  </>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Figure label="Qualifying base" value={usd(report.qualifyingBase)} hint="billable labor, net of payouts" />
                <Figure
                  label="Band"
                  value={`${report.ratePercent.toFixed(2)}%`}
                  hint={
                    report.band
                      ? report.band.upperInclusive === null
                        ? `above ${usd(report.band.lowerExclusive)}`
                        : `${usd(report.band.lowerExclusive)} – ${usd(report.band.upperInclusive)}`
                      : "below the first rung"
                  }
                />
                <Figure label="Bonus" value={usd(report.bonus)} hint="on the whole base" />
                <Figure
                  label="Total payment"
                  value={usd(report.totalPayment)}
                  hint={`${usd(report.retainer)} retainer${
                    report.commission.total > 0 ? ` + ${usd(report.commission.total)} commission` : ""
                  }${report.bounty.dueTotal > 0 ? ` + ${usd(report.bounty.dueTotal)} bounty` : ""}`}
                  emphasis
                />
              </div>
            </CardContent>
          </Card>

          {/* The escalator is a target, not just a lookup: the arrangement
              exists to move the month up the ladder, so the report says what
              the next rung costs rather than leaving it to be worked out by
              hand each month. */}
          {(report.nextBand || report.ceiling) && report.billableHours > 0 && (
            <Card>
              <CardContent className="space-y-3 py-5">
                {report.ceiling && (
                  <>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm">
                        {report.ceiling.progress >= 1 ? (
                          <>
                            At or above {usd(report.ceiling.at)} — the top of the escalator, a flat{" "}
                            {report.ceiling.ratePercent.toFixed(2)}% of the whole base.
                          </>
                        ) : (
                          <>
                            {Math.round(report.ceiling.progress * 100)}% of the way to{" "}
                            {usd(report.ceiling.at)} a month, where the rate reaches{" "}
                            {report.ceiling.ratePercent.toFixed(2)}% and stops climbing.
                          </>
                        )}
                      </p>
                      {report.nextBand && (
                        <p className="text-sm text-muted-foreground">
                          {usd(report.nextBand.need)} more this month reaches{" "}
                          {report.nextBand.ratePercent.toFixed(2)}% —{" "}
                          {usd(report.nextBand.bonusThen)} instead of {usd(report.bonus)}.
                        </p>
                      )}
                    </div>
                    <div
                      className="h-2 w-full overflow-hidden rounded-full"
                      style={{ background: "color-mix(in oklab, var(--foreground) 10%, transparent)" }}
                      role="img"
                      aria-label={`${Math.round(report.ceiling.progress * 100)} percent of the way to ${usd(report.ceiling.at)}`}
                    >
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${Math.max(1, Math.round(report.ceiling.progress * 100))}%` }}
                      />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">By client</CardTitle>
              <CardDescription>
                Every client, no exceptions. Sorted by qualifying dollars.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {report.clients.length === 0 ? (
                <p className="text-sm text-muted-foreground">No billable hours in this month.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      <TableHead className="text-right">Qualifying</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.clients.map((c) => (
                      <TableRow key={c.clientId}>
                        <TableCell className="font-medium">
                          <Link href={`/clients/${c.clientId}`} className="hover:underline">
                            {c.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{hrs(c.hours)}</TableCell>
                        <TableCell className="text-right tabular-nums">{usd(c.qualifying)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell className="font-semibold">Total</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {hrs(report.billableHours)}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {usd(report.qualifyingBase)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">By service type</CardTitle>
              <CardDescription>
                Where a $75 or a $30 comes from. An hour enters at its net figure: where SecureTECC
                pays a third party out of a billed hour, only SecureTECC&apos;s share qualifies.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {report.serviceTypes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No billable hours in this month.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      <TableHead className="text-right">Billed rate</TableHead>
                      <TableHead className="text-right">Paid out</TableHead>
                      <TableHead className="text-right">Qualifying rate</TableHead>
                      <TableHead className="text-right">Qualifying</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.serviceTypes.map((t) => (
                      <TableRow key={t.code}>
                        <TableCell>
                          <span className="font-medium">{t.code}</span>
                          <span className="ml-2 text-muted-foreground">{t.label}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{hrs(t.hours)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {t.billedRate === null ? "mixed" : usd(t.billedRate)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {t.payoutRate === null ? "—" : usd(t.payoutRate)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {t.qualifyingRate === null ? "mixed" : usd(t.qualifyingRate)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{usd(t.qualifying)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Commission</CardTitle>
              <CardDescription>
                {report.commission.percent}% of what BBZ-performed IT hours billed for — the billed
                rate, not the qualifying one, since commission is a share of what the client was
                charged. Web, automation and low-voltage work is excluded.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {report.commission.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No commission-earning hours this month — nothing in {report.monthLabel} is
                  attributed to a BBZ person on an IT service type.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Performed by</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      <TableHead className="text-right">Billed rate</TableHead>
                      <TableHead className="text-right">Billed</TableHead>
                      <TableHead className="text-right">Commission</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.commission.rows.map((r) => (
                      <TableRow key={r.entryId}>
                        <TableCell className="whitespace-nowrap">{r.date}</TableCell>
                        <TableCell>{r.clientName}</TableCell>
                        <TableCell>{r.performedBy}</TableCell>
                        <TableCell>{r.serviceCode}</TableCell>
                        <TableCell className="text-right tabular-nums">{hrs(r.hours)}</TableCell>
                        <TableCell className="text-right tabular-nums">{usd(r.billedRate)}</TableCell>
                        <TableCell className="text-right tabular-nums">{usd(r.billed)}</TableCell>
                        <TableCell className="text-right tabular-nums">{usd(r.commission)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell colSpan={6} className="font-semibold">
                        Total
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {usd(report.commission.billedTotal)}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {usd(report.commission.total)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">New-client bounty</CardTitle>
              <CardDescription>
                {report.bounty.percent}% of everything a qualifying new client pays in its first
                twelve months — labor, monitoring, seats, DMARC and the annual licence line, but
                never reimbursed expenses, which SecureTECC earns nothing on. Counted on money
                actually received, so a client who leaves early carries only what they paid. Paid
                once, in the month the twelve months are up.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                  Due in {report.monthLabel}
                </p>
                {report.bounty.due.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No bounty matures this month.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Client</TableHead>
                        <TableHead>Came from</TableHead>
                        <TableHead>First twelve months</TableHead>
                        <TableHead className="text-right">They paid</TableHead>
                        <TableHead className="text-right">Bounty</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.bounty.due.map((b) => (
                        <TableRow key={b.clientId}>
                          <TableCell className="font-medium">
                            <Link href={`/clients/${b.clientId}`} className="hover:underline">
                              {b.name}
                            </Link>
                          </TableCell>
                          <TableCell>
                            {b.leadSource ? LEAD_SOURCE_LABELS[b.leadSource] : "—"}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {b.windowStart} → {b.windowEnd}
                            {b.windowStartSource === "first payment" && (
                              <span className="ml-1 text-xs">(from first payment)</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {usd(b.qualifyingRevenue)}
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {usd(b.bounty)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow>
                        <TableCell colSpan={4} className="font-semibold">
                          Total
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {usd(report.bounty.dueTotal)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                )}
              </div>

              {report.bounty.accruing.length > 0 && (
                <div>
                  <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                    Still accruing — not owed yet
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Client</TableHead>
                        <TableHead>Came from</TableHead>
                        <TableHead>Window closes</TableHead>
                        <TableHead className="text-right">Paid so far</TableHead>
                        <TableHead className="text-right">Bounty so far</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.bounty.accruing.map((b) => (
                        <TableRow key={b.clientId} className="text-muted-foreground">
                          <TableCell>
                            <Link href={`/clients/${b.clientId}`} className="hover:underline">
                              {b.name}
                            </Link>
                          </TableCell>
                          <TableCell>
                            {b.leadSource ? LEAD_SOURCE_LABELS[b.leadSource] : "—"}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{b.windowEnd}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {usd(b.qualifyingRevenue)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{usd(b.bounty)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {report.bounty.unattributed.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {report.bounty.unattributed.length} client
                  {report.bounty.unattributed.length === 1 ? " has" : "s have"} no
                  &ldquo;how did you hear about us?&rdquo; recorded, so no bounty can be paid on
                  {report.bounty.unattributed.length === 1 ? " it" : " them"}:{" "}
                  {report.bounty.unattributed.slice(0, 6).map((c, i) => (
                    <span key={c.clientId}>
                      {i > 0 && ", "}
                      <Link href={`/clients/${c.clientId}`} className="hover:underline">
                        {c.name}
                      </Link>
                    </span>
                  ))}
                  {report.bounty.unattributed.length > 6 &&
                    ` and ${report.bounty.unattributed.length - 6} more`}
                  . Set it on the client record.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">What is owed for {report.monthLabel}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableBody>
                  <TableRow>
                    <TableCell>Retainer</TableCell>
                    <TableCell className="text-right tabular-nums">{usd(report.retainer)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      Performance bonus
                      <span className="ml-2 text-muted-foreground">
                        {usd(report.qualifyingBase)} × {report.ratePercent.toFixed(2)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{usd(report.bonus)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Commission</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {usd(report.commission.total)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      New-client bounty
                      {report.bounty.due.length > 0 && (
                        <span className="ml-2 text-muted-foreground">
                          {report.bounty.due.map((b) => b.name).join(", ")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {usd(report.bounty.dueTotal)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-semibold">Total</TableCell>
                    <TableCell className="text-right text-lg font-semibold tabular-nums">
                      {usd(report.totalPayment)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">The escalator</CardTitle>
              <CardDescription>
                Bands are exclusive at the bottom and inclusive at the top, and the rate applies to
                the whole qualifying base rather than the amount above the threshold. Editable in
                Settings → Compensation.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Above</TableHead>
                    <TableHead>Up to and including</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.bands.map((b) => {
                    const active = report.band?.lowerExclusive === b.lowerExclusive;
                    return (
                      <TableRow
                        key={b.lowerExclusive}
                        className={active ? "font-medium text-accent" : undefined}
                      >
                        <TableCell>{b.lowerExclusive === 0 ? "—" : usd(b.lowerExclusive)}</TableCell>
                        <TableCell>
                          {b.upperInclusive === null ? "no ceiling" : usd(b.upperInclusive)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {b.ratePercent.toFixed(2)}%{active ? "  ←" : ""}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Figure({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${emphasis ? "text-accent" : ""}`}>{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
