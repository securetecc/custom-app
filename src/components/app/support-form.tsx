"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { submitPublicTicket } from "@/app/support/actions";
import {
  ISSUE_TYPES,
  MAX_ATTACHMENTS,
  URGENCY_LABELS,
  URGENCY_RESPONSE_TIMES,
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
  const [urgency, setUrgency] = useState("Medium");
  // Attachments are held in state rather than left on the native input: a
  // file input offers no way to drop one file from a selection, so picking
  // the wrong screenshot meant re-selecting the whole set.
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function addFiles(picked: FileList | null) {
    if (!picked?.length) return;
    setFiles((current) => {
      const next = [...current];
      for (const file of Array.from(picked)) {
        // Same name AND size is the closest thing to identity a File gives us.
        if (!next.some((f) => f.name === file.name && f.size === file.size)) next.push(file);
      }
      return next.slice(0, MAX_ATTACHMENTS);
    });
    // Clear the input so re-picking the same file still fires onChange.
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    // Built by hand rather than from the form, because the file input is
    // cleared on every pick -- the real selection lives in `files`.
    const formData = new FormData(e.currentTarget);
    formData.delete("attachments");
    for (const file of files) formData.append("attachments", file);

    const result = await submitPublicTicket(formData);
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
        <p className="mt-4 text-[13px] text-[rgba(255,255,255,0.55)]">
          <Link href="/support/status" className="text-[#06E1DC] underline">
            Check your request&apos;s status
          </Link>{" "}
          any time.
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

      <div className="grid gap-5 sm:grid-cols-2">
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
        <div>
          <label htmlFor="callbackNumber" className={LABEL}>
            Callback number
          </label>
          <input
            id="callbackNumber"
            name="callbackNumber"
            type="tel"
            placeholder="Best number to reach you"
            className={FIELD}
          />
        </div>
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
          <select
            id="urgency"
            name="urgency"
            required
            value={urgency}
            onChange={(e) => setUrgency(e.target.value)}
            className={FIELD}
          >
            {Object.entries(URGENCY_LABELS).map(([value, label]) => (
              <option key={value} value={value} className="bg-[#071E37]">
                {label}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-[rgba(255,255,255,0.55)]">
            Target response: {URGENCY_RESPONSE_TIMES[urgency]}
          </p>
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
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
          onChange={(e) => addFiles(e.target.files)}
          className={`${FIELD} file:mr-3 file:rounded-md file:border-0 file:bg-[#06E1DC] file:px-3 file:py-1 file:text-sm file:font-semibold file:text-[#071E37]`}
        />
        <p className="mt-2 text-xs text-[rgba(255,255,255,0.55)]">
          Screenshots help a lot. Up to {MAX_ATTACHMENTS} images or PDFs, 10MB each.
        </p>

        {files.length > 0 && (
          <ul className="mt-3 space-y-2">
            {files.map((file) => (
              <li
                key={`${file.name}-${file.size}`}
                className="flex items-center gap-3 rounded-[10px] border border-[rgba(6,225,220,0.24)] bg-[rgba(6,225,220,0.05)] px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <span className="shrink-0 text-xs text-[rgba(255,255,255,0.55)]">
                  {(file.size / 1024 / 1024).toFixed(1)}MB
                </span>
                <button
                  type="button"
                  onClick={() => setFiles((c) => c.filter((f) => f !== file))}
                  aria-label={`Remove ${file.name}`}
                  className="shrink-0 rounded px-2 py-0.5 text-[rgba(255,255,255,0.6)] transition-colors hover:bg-[rgba(255,255,255,0.08)] hover:text-white"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
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
