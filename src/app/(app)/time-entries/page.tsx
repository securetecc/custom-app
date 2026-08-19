import Link from "next/link";
import { requireOrgContext } from "@/lib/auth";
import { withRLS } from "@/lib/db/rls";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TimeEntryDialog } from "@/components/app/time-entry-dialog";
import { DeleteTimeEntryButton } from "@/components/app/delete-time-entry-button";
import { AiTimeEntryDialog } from "@/components/app/ai-time-entry-dialog";
import { BILLABLE_STATUS_LABELS } from "@/lib/validations/time-entry";
import { Plus, Pencil, Sparkles, Mic } from "lucide-react";

export default async function TimeEntriesPage() {
  const { authUserId } = await requireOrgContext();

  const [entries, clients, serviceTypes] = await withRLS(authUserId, (tx) =>
    Promise.all([
      tx.timeEntry.findMany({
        orderBy: { date: "desc" },
        take: 100,
        include: { client: true, serviceType: true, loggedByUser: true },
      }),
      tx.client.findMany({ where: { activeStatus: true }, orderBy: { name: "asc" } }),
      tx.serviceType.findMany({ orderBy: { code: "asc" } }),
    ]),
  );

  const clientOptions = clients.map((c) => ({ id: c.id, name: c.name, shortName: c.shortName }));
  const serviceTypeOptions = serviceTypes.map((st) => ({
    id: st.id,
    code: st.code,
    label: st.label,
    billingMinimumHours: Number(st.billingMinimumHours),
    rateOverride: st.rateOverride ? Number(st.rateOverride) : null,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Time entries</h1>
          <p className="text-muted-foreground">Most recent 100 entries.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" render={<Link href="/voice-logger" />}>
            <Mic className="mr-1 h-4 w-4" /> Voice Logger
          </Button>
          <AiTimeEntryDialog
            clients={clientOptions}
            serviceTypes={serviceTypeOptions}
            trigger={
              <Button variant="outline">
                <Sparkles className="mr-1 h-4 w-4" /> AI entry
              </Button>
            }
          />
          <TimeEntryDialog
            clients={clientOptions}
            serviceTypes={serviceTypeOptions}
            trigger={
              <Button>
                <Plus className="mr-1 h-4 w-4" /> Log time
              </Button>
            }
          />
        </div>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Hours</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Billed</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="whitespace-nowrap">
                  {entry.date.toISOString().slice(0, 10)}
                </TableCell>
                <TableCell>{entry.client.name}</TableCell>
                <TableCell className="font-mono text-xs">{entry.serviceType.code}</TableCell>
                <TableCell>{entry.durationHours.toString()}</TableCell>
                <TableCell className="max-w-xs truncate" title={entry.description}>
                  {entry.description}
                </TableCell>
                <TableCell>{BILLABLE_STATUS_LABELS[entry.billableStatus]}</TableCell>
                <TableCell>
                  <Badge variant={entry.invoiceId ? "secondary" : "outline"}>
                    {entry.invoiceId ? "Billed" : "Unbilled"}
                  </Badge>
                </TableCell>
                <TableCell className="flex justify-end gap-1">
                  <TimeEntryDialog
                    entryId={entry.id}
                    clients={clientOptions}
                    serviceTypes={serviceTypeOptions}
                    defaultValues={{
                      clientId: entry.clientId,
                      serviceTypeId: entry.serviceTypeId,
                      date: entry.date.toISOString().slice(0, 10),
                      durationHours: Number(entry.durationHours),
                      description: entry.description,
                      billableStatus: entry.billableStatus,
                    }}
                    trigger={
                      <Button variant="ghost" size="icon-sm">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    }
                  />
                  <DeleteTimeEntryButton id={entry.id} />
                </TableCell>
              </TableRow>
            ))}
            {entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  No time entries yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
