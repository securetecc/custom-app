/**
 * Can the platform read Google Analytics, and what does it see?
 *
 *   npx tsx scripts/check-analytics.mts
 *
 * GA access is granted by adding the service account as a user on the GA4
 * property -- not through domain-wide delegation -- so this authenticates as
 * the service account ITSELF rather than impersonating anyone. It finds the
 * property behind the site's measurement ID on its own, so nobody has to go
 * looking for the numeric property ID.
 */
import "dotenv/config";
import { createSign } from "node:crypto";

const SITE_MEASUREMENT_ID = "G-J3SR7M67B9";
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

async function serviceAccountToken(): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let key = process.env.GOOGLE_PRIVATE_KEY?.trim();
  if (!email || !key) throw new Error("Google service account is not configured.");
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1);
  key = key.replace(/\\n/g, "\n").replace(/\r\n/g, "\n");

  const b64 = (v: string | Buffer) =>
    Buffer.from(v).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64(JSON.stringify({ iss: email, scope: SCOPE, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const jwt = `${header}.${claims}.${b64(signer.sign(key))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const body = (await res.json()) as { access_token?: string; error_description?: string };
  if (!body.access_token) throw new Error(`Token refused: ${body.error_description ?? res.status}`);
  return body.access_token;
}

const token = await serviceAccountToken();
const get = async (url: string) => {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  return { ok: res.ok, status: res.status, body: (await res.json().catch(() => ({}))) as any };
};
const report = async (property: string, request: object) => {
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/${property}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  return { ok: res.ok, status: res.status, body: (await res.json().catch(() => ({}))) as any };
};
const disabled = (b: any) => /has not been used in project|is disabled|SERVICE_DISABLED/i.test(JSON.stringify(b?.error ?? ""));

// 1. Which properties can the service account see?
const summaries = await get("https://analyticsadmin.googleapis.com/v1beta/accountSummaries");
if (!summaries.ok) {
  console.log(disabled(summaries.body)
    ? "Analytics Admin API is NOT ENABLED on the Cloud project yet (or still propagating)."
    : `Admin API refused: ${summaries.status} ${summaries.body?.error?.message ?? ""}`);
  process.exit(1);
}
const properties: { account: string; name: string; id: string }[] = (summaries.body.accountSummaries ?? [])
  .flatMap((a: any) => (a.propertySummaries ?? []).map((p: any) => ({ account: a.displayName, name: p.displayName, id: p.property })));
console.log(`Properties visible to the service account: ${properties.length}`);
for (const p of properties) console.log(`  ${p.id}  ${p.name}  (account: ${p.account})`);
if (properties.length === 0) {
  console.log("\nNone yet. The service account needs adding as a Viewer on the GA4 property (it can take a few minutes).");
  process.exit(1);
}

// 2. Which of them is the website's? Matched on the measurement ID the site sends.
let site: { id: string; name: string; stream: string } | null = null;
for (const p of properties) {
  const streams = await get(`https://analyticsadmin.googleapis.com/v1beta/${p.id}/dataStreams`);
  for (const s of streams.body.dataStreams ?? []) {
    if (s.webStreamData?.measurementId === SITE_MEASUREMENT_ID) {
      site = { id: p.id, name: p.name, stream: `${s.displayName} — ${s.webStreamData.defaultUri}` };
    }
  }
}
if (!site) {
  console.log(`\nNo visible property sends ${SITE_MEASUREMENT_ID}. The service account was added to a different property than the website's.`);
  process.exit(1);
}
console.log(`\nThe website's property: ${site.id} "${site.name}"\n  stream: ${site.stream}  (${SITE_MEASUREMENT_ID})`);

// 3. Real numbers. Last 28 days against the 28 before them.
const ranges = [
  { startDate: "28daysAgo", endDate: "yesterday", name: "current" },
  { startDate: "56daysAgo", endDate: "29daysAgo", name: "previous" },
];
const overview = await report(site.id, {
  dateRanges: ranges,
  metrics: [{ name: "activeUsers" }, { name: "sessions" }, { name: "screenPageViews" }, { name: "engagementRate" }],
});
if (!overview.ok) {
  console.log(disabled(overview.body)
    ? "\nAnalytics Data API is NOT ENABLED on the Cloud project yet (or still propagating)."
    : `\nData API refused: ${overview.status} ${overview.body?.error?.message ?? ""}`);
  process.exit(1);
}
const byRange: Record<string, string[]> = {};
for (const row of overview.body.rows ?? []) {
  const rangeName = row.dimensionValues?.[0]?.value ?? "current";
  byRange[rangeName] = row.metricValues.map((m: any) => m.value);
}
const labels = ["active users", "sessions", "page views", "engagement rate"];
console.log("\nLast 28 days vs the 28 before:");
labels.forEach((l, i) => {
  const cur = byRange.current?.[i] ?? "0", prev = byRange.previous?.[i] ?? "0";
  const fmt = (v: string) => (l === "engagement rate" ? `${(Number(v) * 100).toFixed(1)}%` : v);
  console.log(`  ${l.padEnd(16)} ${fmt(cur).padStart(8)}   (was ${fmt(prev)})`);
});

const top = async (title: string, dimension: string, metric: string, limit = 8) => {
  const r = await report(site!.id, {
    dateRanges: [ranges[0]],
    dimensions: [{ name: dimension }],
    metrics: [{ name: metric }],
    orderBys: [{ metric: { metricName: metric }, desc: true }],
    limit,
  });
  console.log(`\n${title}:`);
  if (!r.ok) return console.log(`  (refused: ${r.body?.error?.message ?? r.status})`);
  if (!(r.body.rows ?? []).length) return console.log("  (no data)");
  for (const row of r.body.rows) console.log(`  ${row.metricValues[0].value.padStart(6)}  ${row.dimensionValues[0].value.slice(0, 70)}`);
};
await top("Where visitors came from (sessions)", "sessionDefaultChannelGroup", "sessions");
await top("Pages people landed on (sessions)", "landingPagePlusQueryString", "sessions");
await top("Events recorded (count)", "eventName", "eventCount", 20);

// 4. Key events -- GA4's name for conversions.
const keyEvents = await report(site.id, {
  dateRanges: [ranges[0]],
  dimensions: [{ name: "eventName" }],
  metrics: [{ name: "keyEvents" }],
  orderBys: [{ metric: { metricName: "keyEvents" }, desc: true }],
  limit: 10,
});
const marked = (keyEvents.body.rows ?? []).filter((r: any) => Number(r.metricValues[0].value) > 0);
console.log(`\nKey events (conversions) with activity: ${marked.length ? "" : "none marked, or none triggered"}`);
for (const row of marked) console.log(`  ${row.metricValues[0].value.padStart(6)}  ${row.dimensionValues[0].value}`);
