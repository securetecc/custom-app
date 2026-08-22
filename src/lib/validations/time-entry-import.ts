import { z } from "zod";

/**
 * One parsed CSV row, matching migrate-from-sheets.mts's time-entries.csv
 * column set (clientShortName/serviceTypeCode rather than ids, since a CSV
 * can't know this org's internal uuids) minus the columns only the one-time
 * historical migration needs (invoiceNumber, loggedByEmail).
 */
export const importedTimeEntryRowSchema = z.object({
  clientshortname: z.string().min(1),
  date: z.string().min(1),
  durationhours: z.string().min(1),
  description: z.string().min(1),
  billablestatus: z.string().optional(),
  servicetypecode: z.string().min(1),
});

export type ImportedTimeEntryRow = z.infer<typeof importedTimeEntryRowSchema>;

/** One row after server-side validation/resolution -- what commitTimeEntryImport accepts back. */
export const resolvedImportRowSchema = z.object({
  clientId: z.string().min(1),
  serviceTypeId: z.string().min(1),
  date: z.string().min(1), // yyyy-mm-dd
  durationHours: z.number().positive(),
  description: z.string().min(1),
  billableStatus: z.enum(["Billable", "NonBillable", "Residual"]),
});

export type ResolvedImportRow = z.infer<typeof resolvedImportRowSchema>;

export const BILLABLE_STATUS_ALIASES: Record<string, ResolvedImportRow["billableStatus"]> = {
  billable: "Billable",
  "non-billable": "NonBillable",
  nonbillable: "NonBillable",
  residual: "Residual",
};
