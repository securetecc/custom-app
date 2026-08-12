"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireOrgContext } from "@/lib/auth";
import { withRLS } from "@/lib/db/rls";
import {
  generateInvoiceSchema,
  invoicePeriodSchema,
  monthBounds,
  periodTouchesJanuary,
  type GenerateInvoiceValues,
  type InvoicePeriodValues,
} from "@/lib/validations/invoice";
import { generateInvoicePdf, buildServiceSummary } from "@/lib/pdf/generate-invoice-pdf";
import {
  archiveInvoicePdf,
  invoicePdfPath,
  uploadInvoicePdf,
} from "@/lib/storage/invoices";
import type { InvoicePdfData } from "@/lib/pdf/types";

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

export type BillingCandidate = {
  id: string;
  date: string;
  description: string;
  hours: number;
  rate: number | null;
  amount: number | null;
  serviceTypeCode: string;
  serviceTypeLabel: string;
};

export type RecurringCandidate = {
  id: string;
  description: string;
  amount: number;
  billingFrequency: "Monthly" | "Annual";
};

export type BillingCandidates = {
  clientName: string;
  periodStart: string;
  periodEnd: string;
  timeEntries: BillingCandidate[];
  recurringCharges: RecurringCandidate[];
  /** Entries whose rate can't be resolved -- generation will refuse these. */
  unratedEntryIds: string[];
};

/**
 * Read-only: what *would* go on an invoice for this client + month.
 *
 * Any staff member can run this; it writes nothing.
 */
export async function loadBillingCandidates(
  input: InvoicePeriodValues,
): Promise<ActionResult<BillingCandidates>> {
  const parsed = invoicePeriodSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { clientId, billingMonth } = parsed.data;
  const { periodStart, periodEnd } = monthBounds(billingMonth);

  const { authUserId } = await requireOrgContext();

  try {
    const result = await withRLS(authUserId, async (tx) => {
      const client = await tx.client.findUniqueOrThrow({ where: { id: clientId } });

      const [timeEntries, recurringCharges, alreadyBilled] = await Promise.all([
        tx.timeEntry.findMany({
          where: {
            clientId,
            invoiceId: null, // unbilled only
            billableStatus: "Billable",
            date: { gte: periodStart, lte: periodEnd },
          },
          include: { serviceType: true },
          orderBy: { date: "asc" },
        }),
        tx.recurringCharge.findMany({
          where: { clientId, activeStatus: true },
          orderBy: [{ billingFrequency: "asc" }, { description: "asc" }],
        }),
        // Snapshot rows are how we know a charge was already billed for this
        // exact period -- the template itself is never stamped.
        tx.invoiceRecurringCharge.findMany({
          where: {
            recurringCharge: { clientId },
            invoice: { periodStart, periodEnd, voidedAt: null },
          },
          select: { recurringChargeId: true },
        }),
      ]);

      const billedIds = new Set(alreadyBilled.map((r) => r.recurringChargeId));
      const januaryPeriod = periodTouchesJanuary(periodStart, periodEnd);

      const clientRate = client.billingRate ? Number(client.billingRate) : null;

      const candidates: BillingCandidate[] = timeEntries.map((entry) => {
        const override = entry.serviceType.rateOverride
          ? Number(entry.serviceType.rateOverride)
          : null;
        const rate = override ?? clientRate;
        const hours = Number(entry.durationHours);
        return {
          id: entry.id,
          date: entry.date.toISOString().slice(0, 10),
          description: entry.description,
          hours,
          rate,
          amount: rate === null ? null : Number((hours * rate).toFixed(2)),
          serviceTypeCode: entry.serviceType.code,
          serviceTypeLabel: entry.serviceType.label,
        };
      });

      const applicable: RecurringCandidate[] = recurringCharges
        .filter(
          (rc) =>
            !billedIds.has(rc.id) && (rc.billingFrequency === "Monthly" || januaryPeriod),
        )
        .map((rc) => ({
          id: rc.id,
          description: rc.description,
          amount: Number(rc.amount),
          billingFrequency: rc.billingFrequency,
        }));

      return {
        clientName: client.name,
        periodStart: periodStart.toISOString().slice(0, 10),
        periodEnd: periodEnd.toISOString().slice(0, 10),
        timeEntries: candidates,
        recurringCharges: applicable,
        unratedEntryIds: candidates.filter((c) => c.rate === null).map((c) => c.id),
      } satisfies BillingCandidates;
    });

    return { ok: true, data: result };
  } catch (err: unknown) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * Creates the Draft invoice.
 *
 * Everything money-related is re-derived from the database here; the submitted
 * ids are treated purely as a selection filter, never as a source of amounts
 * (same principle as the billing-minimum handling in time-entries/actions.ts).
 */
export async function generateInvoice(
  input: GenerateInvoiceValues,
): Promise<ActionResult<{ invoiceId: string; invoiceNumber: string; pdfFailed: boolean }>> {
  const parsed = generateInvoiceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { clientId, billingMonth, timeEntryIds, recurringChargeIds } = parsed.data;

  if (timeEntryIds.length === 0 && recurringChargeIds.length === 0) {
    return { ok: false, error: "Select at least one item to invoice." };
  }

  const { periodStart, periodEnd } = monthBounds(billingMonth);
  const { authUserId, appUser } = await requireOrgContext();

  let pdfInput: { invoiceId: string; data: InvoicePdfData } | null = null;
  let invoiceNumber = "";
  let invoiceId = "";

  try {
    const created = await withRLS(authUserId, async (tx) => {
      const [organization, client] = await Promise.all([
        tx.organization.findUniqueOrThrow({ where: { id: appUser.organizationId } }),
        tx.client.findUniqueOrThrow({ where: { id: clientId } }),
      ]);

      // Re-verify the submitted selection against the DB with the same
      // conditions loadBillingCandidates used. A mismatch means something
      // changed underneath (e.g. a concurrent invoice claimed an entry) --
      // fail loudly rather than silently under- or over-billing.
      const entries = await tx.timeEntry.findMany({
        where: {
          id: { in: timeEntryIds },
          clientId,
          invoiceId: null,
          billableStatus: "Billable",
          date: { gte: periodStart, lte: periodEnd },
        },
        include: { serviceType: true },
        orderBy: { date: "asc" },
      });

      if (entries.length !== timeEntryIds.length) {
        throw new ConflictError(
          "Some selected time entries are no longer available to invoice — they may have been " +
            "edited or invoiced elsewhere. Reload the review screen and try again.",
        );
      }

      const januaryPeriod = periodTouchesJanuary(periodStart, periodEnd);
      const charges = await tx.recurringCharge.findMany({
        where: { id: { in: recurringChargeIds }, clientId, activeStatus: true },
      });

      if (charges.length !== recurringChargeIds.length) {
        throw new ConflictError(
          "Some selected recurring charges are no longer active. Reload and try again.",
        );
      }

      const outOfSeason = charges.filter(
        (c) => c.billingFrequency === "Annual" && !januaryPeriod,
      );
      if (outOfSeason.length > 0) {
        throw new ConflictError(
          `Annual charges can only be billed in a January period: ${outOfSeason
            .map((c) => c.description)
            .join(", ")}`,
        );
      }

      const alreadyBilled = await tx.invoiceRecurringCharge.findMany({
        where: {
          recurringChargeId: { in: recurringChargeIds },
          invoice: { periodStart, periodEnd, voidedAt: null },
        },
        select: { recurringChargeId: true },
      });
      if (alreadyBilled.length > 0) {
        throw new ConflictError(
          "One or more recurring charges were already billed for this period.",
        );
      }

      // Resolve rates. Refusing is deliberate -- a $0/NaN line item on a real
      // invoice is worse than a failed generation.
      const clientRate = client.billingRate ? Number(client.billingRate) : null;
      const lineItems = entries.map((entry) => {
        const override = entry.serviceType.rateOverride
          ? Number(entry.serviceType.rateOverride)
          : null;
        const rate = override ?? clientRate;
        if (rate === null) {
          throw new ConflictError(
            `No rate available for "${entry.description.slice(0, 40)}…" ` +
              `(${entry.serviceType.code}). Set a rate override on the service type or a ` +
              `billing rate on the client.`,
          );
        }
        const hours = Number(entry.durationHours);
        return {
          date: entry.date.toISOString().slice(0, 10),
          description: entry.description,
          hours,
          rate,
          amount: Number((hours * rate).toFixed(2)),
          serviceTypeLabel: entry.serviceType.label,
        };
      });

      const totalHours = Number(lineItems.reduce((s, l) => s + l.hours, 0).toFixed(2));
      const chargeTotal = charges.reduce((s, c) => s + Number(c.amount), 0);
      const totalAmount = Number(
        (lineItems.reduce((s, l) => s + l.amount, 0) + chargeTotal).toFixed(2),
      );

      // Atomic per-client sequence. Postgres row-locks the client row for this
      // UPDATE, so two concurrent generations for the same client serialize.
      const bumped = await tx.client.update({
        where: { id: clientId },
        data: { lastInvoiceSequence: { increment: 1 } },
        select: { lastInvoiceSequence: true, shortName: true },
      });
      const number = `${bumped.shortName}-${String(bumped.lastInvoiceSequence).padStart(5, "0")}`;

      const invoice = await tx.invoice.create({
        data: {
          organizationId: appUser.organizationId,
          clientId,
          invoiceNumber: number,
          periodStart,
          periodEnd,
          totalHours,
          totalAmount,
          status: "Draft",
        },
      });

      await tx.timeEntry.updateMany({
        where: { id: { in: entries.map((e) => e.id) } },
        data: { invoiceId: invoice.id },
      });

      if (charges.length > 0) {
        await tx.invoiceRecurringCharge.createMany({
          data: charges.map((c) => ({
            organizationId: appUser.organizationId,
            invoiceId: invoice.id,
            recurringChargeId: c.id,
            description: c.description,
            amount: c.amount,
            billingFrequency: c.billingFrequency,
          })),
        });
      }

      const monthlyCharges = charges
        .filter((c) => c.billingFrequency === "Monthly")
        .map((c) => ({ description: c.description, amount: Number(c.amount) }));
      const annualCharges = charges
        .filter((c) => c.billingFrequency === "Annual")
        .map((c) => ({ description: c.description, amount: Number(c.amount) }));

      const data: InvoicePdfData = {
        invoiceNumber: number,
        issuedAt: new Date().toISOString().slice(0, 10),
        periodStart: periodStart.toISOString().slice(0, 10),
        periodEnd: periodEnd.toISOString().slice(0, 10),
        organization: {
          name: organization.name,
          logoDataUri: null,
          phone: organization.phone,
          brandColorPrimary: organization.brandColorPrimary,
          brandColorAccent: organization.brandColorAccent,
        },
        client: {
          name: client.name,
          address1: client.address1,
          address2: client.address2,
          cityStateZip: client.cityStateZip,
          phone: client.phone,
        },
        lineItems: lineItems.map(({ serviceTypeLabel: _label, ...rest }) => rest),
        monthlyCharges,
        annualCharges,
        serviceSummary: buildServiceSummary({
          organizationName: organization.name,
          clientName: client.name,
          totalHours,
          entryCount: lineItems.length,
          serviceTypeLabels: lineItems.map((l) => l.serviceTypeLabel),
          hasRecurring: charges.length > 0,
        }),
        totalHours,
        totalAmount,
      };

      return { invoiceId: invoice.id, invoiceNumber: number, data };
    });

    invoiceId = created.invoiceId;
    invoiceNumber = created.invoiceNumber;
    pdfInput = { invoiceId: created.invoiceId, data: created.data };
  } catch (err: unknown) {
    return { ok: false, error: errorMessage(err) };
  }

  // PDF render + upload happen AFTER the transaction commits -- rendering is
  // slow and shouldn't hold a DB transaction open. If it fails, the invoice is
  // still correct (line items are linked); the detail page offers a retry.
  let pdfFailed = false;
  try {
    const pdf = await generateInvoicePdf(pdfInput.data);
    const path = invoicePdfPath(appUser.organizationId, clientId, invoiceId);
    await uploadInvoicePdf(path, pdf);
    await withRLS(authUserId, (tx) =>
      tx.invoice.update({ where: { id: invoiceId }, data: { pdfUrl: path } }),
    );
  } catch {
    pdfFailed = true;
  }

  revalidatePath("/invoices");
  revalidatePath("/time-entries");
  return { ok: true, data: { invoiceId, invoiceNumber, pdfFailed } };
}

/** Re-renders the PDF for an invoice that has none (or a stale one). */
export async function regenerateInvoicePdf(id: string): Promise<ActionResult> {
  const { authUserId, appUser } = await requireOrgContext();

  try {
    const data = await withRLS(authUserId, async (tx) => {
      const invoice = await tx.invoice.findUniqueOrThrow({
        where: { id },
        include: {
          client: true,
          organization: true,
          timeEntries: { include: { serviceType: true }, orderBy: { date: "asc" } },
          recurringCharges: true,
        },
      });

      const clientRate = invoice.client.billingRate ? Number(invoice.client.billingRate) : null;
      const lineItems = invoice.timeEntries.map((entry) => {
        const override = entry.serviceType.rateOverride
          ? Number(entry.serviceType.rateOverride)
          : null;
        const rate = override ?? clientRate ?? 0;
        const hours = Number(entry.durationHours);
        return {
          date: entry.date.toISOString().slice(0, 10),
          description: entry.description,
          hours,
          rate,
          amount: Number((hours * rate).toFixed(2)),
          serviceTypeLabel: entry.serviceType.label,
        };
      });

      return {
        invoice,
        pdf: {
          invoiceNumber: invoice.invoiceNumber,
          issuedAt: invoice.createdAt.toISOString().slice(0, 10),
          periodStart: invoice.periodStart.toISOString().slice(0, 10),
          periodEnd: invoice.periodEnd.toISOString().slice(0, 10),
          organization: {
            name: invoice.organization.name,
            logoDataUri: null,
            phone: invoice.organization.phone,
            brandColorPrimary: invoice.organization.brandColorPrimary,
            brandColorAccent: invoice.organization.brandColorAccent,
          },
          client: {
            name: invoice.client.name,
            address1: invoice.client.address1,
            address2: invoice.client.address2,
            cityStateZip: invoice.client.cityStateZip,
            phone: invoice.client.phone,
          },
          lineItems: lineItems.map(({ serviceTypeLabel: _l, ...rest }) => rest),
          monthlyCharges: invoice.recurringCharges
            .filter((c) => c.billingFrequency === "Monthly")
            .map((c) => ({ description: c.description, amount: Number(c.amount) })),
          annualCharges: invoice.recurringCharges
            .filter((c) => c.billingFrequency === "Annual")
            .map((c) => ({ description: c.description, amount: Number(c.amount) })),
          serviceSummary: buildServiceSummary({
            organizationName: invoice.organization.name,
            clientName: invoice.client.name,
            totalHours: Number(invoice.totalHours),
            entryCount: lineItems.length,
            serviceTypeLabels: lineItems.map((l) => l.serviceTypeLabel),
            hasRecurring: invoice.recurringCharges.length > 0,
          }),
          totalHours: Number(invoice.totalHours),
          totalAmount: Number(invoice.totalAmount),
        } satisfies InvoicePdfData,
      };
    });

    const pdf = await generateInvoicePdf(data.pdf);
    const path = invoicePdfPath(appUser.organizationId, data.invoice.clientId, id);
    await uploadInvoicePdf(path, pdf);
    await withRLS(authUserId, (tx) =>
      tx.invoice.update({ where: { id }, data: { pdfUrl: path } }),
    );
  } catch (err: unknown) {
    return { ok: false, error: errorMessage(err) };
  }

  revalidatePath(`/invoices/${id}`);
  return { ok: true };
}

export async function markInvoiceSent(id: string): Promise<ActionResult> {
  // Admin-only, per the RLS split: only admins transition invoice status.
  await requireAdmin();
  const { authUserId } = await requireOrgContext();

  try {
    await withRLS(authUserId, async (tx) => {
      const invoice = await tx.invoice.findUniqueOrThrow({
        where: { id },
        include: { organization: true },
      });
      if (invoice.voidedAt) throw new ConflictError("This invoice has been voided.");
      if (invoice.status !== "Draft") {
        throw new ConflictError(`This invoice is already ${invoice.status}.`);
      }
      if (!invoice.organization.emailDomainVerified) {
        throw new ConflictError(
          "The organization's email domain isn't verified yet, so invoices can't be sent.",
        );
      }
      // Status bookkeeping only. Actually emailing the invoice is Phase 5,
      // where all outbound mail is built together.
      await tx.invoice.update({
        where: { id },
        data: { status: "Sent", sentAt: new Date() },
      });
    });
  } catch (err: unknown) {
    return { ok: false, error: errorMessage(err) };
  }

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${id}`);
  return { ok: true };
}

export async function markInvoicePaid(id: string): Promise<ActionResult> {
  await requireAdmin();
  const { authUserId } = await requireOrgContext();

  try {
    await withRLS(authUserId, async (tx) => {
      const invoice = await tx.invoice.findUniqueOrThrow({ where: { id } });
      if (invoice.voidedAt) throw new ConflictError("This invoice has been voided.");
      if (invoice.status !== "Sent") {
        throw new ConflictError("Only a Sent invoice can be marked Paid.");
      }
      await tx.invoice.update({
        where: { id },
        data: { status: "Paid", paidAt: new Date() },
      });
    });
  } catch (err: unknown) {
    return { ok: false, error: errorMessage(err) };
  }

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${id}`);
  return { ok: true };
}

/**
 * Voids an invoice: frees its time entries to be re-invoiced, removes its
 * recurring-charge snapshots (re-opening those charges for that period), marks
 * it voided, and archives rather than deletes the PDF.
 */
export async function voidInvoice(
  id: string,
): Promise<ActionResult<{ pdfArchived: boolean }>> {
  await requireAdmin();
  const { authUserId, appUser } = await requireOrgContext();

  let pdfUrl: string | null = null;
  let clientId = "";

  try {
    const result = await withRLS(authUserId, async (tx) => {
      const invoice = await tx.invoice.findUniqueOrThrow({ where: { id } });
      if (invoice.voidedAt) throw new ConflictError("This invoice is already voided.");

      await tx.timeEntry.updateMany({ where: { invoiceId: id }, data: { invoiceId: null } });
      await tx.invoiceRecurringCharge.deleteMany({ where: { invoiceId: id } });
      await tx.invoice.update({ where: { id }, data: { voidedAt: new Date() } });

      return { pdfUrl: invoice.pdfUrl, clientId: invoice.clientId };
    });
    pdfUrl = result.pdfUrl;
    clientId = result.clientId;
  } catch (err: unknown) {
    return { ok: false, error: errorMessage(err) };
  }

  // Storage move is best-effort: the DB effects above are what actually matter
  // for billing correctness, so a failed move warns rather than rolls back.
  let pdfArchived = true;
  if (pdfUrl) {
    const moved = await archiveInvoicePdf(pdfUrl, appUser.organizationId, clientId, id);
    if (moved) {
      await withRLS(authUserId, (tx) =>
        tx.invoice.update({ where: { id }, data: { pdfUrl: moved } }),
      );
    } else {
      pdfArchived = false;
    }
  }

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${id}`);
  revalidatePath("/time-entries");
  return { ok: true, data: { pdfArchived } };
}

class ConflictError extends Error {}

function errorMessage(err: unknown): string {
  if (err instanceof ConflictError) return err.message;
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code?: string }).code;
    if (code === "P2025") return "That record no longer exists.";
    if (code === "P2002") {
      return "An invoice with that number already exists for this client.";
    }
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}
