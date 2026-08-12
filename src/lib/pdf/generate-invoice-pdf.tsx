import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { InvoicePdfDocument } from "./invoice-document";
import { formatHours } from "@/lib/format";
import type { InvoicePdfData } from "./types";

/**
 * Renders an invoice to a PDF buffer.
 *
 * Called AFTER the generation transaction commits -- rendering is slow enough
 * that holding a DB transaction open across it is a bad trade, and the invoice
 * rows are already correct by then (see app/(app)/invoices/actions.ts).
 *
 * The cast is needed because renderToBuffer is typed to take the root
 * <Document> element itself; TypeScript can't see that InvoicePdfDocument
 * returns one through the component boundary.
 */
export async function generateInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  const element = (<InvoicePdfDocument data={data} />) as unknown as ReactElement<DocumentProps>;
  return renderToBuffer(element);
}

/**
 * Deterministic 2-4 sentence narrative, built from the invoice's own line
 * items.
 *
 * Deliberately rule-based rather than LLM-generated: this text ships on a real
 * invoice and the review screen has no field to correct it, so there is no
 * human check between generation and the client reading it. Billing
 * correctness outranks prose quality here (see HANDOFF.md priority order).
 */
export function buildServiceSummary(input: {
  organizationName: string;
  clientName: string;
  totalHours: number;
  entryCount: number;
  serviceTypeLabels: string[];
  hasRecurring: boolean;
}): string {
  const {
    organizationName,
    clientName,
    totalHours,
    entryCount,
    serviceTypeLabels,
    hasRecurring,
  } = input;

  if (entryCount === 0) {
    return hasRecurring
      ? `This invoice covers recurring service charges for ${clientName} for the period shown above. No hourly service time was logged during this period.`
      : `This invoice covers services for ${clientName} for the period shown above.`;
  }

  const hoursText = totalHours === 1 ? "1 hour" : `${formatHours(totalHours)} hours`;
  const entryText = entryCount === 1 ? "1 service entry" : `${entryCount} service entries`;

  const uniqueLabels = [...new Set(serviceTypeLabels)];
  const labelText =
    uniqueLabels.length === 0
      ? ""
      : uniqueLabels.length === 1
        ? uniqueLabels[0]
        : uniqueLabels.length === 2
          ? `${uniqueLabels[0]} and ${uniqueLabels[1]}`
          : `${uniqueLabels.slice(0, -1).join(", ")}, and ${uniqueLabels[uniqueLabels.length - 1]}`;

  const sentences = [
    `During this billing period, ${organizationName} performed ${hoursText} of IT support for ${clientName} across ${entryText}.`,
  ];

  if (labelText) {
    sentences.push(`Work primarily covered ${labelText}.`);
  }

  if (hasRecurring) {
    sentences.push("Recurring service charges for this period are itemized above.");
  }

  sentences.push("A dated breakdown of all work performed appears in the Detailed Work Log.");

  return sentences.join(" ");
}
