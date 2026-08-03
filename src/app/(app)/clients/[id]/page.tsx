import { notFound } from "next/navigation";
import { requireOrgContext } from "@/lib/auth";
import { withRLS } from "@/lib/db/rls";
import { ClientForm } from "@/components/app/client-form";

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { authUserId } = await requireOrgContext();

  const client = await withRLS(authUserId, (tx) => tx.client.findUnique({ where: { id } }));

  if (!client) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
        <p className="text-muted-foreground">Edit client details.</p>
      </div>
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
    </div>
  );
}
