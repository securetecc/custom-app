import { z } from "zod";

// Same convention as client.ts: no .transform()/.default() on fields used by a
// zodResolver-backed form, since that makes the resolver's input type diverge
// from its output type and breaks useForm<T>'s single-type assumption.
// Defaults come from useForm's defaultValues; normalization happens in the
// server action.
export const ADDON_ITEM_TYPES = ["DMARC", "MonitoringSeat", "RemoteMonitoring", "Other"] as const;

export const ADDON_ITEM_TYPE_LABELS: Record<(typeof ADDON_ITEM_TYPES)[number], string> = {
  DMARC: "DMARC",
  MonitoringSeat: "Monitoring Seat",
  RemoteMonitoring: "Remote Monitoring",
  Other: "Other",
};

export const recurringChargeFormSchema = z.object({
  description: z.string().min(1, "Description is required"),
  amount: z
    .union([z.number(), z.nan()])
    .refine((v) => !Number.isNaN(v) && v > 0, "Enter an amount greater than zero"),
  billingFrequency: z.enum(["Monthly", "Annual"]),
  activeStatus: z.boolean(),
  // Both optional: a plain retainer-style charge never needs to classify
  // itself. itemType only ever pre-fills the amount field in the UI; it's
  // never read by billing logic.
  itemType: z.enum(ADDON_ITEM_TYPES).nullable(),
  authorizedBy: z.string().min(1, "Enter who authorized this charge"),
});

export type RecurringChargeFormValues = z.infer<typeof recurringChargeFormSchema>;
