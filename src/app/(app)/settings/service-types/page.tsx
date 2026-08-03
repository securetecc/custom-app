import { requireAdmin } from "@/lib/auth";
import { withRLS } from "@/lib/db/rls";
import { getCurrentAuthUserId } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ServiceTypeDialog } from "@/components/app/service-type-dialog";
import { DeleteServiceTypeButton } from "@/components/app/delete-service-type-button";
import { Plus, Pencil } from "lucide-react";

export default async function ServiceTypesPage() {
  await requireAdmin();
  const authUserId = await getCurrentAuthUserId();

  const serviceTypes = await withRLS(authUserId, (tx) =>
    tx.serviceType.findMany({ orderBy: { code: "asc" } }),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Service types</h1>
          <p className="text-muted-foreground">
            Billing minimums and rate overrides used for time entries and the AI parser.
          </p>
        </div>
        <ServiceTypeDialog
          trigger={
            <Button>
              <Plus className="mr-1 h-4 w-4" /> New service type
            </Button>
          }
        />
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Billing minimum</TableHead>
              <TableHead>Rate override</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {serviceTypes.map((st) => (
              <TableRow key={st.id}>
                <TableCell className="font-mono font-medium">{st.code}</TableCell>
                <TableCell>{st.label}</TableCell>
                <TableCell>{st.billingMinimumHours.toString()} hr</TableCell>
                <TableCell>
                  {st.rateOverride ? `$${st.rateOverride.toString()}/hr` : "Client's standard rate"}
                </TableCell>
                <TableCell className="flex justify-end gap-1">
                  <ServiceTypeDialog
                    serviceTypeId={st.id}
                    defaultValues={{
                      code: st.code,
                      label: st.label,
                      billingMinimumHours: Number(st.billingMinimumHours),
                      rateOverride: st.rateOverride ? Number(st.rateOverride) : undefined,
                    }}
                    trigger={
                      <Button variant="ghost" size="icon-sm">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    }
                  />
                  <DeleteServiceTypeButton id={st.id} code={st.code} />
                </TableCell>
              </TableRow>
            ))}
            {serviceTypes.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  No service types yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
