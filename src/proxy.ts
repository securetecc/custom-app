import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Next.js 16 renamed `middleware.ts`/`middleware()` to `proxy.ts`/`proxy()`.
// This refreshes the Supabase session cookie on every request and gates the
// staff app behind auth. The public ticket-submission route and its API stay
// open (no login for clients, per spec).
//
// /api/cron is listed here because Vercel Cron invokes it with no user
// session -- redirecting it to /login would silently stop every scheduled job.
// It is NOT unprotected: those routes verify `Authorization: Bearer
// $CRON_SECRET` themselves and fail closed when the secret is unset
// (src/lib/cron/auth.ts).
// "/support" (a startsWith prefix match below) already covers "/support/status".
const PUBLIC_PATHS = ["/login", "/support", "/privacy", "/terms", "/api/tickets", "/api/cron"];

// Client-facing ticket portal, on its own hostname rather than a path under
// the internal app. Clients never see a domain called "manage", and the
// public/staff split becomes structural instead of a path convention.
//
// support.securetecc.com stays on Hostinger as the marketing page and simply
// links here. Add that host to this array if it ever moves to Vercel too --
// the behaviour below is per-host, not per-domain.
const PUBLIC_TICKET_HOSTS = ["ticket.securetecc.com"];

// Pretty URLs on the ticket host: the public URL bar never shows /support.
const TICKET_REWRITES: Record<string, string> = {
  "/": "/support",
  "/status": "/support/status",
};

// Served as-is on the ticket host. /_next must be here or the page ships
// without its JS/CSS; the legal pages are linked from the portal footer.
const TICKET_PASSTHROUGH = ["/_next", "/support", "/privacy", "/terms"];

export async function proxy(request: NextRequest) {
  const host = request.headers.get("host")?.split(":")[0];
  if (host && PUBLIC_TICKET_HOSTS.includes(host)) {
    const { pathname } = request.nextUrl;

    const rewriteTo = TICKET_REWRITES[pathname];
    if (rewriteTo) {
      const url = request.nextUrl.clone();
      url.pathname = rewriteTo;
      // rewrite, not redirect: preserves method and body, so the form's
      // Server Action POST to "/" still reaches /support intact.
      return NextResponse.rewrite(url);
    }

    if (TICKET_PASSTHROUGH.some((prefix) => pathname.startsWith(prefix))) {
      return NextResponse.next({ request });
    }

    // Everything else on this host is internal-app surface. Send visitors to
    // the form rather than letting the staff app (or its login page) answer
    // on a client-facing domain at all.
    const home = request.nextUrl.clone();
    home.pathname = "/";
    home.search = "";
    return NextResponse.redirect(home);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = PUBLIC_PATHS.some((path) => request.nextUrl.pathname.startsWith(path));

  if (!user && !isPublic) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (user && request.nextUrl.pathname === "/login") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
