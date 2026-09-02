import { Suspense } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { requireAdminContext } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RangeFilter } from "@/components/app/dashboard/range-filter";
import { resolveRange } from "@/lib/dashboard/metrics";
import { loadReports } from "@/lib/reports/metrics";
import { AGING_LABELS } from "@/lib/reports/aging";

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const usd2 = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

type SearchParams = Promise<{ range?: string; from?: string; to?: string }>;

/**
 * Reporting: what each client is worth and where the hours go.
 *
 * Admin-only. Effective rate per client is the kind of number that decides
 * whether an account is kept, and it isn't a technician's to weigh.
 */
export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const range = resolveRange(sp.range, sp.from, sp.to);

  const { data } = await requireAdminContext((tx) => loadReports(tx, range));
  const { clients, serviceTypes, totals, paymentSpeed, aging, profitability } = data!;

  // The PDF route re-resolves the range from these same params, so the
  // download is always the report on screen rather than a default period.
  const pdfQuery = new URLSearchParams();
  if (sp.range) pdfQuery.set("range", sp.range);
  if (sp.from) pdfQuery.set("from", sp.from);
  if (sp.to) pdfQuery.set("to", sp.to);
  const pdfHref = `/reports/pdf${pdfQuery.size > 0 ? `?${pdfQuery}` : ""}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-muted-foreground">
          Where the revenue comes from, and what an hour is actually worth.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{range.label}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Suspense fallback={null}>
            <RangeFilter current={range.key} from={sp.from} to={sp.to} />
          </Suspense>
          {/* A plain anchor, not a button: downloads want a real href so
              open-in-new-tab and save-as behave. */}
          <a href={pdfHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
            <Download className="h-4 w-4" />
            Download PDF
          </a>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Invoiced" value={usd(totals.invoiced)} hint={`${totals.invoiceCount} invoice${totals.invoiceCount === 1 ? "" : "s"} · ${totals.clientsInvoiced} client${totals.clientsInvoiced === 1 ? "" : "s"}`} />
        <Stat
          label="Effective rate"
          value={totals.effectiveRate === null ? "—" : usd2(totals.effectiveRate)}
          hint={totals.effectiveRate === null ? "Nothing billed yet" : `across ${totals.billedHours}h billed`}
        />
        <Stat label="Billable hours logged" value={`${totals.loggedBillable}h`} hint="Time entries in this period" />
        <Stat
          label="Non-billable"
          value={`${totals.loggedNonBillable}h`}
          hint={
            totals.loggedBillable + totals.loggedNonBillable > 0
              ? `${Math.round((totals.loggedNonBillable / (totals.loggedBillable + totals.loggedNonBillable)) * 100)}% of time logged`
              : "No time logged"
          }
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">By client</CardTitle>
          <CardDescription>
            Every active client, whether or not they moved this period — a quiet client is the
            one worth noticing. Effective rate is what was invoiced divided by the hours on those
            invoices, so a client absorbing unbilled time shows a lower rate than their nominal
            one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {clients.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No invoices raised or time logged in this period.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead className="text-right">Invoiced</TableHead>
                  <TableHead className="text-right">Share</TableHead>
                  <TableHead className="text-right">Billed hrs</TableHead>
                  <TableHead className="text-right">Eff. rate</TableHead>
                  <TableHead className="text-right">Logged (B/NB)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.map((c) => (
                  <TableRow key={c.clientId} className={c.dormant ? "text-muted-foreground" : undefined}>
                    <TableCell className="font-medium">
                      <Link href={`/clients/${c.clientId}`} className="hover:underline">
                        {c.name}
                      </Link>
                      {c.dormant && (
                        <span className="ml-2 text-xs font-normal">no activity</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{usd(c.invoicedAmount)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {c.share > 0 ? `${Math.round(c.share * 100)}%` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.billedHours > 0 ? `${c.billedHours}h` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.effectiveRate === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        usd2(c.effectiveRate)
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {c.loggedBillable}h / {c.loggedNonBillable}h
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Money owed, by age</CardTitle>
          <CardDescription>
            Counted from the day each invoice was sent, because that is when the client&apos;s
            clock starts. Part-paid invoices count only their balance. This ignores the period
            filter — an unpaid invoice from March is still unpaid whichever month you are
            looking at.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {aging.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing outstanding — every invoice raised has been paid.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead className="text-right">{AGING_LABELS.current}</TableHead>
                  <TableHead className="text-right">{AGING_LABELS.d31_60}</TableHead>
                  <TableHead className="text-right">{AGING_LABELS.d61_90}</TableHead>
                  <TableHead className="text-right">{AGING_LABELS.d90plus}</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aging.rows.map((r) => (
                  <TableRow key={r.clientId}>
                    <TableCell className="font-medium">
                      <Link href={`/clients/${r.clientId}`} className="hover:underline">
                        {r.name}
                      </Link>
                      <span className="ml-2 text-xs text-muted-foreground">
                        oldest {r.oldestDays}d
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.current ? usd(r.current) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.d31_60 ? usd(r.d31_60) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.d61_90 ? usd(r.d61_90) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {r.d90plus ? usd(r.d90plus) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{usd(r.total)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="font-semibold">Total owed</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(aging.totals.current)}</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(aging.totals.d31_60)}</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(aging.totals.d61_90)}</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(aging.totals.d90plus)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {usd(aging.totals.total)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Revenue against cost</CardTitle>
          <CardDescription>
            Costs recorded in Settings → Expenses. A cost attached to a client is set against
            what that client was billed; overhead is reported here and deliberately NOT split
            across clients — an invented split makes a per-client profit look precise when it
            is a guess.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-4">
            <Stat label="Invoiced" value={usd(profitability.revenue)} hint={range.label.toLowerCase()} />
            <Stat label="Direct costs" value={usd(profitability.directCosts)} hint="attached to a client" />
            <Stat label="Overhead" value={usd(profitability.overhead)} hint="not client-specific" />
            <Stat
              label="Net"
              value={usd(profitability.netProfit)}
              hint={
                profitability.revenue > 0
                  ? `${Math.round((profitability.netProfit / profitability.revenue) * 100)}% of invoiced`
                  : "nothing invoiced"
              }
            />
          </div>

          {profitability.clients.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No costs recorded yet. Add them in Settings → Expenses and this fills itself.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead className="text-right">Invoiced</TableHead>
                  <TableHead className="text-right">Direct cost</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                  <TableHead className="text-right">Margin %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profitability.clients.map((c) => (
                  <TableRow key={c.clientId}>
                    <TableCell className="font-medium">
                      <Link href={`/clients/${c.clientId}`} className="hover:underline">
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{usd(c.invoiced)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.directCost > 0 ? usd(c.directCost) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {usd(c.margin)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {c.marginRatio === null ? "—" : `${Math.round(c.marginRatio * 100)}%`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">How quickly clients pay</CardTitle>
          <CardDescription>
            Days from sent to paid, across every settled invoice — not just this period, because
            one month is too few invoices to judge a client on.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {paymentSpeed.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No invoices yet with both a sent and a paid date. Fill those in on the invoice page and
              this fills itself.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead className="text-right">Avg days</TableHead>
                  <TableHead className="text-right">Slowest</TableHead>
                  <TableHead className="text-right">Invoices</TableHead>
                  <TableHead>Usually pays by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paymentSpeed.map((c) => (
                  <TableRow key={c.clientId}>
                    <TableCell className="font-medium">
                      <Link href={`/clients/${c.clientId}`} className="hover:underline">
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell
                      className="text-right tabular-nums"
                      // 30 days is the same threshold the dashboard chases at.
                      style={c.averageDays >= 30 ? { color: "var(--viz-warn)" } : undefined}
                    >
                      {c.averageDays}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {c.slowestDays}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {c.paidCount}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{c.usualMethod ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">By service type</CardTitle>
          <CardDescription>Where the hours went across {range.label.toLowerCase()}.</CardDescription>
        </CardHeader>
        <CardContent>
          {serviceTypes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No time logged in this period.</p>
          ) : (
            <div className="space-y-3">
              {serviceTypes.map((t) => (
                <div key={t.code} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span>
                      <span className="font-medium">{t.code}</span>{" "}
                      <span className="text-muted-foreground">{t.label}</span>
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {t.hours}h
                      <span className="ml-2 text-muted-foreground">
                        {t.entries} {t.entries === 1 ? "entry" : "entries"}
                      </span>
                    </span>
                  </div>
                  {/* A bar rather than a pie: seven service types read as
                      seven indistinguishable wedges, but sort cleanly as
                      lengths against a shared baseline. */}
                  <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--viz-track)" }}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.max(t.share * 100, 1)}%`, background: "var(--viz-teal)" }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">{hint}</CardContent>
    </Card>
  );
}
