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

// The client-facing ticket portal is meant to live at its own hostname
// (support.securetecc.com) rather than a path under the internal app's
// domain (manage.securetecc.com). Rewriting that host's root to /support
// here means the public site's URL bar never shows /support, while reusing
// the exact same page and backend as everything else -- no separate
// deployment, no duplicated ticket-submission logic.
const SUPPORT_HOST = "support.securetecc.com";

export async function proxy(request: NextRequest) {
  const host = request.headers.get("host")?.split(":")[0];
  if (host === SUPPORT_HOST && request.nextUrl.pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/support";
    return NextResponse.rewrite(url);
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
