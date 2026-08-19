import Link from "next/link";
import { requireOrgContext } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Plus } from "lucide-react";

export default async function ClientsPage() {
  const { data: clients } = await requireOrgContext((tx) =>
    tx.client.findMany({ orderBy: { name: "asc" } }),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="text-muted-foreground">{clients.length} total</p>
        </div>
        <Button render={<Link href="/clients/new" />}>
          <Plus className="mr-1 h-4 w-4" /> New client
        </Button>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Short name</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Billing</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((client) => (
              <TableRow key={client.id} className="cursor-pointer">
                <TableCell className="font-medium">
                  <Link href={`/clients/${client.id}`} className="hover:underline">
                    {client.name}
                  </Link>
                </TableCell>
                <TableCell>{client.shortName}</TableCell>
                <TableCell>{client.contactName || "—"}</TableCell>
                <TableCell>
                  {client.billingType}
                  {client.billingRate ? ` · $${client.billingRate.toString()}/hr` : ""}
                </TableCell>
                <TableCell>
                  <Badge variant={client.activeStatus ? "default" : "secondary"}>
                    {client.activeStatus ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
            {clients.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  No clients yet. Add your first one to get started.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
