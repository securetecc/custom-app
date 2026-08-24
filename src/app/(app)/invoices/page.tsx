import Link from "next/link";
import { requireOrgContext } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { InvoiceRowActions } from "@/components/app/invoice-actions";
import { formatCurrency, formatDate, formatHours } from "@/lib/format";
import { Plus } from "lucide-react";

const FILTERS = ["All", "Draft", "Sent", "Paid", "Voided"] as const;
type Filter = (typeof FILTERS)[number];

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  // Defaults to All: landing on Draft meant the tab looked empty whenever
  // everything had been sent, which reads as "no invoices" rather than
  // "no drafts".
  const active: Filter = FILTERS.includes(status as Filter) ? (status as Filter) : "All";

  const { data: invoices } = await requireOrgContext((tx) =>
    tx.invoice.findMany({
      where:
        active === "All"
          ? {} // includes voided -- "All" that hides some invoices isn't all
          : active === "Voided"
            ? { voidedAt: { not: null } }
            : { status: active, voidedAt: null },
      include: { client: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
          <p className="text-muted-foreground">
            {invoices.length} {active === "All" ? "total" : active.toLowerCase()}
          </p>
        </div>
        <Button render={<Link href="/invoices/new" />}>
          <Plus className="mr-1 h-4 w-4" /> Generate invoice
        </Button>
      </div>

      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f}
            variant={f === active ? "default" : "outline"}
            size="sm"
            render={<Link href={`/invoices?status=${f}`} />}
          >
            {f}
          </Button>
        ))}
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Period</TableHead>
              <TableHead className="text-right">Hours</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[9rem]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((invoice) => (
              <TableRow key={invoice.id}>
                <TableCell className="font-medium">
                  <Link href={`/invoices/${invoice.id}`} className="hover:underline">
                    {invoice.invoiceNumber}
                  </Link>
                </TableCell>
                <TableCell>{invoice.client.name}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatDate(invoice.periodStart)} – {formatDate(invoice.periodEnd)}
                </TableCell>
                <TableCell className="text-right">
                  {formatHours(Number(invoice.totalHours))}
                </TableCell>
                <TableCell className="text-right">
                  {formatCurrency(Number(invoice.totalAmount))}
                </TableCell>
                <TableCell>
                  {invoice.voidedAt ? (
                    <Badge variant="secondary">Voided</Badge>
                  ) : (
                    <Badge variant={invoice.status === "Paid" ? "default" : "secondary"}>
                      {invoice.status}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <InvoiceRowActions
                    invoiceId={invoice.id}
                    status={invoice.status}
                    voided={!!invoice.voidedAt}
                  />
                </TableCell>
              </TableRow>
            ))}
            {invoices.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  {active === "All" ? "No invoices yet." : `No ${active.toLowerCase()} invoices.`}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
