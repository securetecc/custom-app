import { NextResponse } from "next/server";
import { isAuthorizedCronRequest, unauthorizedResponse } from "@/lib/cron/auth";
import { autoCloseResolvedTickets } from "@/lib/tickets/auto-close";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) return unauthorizedResponse();

  const result = await autoCloseResolvedTickets();
  return NextResponse.json({ ok: true, ...result });
}
