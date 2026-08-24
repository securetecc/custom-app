import { NextResponse } from "next/server";
import { isAuthorizedCronRequest, unauthorizedResponse } from "@/lib/cron/auth";
import { shouldRunNow, skippedResponse, type Schedule } from "@/lib/cron/pacific";
import { sendDailyReminders } from "@/lib/email/digests";

/**
 * Intended schedule: 7pm Pacific, weekdays.
 *
 * vercel.json fires this at BOTH candidate UTC hours (the PST and PDT
 * offsets); the gate below runs it on whichever one is actually the right
 * Pacific local time and no-ops on the other, so it never drifts at DST.
 */
const SCHEDULE: Schedule = { hour: 19, weekdays: [1, 2, 3, 4, 5] };

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) return unauthorizedResponse();
  if (!shouldRunNow(SCHEDULE)) return NextResponse.json(skippedResponse(SCHEDULE));

  const results = await sendDailyReminders();
  return NextResponse.json({ ok: true, results });
}
