import { requireOrgContext } from "@/lib/auth";
import { withRLS } from "@/lib/db/rls";
import { InvoiceGenerationFlow } from "@/components/app/invoice-generation-flow";

export default async function NewInvoicePage() {
  const { authUserId } = await requireOrgContext();

  const clients = await withRLS(authUserId, (tx) =>
    tx.client.findMany({
      where: { activeStatus: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Generate invoice</h1>
        <p className="text-muted-foreground">
          Pick a client and billing month, review what will be billed, then create a draft.
        </p>
      </div>
      <InvoiceGenerationFlow clients={clients} />
    </div>
  );
}
