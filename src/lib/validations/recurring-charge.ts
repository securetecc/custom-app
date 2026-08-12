import { z } from "zod";

// Same convention as client.ts: no .transform()/.default() on fields used by a
// zodResolver-backed form, since that makes the resolver's input type diverge
// from its output type and breaks useForm<T>'s single-type assumption.
// Defaults come from useForm's defaultValues; normalization happens in the
// server action.
export const recurringChargeFormSchema = z.object({
  description: z.string().min(1, "Description is required"),
  amount: z
    .union([z.number(), z.nan()])
    .refine((v) => !Number.isNaN(v) && v > 0, "Enter an amount greater than zero"),
  billingFrequency: z.enum(["Monthly", "Annual"]),
  activeStatus: z.boolean(),
});

export type RecurringChargeFormValues = z.infer<typeof recurringChargeFormSchema>;
