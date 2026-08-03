import { requireAppUser } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardPage() {
  const appUser = await requireAppUser();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back, {appUser.name.split(" ")[0]}</h1>
        <p className="text-muted-foreground">Here&apos;s what&apos;s happening at {appUser.organization.name}.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Open tickets</CardDescription>
            <CardTitle className="text-3xl">—</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Coming in Phase 4</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Unbilled hours</CardDescription>
            <CardTitle className="text-3xl">—</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Coming in Phase 3</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Active clients</CardDescription>
            <CardTitle className="text-3xl">—</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">See Clients</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Draft invoices</CardDescription>
            <CardTitle className="text-3xl">—</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Coming in Phase 3</CardContent>
        </Card>
      </div>
    </div>
  );
}
