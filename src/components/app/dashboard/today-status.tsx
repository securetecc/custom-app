import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import type { DashboardMetrics } from "@/lib/dashboard/metrics";

/**
 * "Have you logged today?" -- the same question the 7pm Pacific daily reminder
 * asks, surfaced where it can still be acted on.
 *
 * Deliberately shares the digest's definition (any time entry created by this
 * user since Pacific midnight), so the banner and the email can never disagree
 * and tell Tony two different things about the same day.
 *
 * Status is carried by an icon and a sentence, never by colour alone.
 */
export function TodayStatus({
  today,
  firstName,
  remindersOn,
}: {
  today: DashboardMetrics["today"];
  firstName: string;
  /** Whether THIS user is opted into the 7pm reminder (Settings → Staff). */
  remindersOn: boolean;
}) {
  const done = today.hasLogged;

  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3"
      style={{
        borderColor: done ? "var(--viz-good)" : "var(--viz-warn)",
        background: done ? "color-mix(in oklab, var(--viz-good) 8%, transparent)" : "color-mix(in oklab, var(--viz-warn) 8%, transparent)",
      }}
    >
      <span
        aria-hidden
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
        style={{ background: done ? "var(--viz-good)" : "var(--viz-warn)" }}
      >
        {done ? "✓" : "!"}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {done
            ? `Time logged today — ${today.loggedHours}h across ${today.loggedEntries} ${today.loggedEntries === 1 ? "entry" : "entries"}.`
            : `No time logged today yet, ${firstName}.`}
        </p>
        <p className="text-xs text-muted-foreground">
          {/* Only mention the reminder to people who actually receive it --
              promising a 7pm nudge to someone opted out is just wrong. */}
          {!remindersOn
            ? "Daily reminders are off for you."
            : done
              ? "You won't get the 7pm reminder."
              : "The daily reminder goes out at 7pm Pacific if nothing is logged."}
        </p>
      </div>

      <Link
        href="/time-entries"
        className={buttonVariants({ size: "sm", variant: done ? "outline" : "default" })}
      >
        {done ? "Add another" : "Log time"}
      </Link>
    </div>
  );
}
