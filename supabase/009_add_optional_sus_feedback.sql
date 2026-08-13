-- Incremental migration for the optional written feedback collected after
-- the fixed ten-item SUS. Run this after the existing migrations through
-- 008. It preserves the standard SUS score and adds only supplementary,
-- researcher-only qualitative feedback.

alter table public.sus
  add column if not exists feedback_difficulty text,
  add column if not exists feedback_improvement text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sus_feedback_difficulty_length_check'
      and conrelid = 'public.sus'::regclass
  ) then
    alter table public.sus add constraint sus_feedback_difficulty_length_check
      check (feedback_difficulty is null or char_length(feedback_difficulty) <= 1000);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'sus_feedback_improvement_length_check'
      and conrelid = 'public.sus'::regclass
  ) then
    alter table public.sus add constraint sus_feedback_improvement_length_check
      check (feedback_improvement is null or char_length(feedback_improvement) <= 1000);
  end if;
end $$;

-- The four-argument form is the current browser contract. The score remains
-- calculated only from the original ten SUS values; the two optional fields
-- have no effect on the formula.
create or replace function public.save_sus(
  p_id text, p_scores int[], p_feedback_difficulty text, p_feedback_improvement text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_total numeric := 0;
  v_score numeric;
  v_feedback_difficulty text;
  v_feedback_improvement text;
  i int;
begin
  if p_id is null or p_id = '' then
    return jsonb_build_object('ok', false, 'error', 'Missing participant id.');
  end if;
  if p_scores is null or array_length(p_scores, 1) <> 10 then
    return jsonb_build_object('ok', false, 'error', 'Expected 10 SUS scores.');
  end if;
  if p_feedback_difficulty is not null and char_length(btrim(p_feedback_difficulty)) > 1000 then
    return jsonb_build_object('ok', false, 'error', 'Optional difficulty feedback must be 1,000 characters or fewer.');
  end if;
  if p_feedback_improvement is not null and char_length(btrim(p_feedback_improvement)) > 1000 then
    return jsonb_build_object('ok', false, 'error', 'Optional improvement feedback must be 1,000 characters or fewer.');
  end if;

  for i in 1..10 loop
    if p_scores[i] is null or p_scores[i] < 1 or p_scores[i] > 5 then
      return jsonb_build_object('ok', false, 'error', 'SUS scores must be integers between 1 and 5.');
    end if;
    if i % 2 = 1 then v_total := v_total + (p_scores[i] - 1);
    else v_total := v_total + (5 - p_scores[i]); end if;
  end loop;

  v_score := v_total * 2.5;
  v_feedback_difficulty := nullif(btrim(p_feedback_difficulty), '');
  v_feedback_improvement := nullif(btrim(p_feedback_improvement), '');

  insert into public.sus (
    participant_id, sus1, sus2, sus3, sus4, sus5, sus6, sus7, sus8, sus9, sus10, sus_score,
    feedback_difficulty, feedback_improvement
  ) values (
    p_id, p_scores[1], p_scores[2], p_scores[3], p_scores[4], p_scores[5],
    p_scores[6], p_scores[7], p_scores[8], p_scores[9], p_scores[10], v_score,
    v_feedback_difficulty, v_feedback_improvement
  ) on conflict (participant_id) do update
    set sus1 = excluded.sus1, sus2 = excluded.sus2, sus3 = excluded.sus3, sus4 = excluded.sus4,
        sus5 = excluded.sus5, sus6 = excluded.sus6, sus7 = excluded.sus7, sus8 = excluded.sus8,
        sus9 = excluded.sus9, sus10 = excluded.sus10, sus_score = excluded.sus_score,
        feedback_difficulty = excluded.feedback_difficulty,
        feedback_improvement = excluded.feedback_improvement,
        created_at = now();

  return jsonb_build_object('ok', true, 'susScore', v_score);
exception when foreign_key_violation then
  return jsonb_build_object('ok', false, 'error', 'Unknown participant id: ' || p_id);
end; $$;

-- Older browser tabs can still finish an already-started session. They save
-- no optional feedback but retain exactly the prior score behaviour.
create or replace function public.save_sus(
  p_id text, p_scores int[]
) returns jsonb language sql security definer set search_path = '' as $$
  select public.save_sus(p_id, p_scores, null, null);
$$;
revoke all on function public.save_sus(text, int[], text, text) from public;
revoke all on function public.save_sus(text, int[]) from public;
grant execute on function public.save_sus(text, int[], text, text) to anon;
grant execute on function public.save_sus(text, int[]) to anon;

-- Consent v4 adds the optional written-feedback description. Existing v1-v3
-- records remain valid evidence for an already-started session.
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
  if p_consent_version not in ('sme-web-consent-v1', 'sme-web-consent-v2', 'sme-web-consent-v3', 'sme-web-consent-v4') then
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

-- The feedback is included only in the authenticated dashboard payload and
-- its SUS CSV export; it is never returned to the public study page.
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
        'susFeedbackDifficulty', s.feedback_difficulty,
        'susFeedbackImprovement', s.feedback_improvement,
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
