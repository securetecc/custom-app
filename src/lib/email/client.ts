import { Resend } from "resend";

export type SendResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string; skipped?: boolean };

export type SendArgs = {
  to: string | string[];
  subject: string;
  html: string;
  /** Sender for this message. Invoices use invoiceFromEmail; everything else supportEmail. */
  from: string;
  /** Display name shown in the inbox. Defaults to "SecureTECC Support". */
  fromName?: string;
  replyTo?: string;
  /**
   * Hard gate. Every caller must pass the org's emailDomainVerified value --
   * sending from an unverified domain gets the whole domain marked as spam,
   * which is expensive to undo, so nothing sends until onboarding flips this.
   */
  emailDomainVerified: boolean;
};

/**
 * Thin wrapper over Resend.
 *
 * Never throws: a failed notification must not take down the action that
 * triggered it (a ticket submission or an invoice send is the real work; the
 * email is a side effect). Callers surface the returned error as a warning.
 */
export async function sendEmail(args: SendArgs): Promise<SendResult> {
  if (!args.emailDomainVerified) {
    return {
      ok: false,
      skipped: true,
      error: "Email domain is not verified for this organization — nothing was sent.",
    };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, skipped: true, error: "RESEND_API_KEY is not configured." };
  }

  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      // Display name, so inboxes show "SecureTECC Support" rather than the
      // bare "noreply" local-part. Only added when the caller passed a plain
      // address -- a from that already carries a name is left alone.
      from: args.from.includes("<") ? args.from : `${args.fromName ?? "SecureTECC Support"} <${args.from}>`,
      to: args.to,
      subject: args.subject,
      html: args.html,
      ...(args.replyTo ? { replyTo: args.replyTo } : {}),
    });

    if (error) return { ok: false, error: error.message };
    return { ok: true, id: data?.id ?? null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Email send failed." };
  }
}
