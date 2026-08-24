"use server";

import { revalidatePath } from "next/cache";
import { requireAdminContext, requireOrgContext } from "@/lib/auth";
import { withRLS, type TxClient } from "@/lib/db/rls";
import {
  generateInvoiceSchema,
  invoicePeriodSchema,
  januaryOccurrencesInRange,
  monthsInRange,
  parseIsoDate,
  toIsoDate,
  type GenerateInvoiceValues,
  type InvoicePeriodValues,
} from "@/lib/validations/invoice";
import { generateInvoicePdf } from "@/lib/pdf/generate-invoice-pdf";
import { fetchLogoDataUri } from "@/lib/pdf/logo";
import {
  archiveInvoicePdf,
  downloadInvoicePdf,
  invoicePdfPath,
  uploadInvoicePdf,
} from "@/lib/storage/invoices";
import type { InvoicePdfData } from "@/lib/pdf/types";
import { createGmailDraft } from "@/lib/google/gmail";
import { archiveInvoiceToDrive } from "@/lib/google/archive-invoice";
import { invoiceEmail } from "@/lib/email/templates";
import type { BillingFrequency } from "@/generated/prisma/enums";

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

export type BillingCandidate = {
  id: string;
  date: string;
  description: string;
  hours: number;
  // Both null for a Retainer client's entries: hours are shown for
  // reference, but aren't individually billed (see retainerRate below).
  rate: number | null;
  amount: number | null;
  serviceTypeCode: string;
  serviceTypeLabel: string;
};

export type RecurringCandidate = {
  /** Composite `${recurringChargeId}:${occurrencePeriodStart}` -- see expandRecurringOccurrences. */
  id: string;
  recurringChargeId: string;
  description: string;
  amount: number;
  billingFrequency: "Monthly" | "Annual";
};

export type ReimbursableCandidate = {
  id: string;
  date: string;
  description: string;
  amount: number;
};

export type BillingCandidates = {
  clientName: string;
  billingType: "Hourly" | "Retainer";
  /** Flat rate billed once per calendar month in the period, for Retainer clients. */
  retainerRate: number | null;
  periodStart: string;
  periodEnd: string;
  timeEntries: BillingCandidate[];
  recurringCharges: RecurringCandidate[];
  reimbursableExpenses: ReimbursableCandidate[];
  /** Entries whose rate can't be resolved -- generation will refuse these. Hourly clients only. */
  unratedEntryIds: string[];
};

function monthLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    date,
  );
}

/** A charge/retainer row for the PDF's flat line-item table -- no date, hours, or rate. */
function chargeLineItem(
  description: string,
  amount: number,
  groupLabel: string | null = null,
): InvoicePdfData["lineItems"][number] {
  return { date: null, serviceCode: null, groupLabel, description, hours: null, rate: null, amount };
}

/** "Monthly Recurring Charges" / "Annual Recurring Charges". */
function chargeGroupLabel(frequency: "Monthly" | "Annual"): string {
  return `${frequency} Recurring Charges`;
}

type PdfOrganizationRow = {
  name: string;
  phone: string | null;
  billerName: string | null;
  billerAddress1: string | null;
  billerAddress2: string | null;
  billerCityStateZip: string | null;
  billerMobilePhone: string | null;
  billerEmail: string | null;
  website: string | null;
  invoiceForLabel: string | null;
  checkPayableTo: string | null;
  acceptedPaymentMethods: string | null;
};

/** Maps an Organization row to the PDF's letterhead shape. logoDataUri is filled in after, outside the transaction. */
function buildPdfOrganization(organization: PdfOrganizationRow): InvoicePdfData["organization"] {
  return {
    name: organization.name,
    logoDataUri: null,
    billerName: organization.billerName,
    billerAddress1: organization.billerAddress1,
    billerAddress2: organization.billerAddress2,
    billerCityStateZip: organization.billerCityStateZip,
    officePhone: organization.phone,
    mobilePhone: organization.billerMobilePhone,
    billerEmail: organization.billerEmail,
    website: organization.website,
    invoiceForLabel: organization.invoiceForLabel || "IT Services",
    checkPayableTo: organization.checkPayableTo,
    acceptedPaymentMethods: organization.acceptedPaymentMethods,
  };
}

type RecurringChargeRow = {
  id: string;
  description: string;
  amount: unknown; // Prisma.Decimal, kept opaque here -- always Number()'d before use
  billingFrequency: BillingFrequency;
};

/**
 * Expands each active recurring charge into one occurrence per calendar
 * month (Monthly) or per January (Annual) touched by [periodStart,
 * periodEnd], excluding occurrences already billed on a non-voided invoice.
 * Shared by loadBillingCandidates (read-only preview) and generateInvoice
 * (which re-runs this from scratch server-side rather than trusting the
 * client's selection -- same principle as time-entry rate resolution).
 */
async function expandRecurringOccurrences(
  tx: TxClient,
  charges: RecurringChargeRow[],
  periodStart: Date,
  periodEnd: Date,
): Promise<(RecurringCandidate & { occurrencePeriodStart: Date; occurrencePeriodEnd: Date })[]> {
  if (charges.length === 0) return [];

  const months = monthsInRange(periodStart, periodEnd);
  const januaries = januaryOccurrencesInRange(periodStart, periodEnd);
  const spansMultipleMonths = months.length > 1;

  const occurrences = charges.flatMap((charge) => {
    const periods = charge.billingFrequency === "Monthly" ? months : januaries;
    return periods.map((p) => ({ charge, occStart: p.monthStart, occEnd: p.monthEnd }));
  });
  if (occurrences.length === 0) return [];

  const alreadyBilled = await tx.invoiceRecurringCharge.findMany({
    where: {
      recurringChargeId: { in: charges.map((c) => c.id) },
      invoice: { voidedAt: null },
    },
    select: { recurringChargeId: true, periodStart: true, periodEnd: true },
  });
  const billedKey = (id: string, start: Date, end: Date) =>
    `${id}:${toIsoDate(start)}:${toIsoDate(end)}`;
  const billedSet = new Set(
    alreadyBilled.map((r) => billedKey(r.recurringChargeId, r.periodStart, r.periodEnd)),
  );

  return occurrences
    .filter((o) => !billedSet.has(billedKey(o.charge.id, o.occStart, o.occEnd)))
    .map((o) => ({
      id: `${o.charge.id}:${toIsoDate(o.occStart)}`,
      recurringChargeId: o.charge.id,
      description: spansMultipleMonths
        ? `${o.charge.description} — ${monthLabel(o.occStart)}`
        : o.charge.description,
      amount: Number(o.charge.amount),
      billingFrequency: o.charge.billingFrequency,
      occurrencePeriodStart: o.occStart,
      occurrencePeriodEnd: o.occEnd,
    }));
}

/**
 * Read-only: what *would* go on an invoice for this client + period.
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
  const { clientId } = parsed.data;
  const periodStart = parseIsoDate(parsed.data.periodStart);
  const periodEnd = parseIsoDate(parsed.data.periodEnd);

  const { authUserId } = await requireOrgContext();

  try {
    const result = await withRLS(authUserId, async (tx) => {
      const client = await tx.client.findUniqueOrThrow({ where: { id: clientId } });
      const isRetainer = client.billingType === "Retainer";

      const [timeEntries, recurringCharges, reimbursableExpenses] = await Promise.all([
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
        tx.reimbursableExpense.findMany({
          where: {
            clientId,
            invoiceId: null, // unbilled only
            date: { gte: periodStart, lte: periodEnd },
          },
          orderBy: { date: "asc" },
        }),
      ]);

      const clientRate = client.billingRate ? Number(client.billingRate) : null;

      const candidates: BillingCandidate[] = timeEntries.map((entry) => {
        const hours = Number(entry.durationHours);
        // Retainer: hours are informational only, never billed per-entry.
        if (isRetainer) {
          return {
            id: entry.id,
            date: entry.date.toISOString().slice(0, 10),
            description: entry.description,
            hours,
            rate: null,
            amount: null,
            serviceTypeCode: entry.serviceType.code,
            serviceTypeLabel: entry.serviceType.label,
          };
        }
        const override = entry.serviceType.rateOverride
          ? Number(entry.serviceType.rateOverride)
          : null;
        const rate = override ?? clientRate;
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

      const applicable = await expandRecurringOccurrences(tx, recurringCharges, periodStart, periodEnd);

      return {
        clientName: client.name,
        billingType: client.billingType,
        retainerRate: isRetainer ? clientRate : null,
        periodStart: toIsoDate(periodStart),
        periodEnd: toIsoDate(periodEnd),
        timeEntries: candidates,
        recurringCharges: applicable.map(
          ({ occurrencePeriodStart: _s, occurrencePeriodEnd: _e, ...rest }) => rest,
        ),
        reimbursableExpenses: reimbursableExpenses.map((e) => ({
          id: e.id,
          date: e.date.toISOString().slice(0, 10),
          description: e.description,
          amount: Number(e.amount),
        })),
        // Hourly only -- a Retainer entry with no rate isn't an error, it's expected.
        unratedEntryIds: isRetainer ? [] : candidates.filter((c) => c.rate === null).map((c) => c.id),
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
): Promise<
  ActionResult<{
    invoiceId: string;
    invoiceNumber: string;
    pdfFailed: boolean;
    archiveWarning?: string;
  }>
> {
  const parsed = generateInvoiceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { clientId, timeEntryIds, recurringChargeOccurrenceIds, reimbursableExpenseIds } =
    parsed.data;
  const periodStart = parseIsoDate(parsed.data.periodStart);
  const periodEnd = parseIsoDate(parsed.data.periodEnd);

  if (
    timeEntryIds.length === 0 &&
    recurringChargeOccurrenceIds.length === 0 &&
    reimbursableExpenseIds.length === 0
  ) {
    return { ok: false, error: "Select at least one item to invoice." };
  }

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
      const isRetainer = client.billingType === "Retainer";

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

      // Re-expand from scratch -- never trust the period embedded in a
      // client-submitted composite id.
      const allActiveCharges = await tx.recurringCharge.findMany({
        where: { clientId, activeStatus: true },
      });
      const occurrences = await expandRecurringOccurrences(
        tx,
        allActiveCharges,
        periodStart,
        periodEnd,
      );
      const selectedOccurrences = occurrences.filter((o) =>
        recurringChargeOccurrenceIds.includes(o.id),
      );
      if (selectedOccurrences.length !== recurringChargeOccurrenceIds.length) {
        throw new ConflictError(
          "Some selected recurring charges are no longer available — they may already be billed, " +
            "inactive, or outside this period. Reload the review screen and try again.",
        );
      }

      // Same re-verification principle as time entries above.
      const reimbursables = await tx.reimbursableExpense.findMany({
        where: {
          id: { in: reimbursableExpenseIds },
          clientId,
          invoiceId: null,
          date: { gte: periodStart, lte: periodEnd },
        },
        orderBy: { date: "asc" },
      });
      if (reimbursables.length !== reimbursableExpenseIds.length) {
        throw new ConflictError(
          "Some selected expenses are no longer available to invoice — they may have been " +
            "edited or invoiced elsewhere. Reload the review screen and try again.",
        );
      }

      // Resolve rates. Refusing is deliberate -- a $0/NaN line item on a real
      // invoice is worse than a failed generation.
      const clientRate = client.billingRate ? Number(client.billingRate) : null;
      if (isRetainer && clientRate === null) {
        throw new ConflictError(
          `${client.name} is billed as Retainer but has no billing rate set. Set one on the client first.`,
        );
      }

      const lineItems = entries.map((entry) => {
        const hours = Number(entry.durationHours);
        if (isRetainer) {
          return {
            date: entry.date.toISOString().slice(0, 10),
            serviceCode: entry.serviceType.code,
            groupLabel: null,
            description: entry.description,
            hours,
            rate: null as number | null,
            amount: null as number | null,
          };
        }
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
        return {
          date: entry.date.toISOString().slice(0, 10),
          serviceCode: entry.serviceType.code,
          groupLabel: null,
          description: entry.description,
          hours,
          rate,
          amount: Number((hours * rate).toFixed(2)),
        };
      });

      const totalHours = Number(lineItems.reduce((s, l) => s + l.hours, 0).toFixed(2));
      const chargeTotal = selectedOccurrences.reduce((s, o) => s + o.amount, 0);
      const reimbursableTotal = reimbursables.reduce((s, e) => s + Number(e.amount), 0);

      // Retainer: a flat rate billed once per calendar month, replacing the
      // time-based total entirely. Months already billed on a non-voided
      // invoice are excluded here -- without that, two invoices whose periods
      // both touch March would each charge March's retainer. Same ledger
      // approach InvoiceRetainerPeriod exists for, mirroring how
      // expandRecurringOccurrences dedupes recurring charges.
      let retainerOccurrences: { monthStart: Date; monthEnd: Date }[] = [];
      if (isRetainer) {
        const candidateMonths = monthsInRange(periodStart, periodEnd);
        const alreadyBilled = await tx.invoiceRetainerPeriod.findMany({
          where: { clientId, invoice: { voidedAt: null } },
          select: { periodStart: true },
        });
        const billed = new Set(alreadyBilled.map((r) => toIsoDate(r.periodStart)));
        retainerOccurrences = candidateMonths.filter(
          (m) => !billed.has(toIsoDate(m.monthStart)),
        );

        if (retainerOccurrences.length === 0) {
          throw new ConflictError(
            `Every month in this period has already been billed to ${client.name}'s retainer. ` +
              "Void the earlier invoice first, or choose a different period.",
          );
        }
      }
      const retainerMonths = retainerOccurrences.length;
      const retainerTotal = isRetainer ? (clientRate as number) * retainerMonths : 0;
      const timeTotal = isRetainer
        ? retainerTotal
        : lineItems.reduce((s, l) => s + (l.amount ?? 0), 0);
      const totalAmount = Number((timeTotal + chargeTotal + reimbursableTotal).toFixed(2));

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

      if (reimbursables.length > 0) {
        await tx.reimbursableExpense.updateMany({
          where: { id: { in: reimbursables.map((e) => e.id) } },
          data: { invoiceId: invoice.id },
        });
      }

      if (retainerOccurrences.length > 0) {
        await tx.invoiceRetainerPeriod.createMany({
          data: retainerOccurrences.map((m) => ({
            organizationId: appUser.organizationId,
            invoiceId: invoice.id,
            clientId,
            periodStart: m.monthStart,
            periodEnd: m.monthEnd,
            // Snapshot the rate, so a later change to Client.billingRate
            // never rewrites what a past invoice charged.
            amount: clientRate as number,
          })),
        });
      }

      if (selectedOccurrences.length > 0) {
        await tx.invoiceRecurringCharge.createMany({
          data: selectedOccurrences.map((o) => ({
            organizationId: appUser.organizationId,
            invoiceId: invoice.id,
            recurringChargeId: o.recurringChargeId,
            description: o.description,
            amount: o.amount,
            billingFrequency: o.billingFrequency,
            periodStart: o.occurrencePeriodStart,
            periodEnd: o.occurrencePeriodEnd,
          })),
        });
      }

      // Charge/retainer/expense rows fold into the same flat table as extra
      // rows, matching the org's canonical invoice template -- no separate
      // "Monthly/Annual Recurring Charges" or "Retainer" sections.
      const chargeRows = selectedOccurrences.map((o) =>
        chargeLineItem(o.description, o.amount, chargeGroupLabel(o.billingFrequency)),
      );
      const expenseRows = reimbursables.map((e) => ({
        date: e.date.toISOString().slice(0, 10),
        serviceCode: null,
        groupLabel: null,
        description: e.description,
        hours: null,
        rate: null,
        amount: Number(e.amount),
      }));
      const retainerRow = isRetainer
        ? [
            chargeLineItem(
              retainerMonths > 1
                ? `${client.name} — Retainer (${retainerMonths} months)`
                : `${client.name} — Retainer`,
              retainerTotal,
            ),
          ]
        : [];

      const data: InvoicePdfData = {
        invoiceNumber: number,
        issuedAt: new Date().toISOString().slice(0, 10),
        periodStart: periodStart.toISOString().slice(0, 10),
        periodEnd: periodEnd.toISOString().slice(0, 10),
        organization: buildPdfOrganization(organization),
        client: {
          name: client.name,
          address1: client.address1,
          address2: client.address2,
          cityStateZip: client.cityStateZip,
          phone: client.phone,
        },
        lineItems: [...lineItems, ...expenseRows, ...chargeRows, ...retainerRow],
        totalHours,
        totalAmount,
      };

      return { invoiceId: invoice.id, invoiceNumber: number, data, logoUrl: organization.logoUrl };
    });

    invoiceId = created.invoiceId;
    invoiceNumber = created.invoiceNumber;
    pdfInput = { invoiceId: created.invoiceId, data: created.data };
    // Fetch outside the transaction -- it's a network call, and the PDF render
    // below already runs after commit for the same reason.
    pdfInput.data.organization.logoDataUri = await fetchLogoDataUri(created.logoUrl);
  } catch (err: unknown) {
    return { ok: false, error: errorMessage(err) };
  }

  // PDF render + upload happen AFTER the transaction commits -- rendering is
  // slow and shouldn't hold a DB transaction open. If it fails, the invoice is
  // still correct (line items are linked); the detail page offers a retry.
  let pdfFailed = false;
  let archiveWarning: string | undefined;
  try {
    const pdf = await generateInvoicePdf(pdfInput.data);
    const path = invoicePdfPath(appUser.organizationId, clientId, invoiceId);
    await uploadInvoicePdf(path, pdf);
    await withRLS(authUserId, (tx) =>
      tx.invoice.update({ where: { id: invoiceId }, data: { pdfUrl: path } }),
    );

    // Drive archiving is best-effort and never throws -- a correctly billed
    // invoice must not be undone because Drive was unreachable. Silently a
    // no-op when Google isn't configured yet.
    const archived = await archiveInvoiceToDrive({
      invoiceNumber,
      clientName: pdfInput.data.client.name,
      year: periodEnd.getUTCFullYear(),
      pdf,
      data: pdfInput.data,
    });
    if (!archived.ok && !archived.skipped) archiveWarning = archived.error;
  } catch {
    pdfFailed = true;
  }

  revalidatePath("/invoices");
  revalidatePath("/time-entries");
  return { ok: true, data: { invoiceId, invoiceNumber, pdfFailed, archiveWarning } };
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
          reimbursableExpenses: { orderBy: { date: "asc" } },
        },
      });
      const isRetainer = invoice.client.billingType === "Retainer";

      const clientRate = invoice.client.billingRate ? Number(invoice.client.billingRate) : null;
      const lineItems = invoice.timeEntries.map((entry) => {
        const hours = Number(entry.durationHours);
        if (isRetainer) {
          return {
            date: entry.date.toISOString().slice(0, 10),
            serviceCode: entry.serviceType.code,
            groupLabel: null,
            description: entry.description,
            hours,
            rate: null as number | null,
            amount: null as number | null,
          };
        }
        const override = entry.serviceType.rateOverride
          ? Number(entry.serviceType.rateOverride)
          : null;
        const rate = override ?? clientRate ?? 0;
        return {
          date: entry.date.toISOString().slice(0, 10),
          serviceCode: entry.serviceType.code,
          groupLabel: null,
          description: entry.description,
          hours,
          rate,
          amount: Number((hours * rate).toFixed(2)),
        };
      });

      // Charge/retainer/expense rows fold into the same flat table as extra rows.
      const chargeRows = invoice.recurringCharges.map((c) =>
        chargeLineItem(c.description, Number(c.amount)),
      );
      const expenseRows = invoice.reimbursableExpenses.map((e) => ({
        date: e.date.toISOString().slice(0, 10),
        serviceCode: null,
        groupLabel: null,
        description: e.description,
        hours: null,
        rate: null,
        amount: Number(e.amount),
      }));
      // Retainer total isn't separately stored -- re-derive it as
      // (invoice total minus recurring charges minus expenses), which is
      // exact since generation computed totalAmount the same way.
      const recurringTotal = invoice.recurringCharges.reduce((s, c) => s + Number(c.amount), 0);
      const expenseTotal = invoice.reimbursableExpenses.reduce((s, e) => s + Number(e.amount), 0);
      const retainerRow = isRetainer
        ? [
            chargeLineItem(
              `${invoice.client.name} — Retainer`,
              Number((Number(invoice.totalAmount) - recurringTotal - expenseTotal).toFixed(2)),
            ),
          ]
        : [];

      return {
        invoice,
        pdf: {
          invoiceNumber: invoice.invoiceNumber,
          issuedAt: invoice.createdAt.toISOString().slice(0, 10),
          periodStart: invoice.periodStart.toISOString().slice(0, 10),
          periodEnd: invoice.periodEnd.toISOString().slice(0, 10),
          organization: buildPdfOrganization(invoice.organization),
          client: {
            name: invoice.client.name,
            address1: invoice.client.address1,
            address2: invoice.client.address2,
            cityStateZip: invoice.client.cityStateZip,
            phone: invoice.client.phone,
          },
          lineItems: [...lineItems, ...expenseRows, ...chargeRows, ...retainerRow],
          totalHours: Number(invoice.totalHours),
          totalAmount: Number(invoice.totalAmount),
        } satisfies InvoicePdfData,
      };
    });

    // Fetch outside the transaction -- it's a network call.
    data.pdf.organization.logoDataUri = await fetchLogoDataUri(data.invoice.organization.logoUrl);

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

/**
 * Creates a Gmail DRAFT of the invoice, with the PDF attached, in the
 * Workspace mailbox the service account impersonates.
 *
 * Deliberately does NOT touch invoice status: the draft is unsent until a
 * human sends it from Gmail, and marking it Sent here would make the app
 * claim something untrue about money owed. markInvoiceSent below is the
 * separate, explicit confirmation step.
 */
export async function createInvoiceGmailDraft(
  id: string,
): Promise<ActionResult<{ draftUrl: string }>> {
  const { authUserId } = await requireAdminContext();

  try {
    const invoice = await withRLS(authUserId, (tx) =>
      tx.invoice.findUniqueOrThrow({
        where: { id },
        include: { organization: true, client: true },
      }),
    );

    if (invoice.voidedAt) throw new ConflictError("This invoice has been voided.");
    if (!invoice.client.email) {
      throw new ConflictError(`${invoice.client.name} has no billing email on file.`);
    }
    if (!invoice.pdfUrl) {
      throw new ConflictError("This invoice has no PDF yet — use Retry PDF first.");
    }

    // The client actually needs the invoice document, not just a summary --
    // the previous Resend path sent HTML with nothing attached.
    const pdf = await downloadInvoicePdf(invoice.pdfUrl);
    const email = invoiceEmail(
      {
        organizationName: invoice.organization.name,
        primaryColor: invoice.organization.brandColorPrimary,
        accentColor: invoice.organization.brandColorAccent,
        logoUrl: invoice.organization.logoUrl,
        phone: invoice.organization.phone,
      },
      {
        invoiceNumber: invoice.invoiceNumber,
        clientName: invoice.client.name,
        periodStart: invoice.periodStart,
        periodEnd: invoice.periodEnd,
        totalAmount: Number(invoice.totalAmount),
      },
    );

    const draft = await createGmailDraft({
      to: invoice.client.email,
      from: invoice.organization.invoiceFromEmail ?? invoice.organization.supportEmail,
      subject: email.subject,
      html: email.html,
      attachment: {
        filename: `${invoice.invoiceNumber}.pdf`,
        content: pdf,
        mimeType: "application/pdf",
      },
    });

    revalidatePath(`/invoices/${id}`);
    return { ok: true, data: { draftUrl: draft.url } };
  } catch (err: unknown) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * Records that an invoice has actually been sent.
 *
 * No longer sends anything itself: invoices go out as a reviewed Gmail draft
 * (see createInvoiceGmailDraft), so this is purely the confirmation step the
 * admin clicks once it's really gone out. Ticket and digest email still go
 * through Resend -- that split is intentional.
 */
export async function markInvoiceSent(id: string): Promise<ActionResult> {
  // Admin-only, per the RLS split: only admins transition invoice status.
  const { authUserId } = await requireAdminContext();

  try {
    await withRLS(authUserId, async (tx) => {
      const invoice = await tx.invoice.findUniqueOrThrow({ where: { id } });
      if (invoice.voidedAt) throw new ConflictError("This invoice has been voided.");
      if (invoice.status !== "Draft") {
        throw new ConflictError(`This invoice is already ${invoice.status}.`);
      }
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
  const { authUserId } = await requireAdminContext();

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
 * Voids an invoice: frees its time entries AND reimbursable expenses to be
 * re-invoiced, removes its recurring-charge snapshots (re-opening those
 * charges for that period), marks it voided, and archives rather than
 * deletes the PDF.
 */
export async function voidInvoice(
  id: string,
): Promise<ActionResult<{ pdfArchived: boolean }>> {
  const { authUserId, appUser } = await requireAdminContext();

  let pdfUrl: string | null = null;
  let clientId = "";

  try {
    const result = await withRLS(authUserId, async (tx) => {
      const invoice = await tx.invoice.findUniqueOrThrow({ where: { id } });
      if (invoice.voidedAt) throw new ConflictError("This invoice is already voided.");

      await tx.timeEntry.updateMany({ where: { invoiceId: id }, data: { invoiceId: null } });
      await tx.reimbursableExpense.updateMany({
        where: { invoiceId: id },
        data: { invoiceId: null },
      });
      await tx.invoiceRecurringCharge.deleteMany({ where: { invoiceId: id } });
      // Re-opens those calendar months so the retainer can be billed again.
      await tx.invoiceRetainerPeriod.deleteMany({ where: { invoiceId: id } });
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
