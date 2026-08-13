-- Incremental migration for the private researcher dashboard.
-- Run once after 003, 004, and 005. It does not expose direct table reads.
-- Instead, a signed Supabase Auth session must have the exact allowlisted
-- researcher email before the dashboard RPC returns any records.

create table if not exists public.researcher_access (
  email       text primary key check (email = lower(email)),
  created_at  timestamptz not null default now()
);

insert into public.researcher_access (email)
values ('muhammadsyaheerdaniel@gmail.com')
on conflict (email) do nothing;

alter table public.researcher_access enable row level security;
revoke all on public.researcher_access from anon, authenticated;

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
