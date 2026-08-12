import { NextResponse } from "next/server";
import { isAuthorizedCronRequest, unauthorizedResponse } from "@/lib/cron/auth";
import { sendWeeklyTicketDigests } from "@/lib/email/digests";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) return unauthorizedResponse();

  const results = await sendWeeklyTicketDigests();
  return NextResponse.json({ ok: true, results });
}
