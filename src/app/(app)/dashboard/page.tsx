import Link from "next/link";
import { requireOrgContext } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardPage() {
  const {
    appUser,
    data: [openTickets, unbilledHours, activeClients, draftInvoices],
  } = await requireOrgContext(async (tx) => {
    const [openTicketCount, unbilled, activeClientCount, draftInvoiceCount] = await Promise.all([
      tx.ticket.count({ where: { status: { in: ["New", "InProgress"] } } }),
      tx.timeEntry.aggregate({
        where: { invoiceId: null, billableStatus: "Billable" },
        _sum: { durationHours: true },
      }),
      tx.client.count({ where: { activeStatus: true } }),
      tx.invoice.count({ where: { status: "Draft", voidedAt: null } }),
    ]);
    return [
      openTicketCount,
      Number(unbilled._sum.durationHours ?? 0),
      activeClientCount,
      draftInvoiceCount,
    ];
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back, {appUser.name.split(" ")[0]}</h1>
        <p className="text-muted-foreground">Here&apos;s what&apos;s happening at {appUser.organization.name}.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/tickets">
          <Card className="transition-colors hover:border-accent">
            <CardHeader className="pb-2">
              <CardDescription>Open tickets</CardDescription>
              <CardTitle className="text-3xl">{openTickets}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">View tickets</CardContent>
          </Card>
        </Link>
        <Link href="/time-entries">
          <Card className="transition-colors hover:border-accent">
            <CardHeader className="pb-2">
              <CardDescription>Unbilled hours</CardDescription>
              <CardTitle className="text-3xl">{unbilledHours}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">View time entries</CardContent>
          </Card>
        </Link>
        <Link href="/clients">
          <Card className="transition-colors hover:border-accent">
            <CardHeader className="pb-2">
              <CardDescription>Active clients</CardDescription>
              <CardTitle className="text-3xl">{activeClients}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">See clients</CardContent>
          </Card>
        </Link>
        <Link href="/invoices">
          <Card className="transition-colors hover:border-accent">
            <CardHeader className="pb-2">
              <CardDescription>Draft invoices</CardDescription>
              <CardTitle className="text-3xl">{draftInvoices}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">View invoices</CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
