"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";

/**
 * Free-text search across the invoice list.
 *
 * In the URL rather than in React state, like the range filter: the search is
 * then shareable and survives a refresh, and the page stays a server component
 * that re-queries instead of shipping every invoice to the browser.
 *
 * Debounced, because it navigates on each change and a keystroke-per-request
 * would queue a dozen server round trips for one word.
 */
export function InvoiceSearch({ initial }: { initial: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(initial);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (value === initial) return;
    const id = setTimeout(() => {
      const q = new URLSearchParams(params.toString());
      if (value.trim()) q.set("q", value.trim());
      else q.delete("q");
      startTransition(() => router.replace(`${pathname}?${q.toString()}`, { scroll: false }));
    }, 300);
    return () => clearTimeout(id);
  }, [value, initial, params, pathname, router]);

  return (
    <Input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder="Search number, client, method, reference…"
      className="h-8 w-full sm:w-72"
      aria-label="Search invoices"
    />
  );
}
