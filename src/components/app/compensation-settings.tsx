"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import {
  replaceBonusBands,
  updateCompensationSettings,
} from "@/app/(app)/settings/compensation/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";

type BandDraft = { lowerExclusive: string; upperInclusive: string; ratePercent: string };

/**
 * The compensation figures, editable.
 *
 * They live in the database rather than in code because the schedule says
 * the thresholds get re-based whenever the rate card changes — and because a
 * subcontractor's or partner's rate moving should not need a deploy or an
 * amended agreement.
 */
export function CompensationSettings({
  retainerAmount,
  commissionPercent,
  bands,
}: {
  retainerAmount: number;
  commissionPercent: number;
  bands: { lowerExclusive: number; upperInclusive: number | null; ratePercent: number }[];
}) {
  const router = useRouter();
  const [retainer, setRetainer] = useState(String(retainerAmount));
  const [commission, setCommission] = useState(String(commissionPercent));
  const [savingSettings, setSavingSettings] = useState(false);

  const [drafts, setDrafts] = useState<BandDraft[]>(
    bands.map((b) => ({
      lowerExclusive: String(b.lowerExclusive),
      upperInclusive: b.upperInclusive === null ? "" : String(b.upperInclusive),
      ratePercent: String(b.ratePercent),
    })),
  );
  const [savingBands, setSavingBands] = useState(false);

  async function saveSettings() {
    setSavingSettings(true);
    const result = await updateCompensationSettings({
      retainerAmount: Number(retainer),
      commissionPercent: Number(commission),
    });
    setSavingSettings(false);
    if (!result.ok) return toast.error(result.error);
    toast.success("Saved");
    router.refresh();
  }

  async function saveBands() {
    setSavingBands(true);
    const result = await replaceBonusBands({
      bands: drafts.map((d) => ({
        lowerExclusive: Number(d.lowerExclusive),
        // Blank means "no ceiling", which is what the top band is.
        upperInclusive: d.upperInclusive.trim() === "" ? null : Number(d.upperInclusive),
        ratePercent: Number(d.ratePercent),
      })),
    });
    setSavingBands(false);
    if (!result.ok) return toast.error(result.error);
    toast.success("Escalator saved");
    router.refresh();
  }

  function update(index: number, field: keyof BandDraft, value: string) {
    setDrafts((current) =>
      current.map((d, i) => (i === index ? { ...d, [field]: value } : d)),
    );
  }

  return (
    <div className="space-y-6">
      <Card className="space-y-4 p-6">
        <div>
          <h2 className="font-medium">Retainer and commission</h2>
          <p className="text-sm text-muted-foreground">
            The monthly retainer, and BBZ&apos;s share of what a BBZ-performed IT hour billed for.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="retainer">Monthly retainer ($)</Label>
            <Input
              id="retainer"
              type="number"
              step="0.01"
              value={retainer}
              onChange={(e) => setRetainer(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="commission">Commission (%)</Label>
            <Input
              id="commission"
              type="number"
              step="0.01"
              value={commission}
              onChange={(e) => setCommission(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Which service types earn it is set per type in Settings → Service types.
            </p>
          </div>
        </div>
        <Button onClick={saveSettings} disabled={savingSettings}>
          {savingSettings ? "Saving…" : "Save"}
        </Button>
      </Card>

      <Card className="space-y-4 p-6">
        <div>
          <h2 className="font-medium">The escalator</h2>
          <p className="text-sm text-muted-foreground">
            Each band runs from just above its lower figure up to and including its upper one, and
            the rate applies to the whole qualifying base. Leave the last band&apos;s upper figure
            blank — that is the one with no ceiling. Bands must meet exactly: a gap would let a
            qualifying base fall into no band and pay nothing.
          </p>
        </div>

        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <span>Above</span>
            <span>Up to and including</span>
            <span>Rate %</span>
            <span className="w-9" />
          </div>
          {drafts.map((d, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
              <Input
                type="number"
                step="0.01"
                value={d.lowerExclusive}
                onChange={(e) => update(i, "lowerExclusive", e.target.value)}
                aria-label={`Band ${i + 1} lower figure`}
              />
              <Input
                type="number"
                step="0.01"
                placeholder="no ceiling"
                value={d.upperInclusive}
                onChange={(e) => update(i, "upperInclusive", e.target.value)}
                aria-label={`Band ${i + 1} upper figure`}
              />
              <Input
                type="number"
                step="0.01"
                value={d.ratePercent}
                onChange={(e) => update(i, "ratePercent", e.target.value)}
                aria-label={`Band ${i + 1} rate`}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove band ${i + 1}`}
                onClick={() => setDrafts((c) => c.filter((_, index) => index !== i))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() =>
              setDrafts((c) => [...c, { lowerExclusive: "", upperInclusive: "", ratePercent: "" }])
            }
          >
            <Plus className="mr-1 h-4 w-4" /> Add a band
          </Button>
          <Button onClick={saveBands} disabled={savingBands}>
            {savingBands ? "Saving…" : "Save escalator"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
