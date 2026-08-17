import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, Wrench } from "lucide-react";

export default async function SettingsPage() {
  await requireAdmin();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Admin-only organization configuration.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/settings/organization">
          <Card className="transition-colors hover:border-accent">
            <CardHeader className="flex-row items-center gap-3 space-y-0">
              <Building2 className="h-5 w-5 text-muted-foreground" />
              <div>
                <CardTitle className="text-base">Organization</CardTitle>
                <CardDescription>Branding, email senders, staff access</CardDescription>
              </div>
            </CardHeader>
            <CardContent />
          </Card>
        </Link>

        <Link href="/settings/service-types">
          <Card className="transition-colors hover:border-accent">
            <CardHeader className="flex-row items-center gap-3 space-y-0">
              <Wrench className="h-5 w-5 text-muted-foreground" />
              <div>
                <CardTitle className="text-base">Service types</CardTitle>
                <CardDescription>Billing minimums and rate overrides</CardDescription>
              </div>
            </CardHeader>
            <CardContent />
          </Card>
        </Link>
      </div>
    </div>
  );
}
