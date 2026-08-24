import { PenLine } from "lucide-react";
import { requireOrgContext } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Placeholder for the HTML email-signature generator.
 *
 * A real page rather than a disabled nav link: a link that goes nowhere reads
 * as broken, whereas a page that says what's coming reads as planned. It
 * still goes through requireOrgContext so it's behind the same auth gate as
 * everything else in the app shell.
 */
export default async function SignaturePage() {
  const { appUser } = await requireOrgContext();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Signature</h1>
        <p className="text-muted-foreground">
          HTML email signature generator for {appUser.organization.name}.
        </p>
      </div>

      <Card>
        <CardHeader className="flex-row items-center gap-3 space-y-0">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/15">
            <PenLine className="h-5 w-5 text-accent" />
          </span>
          <div>
            <CardTitle className="text-base">Coming soon</CardTitle>
            <CardDescription>
              Generate branded HTML signatures for the team, ready to paste into Gmail.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This will build a signature from each staff member&apos;s name, title and contact
            details, using the branding already configured in Settings → Organization — the same
            logo and colours the invoice letterhead uses.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
