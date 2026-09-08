-- Bonus bands.
--
-- Readable by every staff member: the bonus report is deliberately visible to
-- both SecureTECC and BBZ, and a report whose bands are hidden cannot be
-- checked. Editing them changes what the business pays out, so that stays
-- with admins.

alter table public.bonus_bands enable row level security;

drop policy if exists "bonus_bands: staff read within org" on public.bonus_bands;
create policy "bonus_bands: staff read within org"
  on public.bonus_bands for select
  to authenticated
  using ("organizationId" = public.current_org_id());

drop policy if exists "bonus_bands: admin writes within org" on public.bonus_bands;
create policy "bonus_bands: admin writes within org"
  on public.bonus_bands for all
  to authenticated
  using ("organizationId" = public.current_org_id() and public.is_admin())
  with check ("organizationId" = public.current_org_id() and public.is_admin());
