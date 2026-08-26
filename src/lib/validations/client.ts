import { z } from "zod";

export const clientFormSchema = z.object({
  name: z.string().min(1, "Company name is required"),
  shortName: z
    .string()
    .min(1, "Short name is required")
    .max(20, "Keep it short — this becomes part of the invoice number")
    .regex(/^[A-Za-z0-9-]+$/, "Letters, numbers, and hyphens only"),
  /// Whoever owns the business. Renamed from contactName -- it was standing in
  /// for two different people, and the one who signs the contract is rarely
  /// the one who pays the invoice.
  ownerName: z.string().optional().or(z.literal("")),
  /// Who billing correspondence is addressed to, when that isn't the owner.
  billingContactName: z.string().optional().or(z.literal("")),
  email: z.string().email("Enter a valid email").optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  address1: z.string().optional().or(z.literal("")),
  address2: z.string().optional().or(z.literal("")),
  cityStateZip: z.string().optional().or(z.literal("")),
  billingType: z.enum(["Hourly", "Retainer"]),
  // No transform here on purpose: a zod .transform() makes the resolver's
  // pre-validation (input) type diverge from its post-validation (output)
  // type, which breaks useForm<ClientFormValues>'s single-type assumption.
  // NaN (from an emptied number input) and undefined are normalized to null
  // where this value is actually used (see clients/actions.ts).
  billingRate: z.union([z.number(), z.nan()]).optional(),
  // No `.default()` here for the same reason billingRate has no transform:
  // it would make the resolver's input type optional while the output type
  // stays required, which useForm<ClientFormValues> can't reconcile. The
  // form component supplies the default via useForm's defaultValues instead.
  activeStatus: z.boolean(),
  notes: z.string().optional().or(z.literal("")),
});

export type ClientFormValues = z.infer<typeof clientFormSchema>;
