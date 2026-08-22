"use client";

import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DATE_RANGE_PRESET_LABELS, DATE_RANGE_PRESETS, type DateRangePreset } from "@/lib/date-range";

export type EntryType = "time" | "expense";

const TYPE_LABELS: Record<EntryType, string> = {
  time: "Time entries",
  expense: "Reimbursable expenses",
};

type ClientOption = { id: string; name: string };

export function TimeEntryFilters({
  type,
  clientId,
  range,
  start,
  end,
  clients,
}: {
  type: EntryType;
  clientId: string; // "all" or a client id
  range: DateRangePreset;
  start: string; // yyyy-mm-dd, only meaningful when range === "custom"
  end: string;
  clients: ClientOption[];
}) {
  const router = useRouter();

  function navigate(next: Partial<{ type: EntryType; clientId: string; range: DateRangePreset; start: string; end: string }>) {
    const merged = { type, clientId, range, start, end, ...next };
    const params = new URLSearchParams();
    if (merged.type !== "time") params.set("type", merged.type);
    if (merged.clientId !== "all") params.set("client", merged.clientId);
    if (merged.range !== "all") params.set("range", merged.range);
    if (merged.range === "custom") {
      if (merged.start) params.set("start", merged.start);
      if (merged.end) params.set("end", merged.end);
    }
    const qs = params.toString();
    router.push(`/time-entries${qs ? `?${qs}` : ""}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Type</Label>
        <Select value={type} onValueChange={(v) => v && navigate({ type: v as EntryType })}>
          <SelectTrigger className="w-[190px]">
            <SelectValue>{(value) => TYPE_LABELS[value as EntryType]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Client</Label>
        <Select value={clientId} onValueChange={(v) => v && navigate({ clientId: v })}>
          <SelectTrigger className="w-[190px]">
            <SelectValue>
              {(value) =>
                value === "all" ? "All clients" : clients.find((c) => c.id === value)?.name ?? "All clients"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Period</Label>
        <Select value={range} onValueChange={(v) => v && navigate({ range: v as DateRangePreset })}>
          <SelectTrigger className="w-[160px]">
            <SelectValue>{(value) => DATE_RANGE_PRESET_LABELS[value as DateRangePreset]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {DATE_RANGE_PRESETS.map((value) => (
              <SelectItem key={value} value={value}>
                {DATE_RANGE_PRESET_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {range === "custom" && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Start date</Label>
            <Input
              type="date"
              value={start}
              onChange={(e) => navigate({ start: e.target.value })}
              className="w-[160px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">End date</Label>
            <Input
              type="date"
              value={end}
              onChange={(e) => navigate({ end: e.target.value })}
              className="w-[160px]"
            />
          </div>
        </>
      )}
    </div>
  );
}
