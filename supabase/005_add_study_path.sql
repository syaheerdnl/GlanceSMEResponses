-- Incremental migration for the browser-selected full SME / SUS-only routes.
-- Run once in the live Supabase SQL Editor after 003 and 004, before
-- publishing the matching frontend. The browser code is a researcher-supervised
-- route selector, not a login or security boundary.

alter table public.intake add column if not exists study_path text;

-- Existing records were all created through the original full SME instrument.
update public.intake
set study_path = 'full_sme'
where study_path is null;

alter table public.intake
  alter column study_path set default 'full_sme',
  alter column study_path set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'intake_study_path_check'
      and conrelid = 'public.intake'::regclass
  ) then
    alter table public.intake
      add constraint intake_study_path_check
      check (study_path in ('full_sme', 'sus_only'));
  end if;
end $$;

-- Keep the full SME route explicit, rather than relying only on the default.
create or replace function public.assign_id(
  p_years_experience text, p_platforms text, p_role text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  insert into public.intake (years_experience, platforms, role, study_path)
  values (p_years_experience, p_platforms, p_role, 'full_sme')
  returning participant_code into v_code;
  return jsonb_build_object('ok', true, 'id', v_code);
end; $$;
revoke all on function public.assign_id(text, text, text) from public;
grant execute on function public.assign_id(text, text, text) to anon;

-- This writes only the anonymous participant code and the SUS-only route.
-- It does not receive a browser code, person name, Firebase identifier, or
-- any application data. Consent is recorded by save_consent immediately after.
create or replace function public.assign_sus_only_id()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  insert into public.intake (study_path)
  values ('sus_only')
  returning participant_code into v_code;
  return jsonb_build_object('ok', true, 'id', v_code);
end; $$;
revoke all on function public.assign_sus_only_id() from public;
grant execute on function public.assign_sus_only_id() to anon;
