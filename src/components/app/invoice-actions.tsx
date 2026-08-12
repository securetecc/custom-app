"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  markInvoicePaid,
  markInvoiceSent,
  regenerateInvoicePdf,
  voidInvoice,
} from "@/app/(app)/invoices/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/format";

export function MarkSentButton({
  invoiceId,
  emailDomainVerified,
}: {
  invoiceId: string;
  emailDomainVerified: boolean;
}) {
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    const result = await markInvoiceSent(invoiceId);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Invoice marked as Sent");
  }

  if (!emailDomainVerified) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button disabled>Send</Button>
        <p className="text-xs text-muted-foreground">
          Email domain not verified — see organization settings
        </p>
      </div>
    );
  }

  return (
    <Button onClick={handleClick} disabled={pending}>
      {pending ? "Sending…" : "Send"}
    </Button>
  );
}

export function MarkPaidButton({ invoiceId }: { invoiceId: string }) {
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    const result = await markInvoicePaid(invoiceId);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Invoice marked as Paid");
  }

  return (
    <Button onClick={handleClick} disabled={pending}>
      {pending ? "Saving…" : "Mark paid"}
    </Button>
  );
}

export function RetryPdfButton({ invoiceId }: { invoiceId: string }) {
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    const result = await regenerateInvoicePdf(invoiceId);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("PDF regenerated");
  }

  return (
    <Button variant="outline" onClick={handleClick} disabled={pending}>
      {pending ? "Rendering…" : "Retry PDF"}
    </Button>
  );
}

/**
 * Void confirmation.
 *
 * The brief requires this to *show* client, amount, and linked-entry count --
 * not just ask yes/no -- so those are passed in as props (the detail page has
 * already loaded them) rather than re-fetched on open.
 */
export function VoidInvoiceDialog({
  invoiceId,
  invoiceNumber,
  clientName,
  totalAmount,
  timeEntryCount,
  recurringChargeCount,
}: {
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;
  totalAmount: number;
  timeEntryCount: number;
  recurringChargeCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleVoid() {
    setPending(true);
    const result = await voidInvoice(invoiceId);
    setPending(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    setOpen(false);
    if (!result.data.pdfArchived) {
      toast.warning(
        "Invoice voided, but its PDF couldn't be moved to the archive. Archive it manually.",
      );
    } else {
      toast.success(`Invoice ${invoiceNumber} voided`);
    }
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" className="text-destructive">
            Void
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void invoice {invoiceNumber}?</DialogTitle>
          <DialogDescription>
            This cannot be undone. The invoice number stays reserved and the PDF is archived
            rather than deleted.
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-2 gap-3 py-4 text-sm">
          <dt className="text-muted-foreground">Client</dt>
          <dd className="text-right font-medium">{clientName}</dd>

          <dt className="text-muted-foreground">Amount</dt>
          <dd className="text-right font-medium">{formatCurrency(totalAmount)}</dd>

          <dt className="text-muted-foreground">Time entries released</dt>
          <dd className="text-right font-medium">{timeEntryCount}</dd>

          <dt className="text-muted-foreground">Recurring charges released</dt>
          <dd className="text-right font-medium">{recurringChargeCount}</dd>
        </dl>

        <p className="text-sm text-muted-foreground">
          Those {timeEntryCount} time {timeEntryCount === 1 ? "entry" : "entries"} become
          unbilled and can be invoiced again.
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleVoid} disabled={pending}>
            {pending ? "Voiding…" : "Void invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
