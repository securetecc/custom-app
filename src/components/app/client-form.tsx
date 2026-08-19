"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { clientFormSchema, type ClientFormValues } from "@/lib/validations/client";
import { createClientRecord, updateClientRecord } from "@/app/(app)/clients/actions";
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
import { Card, CardContent } from "@/components/ui/card";

export function ClientForm({
  clientId,
  defaultValues,
}: {
  clientId?: string;
  defaultValues?: Partial<ClientFormValues>;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ClientFormValues>({
    resolver: zodResolver(clientFormSchema),
    defaultValues: {
      name: "",
      shortName: "",
      contactName: "",
      email: "",
      phone: "",
      address1: "",
      address2: "",
      cityStateZip: "",
      billingType: "Hourly",
      billingRate: undefined,
      activeStatus: true,
      notes: "",
      ...defaultValues,
    },
  });

  async function onSubmit(values: ClientFormValues) {
    setSubmitting(true);
    const result = clientId
      ? await updateClientRecord(clientId, values)
      : await createClientRecord(values);
    setSubmitting(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(clientId ? "Client updated" : "Client created");
    router.push("/clients");
    router.refresh();
  }

  const billingType = watch("billingType");
  const activeStatus = watch("activeStatus");

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="name">Company name</Label>
            <Input id="name" {...register("name")} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="shortName">Short name</Label>
            <Input id="shortName" placeholder="e.g. ACME" {...register("shortName")} />
            {errors.shortName && (
              <p className="text-xs text-destructive">{errors.shortName.message}</p>
            )}
            <p className="text-xs text-muted-foreground">Used in invoice numbers (ACME-00001).</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="contactName">Contact name</Label>
            <Input id="contactName" {...register("contactName")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" {...register("email")} />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" {...register("phone")} />
          </div>
          <div />
          <div className="space-y-2">
            <Label htmlFor="address1">Address line 1</Label>
            <Input id="address1" {...register("address1")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="address2">Address line 2</Label>
            <Input id="address2" {...register("address2")} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="cityStateZip">City, State ZIP</Label>
            <Input id="cityStateZip" {...register("cityStateZip")} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="billingType">Billing type</Label>
            <Select
              value={billingType}
              onValueChange={(v) => setValue("billingType", v as ClientFormValues["billingType"])}
            >
              <SelectTrigger id="billingType">
                <SelectValue>
                  {(value) => (value === "Retainer" ? "Retainer" : "Hourly")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Hourly">Hourly</SelectItem>
                <SelectItem value="Retainer">Retainer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="billingRate">Billing rate ($/hr)</Label>
            <Input
              id="billingRate"
              type="number"
              step="0.01"
              {...register("billingRate", { valueAsNumber: true })}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="activeStatus">Status</Label>
            <Select
              value={activeStatus ? "active" : "inactive"}
              onValueChange={(v) => setValue("activeStatus", v === "active")}
            >
              <SelectTrigger id="activeStatus">
                <SelectValue>
                  {(value) => (value === "active" ? "Active" : "Inactive")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={4} {...register("notes")} />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.push("/clients")}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving..." : clientId ? "Save changes" : "Create client"}
        </Button>
      </div>
    </form>
  );
}
