/**
 * Which Google scopes the service account can actually use right now.
 *
 * Domain-wide delegation is granted in the Workspace admin console, not in
 * this repo, so the only honest way to know whether a scope works is to ask
 * Google for a token and see. Run it before and after changing the grant.
 *
 *   npx tsx scripts/check-google-scopes.mts
 *
 * A refusal here is a setup step, not a fault: the app degrades to "not
 * connected" on every one of these rather than erroring at a user.
 */
import "dotenv/config";
import { getGoogleAccessToken, GoogleNotConfiguredError } from "../src/lib/google/auth";

const SCOPES = [
  { scope: "https://www.googleapis.com/auth/gmail.compose", used: "Invoice Gmail drafts" },
  { scope: "https://www.googleapis.com/auth/drive", used: "Archiving invoice PDFs to Drive" },
  { scope: "https://www.googleapis.com/auth/spreadsheets", used: "The Operations sheet mirror" },
  { scope: "https://www.googleapis.com/auth/calendar.readonly", used: "Today and Calendar" },
];

console.log(`Service account: ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? "(not configured)"}`);
console.log(`Impersonating:   ${process.env.GOOGLE_IMPERSONATED_USER ?? "(not configured)"}\n`);

let missing = 0;
for (const { scope, used } of SCOPES) {
  let status: string;
  try {
    await getGoogleAccessToken(scope);
    status = "GRANTED";
  } catch (err) {
    missing++;
    status =
      err instanceof GoogleNotConfiguredError
        ? "NOT CONFIGURED"
        : "REFUSED — not in the domain-wide delegation grant";
  }
  console.log(`${status.padEnd(46)} ${scope}`);
  console.log(`${"".padEnd(46)} ${used}\n`);
}

if (missing > 0) {
  console.log(
    "To grant: Workspace admin → Security → Access and data control →\n" +
      "API controls → Domain-wide delegation → edit the existing client ID.\n\n" +
      "Paste the WHOLE list, not just the new one — the field replaces what is\n" +
      "there rather than adding to it, and dropping a scope silently breaks the\n" +
      "feature that used it:\n\n" +
      SCOPES.map((s) => s.scope).join(",") +
      "\n",
  );
} else {
  console.log("Every scope the app uses is granted.");
}
