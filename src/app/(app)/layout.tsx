import Image from "next/image";
import Link from "next/link";
import { requireAppUser } from "@/lib/auth";
import { getAvatarSignedUrl } from "@/lib/storage/avatars";
import { initialsOf } from "@/lib/initials";
import { AppSidebar } from "@/components/app/app-sidebar";
import { SignOutButton } from "@/components/app/sign-out-button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const appUser = await requireAppUser();

  const initials = initialsOf(appUser.name);
  // Signed because the bucket is private; an hour's validity so it doesn't
  // expire mid-session and leave a broken image in the header.
  const avatarUrl = await getAvatarSignedUrl(appUser.avatarPath);

  return (
    <div className="flex min-h-screen">
      <AppSidebar role={appUser.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Teal rule under the header mirrors the brand treatment used on the
            public pages (/login, /support). The app shell uses the same dark
            navy/teal palette as those pages (globals.css's .dark tokens,
            applied on <body> in the root layout so portaled dialogs/selects
            pick it up too) rather than a light theme with a dark sidebar
            bolted on -- kept free of their splash/particle/glow motion, which
            doesn't belong in
            a data-dense daily-use tool. */}
        <header
          className="flex h-16 shrink-0 items-center justify-end bg-background px-6"
          style={{ borderBottom: "2px solid var(--brand-teal)" }}
        >
          {/* No org name here -- the sidebar logo already identifies the
              brand, so repeating "SecureTECC" in the header was redundant. */}
          <div className="flex items-center gap-3">
            <div className="text-right text-sm">
              <p className="font-medium leading-none">{appUser.name}</p>
              <p className="text-xs capitalize text-muted-foreground">{appUser.role}</p>
            </div>
            {/* Links to the profile: the avatar is where people expect to
                click to change their own details. */}
            <Link href="/settings/profile" aria-label="Your profile">
              {avatarUrl ? (
                <Image
                  src={avatarUrl}
                  alt=""
                  width={32}
                  height={32}
                  unoptimized
                  className="h-8 w-8 rounded-full object-cover"
                />
              ) : (
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-accent text-accent-foreground text-xs">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              )}
            </Link>
            <SignOutButton />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto bg-secondary/30 p-6">{children}</main>
      </div>
    </div>
  );
}
