import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import type { DashboardMetrics } from "@/lib/dashboard/metrics";

/**
 * "Have you logged today?"
 *
 * This IS the reminder now. There used to be a 7pm Pacific email as well, and
 * it has been removed: the people it nagged are in the platform every day,
 * and a mail that repeats what the first screen already says is one more
 * thing to delete. Asking here means the answer is one click away instead of
 * in another app.
 *
 * "Logged today" keeps its old definition -- any time entry created by this
 * user since PACIFIC midnight, not the server's, which on Vercel is UTC and
 * rolls over at 5pm local.
 *
 * Status is carried by an icon and a sentence, never by colour alone.
 */
export function TodayStatus({
  today,
  firstName,
}: {
  today: DashboardMetrics["today"];
  firstName: string;
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
          {done
            ? "Logging as you go is what keeps invoice time from becoming archaeology."
            : "This is your reminder — there is no longer an email one."}
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
