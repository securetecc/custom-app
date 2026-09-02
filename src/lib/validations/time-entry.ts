import { z } from "zod";

export const timeEntryFormSchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  serviceTypeId: z.string().min(1, "Service type is required"),
  date: z.string().min(1, "Date is required"), // yyyy-mm-dd
  durationHours: z.number().positive("Must be greater than zero"),
  description: z.string().min(1, "Description is required"),
  billableStatus: z.enum(["Billable", "NonBillable", "Residual"]),
  /// This job's rate, overriding the service type and the client. Null means
  /// "use the usual one" -- see lib/billing/rates.ts.
  rateOverride: z.number().positive("Enter a rate above zero").nullable(),
  /// One-way travel time in minutes, for on-site work. The billing rule
  /// (one way or return) comes from the client's service area, not from here.
  travelMinutes: z.number().int().min(0).max(600).nullable(),
});

export type TimeEntryFormValues = z.infer<typeof timeEntryFormSchema>;

export const BILLABLE_STATUS_LABELS: Record<TimeEntryFormValues["billableStatus"], string> = {
  Billable: "Billable",
  NonBillable: "Non-Billable",
  Residual: "Residual",
};
