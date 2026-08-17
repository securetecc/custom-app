import { z } from "zod";

const HEX = /^#[0-9a-fA-F]{6}$/;

// Same convention as the other form schemas: no .transform()/.default() on
// fields a zodResolver-backed form owns.
export const organizationFormSchema = z.object({
  name: z.string().min(1, "Organization name is required"),
  supportEmail: z.string().email("Enter a valid email"),
  invoiceFromEmail: z.string().email("Enter a valid email").or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  logoUrl: z.string().url("Enter a valid URL").or(z.literal("")),
  brandColorPrimary: z.string().regex(HEX, "Use a hex colour like #071E37"),
  brandColorAccent: z.string().regex(HEX, "Use a hex colour like #06E1DC"),
});

export type OrganizationFormValues = z.infer<typeof organizationFormSchema>;

export const staffFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Enter a valid email"),
  role: z.enum(["admin", "technician"]),
  // Only used when creating; ignored on edit.
  password: z.string().min(10, "Use at least 10 characters").or(z.literal("")),
});

export type StaffFormValues = z.infer<typeof staffFormSchema>;
