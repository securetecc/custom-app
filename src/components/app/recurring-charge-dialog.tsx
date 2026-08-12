"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  recurringChargeFormSchema,
  type RecurringChargeFormValues,
} from "@/lib/validations/recurring-charge";
import {
  createRecurringCharge,
  updateRecurringCharge,
} from "@/app/(app)/clients/recurring-charge-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const FREQUENCY_LABELS: Record<string, string> = {
  Monthly: "Monthly",
  Annual: "Annual (January)",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active — include on new invoices",
  inactive: "Inactive — stop billing",
};

export function RecurringChargeDialog({
  clientId,
  recurringChargeId,
  defaultValues,
  trigger,
}: {
  clientId: string;
  recurringChargeId?: string;
  defaultValues?: Partial<RecurringChargeFormValues>;
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
  } = useForm<RecurringChargeFormValues>({
    resolver: zodResolver(recurringChargeFormSchema),
    defaultValues: {
      description: "",
      amount: 0,
      billingFrequency: "Monthly",
      activeStatus: true,
      ...defaultValues,
    },
  });

  const billingFrequency = watch("billingFrequency");
  const activeStatus = watch("activeStatus");

  async function onSubmit(values: RecurringChargeFormValues) {
    setSubmitting(true);
    const result = recurringChargeId
      ? await updateRecurringCharge(recurringChargeId, clientId, values)
      : await createRecurringCharge(clientId, values);
    setSubmitting(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(recurringChargeId ? "Recurring charge updated" : "Recurring charge added");
    setOpen(false);
    if (!recurringChargeId) reset();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogHeader>
            <DialogTitle>
              {recurringChargeId ? "Edit recurring charge" : "New recurring charge"}
            </DialogTitle>
            <DialogDescription>
              Billed every period this client is invoiced. Monthly charges apply to every invoice;
              Annual charges are only pulled in for a January billing period.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                placeholder="Managed Antivirus — 24 endpoints"
                {...register("description")}
              />
              {errors.description && (
                <p className="text-xs text-destructive">{errors.description.message}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="amount">Amount ($)</Label>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  {...register("amount", { valueAsNumber: true })}
                />
                {errors.amount && (
                  <p className="text-xs text-destructive">{errors.amount.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="billingFrequency">Frequency</Label>
                <Select
                  value={billingFrequency}
                  onValueChange={(v) =>
                    setValue("billingFrequency", (v ?? "Monthly") as "Monthly" | "Annual")
                  }
                >
                  <SelectTrigger id="billingFrequency">
                    {/* base-ui renders the raw value unless given this mapper */}
                    <SelectValue>{(value) => FREQUENCY_LABELS[value as string]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="activeStatus">Status</Label>
              <Select
                value={activeStatus ? "active" : "inactive"}
                onValueChange={(v) => setValue("activeStatus", (v ?? "active") === "active")}
              >
                <SelectTrigger id="activeStatus">
                  <SelectValue>{(value) => STATUS_LABELS[value as string]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
