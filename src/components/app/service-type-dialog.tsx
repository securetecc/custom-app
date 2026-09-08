"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  serviceTypeFormSchema,
  type ServiceTypeFormValues,
} from "@/lib/validations/service-type";
import { createServiceType, updateServiceType } from "@/app/(app)/settings/service-types/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function ServiceTypeDialog({
  serviceTypeId,
  defaultValues,
  trigger,
}: {
  serviceTypeId?: string;
  defaultValues?: Partial<ServiceTypeFormValues>;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ServiceTypeFormValues>({
    resolver: zodResolver(serviceTypeFormSchema),
    defaultValues: {
      code: "",
      label: "",
      billingMinimumHours: 0.25,
      rateOverride: undefined,
      payoutRate: undefined,
      commissionEligible: false,
      ...defaultValues,
    },
  });

  const commissionEligible = watch("commissionEligible");

  async function onSubmit(values: ServiceTypeFormValues) {
    setSubmitting(true);
    const result = serviceTypeId
      ? await updateServiceType(serviceTypeId, values)
      : await createServiceType(values);
    setSubmitting(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(serviceTypeId ? "Service type updated" : "Service type created");
    setOpen(false);
    if (!serviceTypeId) reset();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogHeader>
            <DialogTitle>{serviceTypeId ? "Edit service type" : "New service type"}</DialogTitle>
            <DialogDescription>
              Used to tag time entries and set billing minimums. The code is what the AI parser
              matches against, so keep it short and stable.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="code">Code</Label>
                <Input id="code" placeholder="R-S" {...register("code")} />
                {errors.code && <p className="text-xs text-destructive">{errors.code.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="label">Label</Label>
                <Input id="label" placeholder="Remote Service" {...register("label")} />
                {errors.label && (
                  <p className="text-xs text-destructive">{errors.label.message}</p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="billingMinimumHours">Billing minimum (hrs)</Label>
                <Input
                  id="billingMinimumHours"
                  type="number"
                  step="0.25"
                  {...register("billingMinimumHours", { valueAsNumber: true })}
                />
                {errors.billingMinimumHours && (
                  <p className="text-xs text-destructive">{errors.billingMinimumHours.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="rateOverride">Rate override ($/hr)</Label>
                <Input
                  id="rateOverride"
                  type="number"
                  step="0.01"
                  placeholder="Uses client's standard rate"
                  {...register("rateOverride", { valueAsNumber: true })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="payoutRate">Payout rate ($/hr)</Label>
                <Input
                  id="payoutRate"
                  type="number"
                  step="0.01"
                  placeholder="Nothing paid out"
                  {...register("payoutRate", { valueAsNumber: true })}
                />
                <p className="text-xs text-muted-foreground">
                  What SecureTECC pays out per hour on this type — the subcontractor&apos;s or
                  partner&apos;s share. Only the remainder counts toward the performance bonus.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Commission</Label>
                <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3">
                  <Checkbox
                    checked={commissionEligible}
                    onCheckedChange={(v) => setValue("commissionEligible", v === true)}
                  />
                  <span className="text-xs text-muted-foreground">
                    A BBZ-performed hour of this type earns BBZ its commission. IT service lines
                    only — web and automation work is already paid hourly.
                  </span>
                </label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
