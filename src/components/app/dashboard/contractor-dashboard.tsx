import Link from "next/link";
import { Clock, ListChecks, Plus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatHours } from "@/lib/format";
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from "@/lib/validations/task";

/**
 * The dashboard a contractor sees: their own work, and nothing else.
 *
 * The ordinary dashboard is a money screen -- revenue against target, what is
 * owed, every client with unbilled time. None of that is a contractor's to
 * read, and hiding the cards one by one would mean remembering to hide the
 * next one somebody adds. This is a separate view of their own figures.
 */
export function ContractorDashboard({
  greeting,
  hours,
  tasks,
}: {
  greeting: { headline: string; subline: string | null };
  hours: { today: number; week: number; month: number; unbilled: number; monthEntries: number };
  tasks: { id: string; title: string; status: string; priority: string; dueDate: string | null }[];
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-glow text-2xl font-semibold tracking-tight text-[var(--teal-ink)]">
          {greeting.headline}
        </h1>
        {greeting.subline && <p className="text-muted-foreground">{greeting.subline}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Logged today" value={formatHours(hours.today)} hint="hours you recorded today" />
        <Figure label="This week" value={formatHours(hours.week)} hint="since Monday" />
        <Figure
          label="This month"
          value={formatHours(hours.month)}
          hint={`${hours.monthEntries} ${hours.monthEntries === 1 ? "entry" : "entries"}`}
        />
        <Figure
          label="Not yet invoiced"
          value={formatHours(hours.unbilled)}
          hint="your hours waiting to be billed"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-muted-foreground" /> Your time
            </CardTitle>
            <CardDescription>Record your hours as you work rather than at month end.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Link href="/time-entries" className={buttonVariants({ size: "sm" })}>
              <Plus className="mr-1 h-4 w-4" /> Log time
            </Link>
            <Link href="/time-entries" className={buttonVariants({ variant: "outline", size: "sm" })}>
              See your entries
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="h-4 w-4 text-muted-foreground" /> Your tasks
            </CardTitle>
            <CardDescription>
              {tasks.length === 0 ? "Nothing assigned to you." : `${tasks.length} open`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing on your plate right now.</p>
            ) : (
              <ul className="divide-y">
                {tasks.map((task) => (
                  <li key={task.id} className="flex items-center gap-2 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
                    {task.dueDate && (
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {task.dueDate}
                      </span>
                    )}
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {TASK_STATUS_LABELS[task.status as keyof typeof TASK_STATUS_LABELS]}
                    </span>
                    <Badge variant="outline" className="shrink-0 font-normal">
                      {TASK_PRIORITY_LABELS[task.priority as keyof typeof TASK_PRIORITY_LABELS]}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href="/tasks"
              className={`mt-3 ${buttonVariants({ variant: "outline", size: "sm" })}`}
            >
              Open the board
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint: string }) {
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
