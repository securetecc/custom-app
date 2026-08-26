import {
  pacificDayStart,
  pacificMidnight,
  pacificMonthStart,
  pacificMonthStartsBack,
  PACIFIC_TZ,
} from "@/lib/cron/pacific";
import type { TxClient } from "@/lib/db/rls";

/**
 * Dashboard aggregates.
 *
 * Every date boundary here is PACIFIC, not UTC -- the same correctness point
 * the daily digest had to be fixed for. "Revenue this month" must not shift by
 * a day depending on what time of day the page is loaded.
 *
 * All queries take the caller's open `tx` so the whole dashboard is one
 * withRLS transaction rather than a dozen, matching how requireOrgContext's
 * callback is used elsewhere.
 */

export type RangeKey = "mtd" | "3m" | "6m" | "12m" | "custom";

export const RANGE_LABELS: Record<Exclude<RangeKey, "custom">, string> = {
  mtd: "This month",
  "3m": "Last 3 months",
  "6m": "Last 6 months",
  "12m": "Last 12 months",
};

const MONTHS_FOR: Record<Exclude<RangeKey, "custom">, number> = {
  mtd: 1,
  "3m": 3,
  "6m": 6,
  "12m": 12,
};

export type ResolvedRange = {
  key: RangeKey;
  label: string;
  start: Date;
  /** Exclusive upper bound. */
  end: Date;
  /** Month-start instants covering the range, oldest first. */
  buckets: Date[];
};

/**
 * Turns the URL's range params into concrete Pacific instants.
 *
 * Falls back to "this month" for anything unparseable rather than throwing --
 * a hand-edited query string should not 500 the dashboard.
 */
export function resolveRange(key?: string, from?: string, to?: string): ResolvedRange {
  if (key === "custom" && from && to) {
    // Parsed as PACIFIC midnight, not `new Date("2026-01-15T00:00:00")` --
    // that parses in the server's zone, which is UTC on Vercel, so a picked
    // date would silently start at 4pm the previous day in Pacific terms and
    // disagree with every other range on this page.
    const start = ymdToPacific(from);
    const end = ymdToPacific(to);
    if (start && end && start <= end) {
      // The picked end date is inclusive, so the exclusive bound is the
      // following Pacific midnight.
      const endExclusive = nextDayStart(end);
      return {
        key: "custom",
        label: `${formatDay(start)} – ${formatDay(end)}`,
        start,
        end: endExclusive,
        buckets: monthBucketsBetween(start, endExclusive),
      };
    }
  }

  const safe = (key && key in MONTHS_FOR ? key : "mtd") as Exclude<RangeKey, "custom">;
  const buckets = pacificMonthStartsBack(MONTHS_FOR[safe]);
  return {
    key: safe,
    label: RANGE_LABELS[safe],
    start: buckets[0],
    end: nextMonthStart(pacificMonthStart()),
    buckets,
  };
}

/** Pacific midnight starting the day after `d`'s Pacific day. */
function nextDayStart(d: Date): Date {
  // +36h lands solidly inside the next Pacific day regardless of a DST shift,
  // then pacificDayStart snaps back to that day's true midnight.
  return pacificDayStart(new Date(d.getTime() + 36 * 3_600_000));
}

/** "2026-01-15" -> Pacific midnight that day, or null if unparseable. */
function ymdToPacific(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const at = pacificMidnight(y, mo, d);
  return Number.isNaN(at.getTime()) ? null : at;
}

function nextMonthStart(monthStart: Date): Date {
  const d = new Date(monthStart);
  d.setUTCDate(20); // safely mid-month before advancing, avoids 31st overflow
  d.setUTCMonth(d.getUTCMonth() + 1);
  return pacificMonthStart(d);
}

function monthBucketsBetween(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  let cur = pacificMonthStart(start);
  while (cur < end) {
    out.push(cur);
    cur = nextMonthStart(cur);
  }
  return out.length ? out : [pacificMonthStart(start)];
}

function formatDay(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

export function formatMonth(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: PACIFIC_TZ, month: "short" }).format(d);
}

export function formatMonthYear(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: PACIFIC_TZ, month: "short", year: "numeric" }).format(d);
}

export type RevenueBucket = {
  monthStart: string;
  label: string;
  paid: number;
  sent: number;
  draft: number;
  total: number;
};

export type ClientShare = { name: string; amount: number };

export type DashboardMetrics = {
  today: {
    loggedEntries: number;
    loggedHours: number;
    hasLogged: boolean;
  };
  goal: {
    target: number;
    invoiced: number;
    /** Billable, not-yet-invoiced value sitting in time entries. */
    pipeline: number;
    /** 0-1, uncapped ratio is exposed separately for the label. */
    ratio: number;
    monthLabel: string;
    daysElapsed: number;
    daysInMonth: number;
  };
  revenue: RevenueBucket[];
  clientShare: { top: ClientShare[]; otherAmount: number; otherCount: number; total: number };
  hours: { billable: number; nonBillable: number; unbilledValue: number; unbilledHours: number };
  tickets: {
    open: number;
    inProgress: number;
    newCount: number;
    resolvedInRange: number;
    /** Most recent unresolved tickets, for the dashboard's attention list. */
    recent: { id: string; ticketNumber: string; company: string; urgency: string; ageDays: number }[];
  };
  counts: { activeClients: number; draftInvoices: number };
  /** Sent-but-unpaid invoices, worst-overdue first. */
  awaitingPayment: {
    id: string;
    invoiceNumber: string;
    clientName: string;
    amount: number;
    daysSinceSent: number;
    /** Sent over 30 days ago -- the threshold for chasing. */
    overdue: boolean;
  }[];
  collections: { sentValue: number; paidValue: number; overdueValue: number };
};

/** Prisma Decimal | number | null -> number. */
function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  return typeof v === "number" ? v : Number(v.toString());
}

export async function loadDashboardMetrics(
  tx: TxClient,
  args: { userId: string; range: ResolvedRange; monthlyGoal: number },
): Promise<DashboardMetrics> {
  const { userId, range, monthlyGoal } = args;
  const dayStart = pacificDayStart();
  const monthStart = pacificMonthStart();
  const monthEnd = nextMonthStart(monthStart);

  const [
    todayEntries,
    monthInvoices,
    rangeInvoices,
    unbilled,
    rangeHours,
    ticketRows,
    resolvedInRange,
    activeClients,
    draftInvoices,
    clients,
    sentUnpaid,
    paidInRange,
    recentTickets,
  ] = await Promise.all([
    tx.timeEntry.aggregate({
      where: { loggedByUserId: userId, createdAt: { gte: dayStart } },
      _count: true,
      _sum: { durationHours: true },
    }),
    // The goal is about invoicing OUTPUT this month, so a draft still counts --
    // the work is captured. Voided invoices never count: they were withdrawn.
    tx.invoice.aggregate({
      where: { voidedAt: null, createdAt: { gte: monthStart, lt: monthEnd } },
      _sum: { totalAmount: true },
    }),
    tx.invoice.findMany({
      where: { voidedAt: null, createdAt: { gte: range.start, lt: range.end } },
      select: { totalAmount: true, status: true, createdAt: true, clientId: true },
    }),
    tx.timeEntry.findMany({
      where: { invoiceId: null, billableStatus: "Billable" },
      select: { durationHours: true, client: { select: { billingRate: true } } },
    }),
    tx.timeEntry.groupBy({
      by: ["billableStatus"],
      where: { date: { gte: range.start, lt: range.end } },
      _sum: { durationHours: true },
    }),
    tx.ticket.groupBy({ by: ["status"], _count: true }),
    tx.ticket.count({ where: { resolvedAt: { gte: range.start, lt: range.end } } }),
    tx.client.count({ where: { activeStatus: true } }),
    tx.invoice.count({ where: { status: "Draft", voidedAt: null } }),
    tx.client.findMany({ select: { id: true, name: true } }),
    // Sent but not paid: the invoices that are actually owed money.
    tx.invoice.findMany({
      // Issued-but-unpaid, whichever way it left: an invoice handed over or
      // posted is owed exactly as much as one that was emailed.
      where: { status: { in: ["Sent", "Invoiced"] }, voidedAt: null },
      select: {
        id: true, invoiceNumber: true, totalAmount: true, sentAt: true, issuedAt: true,
        client: { select: { name: true } },
      },
      orderBy: { sentAt: "asc" },
    }),
    tx.invoice.aggregate({
      where: { status: "Paid", voidedAt: null, paidAt: { gte: range.start, lt: range.end } },
      _sum: { totalAmount: true },
    }),
    tx.ticket.findMany({
      where: { status: { in: ["New", "InProgress"] } },
      select: { id: true, ticketNumber: true, clientCompanyName: true, urgency: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }],
      take: 5,
    }),
  ]);

  // --- revenue, bucketed by Pacific month -----------------------------------
  const bucketIndex = new Map<number, number>();
  const revenue: RevenueBucket[] = range.buckets.map((b, i) => {
    bucketIndex.set(b.getTime(), i);
    return {
      monthStart: b.toISOString(),
      label: range.buckets.length > 12 ? formatMonthYear(b) : formatMonth(b),
      paid: 0,
      sent: 0,
      draft: 0,
      total: 0,
    };
  });

  const bucketStarts = range.buckets.map((b) => b.getTime()).sort((a, b) => a - b);
  const bucketFor = (at: Date): number => {
    const t = at.getTime();
    let lo = 0;
    let hi = bucketStarts.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (bucketStarts[mid] <= t) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found === -1 ? -1 : (bucketIndex.get(bucketStarts[found]) ?? -1);
  };

  const clientNames = new Map(clients.map((c) => [c.id, c.name]));
  const perClient = new Map<string, number>();

  for (const inv of rangeInvoices) {
    const amount = num(inv.totalAmount);
    const i = bucketFor(inv.createdAt);
    if (i >= 0) {
      // Invoiced counts with Sent, not with Draft. Both are real invoices
      // that are out and unpaid; a draft is not yet an invoice at all. The
      // `else` used to sweep Invoiced in with drafts, which understated the
      // month's issued revenue and labelled a finalised invoice "Draft".
      if (inv.status === "Paid") revenue[i].paid += amount;
      else if (inv.status === "Sent" || inv.status === "Invoiced") revenue[i].sent += amount;
      else revenue[i].draft += amount;
      revenue[i].total += amount;
    }
    perClient.set(inv.clientId, (perClient.get(inv.clientId) ?? 0) + amount);
  }

  // --- client share: top 5 + Other -------------------------------------------
  const ranked = [...perClient.entries()]
    .map(([id, amount]) => ({ name: clientNames.get(id) ?? "Unknown", amount }))
    .sort((a, b) => b.amount - a.amount);
  const top = ranked.slice(0, 5);
  const rest = ranked.slice(5);
  const clientShare = {
    top,
    otherAmount: rest.reduce((s, r) => s + r.amount, 0),
    otherCount: rest.length,
    total: ranked.reduce((s, r) => s + r.amount, 0),
  };

  // --- unbilled pipeline -----------------------------------------------------
  let unbilledHours = 0;
  let unbilledValue = 0;
  for (const e of unbilled) {
    const h = num(e.durationHours);
    unbilledHours += h;
    unbilledValue += h * num(e.client.billingRate);
  }

  const billable = num(rangeHours.find((r) => r.billableStatus === "Billable")?._sum.durationHours);
  const nonBillable = rangeHours
    .filter((r) => r.billableStatus !== "Billable")
    .reduce((s, r) => s + num(r._sum.durationHours), 0);

  const statusCount = (s: string) =>
    ticketRows.filter((r) => r.status === s).reduce((n, r) => n + (r._count as number), 0);

  const invoicedThisMonth = num(monthInvoices._sum.totalAmount);
  const daysInMonth = Math.round((monthEnd.getTime() - monthStart.getTime()) / 86_400_000);
  const daysElapsed = Math.min(
    daysInMonth,
    Math.floor((dayStart.getTime() - monthStart.getTime()) / 86_400_000) + 1,
  );

  // --- collections ----------------------------------------------------------
  const OVERDUE_AFTER_DAYS = 30;
  const awaitingPayment = sentUnpaid.map((inv) => {
    // Falls back to issuedAt: an invoice that was never marked sent still has
    // an age, and treating it as 0 days old would hide a genuinely overdue
    // one from the chase list.
    const since = inv.sentAt ?? inv.issuedAt;
    const daysSinceSent = since
      ? Math.floor((Date.now() - since.getTime()) / 86_400_000)
      : 0;
    return {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      clientName: inv.client.name,
      amount: num(inv.totalAmount),
      daysSinceSent,
      overdue: daysSinceSent >= OVERDUE_AFTER_DAYS,
    };
  });

  return {
    today: {
      loggedEntries: todayEntries._count,
      loggedHours: num(todayEntries._sum.durationHours),
      hasLogged: todayEntries._count > 0,
    },
    goal: {
      target: monthlyGoal,
      invoiced: invoicedThisMonth,
      pipeline: unbilledValue,
      ratio: monthlyGoal > 0 ? invoicedThisMonth / monthlyGoal : 0,
      monthLabel: formatMonthYear(monthStart),
      daysElapsed,
      daysInMonth,
    },
    revenue,
    clientShare,
    hours: { billable, nonBillable, unbilledValue, unbilledHours },
    tickets: {
      open: statusCount("New") + statusCount("InProgress"),
      inProgress: statusCount("InProgress"),
      newCount: statusCount("New"),
      resolvedInRange,
      recent: recentTickets.map((t) => ({
        id: t.id,
        ticketNumber: t.ticketNumber,
        company: t.clientCompanyName,
        urgency: t.urgency,
        ageDays: Math.floor((Date.now() - t.createdAt.getTime()) / 86_400_000),
      })),
    },
    counts: { activeClients, draftInvoices },
    awaitingPayment,
    collections: {
      sentValue: awaitingPayment.reduce((s, i) => s + i.amount, 0),
      paidValue: num(paidInRange._sum.totalAmount),
      overdueValue: awaitingPayment.filter((i) => i.overdue).reduce((s, i) => s + i.amount, 0),
    },
  };
}
