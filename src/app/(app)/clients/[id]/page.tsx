import { notFound } from "next/navigation";
import { requireOrgContext } from "@/lib/auth";
import { ClientForm } from "@/components/app/client-form";
import { RecurringChargeDialog } from "@/components/app/recurring-charge-dialog";
import { DeleteRecurringChargeButton } from "@/components/app/delete-recurring-charge-button";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import { ADDON_ITEM_TYPE_LABELS } from "@/lib/validations/recurring-charge";
import { Pencil, Plus } from "lucide-react";

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const {
    data: [client, pricingRows],
  } = await requireOrgContext((tx, appUser) =>
    Promise.all([
      tx.client.findUnique({
        where: { id },
        include: {
          recurringCharges: {
            orderBy: [{ billingFrequency: "asc" }, { description: "asc" }],
          },
        },
      }),
      tx.addonPricing.findMany({ where: { organizationId: appUser.organizationId } }),
    ]),
  );

  if (!client) notFound();

  const addonPricing = Object.fromEntries(
    pricingRows.map((p) => [p.itemType, Number(p.defaultRate)]),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
        <p className="text-muted-foreground">Client details and recurring charges.</p>
      </div>

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="recurring">
            Recurring charges ({client.recurringCharges.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="pt-4">
          <ClientForm
            clientId={client.id}
            defaultValues={{
              name: client.name,
              shortName: client.shortName,
              contactName: client.contactName ?? "",
              email: client.email ?? "",
              phone: client.phone ?? "",
              address1: client.address1 ?? "",
              address2: client.address2 ?? "",
              cityStateZip: client.cityStateZip ?? "",
              billingType: client.billingType,
              billingRate: client.billingRate ? Number(client.billingRate) : undefined,
              activeStatus: client.activeStatus,
              notes: client.notes ?? "",
            }}
          />
        </TabsContent>

        <TabsContent value="recurring" className="space-y-4 pt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Pulled into invoices automatically. Annual charges only apply to a January period.
            </p>
            <RecurringChargeDialog
              clientId={client.id}
              addonPricing={addonPricing}
              trigger={
                <Button>
                  <Plus className="mr-1 h-4 w-4" /> New charge
                </Button>
              }
            />
          </div>

          {/* A list rather than a table: seven columns don't fit this
              column's width, and the result was a horizontal scrollbar on the
              one screen where you're looking at a single client's charges.
              Stacking the secondary details under the description keeps
              everything readable without sideways movement. */}
          <Card className="divide-y">
            {client.recurringCharges.map((charge) => (
              <div key={charge.id} className="flex items-start gap-3 p-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{charge.description}</span>
                    <Badge variant={charge.activeStatus ? "default" : "secondary"}>
                      {charge.activeStatus ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {charge.billingFrequency === "Annual" ? "Annual (January)" : "Monthly"}
                    {charge.itemType ? ` · ${ADDON_ITEM_TYPE_LABELS[charge.itemType]}` : ""}
                    {charge.reference ? ` · ${charge.reference}` : ""}
                    {charge.authorizedBy ? ` · authorized by ${charge.authorizedBy}` : ""}
                  </p>
                  {charge.notes && (
                    <p className="text-xs text-muted-foreground">{charge.notes}</p>
                  )}
                </div>

                <div className="shrink-0 text-right">
                  <p className="font-semibold tabular-nums">
                    {formatCurrency(Number(charge.amount))}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {charge.billingFrequency === "Annual" ? "per year" : "per month"}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <RecurringChargeDialog
                    clientId={client.id}
                    recurringChargeId={charge.id}
                    addonPricing={addonPricing}
                    defaultValues={{
                      description: charge.description,
                      amount: Number(charge.amount),
                      billingFrequency: charge.billingFrequency,
                      activeStatus: charge.activeStatus,
                      itemType: charge.itemType,
                      authorizedBy: charge.authorizedBy ?? "",
                      notes: charge.notes ?? "",
                    }}
                    trigger={
                      <Button variant="ghost" size="icon" aria-label="Edit charge">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    }
                  />
                  <DeleteRecurringChargeButton id={charge.id} clientId={client.id} />
                </div>
              </div>
            ))}
            {client.recurringCharges.length === 0 && (
              <p className="py-10 text-center text-muted-foreground">
                No recurring charges for this client yet.
              </p>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
