"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  timeEntryFormSchema,
  type TimeEntryFormValues,
  BILLABLE_STATUS_LABELS,
} from "@/lib/validations/time-entry";
import { createTimeEntry } from "@/app/(app)/time-entries/actions";
import { parseTimeEntryVoiceNote } from "@/app/(app)/time-entries/ai-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Sparkles } from "lucide-react";

type ClientOption = { id: string; name: string; shortName: string };
type ServiceTypeOption = {
  id: string;
  code: string;
  label: string;
  billingMinimumHours: number;
  rateOverride: number | null;
};

export function AiTimeEntryDialog({
  clients,
  serviceTypes,
  trigger,
}: {
  clients: ClientOption[];
  serviceTypes: ServiceTypeOption[];
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"input" | "review">("input");
  const [rawInput, setRawInput] = useState("");
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<TimeEntryFormValues>({
    resolver: zodResolver(timeEntryFormSchema),
    defaultValues: {
      clientId: "",
      serviceTypeId: "",
      date: new Date().toISOString().slice(0, 10),
      durationHours: 1,
      description: "",
      billableStatus: "Billable",
    },
  });

  function resetAll() {
    setStep("input");
    setRawInput("");
    setWarning(null);
    reset();
  }

  async function handleParse() {
    setParsing(true);
    const result = await parseTimeEntryVoiceNote(rawInput);
    setParsing(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    if (result.values.clientId) setValue("clientId", result.values.clientId);
    if (result.values.serviceTypeId) setValue("serviceTypeId", result.values.serviceTypeId);
    if (result.values.date) setValue("date", result.values.date);
    if (result.values.durationHours !== undefined)
      setValue("durationHours", result.values.durationHours);
    if (result.values.description !== undefined)
      setValue("description", result.values.description);
    if (result.values.billableStatus) setValue("billableStatus", result.values.billableStatus);

    setWarning(result.warning ?? null);
    setStep("review");
  }

  async function onSubmit(values: TimeEntryFormValues) {
    setSubmitting(true);
    const result = await createTimeEntry(values, rawInput);
    setSubmitting(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success("Time entry logged");
    setOpen(false);
    resetAll();
  }

  const clientId = watch("clientId");
  const serviceTypeId = watch("serviceTypeId");
  const billableStatus = watch("billableStatus");
  const selectedServiceType = serviceTypes.find((st) => st.id === serviceTypeId);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) resetAll();
      }}
    >
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent className="sm:max-w-lg">
        {step === "input" ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-accent-foreground" /> AI-assisted time entry
              </DialogTitle>
              <DialogDescription>
                Describe the work in plain language. You&apos;ll review the parsed fields before
                anything is saved.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Textarea
                rows={4}
                placeholder="e.g. Worked 2 hours on Daryl's network connection issues, billable"
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={handleParse} disabled={parsing || !rawInput.trim()}>
                {parsing ? "Parsing..." : "Parse"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)}>
            <DialogHeader>
              <DialogTitle>Review parsed entry</DialogTitle>
              <DialogDescription>
                {warning ?? "Confirm the fields below, then save."}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Client</Label>
                  <Select value={clientId} onValueChange={(v) => setValue("clientId", v ?? "")}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select client">
                        {(value) => clients.find((c) => c.id === value)?.name ?? "Select client"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {clients.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.clientId && (
                    <p className="text-xs text-destructive">{errors.clientId.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ai-date">Date</Label>
                  <Input id="ai-date" type="date" {...register("date")} />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Service type</Label>
                <Select
                  value={serviceTypeId}
                  onValueChange={(v) => setValue("serviceTypeId", v ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select service type">
                      {(value) => {
                        const st = serviceTypes.find((s) => s.id === value);
                        return st ? `${st.code} — ${st.label}` : "Select service type";
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {serviceTypes.map((st) => (
                      <SelectItem key={st.id} value={st.id}>
                        {st.code} — {st.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.serviceTypeId && (
                  <p className="text-xs text-destructive">{errors.serviceTypeId.message}</p>
                )}
                {selectedServiceType && (
                  <p className="text-xs text-muted-foreground">
                    {selectedServiceType.billingMinimumHours}hr minimum
                    {selectedServiceType.rateOverride
                      ? ` · billed at $${selectedServiceType.rateOverride}/hr`
                      : " · billed at client's standard rate"}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="ai-durationHours">Hours</Label>
                  <Input
                    id="ai-durationHours"
                    type="number"
                    step="0.25"
                    {...register("durationHours", { valueAsNumber: true })}
                  />
                  {errors.durationHours && (
                    <p className="text-xs text-destructive">{errors.durationHours.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Billable status</Label>
                  <Select
                    value={billableStatus}
                    onValueChange={(v) =>
                      setValue("billableStatus", v as TimeEntryFormValues["billableStatus"])
                    }
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {(value) => BILLABLE_STATUS_LABELS[value as TimeEntryFormValues["billableStatus"]]}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(BILLABLE_STATUS_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai-description">Description</Label>
                <Textarea id="ai-description" rows={3} {...register("description")} />
                {errors.description && (
                  <p className="text-xs text-destructive">{errors.description.message}</p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setStep("input")}>
                Back
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving..." : "Save entry"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
