import { ChartLine } from "lucide-react";
import { requireAdminContext } from "@/lib/auth";
import { ComingSoon } from "@/components/app/coming-soon";

/** Planned: a plain-language read on securetecc.com traffic. */
export default async function AnalyticsPage() {
  await requireAdminContext();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-muted-foreground">Website traffic for securetecc.com.</p>
      </div>

      <ComingSoon
        icon={ChartLine}
        title="Coming soon"
        description="The handful of numbers worth knowing, pulled from Google Analytics."
        points={[
          "Visitors and page views over the last 30 days, against the previous 30.",
          "Which pages people actually land on, and which ones they leave from.",
          "Where the traffic comes from — search, direct, referral — so marketing effort can be aimed.",
          "Contact-form submissions as a conversion, tying visits to enquiries rather than reporting traffic in isolation.",
        ]}
        note="Needs a GA4 property ID and read access for the service account already set up for Drive and Gmail — the same credential, one extra scope, so there is nothing new to authorise beyond that."
      />
    </div>
  );
}
