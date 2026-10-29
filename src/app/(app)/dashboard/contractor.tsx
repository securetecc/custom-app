import { requireOrgContext } from "@/lib/auth";
import { buildGreeting } from "@/lib/greeting";
import { pacificDayStart, pacificMonthStart } from "@/lib/cron/pacific";
import { ContractorDashboard } from "@/components/app/dashboard/contractor-dashboard";

/**
 * The contractor's own figures, gathered in one transaction.
 *
 * Every query here is filtered to the person asking, so nothing it can
 * return belongs to anyone else: their hours, their unbilled time, their
 * tasks. Kept beside the dashboard it replaces rather than inside it, so the
 * money screen and this one cannot drift into each other.
 */
export async function ContractorDashboardPage() {
  const dayStart = pacificDayStart();
  const monthStart = pacificMonthStart();
  // Monday of the current week, in Pacific terms.
  const weekStart = new Date(dayStart);
  const daysSinceMonday = (weekStart.getUTCDay() + 6) % 7;
  weekStart.setTime(weekStart.getTime() - daysSinceMonday * 86_400_000);

  const { appUser, data } = await requireOrgContext(async (tx, me) => {
    const mine = { performedByUserId: me.id };
    const [today, week, month, unbilled, tasks] = await Promise.all([
      tx.timeEntry.aggregate({ where: { ...mine, date: { gte: dayStart } }, _sum: { durationHours: true } }),
      tx.timeEntry.aggregate({ where: { ...mine, date: { gte: weekStart } }, _sum: { durationHours: true } }),
      tx.timeEntry.aggregate({
        where: { ...mine, date: { gte: monthStart } },
        _sum: { durationHours: true },
        _count: true,
      }),
      tx.timeEntry.aggregate({
        where: { ...mine, invoiceId: null, billableStatus: "Billable" },
        _sum: { durationHours: true },
      }),
      tx.task.findMany({
        where: {
          status: { not: "Completed" },
          OR: [{ assignedToUserId: me.id }, { assignees: { some: { userId: me.id } } }],
        },
        orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { priority: "desc" }],
        take: 8,
        select: { id: true, title: true, status: true, priority: true, dueDate: true },
      }),
    ]);
    return { today, week, month, unbilled, tasks };
  });

  const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

  return (
    <ContractorDashboard
      greeting={buildGreeting({
        firstName: appUser.name.split(" ")[0],
        birthMonth: appUser.birthMonth,
        birthDay: appUser.birthDay,
        organizationName: appUser.organization.name,
      })}
      hours={{
        today: num(data.today._sum.durationHours),
        week: num(data.week._sum.durationHours),
        month: num(data.month._sum.durationHours),
        unbilled: num(data.unbilled._sum.durationHours),
        monthEntries: data.month._count,
      }}
      tasks={data.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate ? task.dueDate.toISOString().slice(0, 10) : null,
      }))}
    />
  );
}
