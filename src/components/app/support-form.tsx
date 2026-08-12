"use client";

import { useState } from "react";
import Image from "next/image";
import { submitPublicTicket } from "@/app/support/actions";
import {
  ISSUE_TYPES,
  MAX_ATTACHMENTS,
  URGENCY_LABELS,
} from "@/lib/validations/ticket";

/**
 * Public support form. Styled to match the landing page / manage.securetecc.com
 * rather than the authenticated shell, since this is a client-facing surface
 * seen by people who never log in.
 *
 * Uses a plain FormData submission so file attachments go straight to the
 * server action without a separate upload round-trip.
 */
const FIELD =
  "w-full rounded-[10px] border border-[rgba(6,225,220,0.24)] bg-[rgba(6,225,220,0.05)] px-4 py-[13px] text-[15px] text-white outline-none transition-colors placeholder:text-[rgba(255,255,255,0.35)] focus:border-[#06E1DC]";
const LABEL =
  "mb-2 block text-xs font-bold uppercase tracking-[1.5px] text-[#06E1DC]";

export function SupportForm() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const result = await submitPublicTicket(new FormData(e.currentTarget));
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSubmitted(result.ticketNumber);
  }

  if (submitted) {
    return (
      <div className="rounded-[14px] border border-[rgba(6,225,220,0.24)] bg-[#071E37] p-8 text-center">
        <p className="mb-2 text-xs font-bold uppercase tracking-[2px] text-[#06E1DC]">
          Request received
        </p>
        <h2 className="mb-3 text-2xl font-bold">{submitted}</h2>
        <p className="text-[15px] leading-[1.6] text-[rgba(255,255,255,0.74)]">
          We&apos;ve logged your request and the team has been notified. Keep this number for
          reference — we&apos;ll follow up by email at the address you provided.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 text-left">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="clientCompanyName" className={LABEL}>
            Company
          </label>
          <input id="clientCompanyName" name="clientCompanyName" required className={FIELD} />
        </div>
        <div>
          <label htmlFor="contactName" className={LABEL}>
            Your name
          </label>
          <input id="contactName" name="contactName" required className={FIELD} />
        </div>
      </div>

      <div>
        <label htmlFor="contactEmail" className={LABEL}>
          Email
        </label>
        <input
          id="contactEmail"
          name="contactEmail"
          type="email"
          required
          className={FIELD}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="issueType" className={LABEL}>
            Issue type
          </label>
          <select id="issueType" name="issueType" required defaultValue="" className={FIELD}>
            <option value="" disabled>
              Select…
            </option>
            {ISSUE_TYPES.map((t) => (
              <option key={t} value={t} className="bg-[#071E37]">
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="urgency" className={LABEL}>
            Urgency
          </label>
          <select id="urgency" name="urgency" required defaultValue="Medium" className={FIELD}>
            {Object.entries(URGENCY_LABELS).map(([value, label]) => (
              <option key={value} value={value} className="bg-[#071E37]">
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="description" className={LABEL}>
          What&apos;s happening?
        </label>
        <textarea
          id="description"
          name="description"
          required
          rows={5}
          placeholder="Tell us what you're seeing, when it started, and who's affected."
          className={`${FIELD} resize-y`}
        />
      </div>

      <div>
        <label htmlFor="attachments" className={LABEL}>
          Attachments (optional)
        </label>
        <input
          id="attachments"
          name="attachments"
          type="file"
          multiple
          accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
          className={`${FIELD} file:mr-3 file:rounded-md file:border-0 file:bg-[#06E1DC] file:px-3 file:py-1 file:text-sm file:font-semibold file:text-[#071E37]`}
        />
        <p className="mt-2 text-xs text-[rgba(255,255,255,0.55)]">
          Screenshots help a lot. Up to {MAX_ATTACHMENTS} images or PDFs, 10MB each.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-[#ff8a8a]">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-[10px] bg-[#06E1DC] px-10 py-[15px] text-base font-bold tracking-[0.2px] text-[#071E37] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Submitting…" : "Submit request"}
      </button>
    </form>
  );
}

export function SupportHeader() {
  return (
    <header className="sticky top-0 z-10 border-b-2 border-[#06E1DC] bg-[#071E37] px-6 py-5 text-center">
      <Image
        src="/securetecc-logo.png"
        alt="SecureTECC"
        width={1080}
        height={264}
        priority
        className="mx-auto h-auto w-full max-w-[200px]"
      />
    </header>
  );
}
