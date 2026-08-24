import { NextResponse } from "next/server";
import { isAuthorizedCronRequest, unauthorizedResponse } from "@/lib/cron/auth";
import { shouldRunNow, skippedResponse, type Schedule } from "@/lib/cron/pacific";
import { sendMonthlySummaries } from "@/lib/email/digests";

/**
 * Intended schedule: 7am Pacific, 1st of month.
 *
 * vercel.json fires this at BOTH candidate UTC hours (the PST and PDT
 * offsets); the gate below runs it on whichever one is actually the right
 * Pacific local time and no-ops on the other, so it never drifts at DST.
 */
const SCHEDULE: Schedule = { hour: 7, dayOfMonth: 1 };

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) return unauthorizedResponse();
  if (!shouldRunNow(SCHEDULE)) return NextResponse.json(skippedResponse(SCHEDULE));

  const results = await sendMonthlySummaries();
  return NextResponse.json({ ok: true, results });
}
