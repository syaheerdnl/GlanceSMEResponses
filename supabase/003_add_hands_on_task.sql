-- Incremental migration for an existing SME-study Supabase project.
-- Run once in the Supabase SQL Editor before publishing the hands-on step.
-- It stores only four task timestamps for a fixed sample. No source code,
-- Firebase ID/token, email, or Glance history is written to this database.

create table if not exists public.hands_on_task (
  id                  bigint generated always as identity primary key,
  participant_id      text not null references public.intake (participant_code),
  sample_id           text not null check (sample_id = 'mysejahtera-alpha-dart-v1'),
  opened_at           timestamptz,
  review_completed_at timestamptz,
  feedback_opened_at  timestamptz,
  fix_applied_at      timestamptz,
  constraint hands_on_task_participant_unique unique (participant_id)
);

alter table public.hands_on_task enable row level security;
revoke all on public.hands_on_task from anon, authenticated;

create or replace function public.save_hands_on_milestone(
  p_id text, p_milestone text, p_sample_id text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_sample_id text;
begin
  if p_id is null or p_id = '' then
    return jsonb_build_object('ok', false, 'error', 'Missing participant id.');
  end if;
  if p_sample_id is distinct from 'mysejahtera-alpha-dart-v1' then
    return jsonb_build_object('ok', false, 'error', 'Unexpected study sample.');
  end if;
  if p_milestone is null or p_milestone not in ('opened', 'review-completed', 'feedback-opened', 'fix-applied') then
    return jsonb_build_object('ok', false, 'error', 'Unknown hands-on milestone.');
  end if;

  insert into public.hands_on_task (participant_id, sample_id)
  values (p_id, p_sample_id)
  on conflict (participant_id) do nothing;

  select sample_id into v_sample_id
  from public.hands_on_task
  where participant_id = p_id;
  if v_sample_id <> p_sample_id then
    return jsonb_build_object('ok', false, 'error', 'Participant already has a different study sample.');
  end if;

  if p_milestone = 'review-completed' and not exists (
    select 1 from public.hands_on_task where participant_id = p_id and opened_at is not null
  ) then
    return jsonb_build_object('ok', false, 'error', 'Open the prototype before running its review.');
  end if;
  if p_milestone = 'feedback-opened' and not exists (
    select 1 from public.hands_on_task where participant_id = p_id and review_completed_at is not null
  ) then
    return jsonb_build_object('ok', false, 'error', 'Complete the review before opening feedback.');
  end if;
  if p_milestone = 'fix-applied' and not exists (
    select 1 from public.hands_on_task where participant_id = p_id and feedback_opened_at is not null
  ) then
    return jsonb_build_object('ok', false, 'error', 'Open feedback before applying a suggested fix.');
  end if;

  if p_milestone = 'opened' then
    update public.hands_on_task set opened_at = coalesce(opened_at, now()) where participant_id = p_id;
  elsif p_milestone = 'review-completed' then
    update public.hands_on_task set review_completed_at = coalesce(review_completed_at, now()) where participant_id = p_id;
  elsif p_milestone = 'feedback-opened' then
    update public.hands_on_task set feedback_opened_at = coalesce(feedback_opened_at, now()) where participant_id = p_id;
  else
    update public.hands_on_task set fix_applied_at = coalesce(fix_applied_at, now()) where participant_id = p_id;
  end if;

  return jsonb_build_object('ok', true);
exception when foreign_key_violation then
  return jsonb_build_object('ok', false, 'error', 'Unknown participant id: ' || p_id);
end; $$;

revoke all on function public.save_hands_on_milestone(text, text, text) from public;
grant execute on function public.save_hands_on_milestone(text, text, text) to anon;
