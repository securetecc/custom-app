import type { InvoicePdfLineItem } from "./types";

/**
 * Builds the invoice's work log and prose service summary.
 *
 * Kept as pure functions on plain data (no React, no Prisma) so the PDF page
 * and the Google Sheet replica render the SAME text -- the two outputs are
 * sent to the same client and must not describe the period differently.
 */

export type WorkLogEntry = { when: string; code: string | null; description: string };

/** Dated rows keep their date and service code; charges/retainers read "Monthly". */
export function buildWorkLog(lineItems: InvoicePdfLineItem[]): WorkLogEntry[] {
  return lineItems.map((item) => ({
    when: item.date ? formatDate(item.date) : "Monthly",
    code: item.serviceCode,
    description: item.description.trim(),
  }));
}

/**
 * "During July 2026, SecureTECC provided the following IT services for X."
 * followed by the work itself, then any recurring services.
 *
 * Individual descriptions are split on sentence boundaries and re-joined with
 * commas, which is how the old system's summaries read -- "Repaired Acrobat.
 * Ran Dell Updates." becomes part of one flowing list rather than staying two
 * clipped sentences.
 */
export function buildServiceSummary(args: {
  lineItems: InvoicePdfLineItem[];
  clientName: string;
  orgName: string;
  periodLabel: string;
}): string[] {
  const { lineItems, clientName, orgName, periodLabel } = args;

  const dated = lineItems.filter((i) => i.date);
  const recurring = lineItems.filter((i) => !i.date);

  const paragraphs = [
    `During ${periodLabel}, ${orgName} provided the following IT services for ${clientName}.`,
  ];

  const clauses = dated.flatMap((i) => splitSentences(i.description));
  const body: string[] = [];
  if (clauses.length) body.push(`${clauses.join(", ")}.`);
  if (recurring.length) {
    const names = recurring.map((i) => i.description.trim().replace(/\.$/, ""));
    body.push(`Recurring services for the period also included ${joinList(names)}.`);
  }
  if (body.length) paragraphs.push(body.join(" "));

  return paragraphs;
}

/** "Jul 2026" style label for the billing period the invoice covers. */
export function periodLabel(periodStart: string, periodEnd: string): string {
  const start = parseIsoDate(periodStart);
  const end = parseIsoDate(periodEnd);
  const month = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
  const a = month(start);
  const b = month(end);
  return a === b ? a : `${a} – ${b}`;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=\.)\s+/)
    .map((part) => part.trim().replace(/\.$/, ""))
    .filter(Boolean);
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${m}/${d}/${y}`;
}
