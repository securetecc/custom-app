import { z } from "zod";

export const serviceTypeFormSchema = z.object({
  code: z
    .string()
    .min(1, "Code is required")
    .max(10, "Keep it short (e.g. R-S)")
    .regex(/^[A-Za-z0-9-]+$/, "Letters, numbers, and hyphens only"),
  label: z.string().min(1, "Label is required"),
  billingMinimumHours: z.number().min(0, "Must be zero or more"),
  rateOverride: z.union([z.number(), z.nan()]).optional(),
  /// What SecureTECC pays out per hour on this type -- the subcontractor's or
  /// partner's share. Blank means nothing is paid out. Feeds the bonus.
  payoutRate: z.union([z.number(), z.nan()]).optional(),
  /// Whether a BBZ-performed hour of this type earns BBZ its commission.
  commissionEligible: z.boolean(),
});

export type ServiceTypeFormValues = z.infer<typeof serviceTypeFormSchema>;
