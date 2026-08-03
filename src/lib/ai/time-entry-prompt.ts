/**
 * AI-assisted time-entry parsing prompt.
 *
 * This is a faithful port of the proven production prompt (see AGENTS.md
 * Appendix A) -- it went through multiple real iterations to fix an actual
 * misclassification bug: entries with no explicit keyword ("remote", "phone",
 * etc.) were silently coming through with no service type tag at all. The
 * "always classify, infer from context using these defaults" rules below are
 * that fix. Do not simplify this back down to "only tag if a keyword is
 * present" -- that's the exact regression this prompt exists to prevent.
 *
 * The only thing that changes per organization is the acronym/minimum/rate
 * table and the client alias list, both built dynamically from that org's
 * ServiceType and Client rows. The behavioral rules stay fixed and org-agnostic.
 */

export type ServiceTypeForPrompt = {
  code: string;
  label: string;
  billingMinimumHours: number;
  rateOverride: number | null;
};

export function buildTimeEntryPrompt({
  orgName,
  rawInput,
  clientShortNames,
  serviceTypes,
}: {
  orgName: string;
  rawInput: string;
  clientShortNames: string[];
  serviceTypes: ServiceTypeForPrompt[];
}): string {
  const serviceTypeTable = serviceTypes
    .map(
      (st) =>
        `- ${st.code} (${st.label}): minimum ${st.billingMinimumHours}hr${
          st.rateOverride ? `, rate override $${st.rateOverride}/hr` : ""
        }`,
    )
    .join("\n");

  return `You are a time tracking assistant for ${orgName}. Extract data from this voice note
and return ONLY a JSON object with no other text.

Voice note: "${rawInput}"

Known client aliases (use one of these exactly for clientShortName): ${clientShortNames.join(", ")}

SERVICE TYPE ACRONYMS, BILLING MINIMUMS, AND RATES:

${serviceTypeTable}

You MUST always classify the entry with exactly one of these acronyms — never leave
it untagged. Use explicit keywords when present (remote, phone call, email, on-site,
in person, low voltage, travel). When no keyword is stated, infer the most likely
service type from context using these defaults:

- Troubleshooting, fixing, checking, or configuring a computer, network, printer,
  account, or software issue with no mention of traveling to a location or being
  physically present = Remote Service — this is the default for most IT work unless
  another type is clearly indicated.
- A call or conversation with no video/screen-share mentioned = Phone Service.
- A hosted video call, Google Meet, Teams meeting, or Zoom = Remote Service.
- Explicit mention of driving to, visiting, or being physically at a client site =
  On-Site Service.
- Structured cabling, cameras, access control, or AV installation = Low Voltage.

Apply the matching service type's billing minimum: if the stated/calculated hours
are below that minimum, round UP to the minimum.

RATE OVERRIDE RULE: if the matched service type has a rate override (e.g. Low
Voltage's special higher rate), set the billingRate field to that override value.
For all other service types, omit the billingRate field (null).

In the description field, always prefix the work description with the matched
service type's code exactly like this format: "R-S — [description]" or
"L-V — [description]" etc. Every entry must have this prefix — there is no case
where it should be omitted.

IMPORTANT — CLEANING THE DESCRIPTION: Voice transcription often mishears words,
especially client names. The description should describe the WORK PERFORMED only —
do NOT include the client name in the description (it is already captured
separately in clientShortName), and do NOT repeat misheard/garbled phrases.
Rewrite the description in clear, professional language describing only the task
completed.

Return this exact JSON structure:
{"clientShortName":"alias","durationHours":1.0,"description":"work done","date":"today","billableStatus":"Billable","billingRate":null}

Rules:
- durationHours is a number (90 minutes = 1.5), after applying the billing minimum
- billableStatus is exactly Billable, Non-Billable, or Residual
- billingRate is the override value for rate-override service types, null otherwise
- description is under 100 characters, including the required prefix
- date is today unless specified. If yesterday, use the word yesterday. If a
  specific date, use YYYY-MM-DD format. Never return a timestamp or number.
- clientShortName must match one of the known client aliases
- Return ONLY the JSON, nothing else`;
}
