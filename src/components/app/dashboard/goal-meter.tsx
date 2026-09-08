import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import type { DashboardMetrics } from "@/lib/dashboard/metrics";

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

/**
 * Progress toward the monthly invoicing target.
 *
 * A meter, not a pie or a gauge: the job is "one ratio against a limit", and a
 * meter is the form that reads at a glance without needing a legend. The
 * pace marker is what makes it actionable -- 60% of target on the 20th of a
 * 31-day month is behind, and the bar alone can't say that.
 */
export function GoalMeter({ goal }: { goal: DashboardMetrics["goal"] }) {
  const pct = goal.target > 0 ? goal.invoiced / goal.target : 0;
  const filled = Math.min(1, Math.max(0, pct));
  const pacePct = goal.daysInMonth > 0 ? goal.daysElapsed / goal.daysInMonth : 0;
  const expected = goal.target * pacePct;
  const delta = goal.invoiced - expected;
  const onTrack = delta >= 0;

  // Where the invoiced bar ends, plus what the unbilled pipeline would add if
  // it were all invoiced today. Shown as a lighter continuation, never folded
  // into the headline number -- it is not revenue yet.
  const pipelineEnd = Math.min(1, (goal.invoiced + goal.pipeline) / (goal.target || 1));

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle className="text-base font-medium text-muted-foreground">
            {goal.monthLabel} invoicing goal
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            Day {goal.daysElapsed} of {goal.daysInMonth}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {/* Hero figure: the one number this card exists to show. */}
          <span className="text-4xl font-semibold tabular-nums tracking-tight">
            {usd(goal.invoiced)}
          </span>
          <span className="text-sm text-muted-foreground">of {usd(goal.target)}</span>
          <span className="ml-auto text-sm font-medium tabular-nums">
            {Math.round(pct * 100)}%
          </span>
        </div>

        <div className="space-y-2">
          <div
            className="relative h-3 w-full overflow-hidden rounded-full"
            style={{ background: "var(--viz-track)" }}
            role="meter"
            aria-valuenow={Math.round(goal.invoiced)}
            aria-valuemin={0}
            aria-valuemax={Math.round(goal.target)}
            aria-label={`${goal.monthLabel} invoicing: ${usd(goal.invoiced)} of ${usd(goal.target)}`}
          >
            {goal.pipeline > 0 && (
              <div
                className="absolute inset-y-0 left-0 rounded-full opacity-30"
                style={{ width: `${pipelineEnd * 100}%`, background: "var(--viz-teal)" }}
              />
            )}
            <div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${filled * 100}%`, background: "var(--viz-teal)" }}
            />
            {/* Pace marker: where you'd be if invoicing were spread evenly. */}
            {pacePct > 0 && pacePct < 1 && (
              <div
                className="absolute inset-y-0 w-0.5 bg-foreground/45"
                style={{ left: `${pacePct * 100}%` }}
                title={`Even pace for today: ${usd(expected)}`}
              />
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
            <span
              className="font-medium"
              style={{ color: onTrack ? "var(--viz-good)" : "var(--viz-warn)" }}
            >
              {onTrack ? "On track" : "Behind pace"} — {onTrack ? "+" : "−"}
              {usd(Math.abs(delta))} vs {usd(expected)} expected by today
            </span>
            <span className="text-muted-foreground">
              {usd(Math.max(0, goal.target - goal.invoiced))} to go
            </span>
          </div>
        </div>

        {/* Straight to this month's invoicing, not the generic Reports page:
            the question the meter raises is "what is behind this figure",
            and the answer is the current month's invoices by client. */}
        <Link
          href="/reports?range=mtd"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          View invoicing reports
          <ArrowRight className="ml-1 h-4 w-4" />
        </Link>

        {goal.pipeline > 0 && (
          <p className="border-t pt-3 text-xs text-muted-foreground">
            <span
              className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle opacity-30"
              style={{ background: "var(--viz-teal)" }}
            />
            {usd(goal.pipeline)} in unbilled billable time isn&apos;t counted above — invoicing it
            would put the month at {usd(goal.invoiced + goal.pipeline)}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
