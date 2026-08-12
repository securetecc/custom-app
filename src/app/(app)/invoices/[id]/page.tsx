import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgContext } from "@/lib/auth";
import { withRLS } from "@/lib/db/rls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  MarkPaidButton,
  MarkSentButton,
  RetryPdfButton,
  VoidInvoiceDialog,
} from "@/components/app/invoice-actions";
import { formatAddressLine, formatCurrency, formatDate, formatHours } from "@/lib/format";
import { Download } from "lucide-react";

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { authUserId, appUser } = await requireOrgContext();

  const invoice = await withRLS(authUserId, (tx) =>
    tx.invoice.findUnique({
      where: { id },
      include: {
        client: true,
        organization: { select: { emailDomainVerified: true } },
        timeEntries: { include: { serviceType: true }, orderBy: { date: "asc" } },
        recurringCharges: true,
      },
    }),
  );

  if (!invoice) notFound();

  const isAdmin = appUser.role === "admin";
  const voided = Boolean(invoice.voidedAt);
  const clientRate = invoice.client.billingRate ? Number(invoice.client.billingRate) : null;
  const addressLine = formatAddressLine(invoice.client.address1, invoice.client.address2);

  const monthly = invoice.recurringCharges.filter((c) => c.billingFrequency === "Monthly");
  const annual = invoice.recurringCharges.filter((c) => c.billingFrequency === "Annual");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{invoice.invoiceNumber}</h1>
            {voided ? (
              <Badge variant="secondary">Voided</Badge>
            ) : (
              <Badge variant={invoice.status === "Paid" ? "default" : "secondary"}>
                {invoice.status}
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground">
            {invoice.client.name} · {formatDate(invoice.periodStart)} –{" "}
            {formatDate(invoice.periodEnd)}
          </p>
          {invoice.sentAt && (
            <p className="text-sm text-muted-foreground">Sent {formatDate(invoice.sentAt)}</p>
          )}
          {invoice.paidAt && (
            <p className="text-sm text-muted-foreground">Paid {formatDate(invoice.paidAt)}</p>
          )}
          {invoice.voidedAt && (
            <p className="text-sm text-muted-foreground">Voided {formatDate(invoice.voidedAt)}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {invoice.pdfUrl ? (
            <Button variant="outline" render={<a href={`/invoices/${invoice.id}/pdf`} />}>
              <Download className="mr-1 h-4 w-4" /> Download PDF
            </Button>
          ) : (
            <RetryPdfButton invoiceId={invoice.id} />
          )}

          {!voided && isAdmin && invoice.status === "Draft" && (
            <MarkSentButton
              invoiceId={invoice.id}
              emailDomainVerified={invoice.organization.emailDomainVerified}
            />
          )}
          {!voided && isAdmin && invoice.status === "Sent" && (
            <MarkPaidButton invoiceId={invoice.id} />
          )}
          {!voided && isAdmin && (
            <VoidInvoiceDialog
              invoiceId={invoice.id}
              invoiceNumber={invoice.invoiceNumber}
              clientName={invoice.client.name}
              totalAmount={Number(invoice.totalAmount)}
              timeEntryCount={invoice.timeEntries.length}
              recurringChargeCount={invoice.recurringCharges.length}
            />
          )}
        </div>
      </div>

      {!invoice.pdfUrl && !voided && (
        <Card className="border-destructive/50 p-4">
          <p className="text-sm text-destructive">
            This invoice has no PDF — rendering failed after it was created. The line items below
            are correct; use Retry PDF to render it.
          </p>
        </Card>
      )}

      <Card className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Bill to
        </p>
        <p className="mt-1 font-medium">{invoice.client.name}</p>
        <p className="text-sm">ATTN: Accounting Department</p>
        {addressLine && <p className="text-sm">{addressLine}</p>}
        {invoice.client.cityStateZip && (
          <p className="text-sm">{invoice.client.cityStateZip}</p>
        )}
        {invoice.client.phone && <p className="text-sm">{invoice.client.phone}</p>}
      </Card>

      {invoice.timeEntries.length > 0 && (
        <Card>
          <div className="border-b px-4 py-3">
            <h2 className="font-medium">Time entries ({invoice.timeEntries.length})</h2>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.timeEntries.map((entry) => {
                const rate =
                  (entry.serviceType.rateOverride
                    ? Number(entry.serviceType.rateOverride)
                    : null) ?? clientRate;
                const hours = Number(entry.durationHours);
                return (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(entry.date)}</TableCell>
                    <TableCell className="max-w-md truncate">{entry.description}</TableCell>
                    <TableCell>{entry.serviceType.code}</TableCell>
                    <TableCell className="text-right">{formatHours(hours)}</TableCell>
                    <TableCell className="text-right">
                      {rate === null ? "—" : formatCurrency(rate)}
                    </TableCell>
                    <TableCell className="text-right">
                      {rate === null ? "—" : formatCurrency(Number((hours * rate).toFixed(2)))}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {invoice.recurringCharges.length > 0 && (
        <Card>
          <div className="border-b px-4 py-3">
            <h2 className="font-medium">Recurring charges</h2>
            <p className="text-xs text-muted-foreground">
              Snapshotted at billing time — later edits to the charge don&apos;t change this
              invoice.
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Frequency</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...monthly, ...annual].map((charge) => (
                <TableRow key={charge.id}>
                  <TableCell className="font-medium">{charge.description}</TableCell>
                  <TableCell>
                    {charge.billingFrequency === "Annual" ? "Annual (January)" : "Monthly"}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(Number(charge.amount))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Card className="p-4">
        <div className="flex items-baseline justify-end gap-6">
          <span className="text-sm text-muted-foreground">
            {formatHours(Number(invoice.totalHours))} billable hours
          </span>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Total due</p>
            <p className="text-2xl font-semibold">
              {formatCurrency(Number(invoice.totalAmount))}
            </p>
          </div>
        </div>
      </Card>

      <div>
        <Button variant="ghost" render={<Link href="/invoices" />}>
          ← Back to invoices
        </Button>
      </div>
    </div>
  );
}
