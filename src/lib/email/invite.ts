import { prisma } from "@/lib/db/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, type SendResult } from "@/lib/email/client";
import { emailAppUrl } from "@/lib/email/app-url";
import { staffInviteEmail, type Branding } from "@/lib/email/templates";

/**
 * The welcome a new member of staff actually receives.
 *
 * The platform used to send nothing at all: an admin typed a password into
 * the new-user form and then had to pass it on by hand, which meant every
 * account started life with its password spoken aloud or sat in a chat log.
 *
 * This sends the invitation itself, carrying a single-use link that lets the
 * person set their own password. The link is minted by Supabase but NOT
 * delivered by it -- generateLink returns the URL without mailing it, so the
 * message goes out through the same branded sender as every other email the
 * platform sends, from the company's own domain.
 */

const ROLE_LABELS: Record<string, string> = {
  admin: "administrator",
  technician: "technician",
};

/**
 * A one-time link that signs the person in and lands them on the page where
 * they choose a password.
 *
 * "recovery" rather than "invite": an invite link is refused once the account
 * exists, and by this point it always does. Both arrive at the same place.
 */
export async function inviteLinks(email: string): Promise<{ setPasswordUrl: string; signInUrl: string }> {
  const signInUrl = emailAppUrl("/login");
  const supabase = createAdminClient();
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: emailAppUrl("/reset-password") },
  });

  // Without a link the invitation is still worth sending: the sign-in page's
  // own "Forgot your password?" gets them there, one step later.
  return {
    setPasswordUrl: error ? signInUrl : (data?.properties?.action_link ?? signInUrl),
    signInUrl,
  };
}

export async function sendStaffInvite(args: {
  email: string;
  name: string;
  role: string;
  organizationId: string;
}): Promise<SendResult> {
  const org = await prisma.organization.findUnique({ where: { id: args.organizationId } });
  if (!org) return { ok: false, error: "Organization not found." };

  const branding: Branding = {
    organizationName: org.name,
    primaryColor: org.brandColorPrimary,
    accentColor: org.brandColorAccent,
    logoUrl: org.logoUrl,
    phone: org.phone,
  };

  const { setPasswordUrl, signInUrl } = await inviteLinks(args.email);
  const email = staffInviteEmail(
    branding,
    { name: args.name, email: args.email, roleLabel: ROLE_LABELS[args.role] ?? "technician" },
    setPasswordUrl,
    signInUrl,
  );

  return sendEmail({
    to: args.email,
    from: org.notificationFromEmail ?? org.supportEmail,
    // A reply reaches support, who can answer "is this real?"
    replyTo: org.supportEmail,
    subject: email.subject,
    html: email.html,
    emailDomainVerified: org.emailDomainVerified,
  });
}
