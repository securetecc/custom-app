import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { withRLS } from "@/lib/db/rls";

// Resolves the signed-in Supabase auth user to their app-side profile row
// (organization + role). This is the single place request handlers should
// call to find out "who is making this request" -- proxy.ts only guarantees
// *a* session exists, not that a matching public.users row does.
//
// Runs under withRLS like any other query: the "users: staff can read own
// org roster" policy resolves via the SECURITY DEFINER current_org_id(), so
// this doesn't need a bypass -- it's the same DB-level check every other
// query gets.
// supabase.auth.getUser() validates the JWT against Supabase's Auth API --
// a real network round trip, not a local decode. getCurrentAppUser() and
// getCurrentAuthUserId() used to each call it independently, so
// requireOrgContext() (used on every server-rendered page) fired it twice
// per request on top of the middleware's own call. Centralizing it here so
// a single request only ever pays for one verified lookup.
async function getVerifiedAuthUser() {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  return authUser;
}

export async function getCurrentAppUser() {
  const authUser = await getVerifiedAuthUser();
  if (!authUser) return null;

  const appUser = await withRLS(authUser.id, (tx) =>
    tx.user.findUnique({
      where: { authUserId: authUser.id },
      include: { organization: true },
    }),
  );

  return appUser;
}

// Returns the verified Supabase auth user id for the current request, for
// callers (server actions) that need to open their own withRLS transaction.
export async function getCurrentAuthUserId() {
  const authUser = await getVerifiedAuthUser();
  return authUser?.id ?? null;
}

export async function requireAppUser() {
  const appUser = await getCurrentAppUser();
  if (!appUser) redirect("/login");
  return appUser;
}

export async function requireAdmin() {
  const appUser = await requireAppUser();
  if (appUser.role !== "admin") redirect("/dashboard?error=admin-only");
  return appUser;
}

// For server actions/route handlers: one call to get both the verified auth
// user id (needed to open a withRLS transaction) and the resolved app user
// (org + role, for building the write payload and any role checks). Calls
// getVerifiedAuthUser() exactly once -- every page in the app goes through
// here, so this is the highest-leverage spot to avoid a second Auth API
// round trip per request.
export async function requireOrgContext() {
  const authUser = await getVerifiedAuthUser();
  if (!authUser) redirect("/login");

  const appUser = await withRLS(authUser.id, (tx) =>
    tx.user.findUnique({
      where: { authUserId: authUser.id },
      include: { organization: true },
    }),
  );
  if (!appUser) redirect("/login");

  return { authUserId: authUser.id, appUser };
}
