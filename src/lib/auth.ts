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
export async function getCurrentAppUser() {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

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
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
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
// (org + role, for building the write payload and any role checks).
export async function requireOrgContext() {
  const authUserId = await getCurrentAuthUserId();
  if (!authUserId) redirect("/login");

  const appUser = await getCurrentAppUser();
  if (!appUser) redirect("/login");

  return { authUserId, appUser };
}
