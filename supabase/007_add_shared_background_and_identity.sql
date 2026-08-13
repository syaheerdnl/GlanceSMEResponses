-- Incremental migration for shared Background collection and the protected
-- participant-name record. Run once after 003, 004 and 005. It is safe to
-- run whether or not 006 was run, because it ensures the dashboard allowlist
-- and RPC exist as well.

-- Keep identity separate from questionnaire answers. This table is never
-- readable directly from the public API; only the authenticated, allowlisted
-- researcher_dashboard function can join it for the researcher record.
create table if not exists public.participant_identity (
  participant_id   text primary key references public.intake (participant_code),
  participant_name text not null check (btrim(participant_name) <> ''),
  created_at       timestamptz not null default now()
);

alter table public.participant_identity enable row level security;
revoke all on public.participant_identity from anon, authenticated;

-- 006's allowlist is repeated here so this migration can complete the whole
-- dashboard setup if 006 was missed. It does not widen access.
create table if not exists public.researcher_access (
  email       text primary key check (email = lower(email)),
  created_at  timestamptz not null default now()
);

insert into public.researcher_access (email)
values ('muhammadsyaheerdaniel@gmail.com')
on conflict (email) do nothing;

alter table public.researcher_access enable row level security;
revoke all on public.researcher_access from anon, authenticated;

-- Replace the old assignment functions. Both routes now receive the same
-- name and professional-background fields. The browser-only SME code still
-- decides only whether Interview and Category Check are included later.
drop function if exists public.assign_id(text, text, text);
drop function if exists public.assign_sus_only_id();

create or replace function public.assign_id(
  p_years_experience text, p_platforms text, p_role text, p_participant_name text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  if coalesce(btrim(p_participant_name), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'Participant name is required.');
  end if;

  insert into public.intake (years_experience, platforms, role, study_path)
  values (p_years_experience, p_platforms, p_role, 'full_sme')
  returning participant_code into v_code;

  insert into public.participant_identity (participant_id, participant_name)
  values (v_code, btrim(p_participant_name));

  return jsonb_build_object('ok', true, 'id', v_code);
end; $$;
revoke all on function public.assign_id(text, text, text, text) from public;
grant execute on function public.assign_id(text, text, text, text) to anon;

create or replace function public.assign_sus_only_id(
  p_years_experience text, p_platforms text, p_role text, p_participant_name text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  if coalesce(btrim(p_participant_name), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'Participant name is required.');
  end if;

  insert into public.intake (years_experience, platforms, role, study_path)
  values (p_years_experience, p_platforms, p_role, 'sus_only')
  returning participant_code into v_code;

  insert into public.participant_identity (participant_id, participant_name)
  values (v_code, btrim(p_participant_name));

  return jsonb_build_object('ok', true, 'id', v_code);
end; $$;
revoke all on function public.assign_sus_only_id(text, text, text, text) from public;
grant execute on function public.assign_sus_only_id(text, text, text, text) to anon;

-- New sessions see consent version 2, which explicitly covers name storage.
-- Version 1 remains accepted only for an interrupted pre-change session.
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
  if p_consent_version not in ('sme-web-consent-v1', 'sme-web-consent-v2') then
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

-- A valid Supabase Auth session must still carry the approved signed email.
-- The function is never granted to anon and direct table reads remain denied.
create or replace function public.researcher_dashboard()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  if v_email = '' or not exists (
    select 1 from public.researcher_access where email = v_email
  ) then
    raise exception 'Researcher access required.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'generatedAt', now(),
    'participants', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'participantId', i.participant_code,
        'participantName', pi.participant_name,
        'studyPath', i.study_path,
        'createdAt', i.created_at,
        'yearsExperience', i.years_experience,
        'platforms', i.platforms,
        'role', i.role,
        'consentedAt', c.consented_at,
        'sus1', s.sus1, 'sus2', s.sus2, 'sus3', s.sus3, 'sus4', s.sus4, 'sus5', s.sus5,
        'sus6', s.sus6, 'sus7', s.sus7, 'sus8', s.sus8, 'sus9', s.sus9, 'sus10', s.sus10,
        'susScore', s.sus_score,
        'sampleId', h.sample_id,
        'openedAt', h.opened_at,
        'reviewCompletedAt', h.review_completed_at,
        'feedbackOpenedAt', h.feedback_opened_at,
        'fixAppliedAt', h.fix_applied_at
      ) order by i.id), '[]'::jsonb)
      from public.intake i
      left join public.participant_identity pi on pi.participant_id = i.participant_code
      left join public.consent c on c.participant_id = i.participant_code
      left join public.sus s on s.participant_id = i.participant_code
      left join public.hands_on_task h on h.participant_id = i.participant_code
    ),
    'categoryValidation', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'participantId', cv.participant_id,
        'studyPath', i.study_path,
        'findingNum', cv.finding_num,
        'line', cv.line,
        'findingTitle', cv.finding_title,
        'guess', cv.guess,
        'aiCategory', cv.ai_category,
        'agreement', cv.agreement,
        'correctCategory', cv.correct_category,
        'couldAlsoBe', cv.could_also_be,
        'guessAt', cv.guess_at,
        'agreementAt', cv.agreement_at
      ) order by cv.participant_id, cv.finding_num), '[]'::jsonb)
      from public.category_validation cv
      join public.intake i on i.participant_code = cv.participant_id
    ),
    'interviews', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'participantId', iv.participant_id,
        'studyPath', i.study_path,
        'createdAt', iv.created_at,
        'q2', iv.q2, 'q3', iv.q3, 'q4', iv.q4, 'q5', iv.q5, 'q6', iv.q6
      ) order by iv.participant_id), '[]'::jsonb)
      from public.interview iv
      join public.intake i on i.participant_code = iv.participant_id
    )
  );
end; $$;
revoke all on function public.researcher_dashboard() from public;
grant execute on function public.researcher_dashboard() to authenticated;

notify pgrst, 'reload schema';
