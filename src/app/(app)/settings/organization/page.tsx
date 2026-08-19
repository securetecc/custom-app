import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOrgContext } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  EmailDomainChecklist,
  OrganizationForm,
  StaffSection,
} from "@/components/app/organization-form";

export default async function OrganizationSettingsPage() {
  const {
    appUser,
    data: [organization, staff],
  } = await requireOrgContext(async (tx, user) => [
    await tx.organization.findUniqueOrThrow({ where: { id: user.organizationId } }),
    await tx.user.findMany({
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: "asc" },
    }),
  ]);
  if (appUser.role !== "admin") redirect("/dashboard?error=admin-only");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Organization</h1>
        <p className="text-muted-foreground">
          Branding, sender addresses, email verification, and staff access.
        </p>
      </div>

      <OrganizationForm
        defaultValues={{
          name: organization.name,
          supportEmail: organization.supportEmail,
          invoiceFromEmail: organization.invoiceFromEmail ?? "",
          phone: organization.phone ?? "",
          logoUrl: organization.logoUrl ?? "",
          brandColorPrimary: organization.brandColorPrimary,
          brandColorAccent: organization.brandColorAccent,
        }}
      />

      <EmailDomainChecklist
        verified={organization.emailDomainVerified}
        supportEmail={organization.supportEmail}
        invoiceFromEmail={organization.invoiceFromEmail}
      />

      <StaffSection staff={staff} currentUserId={appUser.id} />

      <div>
        <Button variant="ghost" render={<Link href="/settings" />}>
          ← Back to settings
        </Button>
      </div>
    </div>
  );
}
