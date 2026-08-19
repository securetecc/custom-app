"use client";

import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const STATUS_OPTIONS = [
  { value: "Open", label: "Open" },
  { value: "New", label: "New" },
  { value: "InProgress", label: "In progress" },
  { value: "Resolved", label: "Resolved" },
  { value: "Closed", label: "Closed" },
  { value: "All", label: "All statuses" },
];

const URGENCY_OPTIONS = [
  { value: "All", label: "Any urgency" },
  { value: "Emergency", label: "Emergency" },
  { value: "Critical", label: "Critical" },
  { value: "High", label: "High" },
  { value: "Medium", label: "Medium" },
  { value: "Low", label: "Low" },
];

export function TicketFilters({ status, urgency }: { status: string; urgency: string }) {
  const router = useRouter();

  function navigate(nextStatus: string, nextUrgency: string) {
    router.push(`/tickets?status=${nextStatus}&urgency=${nextUrgency}`);
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Select value={status} onValueChange={(v) => v && navigate(v, urgency)}>
        <SelectTrigger className="w-[160px]">
          <SelectValue>
            {(value) => STATUS_OPTIONS.find((o) => o.value === value)?.label ?? "Status"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={urgency} onValueChange={(v) => v && navigate(status, v)}>
        <SelectTrigger className="w-[160px]">
          <SelectValue>
            {(value) => URGENCY_OPTIONS.find((o) => o.value === value)?.label ?? "Urgency"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {URGENCY_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
