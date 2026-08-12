"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  loadBillingCandidates,
  generateInvoice,
  type BillingCandidates,
} from "@/app/(app)/invoices/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatDate, formatHours } from "@/lib/format";

type ClientOption = { id: string; name: string };

/**
 * Two-step flow, mirroring the input -> review shape of
 * ai-time-entry-dialog.tsx but as a full page (the review table is far too
 * much content for a dialog).
 *
 * The review step is include/exclude only -- amounts aren't editable here on
 * purpose. Line-item numbers come from the TimeEntry/RecurringCharge records,
 * which stay the single source of truth; correcting an entry happens on the
 * Time Entries screen. The server re-derives every amount at generation time
 * regardless of what this screen submits.
 */
export function InvoiceGenerationFlow({ clients }: { clients: ClientOption[] }) {
  const router = useRouter();

  const [step, setStep] = useState<"select" | "review">("select");
  const [clientId, setClientId] = useState("");
  const [billingMonth, setBillingMonth] = useState(defaultBillingMonth());
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [candidates, setCandidates] = useState<BillingCandidates | null>(null);
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set());
  const [selectedCharges, setSelectedCharges] = useState<Set<string>>(new Set());

  async function handleLoad() {
    if (!clientId) {
      toast.error("Select a client first.");
      return;
    }
    setLoading(true);
    const result = await loadBillingCandidates({ clientId, billingMonth });
    setLoading(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    const data = result.data;
    if (data.timeEntries.length === 0 && data.recurringCharges.length === 0) {
      toast.error("Nothing unbilled for that client and month.");
      return;
    }

    setCandidates(data);
    // Everything starts checked; unchecking is how you hold something back.
    // Entries with no resolvable rate start unchecked -- generation refuses
    // them, so pre-selecting would just guarantee an error.
    setSelectedEntries(
      new Set(
        data.timeEntries.filter((e) => e.rate !== null).map((e) => e.id),
      ),
    );
    setSelectedCharges(new Set(data.recurringCharges.map((c) => c.id)));
    setStep("review");
  }

  async function handleGenerate() {
    setSubmitting(true);
    const result = await generateInvoice({
      clientId,
      billingMonth,
      timeEntryIds: [...selectedEntries],
      recurringChargeIds: [...selectedCharges],
    });
    setSubmitting(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    if (result.data.pdfFailed) {
      toast.warning(
        `Invoice ${result.data.invoiceNumber} created, but the PDF failed to render. ` +
          "Use Retry PDF on the invoice.",
      );
    } else {
      toast.success(`Invoice ${result.data.invoiceNumber} created as Draft`);
    }
    router.push(`/invoices/${result.data.invoiceId}`);
  }

  function toggle(set: Set<string>, id: string, setter: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  // Running total reflects only what's checked, recomputed from the values the
  // server already sent. The server recomputes independently on submit.
  const selectedEntryRows =
    candidates?.timeEntries.filter((e) => selectedEntries.has(e.id)) ?? [];
  const selectedChargeRows =
    candidates?.recurringCharges.filter((c) => selectedCharges.has(c.id)) ?? [];
  const runningHours = selectedEntryRows.reduce((s, e) => s + e.hours, 0);
  const runningTotal =
    selectedEntryRows.reduce((s, e) => s + (e.amount ?? 0), 0) +
    selectedChargeRows.reduce((s, c) => s + c.amount, 0);

  if (step === "select") {
    return (
      <Card className="max-w-xl p-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="client">Client</Label>
            <Select value={clientId} onValueChange={(v) => setClientId(v ?? "")}>
              <SelectTrigger id="client">
                {/* base-ui renders the raw value (a uuid here) without this mapper */}
                <SelectValue placeholder="Select client">
                  {(value) =>
                    clients.find((c) => c.id === value)?.name ?? "Select client"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="billingMonth">Billing month</Label>
            <Input
              id="billingMonth"
              type="month"
              value={billingMonth}
              onChange={(e) => setBillingMonth(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Annual recurring charges are only included for a January period.
            </p>
          </div>

          <Button onClick={handleLoad} disabled={loading} className="w-full">
            {loading ? "Loading…" : "Load billable items"}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium">{candidates?.clientName}</p>
            <p className="text-sm text-muted-foreground">
              {candidates && `${formatDate(candidates.periodStart)} – ${formatDate(candidates.periodEnd)}`}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">
              {formatHours(runningHours)} hrs · {selectedEntryRows.length} entries ·{" "}
              {selectedChargeRows.length} charges
            </p>
            <p className="text-xl font-semibold">{formatCurrency(runningTotal)}</p>
          </div>
        </div>
      </Card>

      {candidates && candidates.unratedEntryIds.length > 0 && (
        <Card className="border-destructive/50 p-4">
          <p className="text-sm text-destructive">
            {candidates.unratedEntryIds.length} entr
            {candidates.unratedEntryIds.length === 1 ? "y has" : "ies have"} no resolvable rate
            (no service-type override and no client billing rate). They can&apos;t be invoiced
            until a rate is set.
          </p>
        </Card>
      )}

      {candidates && candidates.timeEntries.length > 0 && (
        <Card>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="font-medium">Time entries</h2>
            <button
              type="button"
              className="text-sm text-muted-foreground underline"
              onClick={() =>
                setSelectedEntries(
                  selectedEntries.size === candidates.timeEntries.filter((e) => e.rate !== null).length
                    ? new Set()
                    : new Set(candidates.timeEntries.filter((e) => e.rate !== null).map((e) => e.id)),
                )
              }
            >
              Toggle all
            </button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {candidates.timeEntries.map((entry) => (
                <TableRow key={entry.id} data-unrated={entry.rate === null || undefined}>
                  <TableCell>
                    <Checkbox
                      checked={selectedEntries.has(entry.id)}
                      disabled={entry.rate === null}
                      onCheckedChange={() =>
                        toggle(selectedEntries, entry.id, setSelectedEntries)
                      }
                      aria-label={`Include entry from ${formatDate(entry.date)}`}
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(entry.date)}</TableCell>
                  <TableCell className="max-w-md truncate">{entry.description}</TableCell>
                  <TableCell>{entry.serviceTypeCode}</TableCell>
                  <TableCell className="text-right">{formatHours(entry.hours)}</TableCell>
                  <TableCell className="text-right">
                    {entry.rate === null ? "—" : formatCurrency(entry.rate)}
                  </TableCell>
                  <TableCell className="text-right">
                    {entry.amount === null ? "—" : formatCurrency(entry.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {candidates && candidates.recurringCharges.length > 0 && (
        <Card>
          <div className="border-b px-4 py-3">
            <h2 className="font-medium">Recurring charges</h2>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Description</TableHead>
                <TableHead>Frequency</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {candidates.recurringCharges.map((charge) => (
                <TableRow key={charge.id}>
                  <TableCell>
                    <Checkbox
                      checked={selectedCharges.has(charge.id)}
                      onCheckedChange={() =>
                        toggle(selectedCharges, charge.id, setSelectedCharges)
                      }
                      aria-label={`Include ${charge.description}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{charge.description}</TableCell>
                  <TableCell>
                    {charge.billingFrequency === "Annual" ? "Annual (January)" : "Monthly"}
                  </TableCell>
                  <TableCell className="text-right">{formatCurrency(charge.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={() => setStep("select")} disabled={submitting}>
          Back
        </Button>
        <Button
          onClick={handleGenerate}
          disabled={submitting || (selectedEntries.size === 0 && selectedCharges.size === 0)}
        >
          {submitting ? "Generating…" : "Generate draft invoice"}
        </Button>
      </div>
    </div>
  );
}

function defaultBillingMonth(): string {
  // Default to last month -- you almost always invoice a period that's closed.
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
