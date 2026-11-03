import { z } from "zod";

const baseServiceTypeSchema = z.object({
  code: z
    .string()
    .min(1, "Code is required")
    .max(10, "Keep it short (e.g. R-S)")
    .regex(/^[A-Za-z0-9-]+$/, "Letters, numbers, and hyphens only"),
  label: z.string().min(1, "Label is required"),
  billingMinimumHours: z.number().min(0, "Must be zero or more"),
  rateOverride: z.union([z.number(), z.nan()]).optional(),
  /// A rate for this type agreed for LATER -- on-site going to $150 on
  /// 1 Jan 2027. Decided by the date of the work, not today's.
  scheduledRate: z.union([z.number(), z.nan()]).optional(),
  scheduledRateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")
    .nullable(),
  /// What SecureTECC pays out per hour on this type -- the subcontractor's or
  /// partner's share. Blank means nothing is paid out. Feeds the bonus.
  payoutRate: z.union([z.number(), z.nan()]).optional(),
  /// The same share as a percentage of what the client was billed, for a cut
  /// rather than a fixed figure. Follows the rate when the rate changes.
  payoutPercent: z
    .union([
      z.number().min(0, "Must be zero or more").max(100, "A share cannot exceed 100%"),
      z.nan(),
    ])
    .optional(),
  /// Whether a BBZ-performed hour of this type earns BBZ its commission.
  commissionEligible: z.boolean(),
});

// A share is one thing or the other. Holding both would leave the report
// quietly preferring one and the settings page showing the other.
export const serviceTypeFormSchema = baseServiceTypeSchema.refine(
  (v) =>
    !(
      v.payoutRate !== undefined &&
      !Number.isNaN(v.payoutRate) &&
      v.payoutPercent !== undefined &&
      !Number.isNaN(v.payoutPercent)
    ),
  {
    message: "Give the payout as a rate or as a percentage, not both.",
    path: ["payoutPercent"],
  },
);

export type ServiceTypeFormValues = z.infer<typeof serviceTypeFormSchema>;
