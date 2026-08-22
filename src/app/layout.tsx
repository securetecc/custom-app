import type { Metadata } from "next";
import { Geist, Geist_Mono, Poppins } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Matches the marketing/internal site at manage.securetecc.com, which sets
// headings and UI chrome in Poppins. Self-hosted via next/font rather than a
// runtime Google Fonts request.
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "SecureTECC Platform",
  description: "Client billing, time tracking, and support tickets for SecureTECC.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${poppins.variable} h-full antialiased`}
    >
      {/* dark is applied here rather than scoped to just the authenticated
          app shell because shadcn/base-ui portals (Dialog, Select, Popover,
          Tooltip, and Sonner's toasts) render directly under <body>, outside
          any wrapper div's DOM subtree -- scoping .dark to a child element
          left every portaled overlay stuck on the light theme. /login,
          /support, and /voice-logger don't use these design tokens at all
          (hardcoded colors throughout), so this has no effect on them. */}
      <body className="dark min-h-full flex flex-col bg-background text-foreground">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
