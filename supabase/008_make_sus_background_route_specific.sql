-- Incremental migration for installations that already ran the original 007.
-- Run this after 003, 004, 005 and 007. It changes SUS-only Background from
-- the SME professional profile to the participant name plus Dart/Kotlin
-- familiarity, while keeping professional fields exclusive to full SME.

alter table public.intake
  add column if not exists language_familiarity text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'intake_language_familiarity_check'
      and conrelid = 'public.intake'::regclass
  ) then
    alter table public.intake
      add constraint intake_language_familiarity_check
      check (language_familiarity is null or language_familiarity in ('Dart', 'Kotlin', 'Dart and Kotlin', 'Neither'));
  end if;
end $$;

-- Original 007 accepted four professional-background arguments for SUS-only.
-- Replace that function with the narrower, route-appropriate two-field form.
drop function if exists public.assign_sus_only_id(text, text, text, text);
drop function if exists public.assign_sus_only_id();

create or replace function public.assign_sus_only_id(
  p_participant_name text, p_language_familiarity text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  if coalesce(btrim(p_participant_name), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'Participant name is required.');
  end if;
  if p_language_familiarity is null or p_language_familiarity not in ('Dart', 'Kotlin', 'Dart and Kotlin', 'Neither') then
    return jsonb_build_object('ok', false, 'error', 'Language familiarity is required.');
  end if;

  insert into public.intake (language_familiarity, study_path)
  values (p_language_familiarity, 'sus_only')
  returning participant_code into v_code;

  insert into public.participant_identity (participant_id, participant_name)
  values (v_code, btrim(p_participant_name));

  return jsonb_build_object('ok', true, 'id', v_code);
end; $$;
revoke all on function public.assign_sus_only_id(text, text) from public;
grant execute on function public.assign_sus_only_id(text, text) to anon;

-- Consent v3 accurately describes the SUS-only language-familiarity field.
-- Versions 1 and 2 stay valid only for already-started older sessions.
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
  if p_consent_version not in ('sme-web-consent-v1', 'sme-web-consent-v2', 'sme-web-consent-v3') then
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

-- Keep the private dashboard and Participants CSV supplied with the new
-- route-specific field. It remains unavailable to anon and still verifies
-- the authenticated email against the RLS-locked allowlist server-side.
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
        'languageFamiliarity', i.language_familiarity,
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
