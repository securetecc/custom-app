import { Sunrise } from "lucide-react";
import { requireOrgContext } from "@/lib/auth";
import { ComingSoon } from "@/components/app/coming-soon";
import { buildGreeting, PACIFIC_LONG_DATE } from "@/lib/greeting";

/**
 * The "start here" screen: what today asks of you, in one place.
 *
 * The header is real, not mocked -- it runs the same Pacific-aware greeting
 * the dashboard uses, so the page is already correct about who you are, what
 * time it is, and whether it's your birthday. Only the body below is pending.
 */
export default async function TodayPage() {
  const { appUser } = await requireOrgContext();
  const greeting = buildGreeting({
    firstName: appUser.name.split(" ")[0],
    birthMonth: appUser.birthMonth,
    birthDay: appUser.birthDay,
    organizationName: appUser.organization.name,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-glow text-2xl font-semibold tracking-tight text-[var(--teal-ink)]">
          {greeting.headline}
        </h1>
        <p className="text-muted-foreground">{PACIFIC_LONG_DATE.format(new Date())}</p>
      </div>

      <ComingSoon
        icon={Sunrise}
        title="Coming soon"
        description="One screen that answers “what do I need to do today?”"
        points={[
          "Your Day — today's meetings and calls, pulled from the connected calendars.",
          "Priority Work — the handful of things that actually matter today, ranked, drawn from open tickets and assigned tasks.",
          "Time — how much of today is still unlogged, with a button that fixes it on the spot.",
          "Tickets — open, urgent and due-today counts, so nothing is discovered late.",
          "Follow-ups — anything waiting on a reply from you.",
          "Quick actions — new ticket, log time, create task, add note, without navigating anywhere.",
        ]}
        note="Every count here already exists somewhere in the platform; what's missing is one place that puts them in front of you in the order the day needs them. The calendar strip depends on the Calendar tab landing first, since that's where the connected accounts live."
        preview={<TodayPreview />}
      />
    </div>
  );
}

/** Static sketch of the layout. Illustrative content, not live data. */
function TodayPreview() {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Block title="Your day">
        {[
          ["9:00 AM", "Team meeting"],
          ["11:00 AM", "Client call"],
          ["2:00 PM", "Project review"],
        ].map(([time, label]) => (
          <div key={label} className="flex gap-2 text-[11px]">
            <span className="w-16 shrink-0 tabular-nums text-muted-foreground">{time}</span>
            <span>{label}</span>
          </div>
        ))}
      </Block>

      <Block title="Priority work">
        {[
          ["var(--destructive)", "Resolve Client X — server issue"],
          ["var(--viz-warn)", "Follow up on Client Y"],
          ["var(--viz-teal)", "Review Project Z"],
        ].map(([color, label]) => (
          <div key={label} className="flex items-center gap-2 text-[11px]">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
            <span>{label}</span>
          </div>
        ))}
      </Block>

      <Block title="Time">
        <p className="text-[11px]" style={{ color: "var(--viz-warn)" }}>
          2h 15m of today&apos;s work is not yet logged
        </p>
        <FakeButton>Log time</FakeButton>
      </Block>

      <Block title="Tickets">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] tabular-nums">
          <span>8 open</span>
          <span style={{ color: "var(--destructive)" }}>2 urgent</span>
          <span style={{ color: "var(--viz-warn)" }}>3 due today</span>
        </div>
        <p className="text-[11px] text-muted-foreground">4 follow-ups waiting on your reply</p>
      </Block>

      <div className="md:col-span-2">
        <Block title="Quick actions">
          <div className="flex flex-wrap gap-1.5">
            {["+ New ticket", "Log time", "Create task", "Add note"].map((a) => (
              <FakeButton key={a}>{a}</FakeButton>
            ))}
          </div>
        </Block>
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 rounded-md border p-2.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

/** Looks like a button, isn't one -- this is a sketch, and a dead control
    that responds to clicks is worse than one that plainly doesn't. */
function FakeButton({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block rounded border px-2 py-1 text-[10px] text-accent">{children}</span>
  );
}
