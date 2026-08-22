"use server";

import { revalidatePath } from "next/cache";
import { requireOrgContext } from "@/lib/auth";
import { withRLS } from "@/lib/db/rls";
import { parseCsv } from "@/lib/csv";
import {
  importedTimeEntryRowSchema,
  resolvedImportRowSchema,
  BILLABLE_STATUS_ALIASES,
  type ResolvedImportRow,
} from "@/lib/validations/time-entry-import";

const MAX_ROWS = 1000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export type PreviewRow = {
  /** 1-based, matches the CSV's data rows (header excluded). */
  rowNumber: number;
  raw: Record<string, string>;
  resolved: ResolvedImportRow | null;
  error: string | null;
};

export type PreviewResult =
  | { ok: true; rows: PreviewRow[]; validCount: number }
  | { ok: false; error: string };

/**
 * Parses an uploaded CSV, resolves each row's clientShortName/serviceTypeCode
 * against this org's actual records, and applies the same billing-minimum
 * floor createTimeEntry does -- so the preview total matches what actually
 * gets billed once imported. Writes nothing.
 */
export async function previewTimeEntryImport(formData: FormData): Promise<PreviewResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a CSV file." };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, error: "File is too large (max 2MB)." };
  }

  const records = parseCsv(await file.text());
  if (records.length === 0) {
    return { ok: false, error: "No rows found in that file." };
  }
  if (records.length > MAX_ROWS) {
    return { ok: false, error: `Import at most ${MAX_ROWS} rows at a time.` };
  }

  const { authUserId, appUser } = await requireOrgContext();

  const rows = await withRLS(authUserId, async (tx) => {
    const [clients, serviceTypes] = await Promise.all([
      tx.client.findMany({ where: { organizationId: appUser.organizationId } }),
      tx.serviceType.findMany({ where: { organizationId: appUser.organizationId } }),
    ]);
    const clientByShortName = new Map(clients.map((c) => [c.shortName.toLowerCase(), c]));
    const serviceTypeByCode = new Map(serviceTypes.map((s) => [s.code.toLowerCase(), s]));

    return records.map((raw, i): PreviewRow => {
      const rowNumber = i + 1;
      const parsed = importedTimeEntryRowSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          rowNumber,
          raw,
          resolved: null,
          error: parsed.error.issues[0]?.message ?? "Missing a required column",
        };
      }
      const r = parsed.data;

      const client = clientByShortName.get(r.clientshortname.toLowerCase());
      if (!client) {
        return {
          rowNumber,
          raw,
          resolved: null,
          error: `Unknown client short name "${r.clientshortname}"`,
        };
      }
      const serviceType = serviceTypeByCode.get(r.servicetypecode.toLowerCase());
      if (!serviceType) {
        return {
          rowNumber,
          raw,
          resolved: null,
          error: `Unknown service type code "${r.servicetypecode}"`,
        };
      }
      const date = new Date(r.date);
      if (Number.isNaN(date.getTime())) {
        return { rowNumber, raw, resolved: null, error: `Unparseable date "${r.date}"` };
      }
      const hours = Number(r.durationhours);
      if (Number.isNaN(hours) || hours <= 0) {
        return {
          rowNumber,
          raw,
          resolved: null,
          error: `Unparseable hours "${r.durationhours}"`,
        };
      }
      const billableStatus = r.billablestatus
        ? BILLABLE_STATUS_ALIASES[r.billablestatus.toLowerCase()]
        : "Billable";
      if (!billableStatus) {
        return {
          rowNumber,
          raw,
          resolved: null,
          error: `Unrecognized billable status "${r.billablestatus}"`,
        };
      }

      const minimum = Number(serviceType.billingMinimumHours);
      const durationHours = Math.max(hours, minimum);

      const resolved: ResolvedImportRow = {
        clientId: client.id,
        serviceTypeId: serviceType.id,
        date: date.toISOString().slice(0, 10),
        durationHours,
        description: r.description,
        billableStatus,
      };
      return { rowNumber, raw, resolved, error: null };
    });
  });

  return { ok: true, rows, validCount: rows.filter((r) => r.resolved !== null).length };
}

export type CommitResult = { ok: true; created: number } | { ok: false; error: string };

/**
 * Bulk-inserts only the already-resolved rows the preview step produced.
 * Re-validates and re-verifies every id server-side rather than trusting the
 * round trip -- same principle as invoice generation's re-verification of a
 * submitted selection.
 */
export async function commitTimeEntryImport(rows: ResolvedImportRow[]): Promise<CommitResult> {
  if (rows.length === 0) return { ok: false, error: "Nothing to import." };
  if (rows.length > MAX_ROWS) {
    return { ok: false, error: `Import at most ${MAX_ROWS} rows at a time.` };
  }

  const validRows: ResolvedImportRow[] = [];
  for (const r of rows) {
    const parsed = resolvedImportRowSchema.safeParse(r);
    if (!parsed.success) {
      return { ok: false, error: "One or more rows failed validation. Reload and try again." };
    }
    validRows.push(parsed.data);
  }

  const { authUserId, appUser } = await requireOrgContext();

  try {
    await withRLS(authUserId, async (tx) => {
      const clientIds = [...new Set(validRows.map((r) => r.clientId))];
      const serviceTypeIds = [...new Set(validRows.map((r) => r.serviceTypeId))];
      const [validClients, validServiceTypes] = await Promise.all([
        tx.client.findMany({
          where: { id: { in: clientIds }, organizationId: appUser.organizationId },
        }),
        tx.serviceType.findMany({
          where: { id: { in: serviceTypeIds }, organizationId: appUser.organizationId },
        }),
      ]);
      const validClientIds = new Set(validClients.map((c) => c.id));
      const validServiceTypeIds = new Set(validServiceTypes.map((s) => s.id));
      if (
        validRows.some(
          (r) => !validClientIds.has(r.clientId) || !validServiceTypeIds.has(r.serviceTypeId),
        )
      ) {
        throw new Error("One or more rows reference a client or service type that no longer exists.");
      }

      await tx.timeEntry.createMany({
        data: validRows.map((r) => ({
          organizationId: appUser.organizationId,
          clientId: r.clientId,
          serviceTypeId: r.serviceTypeId,
          date: new Date(r.date),
          durationHours: r.durationHours,
          description: r.description,
          billableStatus: r.billableStatus,
          loggedByUserId: appUser.id,
          source: "CsvImport",
        })),
      });
    });
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
  }

  revalidatePath("/time-entries");
  return { ok: true, created: validRows.length };
}
