"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createInvoiceGmailDraft,
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

/**
 * Two-step, deliberately: invoices leave as a Gmail draft that a human
 * reviews and sends, then the status is confirmed here. "Mark as sent" is
 * the only thing that flips the invoice to Sent -- creating a draft doesn't,
 * because an unsent draft isn't a sent invoice.
 */
export function SendInvoiceActions({
  invoiceId,
  googleConfigured,
}: {
  invoiceId: string;
  googleConfigured: boolean;
}) {
  const [drafting, setDrafting] = useState(false);
  const [marking, setMarking] = useState(false);

  async function handleDraft() {
    setDrafting(true);
    const result = await createInvoiceGmailDraft(invoiceId);
    setDrafting(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(
      result.data.reused
        ? "Gmail draft updated — the existing draft was refreshed, not duplicated."
        : "Gmail draft created — review and send it, then Mark as sent.",
      {
        action: {
          label: "Open draft",
          onClick: () => window.open(result.data.draftUrl, "_blank", "noopener,noreferrer"),
        },
        duration: 15_000,
      },
    );
  }

  async function handleMarkSent() {
    if (!confirm("Confirm this invoice has actually been sent from Gmail?")) return;
    setMarking(true);
    const result = await markInvoiceSent(invoiceId);
    setMarking(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Invoice marked as Sent");
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={handleDraft} disabled={drafting || !googleConfigured}>
          {drafting ? "Creating draft…" : "Create Gmail draft"}
        </Button>
        <Button onClick={handleMarkSent} disabled={marking}>
          {marking ? "Saving…" : "Mark as sent"}
        </Button>
      </div>
      {!googleConfigured && (
        <p className="text-xs text-muted-foreground">
          Google Workspace not connected — see docs/google-setup.md
        </p>
      )}
    </div>
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
  reimbursableExpenseCount,
}: {
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;
  totalAmount: number;
  timeEntryCount: number;
  recurringChargeCount: number;
  reimbursableExpenseCount: number;
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

          <dt className="text-muted-foreground">Expenses released</dt>
          <dd className="text-right font-medium">{reimbursableExpenseCount}</dd>
        </dl>

        <p className="text-sm text-muted-foreground">
          Those {timeEntryCount} time {timeEntryCount === 1 ? "entry" : "entries"}
          {reimbursableExpenseCount > 0
            ? ` and ${reimbursableExpenseCount} expense${reimbursableExpenseCount === 1 ? "" : "s"} become`
            : " become"}{" "}
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
