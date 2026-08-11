"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Landing + sign-in page, styled to match SecureTECC's internal site at
 * manage.securetecc.com: deep-navy canvas, teal compass rings behind the
 * hero, Poppins headings, teal-on-navy controls.
 *
 * Deliberately plain elements rather than the shadcn/base-ui primitives used
 * elsewhere in the app -- those are themed for the (light/dark) authenticated
 * shell, whereas this page is a fixed dark brand surface.
 */

const TOOLS = [
  {
    title: "Voice Logger",
    body: "Log billable time by speaking naturally — AI classifies the service type, applies billing minimums, and records it automatically.",
  },
  {
    title: "Manual Time Entry",
    body: "Prefer typing? Log hours directly with a client, date, service type, and description — no voice needed.",
  },
  {
    title: "Client Management",
    body: "Add new clients on the fly — billing rate, contact info, and address feed straight into every future invoice.",
  },
  {
    title: "Invoicing",
    body: "Generate client invoices from logged hours and recurring charges, with a review step before anything goes final.",
  },
  {
    title: "Support Tickets",
    body: "Client requests from the support portal land automatically, with email alerts and status updates handled for you.",
  },
  {
    title: "Reporting",
    body: "Daily reminders, weekly ticket digests, and monthly revenue summaries land in your inbox automatically.",
  },
];

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push(searchParams.get("next") ?? "/dashboard");
    router.refresh();
  }

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-[#050F1D] font-[family-name:var(--font-poppins)] text-white">
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

      <section className="relative flex min-h-[max(82vh,700px)] items-center justify-center overflow-hidden px-6 pb-10 pt-15">
        {/* Ambient teal wash */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(60% 40% at 20% 15%, rgba(6,225,220,0.10), transparent 60%), radial-gradient(50% 35% at 85% 25%, rgba(6,225,220,0.07), transparent 60%), radial-gradient(55% 45% at 75% 85%, rgba(6,225,220,0.09), transparent 60%)",
          }}
        />

        {/* Wide arc ring */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 h-[1040px] w-[1040px] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            backgroundImage:
              "radial-gradient(circle, transparent 0%, transparent 40%, rgba(20,216,196,0.30) 46%, rgba(20,216,196,0.12) 52%, transparent 60%)",
          }}
        />

        {/* Compass: three hairline concentric rings, slowly counter-rotating */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2"
        >
          <div className="absolute inset-0 animate-[spin_26s_linear_infinite] rounded-full border border-[rgba(6,225,220,0.20)]" />
          <div className="absolute inset-10 animate-[spin_38s_linear_infinite_reverse] rounded-full border border-[rgba(6,225,220,0.15)]" />
          <div className="absolute inset-[90px] rounded-full border border-[rgba(6,225,220,0.11)]" />
        </div>

        {/* Eclipse glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[60px]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 65% 50%, rgba(6,225,220,0.22), transparent 62%)",
          }}
        />

        <div className="relative z-[2] w-full max-w-[420px] text-center">
          <span className="mb-6 inline-block rounded-[20px] border border-[rgba(6,225,220,0.24)] bg-[rgba(6,225,220,0.14)] px-[18px] py-[7px] text-xs font-bold uppercase tracking-[2px] text-[#06E1DC]">
            Internal Access
          </span>

          <h1 className="text-[clamp(30px,5vw,36px)] font-extrabold leading-[1.15] tracking-[-0.02em]">
            SecureTECC staff only
          </h1>
          <p className="mt-3 text-[15px] leading-[1.6] text-[rgba(255,255,255,0.74)]">
            Sign in to reach the operations tools.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 text-left">
            <label
              htmlFor="email"
              className="mb-2 block text-xs font-bold uppercase tracking-[1.5px] text-[#06E1DC]"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mb-3 w-full rounded-[10px] border border-[rgba(6,225,220,0.24)] bg-[rgba(6,225,220,0.05)] px-4 py-[14px] text-[15px] text-white outline-none transition-colors placeholder:text-[rgba(255,255,255,0.35)] focus:border-[#06E1DC]"
            />

            <label
              htmlFor="password"
              className="mb-2 block text-xs font-bold uppercase tracking-[1.5px] text-[#06E1DC]"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mb-3 w-full rounded-[10px] border border-[rgba(6,225,220,0.24)] bg-[rgba(6,225,220,0.05)] px-4 py-[14px] text-[15px] tracking-[1px] text-white outline-none transition-colors focus:border-[#06E1DC]"
            />

            {error && (
              <p role="alert" className="mb-3 text-sm text-[#ff8a8a]">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-[10px] bg-[#06E1DC] px-10 py-[15px] text-base font-bold tracking-[0.2px] text-[#071E37] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Signing in…" : "Unlock"}
            </button>
          </form>

          <p className="mt-6 text-[13px] text-[rgba(255,255,255,0.55)]">
            SecureTECC Solutions · Internal Tools
          </p>
        </div>
      </section>

      <section className="px-6 pb-24">
        <div className="mx-auto mb-10 max-w-[560px] text-center">
          <p className="mb-[10px] text-xs font-bold uppercase tracking-[2px] text-[#06E1DC]">
            What&apos;s inside
          </p>
          <h2 className="mb-3 text-[clamp(24px,3.4vw,32px)] font-bold">
            Everything the team runs day to day
          </h2>
          <p className="text-[15px] leading-[1.6] text-[rgba(255,255,255,0.74)]">
            One login gets you to all of it — no separate tools to juggle.
          </p>
        </div>

        <div className="mx-auto grid max-w-[900px] grid-cols-1 gap-5 sm:grid-cols-2">
          {TOOLS.map((tool) => (
            <div
              key={tool.title}
              className="rounded-[14px] border border-[rgba(6,225,220,0.24)] bg-[#071E37] px-[22px] py-[26px] transition-all duration-200 hover:-translate-y-1 hover:border-[#06E1DC] hover:shadow-[0_14px_30px_-14px_rgba(6,225,220,0.4)]"
            >
              <h3 className="mb-2 text-[17px] font-bold">{tool.title}</h3>
              <p className="text-sm leading-[1.6] text-[rgba(255,255,255,0.74)]">
                {tool.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-[rgba(6,225,220,0.24)] px-6 py-8 text-center text-[13px] text-[rgba(255,255,255,0.55)]">
        SecureTECC Solutions · Internal Tools · 877.707.TECC
      </footer>
    </div>
  );
}
