import { CalendarDays } from "lucide-react";
import { requireAdminContext } from "@/lib/auth";
import { ComingSoon } from "@/components/app/coming-soon";

/** Planned: a read-only view of the calendars that already exist elsewhere. */
export default async function CalendarPage() {
  await requireAdminContext();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
        <p className="text-muted-foreground">
          Meetings and events from every connected email account, in one place.
        </p>
      </div>

      <ComingSoon
        icon={CalendarDays}
        title="Coming soon"
        description="Read-only, by design — everything shows here, nothing is created here."
        points={[
          "Every connected account's calendar in a single view — day, week and month.",
          "Each event colour-coded by which account it came from, so it's clear at a glance which hat a meeting belongs to.",
          "Today's schedule surfaced on the dashboard, next to the hours and tickets.",
          "Read-only: events are created wherever they already are, and simply appear here.",
        ]}
        preview={
          <div className="rounded-md border p-2">
            <div className="mb-1.5 grid grid-cols-5 gap-1">
              {["Mon 24", "Tue 25", "Wed 26", "Thu 27", "Fri 28"].map((d) => (
                <p key={d} className="text-[10px] uppercase tracking-wider text-muted-foreground">{d}</p>
              ))}
            </div>
            <div className="grid grid-cols-5 gap-1">
              {[
                [["9:00 PCC standup", "var(--viz-teal)"]],
                [["11:30 Sergent migration", "var(--viz-1)"]],
                [["10:00 UPH review", "var(--viz-teal)"], ["15:00 Dentist", "var(--viz-4)"]],
                [],
                [["13:00 Invoicing block", "var(--viz-1)"]],
              ].map((day, i) => (
                <div key={i} className="min-h-16 space-y-1 rounded border p-1">
                  {day.map(([label, color]) => (
                    <div
                      key={label}
                      className="rounded px-1 py-0.5 text-[9px] leading-tight"
                      style={{ borderLeft: `2px solid ${color}`, background: "color-mix(in oklab, currentColor 6%, transparent)" }}
                    >
                      {label}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              Colour marks which account an event came from.
            </p>
          </div>
        }
        note="Keeping it one-way is the whole point. Two-way sync means deciding what happens when the same event is edited in both places, and that is how duplicate and silently-deleted calendar entries happen. Google Calendar can use the service account already set up for Drive and Gmail; other providers need their own connection."
      />
    </div>
  );
}
