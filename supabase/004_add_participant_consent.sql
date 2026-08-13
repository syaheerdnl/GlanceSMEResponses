-- Incremental migration for the recorded participant-consent gate.
-- Run once in the live Supabase SQL Editor before deploying this UI change.

create table if not exists public.consent (
  id              bigint generated always as identity primary key,
  participant_id  text not null references public.intake (participant_code),
  accepted        boolean not null check (accepted),
  consent_version text not null,
  consented_at    timestamptz not null default now(),
  constraint consent_participant_unique unique (participant_id)
);

alter table public.consent enable row level security;
revoke all on public.consent from anon, authenticated;

create or replace function public.require_recorded_consent()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.consent
    where participant_id = new.participant_id and accepted = true
  ) then
    raise exception 'Recorded participant consent is required before study responses can be saved.' using errcode = '23514';
  end if;
  return new;
end; $$;
revoke all on function public.require_recorded_consent() from public;

drop trigger if exists interview_requires_consent on public.interview;
create trigger interview_requires_consent
before insert or update on public.interview
for each row execute function public.require_recorded_consent();

drop trigger if exists category_validation_requires_consent on public.category_validation;
create trigger category_validation_requires_consent
before insert or update on public.category_validation
for each row execute function public.require_recorded_consent();

drop trigger if exists hands_on_task_requires_consent on public.hands_on_task;
create trigger hands_on_task_requires_consent
before insert or update on public.hands_on_task
for each row execute function public.require_recorded_consent();

drop trigger if exists sus_requires_consent on public.sus;
create trigger sus_requires_consent
before insert or update on public.sus
for each row execute function public.require_recorded_consent();

create or replace function public.save_consent(
  p_id text, p_accepted boolean, p_consent_version text
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_id is null or p_id = '' then
    return jsonb_build_object('ok', false, 'error', 'Missing participant id.');
  end if;
  if p_accepted is distinct from true then
    return jsonb_build_object('ok', false, 'error', 'Explicit consent is required.');
  end if;
  if p_consent_version is distinct from 'sme-web-consent-v1' then
    return jsonb_build_object('ok', false, 'error', 'Unexpected consent form version.');
  end if;

  insert into public.consent (participant_id, accepted, consent_version)
  values (p_id, true, p_consent_version)
  on conflict (participant_id) do update
    set accepted = true,
        consent_version = excluded.consent_version,
        consented_at = coalesce(public.consent.consented_at, now());
  return jsonb_build_object('ok', true);
exception when foreign_key_violation then
  return jsonb_build_object('ok', false, 'error', 'Unknown participant id: ' || p_id);
end; $$;

revoke all on function public.save_consent(text, boolean, text) from public;
grant execute on function public.save_consent(text, boolean, text) to anon;
