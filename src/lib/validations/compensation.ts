import { z } from "zod";

export const compensationSettingsSchema = z.object({
  retainerAmount: z
    .union([z.number(), z.nan()])
    .refine((v) => !Number.isNaN(v) && v >= 0, "Enter an amount"),
  commissionPercent: z
    .union([z.number(), z.nan()])
    .refine((v) => !Number.isNaN(v) && v >= 0 && v <= 100, "Enter a percentage between 0 and 100"),
  bountyPercent: z
    .union([z.number(), z.nan()])
    .refine((v) => !Number.isNaN(v) && v >= 0 && v <= 100, "Enter a percentage between 0 and 100"),
});

export type CompensationSettingsValues = z.infer<typeof compensationSettingsSchema>;

export const bonusBandsFormSchema = z.object({
  /// Which vintage of the ladder is being replaced, "YYYY-MM". Bands are
  /// dated sets so a closed month never restates -- editing must therefore
  /// name the set it means.
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}$/, "Use a month like 2027-01"),
  bands: z
    .array(
      z.object({
        lowerExclusive: z.number().min(0),
        /** Null on the last band only -- the top of the escalator. */
        upperInclusive: z.number().nullable(),
        ratePercent: z.number().min(0).max(100),
      }),
    )
    .min(1, "Keep at least one band"),
});

export type BonusBandsFormValues = z.infer<typeof bonusBandsFormSchema>;
