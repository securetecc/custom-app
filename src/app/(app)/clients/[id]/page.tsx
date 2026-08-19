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
import { Pencil, Plus } from "lucide-react";

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { data: client } = await requireOrgContext((tx) =>
    tx.client.findUnique({
      where: { id },
      include: {
        recurringCharges: {
          orderBy: [{ billingFrequency: "asc" }, { description: "asc" }],
        },
      },
    }),
  );

  if (!client) notFound();

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
              trigger={
                <Button>
                  <Plus className="mr-1 h-4 w-4" /> New charge
                </Button>
              }
            />
          </div>

          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Frequency</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {client.recurringCharges.map((charge) => (
                  <TableRow key={charge.id}>
                    <TableCell className="font-medium">{charge.description}</TableCell>
                    <TableCell>
                      {charge.billingFrequency === "Annual" ? "Annual (January)" : "Monthly"}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(Number(charge.amount))}
                    </TableCell>
                    <TableCell>
                      <Badge variant={charge.activeStatus ? "default" : "secondary"}>
                        {charge.activeStatus ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <RecurringChargeDialog
                          clientId={client.id}
                          recurringChargeId={charge.id}
                          defaultValues={{
                            description: charge.description,
                            amount: Number(charge.amount),
                            billingFrequency: charge.billingFrequency,
                            activeStatus: charge.activeStatus,
                          }}
                          trigger={
                            <Button variant="ghost" size="icon" aria-label="Edit charge">
                              <Pencil className="h-4 w-4" />
                            </Button>
                          }
                        />
                        <DeleteRecurringChargeButton id={charge.id} clientId={client.id} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {client.recurringCharges.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      No recurring charges for this client yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
