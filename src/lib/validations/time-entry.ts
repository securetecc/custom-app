import { z } from "zod";

export const timeEntryFormSchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  serviceTypeId: z.string().min(1, "Service type is required"),
  date: z.string().min(1, "Date is required"), // yyyy-mm-dd
  durationHours: z.number().positive("Must be greater than zero"),
  description: z.string().min(1, "Description is required"),
  billableStatus: z.enum(["Billable", "NonBillable", "Residual"]),
});

export type TimeEntryFormValues = z.infer<typeof timeEntryFormSchema>;

export const BILLABLE_STATUS_LABELS: Record<TimeEntryFormValues["billableStatus"], string> = {
  Billable: "Billable",
  NonBillable: "Non-Billable",
  Residual: "Residual",
};
