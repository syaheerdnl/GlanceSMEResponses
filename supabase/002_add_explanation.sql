-- 002_add_explanation.sql
--
-- Incremental migration for a project that already ran migration.sql
-- (which now includes this from the start for fresh installs). Adds the
-- "why" explanation shown alongside the category after a guess, gated
-- with the exact same blind-reveal treatment as category itself.
--
-- Run this once in the SQL Editor on an already-deployed project.

alter table public.findings add column explanation text;

update public.findings set explanation =
  'The production merchant key is embedded directly in the source as a string literal. Anyone with access to the repository, a build artifact, or a decompiled binary can extract it and impersonate this app to the payment gateway. Load it from a secure runtime config or environment variable instead, never commit it to source.'
  where num = 1;

update public.findings set explanation =
  'A refunded transaction''s amount was already added to the running total on the line above, then subtracted twice here via the "* 2" multiplier, over-correcting the total into negative territory instead of simply netting it out to zero. The multiplier should be removed.'
  where num = 2;

update public.findings set explanation =
  'Every exception from a failed payment retry is silently discarded here. If all attempts throw, the function just returns null with no trace of what actually went wrong, so failures become invisible to logs, monitoring, and the caller alike.'
  where num = 3;

update public.findings set explanation =
  'Each payment in the batch is awaited before the next one starts, even though the requests are independent of each other. Total time scales linearly with the number of billers; issuing them concurrently (e.g. with Future.wait) would cut batch latency down to roughly the slowest single call.'
  where num = 4;

update public.findings set explanation =
  'This check scans the entire recentRefs list linearly on every call. If it runs frequently against a growing list, the cost adds up; storing recent references in a Set would make each lookup near-constant time instead of O(n).'
  where num = 5;

update public.findings set explanation =
  'The loop manually tracks the index to decide when to add a separator, which takes more effort to read than the join it''s replicating. Expressing the same intent directly, e.g. p.join(''/''), would be immediately clear instead of hidden behind index bookkeeping.'
  where num = 6;

alter table public.findings alter column explanation set not null;

-- Re-point submit_guess to also return it (write-then-reveal ordering
-- unchanged — the INSERT still happens before this return).
create or replace function public.submit_guess(
  p_id text, p_finding_num int, p_guess text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_finding public.findings%rowtype;
begin
  if p_id is null or p_id = '' then
    return jsonb_build_object('ok', false, 'error', 'Missing participant id.');
  end if;
  select * into v_finding from public.findings where num = p_finding_num;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Unknown finding number: ' || p_finding_num);
  end if;
  if p_guess is null or p_guess not in ('Code Quality','Bugs','Optimization','Readability') then
    return jsonb_build_object('ok', false, 'error', 'Invalid category guess: ' || coalesce(p_guess, 'null'));
  end if;

  insert into public.category_validation
    (participant_id, finding_num, line, finding_title, guess, ai_category, guess_at)
  values
    (p_id, p_finding_num, v_finding.line, v_finding.title, p_guess, v_finding.category, now())
  on conflict (participant_id, finding_num) do update
    set guess = excluded.guess, ai_category = excluded.ai_category, guess_at = now();

  return jsonb_build_object('ok', true, 'title', v_finding.title, 'line', v_finding.line, 'category', v_finding.category, 'explanation', v_finding.explanation);
exception when foreign_key_violation then
  return jsonb_build_object('ok', false, 'error', 'Unknown participant id: ' || p_id);
end; $$;
revoke all on function public.submit_guess(text, int, text) from public;
grant execute on function public.submit_guess(text, int, text) to anon;
