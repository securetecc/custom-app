import type { LeadSource } from "@/generated/prisma/enums";

/**
 * Which answers to "How did you hear about us?" earn the bounty.
 *
 * The bounty pays BBZ for bringing a client in, so it pays where the client
 * arrived through work BBZ does -- the website, the Google Business Profile,
 * SEO, a campaign -- and not where Tony brought them in through his own
 * network. A returning client after a gap is not a new client and does not
 * pay either.
 *
 * A blank field pays nothing. That is the schedule's rule and it is
 * deliberate: after the fact neither side can prove where a client came from,
 * so a bounty resting on memory would cost more in goodwill than it is worth.
 */
export const QUALIFYING_LEAD_SOURCES: LeadSource[] = [
  "Website",
  "GoogleBusinessProfile",
  "SEO",
  "Campaign",
];

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  Website: "Website",
  GoogleBusinessProfile: "Google Business Profile",
  SEO: "SEO",
  Campaign: "Campaign",
  Referral: "Referral — Tony's network",
  ExistingClient: "Referred by an existing client",
  ReturningClient: "Returning after a gap",
  Other: "Other",
};

export function qualifiesForBounty(leadSource: LeadSource | null): boolean {
  return leadSource !== null && QUALIFYING_LEAD_SOURCES.includes(leadSource);
}
