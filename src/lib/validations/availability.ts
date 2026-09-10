import { z } from "zod";

const wallTime = z.string().regex(/^\d{1,2}:\d{2}$/, "Use a time like 09:00");

export const availabilityBlockSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    /** Wall-clock times in the person's OWN zone -- see UserAvailability. */
    start: wallTime,
    end: wallTime,
    label: z.string().trim().max(40).nullable(),
  })
  .refine((v) => v.start !== v.end, {
    message: "A block needs a start and an end that differ",
    path: ["end"],
  });

export const availabilityFormSchema = z.object({
  userId: z.string().min(1),
  timeZone: z.string().min(1, "Choose a time zone"),
  jobTitle: z.string().trim().max(60).nullable(),
  /// Wall time in their own zone, or null. Never a working hour.
  offlineAfter: z
    .string()
    .regex(/^\d{1,2}:\d{2}$/, "Use a time like 23:00")
    .nullable(),
  availabilityNote: z.string().trim().max(120).nullable(),
  /** The whole week, replaced wholesale -- see the action for why. */
  blocks: z.array(availabilityBlockSchema).max(30, "That is a lot of blocks"),
});

export type AvailabilityFormValues = z.infer<typeof availabilityFormSchema>;
