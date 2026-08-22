/**
 * One-time local bootstrap: creates the SecureTECC organization, its default
 * ServiceType rows, and (if SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD are set) a
 * first admin user via the Supabase service role. Run with `npx prisma db seed`.
 *
 * This connects with the plain Prisma client (no withRLS) on purpose: there's
 * no authenticated user yet to scope a session to, and seeding is trusted
 * server-side bootstrap tooling, same category as tenant onboarding.
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";

const prisma = new PrismaClient();

const DEFAULT_SERVICE_TYPES = [
  { code: "R-S", label: "Remote Service", billingMinimumHours: 0.25, rateOverride: null },
  { code: "P-S", label: "Phone Service", billingMinimumHours: 0.25, rateOverride: null },
  { code: "E-S", label: "Email Service", billingMinimumHours: 0.25, rateOverride: null },
  { code: "O-S", label: "On-Site Service", billingMinimumHours: 1.0, rateOverride: null },
  { code: "L-V", label: "Low Voltage", billingMinimumHours: 1.0, rateOverride: 150 },
  { code: "W-D", label: "Website Development", billingMinimumHours: 0.25, rateOverride: 50 },
  { code: "A-I", label: "AI Automation", billingMinimumHours: 0.25, rateOverride: 50 },
] as const;

// Reference-only, per the schema comment on AddonPricing -- pre-fills the
// dialog's amount field, never enforced. Amounts are placeholders; adjust
// per-org from Settings once that UI exists, or edit here before re-seeding.
const DEFAULT_ADDON_PRICING = [
  { itemType: "DMARC", defaultRate: 25 },
  { itemType: "MonitoringSeat", defaultRate: 15 },
  { itemType: "RemoteMonitoring", defaultRate: 35 },
] as const;

async function main() {
  const org = await prisma.organization.upsert({
    where: { supportEmail: "support@securetecc.com" },
    update: {},
    create: {
      name: "SecureTECC",
      supportEmail: "support@securetecc.com",
      invoiceFromEmail: "tgregory@securetecc.com",
      brandColorPrimary: "#071E37",
      brandColorAccent: "#06E1DC",
    },
  });

  console.log(`Organization ready: ${org.name} (${org.id})`);

  for (const st of DEFAULT_SERVICE_TYPES) {
    await prisma.serviceType.upsert({
      where: { organizationId_code: { organizationId: org.id, code: st.code } },
      update: { label: st.label, billingMinimumHours: st.billingMinimumHours, rateOverride: st.rateOverride },
      create: {
        organizationId: org.id,
        code: st.code,
        label: st.label,
        billingMinimumHours: st.billingMinimumHours,
        rateOverride: st.rateOverride,
      },
    });
  }

  console.log(`Seeded ${DEFAULT_SERVICE_TYPES.length} default service types.`);

  for (const p of DEFAULT_ADDON_PRICING) {
    await prisma.addonPricing.upsert({
      where: { organizationId_itemType: { organizationId: org.id, itemType: p.itemType } },
      update: { defaultRate: p.defaultRate },
      create: { organizationId: org.id, itemType: p.itemType, defaultRate: p.defaultRate },
    });
  }

  console.log(`Seeded ${DEFAULT_ADDON_PRICING.length} default add-on price references.`);

  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  const adminName = process.env.SEED_ADMIN_NAME ?? "Admin";

  if (adminEmail && adminPassword) {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.warn(
        "SEED_ADMIN_EMAIL set but NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are missing -- skipping admin user creation.",
      );
    } else {
      const supabaseAdmin = createSupabaseAdmin(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );

      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: adminEmail,
        password: adminPassword,
        email_confirm: true,
      });

      if (error && !error.message.includes("already been registered")) {
        throw error;
      }

      const authUserId =
        data?.user?.id ??
        (await supabaseAdmin.auth.admin.listUsers()).data.users.find((u) => u.email === adminEmail)?.id;

      if (!authUserId) throw new Error("Could not resolve Supabase auth user id for seed admin.");

      await prisma.user.upsert({
        where: { authUserId },
        update: { role: "admin", organizationId: org.id },
        create: {
          authUserId,
          organizationId: org.id,
          name: adminName,
          email: adminEmail,
          role: "admin",
        },
      });

      console.log(`Admin user ready: ${adminEmail}`);
    }
  } else {
    console.log("Set SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD to also bootstrap a first admin user.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
