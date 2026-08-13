-- migration.sql
--
-- Backend for the SME Interview + Category Validation Exercise + SUS web
-- page. Run this ONCE, in full, in the Supabase SQL Editor (Project ->
-- SQL Editor -> New query -> paste this whole file -> Run) on a fresh
-- Supabase project. See README.md Part 1 for the full setup walkthrough.
--
-- WHY THE AI-ASSIGNED CATEGORIES LIVE HERE, LOCKED DOWN, NOT IN THE FRONTEND:
-- The Category Validation Exercise depends on the participant not being
-- able to see the application's assigned category before they give their
-- own blind guess. The `findings` table below is the ONLY place a category
-- exists before a guess, and it is deliberately unreachable by the public
-- `anon` role — Row Level Security is enabled on every table with zero
-- policies (default-deny), and the only way in or out is through the 5
-- SECURITY DEFINER functions at the bottom, which run with elevated
-- privilege and enforce write-then-reveal ordering exactly like the prior
-- Google Apps Script backend (gas/Code.gs, kept in this repo for
-- historical reference only, no longer deployed).
--
-- If you ever change the findings (different demo file, different planted
-- issues), update the INSERT block below to match FINDINGS_PUBLIC in
-- app.js (line/title only, no category) — same rule as the old Code.gs.

-- ============================================================
-- Tables
-- ============================================================

-- participant_code is a generated column off the identity PK, so 'SME-N'
-- assignment is atomic/race-safe under concurrent submissions (the old
-- Code.gs scan-and-increment had no locking and could theoretically race).
create table public.intake (
  id                bigint generated always as identity primary key,
  participant_code  text generated always as ('SME-' || id) stored,
  created_at        timestamptz not null default now(),
  years_experience  text,
  platforms         text,
  role              text,
  constraint intake_participant_code_unique unique (participant_code)
);

-- Consent is kept separate from Intake so it can record the exact form
-- version and timestamp without storing the participant's on-screen name.
create table public.consent (
  id              bigint generated always as identity primary key,
  participant_id  text not null references public.intake (participant_code),
  accepted        boolean not null check (accepted),
  consent_version text not null,
  consented_at    timestamptz not null default now(),
  constraint consent_participant_unique unique (participant_id)
);

create table public.interview (
  id             bigint generated always as identity primary key,
  participant_id text not null references public.intake (participant_code),
  created_at     timestamptz not null default now(),
  q2 text, q3 text, q4 text, q5 text, q6 text,
  constraint interview_participant_unique unique (participant_id)
);

-- One row per (participant, finding) — matches the old CategoryValidation
-- tab's shape (6 rows per participant). The unique constraint also closes
-- a real gap the old Code.gs had (no idempotency check on submitGuess).
create table public.category_validation (
  id               bigint generated always as identity primary key,
  participant_id   text not null references public.intake (participant_code),
  finding_num      smallint not null check (finding_num between 1 and 6),
  line             smallint not null,
  finding_title    text not null,
  guess            text not null check (guess in ('Code Quality','Bugs','Optimization','Readability')),
  ai_category      text not null check (ai_category in ('Code Quality','Bugs','Optimization','Readability')),
  agreement        text,
  correct_category text,
  could_also_be    text,
  guess_at         timestamptz not null default now(),
  agreement_at     timestamptz,
  constraint category_validation_participant_finding_unique unique (participant_id, finding_num)
);

create table public.sus (
  id             bigint generated always as identity primary key,
  participant_id text not null references public.intake (participant_code),
  created_at     timestamptz not null default now(),
  sus1 smallint check (sus1 between 1 and 5), sus2 smallint check (sus2 between 1 and 5),
  sus3 smallint check (sus3 between 1 and 5), sus4 smallint check (sus4 between 1 and 5),
  sus5 smallint check (sus5 between 1 and 5), sus6 smallint check (sus6 between 1 and 5),
  sus7 smallint check (sus7 between 1 and 5), sus8 smallint check (sus8 between 1 and 5),
  sus9 smallint check (sus9 between 1 and 5), sus10 smallint check (sus10 between 1 and 5),
  sus_score numeric(5,2) not null,
  constraint sus_participant_unique unique (participant_id)
);

-- One supervised hands-on task per participant. This deliberately stores
-- only milestone timestamps for the fixed study sample: never submitted
-- source, Glance review content, Firebase UID/token, email, or app history.
create table public.hands_on_task (
  id                  bigint generated always as identity primary key,
  participant_id      text not null references public.intake (participant_code),
  sample_id           text not null check (sample_id = 'mysejahtera-alpha-dart-v1'),
  opened_at           timestamptz,
  review_completed_at timestamptz,
  feedback_opened_at  timestamptz,
  fix_applied_at      timestamptz,
  constraint hands_on_task_participant_unique unique (participant_id)
);

-- Server-only. The ONLY place a category exists before a guess.
create table public.findings (
  num         smallint primary key check (num between 1 and 6),
  line        smallint not null,
  title       text not null,
  category    text not null check (category in ('Code Quality','Bugs','Optimization','Readability')),
  explanation text not null -- the "why" — gated exactly like category, only ever
                             -- returned by submit_guess after the guess is recorded
);

insert into public.findings (num, line, title, category, explanation) values
  (1, 5,  'Hardcoded Production API Key', 'Code Quality',
   'The production merchant key is embedded directly in the source as a string literal. Anyone with access to the repository, a build artifact, or a decompiled binary can extract it and impersonate this app to the payment gateway. Load it from a secure runtime config or environment variable instead, never commit it to source.'),
  (2, 28, 'Incorrect Refund Calculation Logic', 'Bugs',
   'A refunded transaction''s amount was already added to the running total on the line above, then subtracted twice here via the "* 2" multiplier, over-correcting the total into negative territory instead of simply netting it out to zero. The multiplier should be removed.'),
  (3, 40, 'Empty Catch Block Suppresses Failures', 'Bugs',
   'Every exception from a failed payment retry is silently discarded here. If all attempts throw, the function just returns null with no trace of what actually went wrong, so failures become invisible to logs, monitoring, and the caller alike.'),
  (4, 17, 'Sequential Await in Loop', 'Optimization',
   'Each payment in the batch is awaited before the next one starts, even though the requests are independent of each other. Total time scales linearly with the number of billers; issuing them concurrently (e.g. with Future.wait) would cut batch latency down to roughly the slowest single call.'),
  (5, 44, 'Inefficient Duplicate Reference Check', 'Optimization',
   'This check scans the entire recentRefs list linearly on every call. If it runs frequently against a growing list, the cost adds up; storing recent references in a Set would make each lookup near-constant time instead of O(n).'),
  (6, 51, 'Imperative String Joining', 'Readability',
   'The loop manually tracks the index to decide when to add a separator, which takes more effort to read than the join it''s replicating. Expressing the same intent directly, e.g. p.join(''/''), would be immediately clear instead of hidden behind index bookkeeping.');

-- ============================================================
-- Row Level Security — default-deny on every table.
--
-- Supabase grants anon/authenticated table CRUD by DEFAULT on new tables
-- (via ALTER DEFAULT PRIVILEGES set at project creation). Without RLS,
-- anon could POST /rest/v1/category_validation or GET /rest/v1/findings
-- directly, bypassing every function below entirely. This is mandatory,
-- not a hardening nice-to-have. The explicit REVOKE is defense-in-depth
-- on top of it. Do NOT add FORCE ROW LEVEL SECURITY anywhere below — that
-- would also restrict the table owner and break the functions, which rely
-- on running as an owner that bypasses RLS.
-- ============================================================

alter table public.intake               enable row level security;
alter table public.consent              enable row level security;
alter table public.interview            enable row level security;
alter table public.category_validation  enable row level security;
alter table public.sus                  enable row level security;
alter table public.hands_on_task         enable row level security;
alter table public.findings             enable row level security;

revoke all on public.intake, public.consent, public.interview, public.category_validation,
                public.sus, public.hands_on_task, public.findings
  from anon, authenticated;

grant usage on schema public to anon, authenticated;

-- Even a deliberately crafted direct RPC request cannot submit an interview,
-- category answer, hands-on milestone, or SUS response without a recorded
-- consent row. The trigger protects the tables themselves, rather than
-- trusting only the browser's navigation state.
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

create trigger interview_requires_consent
before insert or update on public.interview
for each row execute function public.require_recorded_consent();

create trigger category_validation_requires_consent
before insert or update on public.category_validation
for each row execute function public.require_recorded_consent();

create trigger hands_on_task_requires_consent
before insert or update on public.hands_on_task
for each row execute function public.require_recorded_consent();

create trigger sus_requires_consent
before insert or update on public.sus
for each row execute function public.require_recorded_consent();

-- ============================================================
-- RPC functions — the only way in or out for the anon role.
--
-- Each is SECURITY DEFINER (runs as its owner, "postgres", which has
-- BYPASSRLS) with search_path pinned to '' and every relation reference
-- fully schema-qualified (public.*) — closes the classic Postgres
-- privilege-escalation footgun where an unpinned search_path lets a
-- caller shadow an unqualified name.
--
-- Postgres grants EXECUTE on new functions to PUBLIC by default, and
-- PostgREST auto-exposes every function in `public` as an RPC route
-- regardless of grants (the route always exists; only the CALL is gated
-- by Postgres permissions). So each function below is explicitly
-- REVOKEd from public before being GRANTed to anon specifically.
-- ============================================================

create or replace function public.assign_id(
  p_years_experience text, p_platforms text, p_role text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  insert into public.intake (years_experience, platforms, role)
  values (p_years_experience, p_platforms, p_role)
  returning participant_code into v_code;
  return jsonb_build_object('ok', true, 'id', v_code);
end; $$;
revoke all on function public.assign_id(text, text, text) from public;
grant execute on function public.assign_id(text, text, text) to anon;


-- Consent must be explicitly true and match the deployed form version. The
-- first timestamp is preserved on retry, so a disrupted network request can
-- safely be retried without creating a second record or changing evidence of
-- when consent was first captured.
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


create or replace function public.save_interview(
  p_id text, p_q2 text, p_q3 text, p_q4 text, p_q5 text, p_q6 text
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_id is null or p_id = '' then
    return jsonb_build_object('ok', false, 'error', 'Missing participant id.');
  end if;
  insert into public.interview (participant_id, q2, q3, q4, q5, q6)
  values (p_id, p_q2, p_q3, p_q4, p_q5, p_q6)
  on conflict (participant_id) do update
    set q2 = excluded.q2, q3 = excluded.q3, q4 = excluded.q4,
        q5 = excluded.q5, q6 = excluded.q6, created_at = now();
  return jsonb_build_object('ok', true);
exception when foreign_key_violation then
  return jsonb_build_object('ok', false, 'error', 'Unknown participant id: ' || p_id);
end; $$;
revoke all on function public.save_interview(text, text, text, text, text, text) from public;
grant execute on function public.save_interview(text, text, text, text, text, text) to anon;


-- submit_guess: the security-critical one. The INSERT (the write) happens
-- BEFORE the returned jsonb (the reveal) — same write-then-reveal ordering
-- as the old Code.gs, and since the whole function body is one
-- transaction, this is actually strictly atomic (the old appendRow()-
-- then-return had no such guarantee).
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


create or replace function public.submit_agreement(
  p_id text, p_finding_num int, p_agreement text, p_correct_category text, p_could_also_be text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_rows int;
begin
  if p_id is null or p_id = '' then
    return jsonb_build_object('ok', false, 'error', 'Missing participant id.');
  end if;
  update public.category_validation
  set agreement = p_agreement, correct_category = p_correct_category,
      could_also_be = p_could_also_be, agreement_at = now()
  where participant_id = p_id and finding_num = p_finding_num;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('ok', false, 'error', 'Matching guess row not found for id/finding. Did you call submitGuess first?');
  end if;
  return jsonb_build_object('ok', true);
end; $$;
revoke all on function public.submit_agreement(text, int, text, text, text) from public;
grant execute on function public.submit_agreement(text, int, text, text, text) to anon;


-- save_sus: same scoring formula as the old Code.gs (odd items contribute
-- score-1, even items contribute 5-score, sum * 2.5). p_scores[1] = SUS
-- item 1, etc.
create or replace function public.save_sus(
  p_id text, p_scores int[]
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_total numeric := 0; v_score numeric; i int;
begin
  if p_id is null or p_id = '' then
    return jsonb_build_object('ok', false, 'error', 'Missing participant id.');
  end if;
  if p_scores is null or array_length(p_scores, 1) <> 10 then
    return jsonb_build_object('ok', false, 'error', 'Expected 10 SUS scores.');
  end if;
  for i in 1..10 loop
    if p_scores[i] is null or p_scores[i] < 1 or p_scores[i] > 5 then
      return jsonb_build_object('ok', false, 'error', 'SUS scores must be integers between 1 and 5.');
    end if;
    if i % 2 = 1 then v_total := v_total + (p_scores[i] - 1);
    else v_total := v_total + (5 - p_scores[i]); end if;
  end loop;
  v_score := v_total * 2.5;
  insert into public.sus (participant_id, sus1, sus2, sus3, sus4, sus5, sus6, sus7, sus8, sus9, sus10, sus_score)
  values (p_id, p_scores[1], p_scores[2], p_scores[3], p_scores[4], p_scores[5],
          p_scores[6], p_scores[7], p_scores[8], p_scores[9], p_scores[10], v_score)
  on conflict (participant_id) do update
    set sus1=excluded.sus1, sus2=excluded.sus2, sus3=excluded.sus3, sus4=excluded.sus4,
        sus5=excluded.sus5, sus6=excluded.sus6, sus7=excluded.sus7, sus8=excluded.sus8,
        sus9=excluded.sus9, sus10=excluded.sus10, sus_score=excluded.sus_score, created_at=now();
  return jsonb_build_object('ok', true, 'susScore', v_score);
exception when foreign_key_violation then
  return jsonb_build_object('ok', false, 'error', 'Unknown participant id: ' || p_id);
end; $$;
revoke all on function public.save_sus(text, int[]) from public;
grant execute on function public.save_sus(text, int[]) to anon;


-- save_hands_on_milestone: idempotently records a single action from the
-- same-origin embedded Glance study build. It is intentionally narrow: the
-- fixed sample id and four allowed milestone names are enforced here, and
-- `coalesce` preserves the first timestamp if the iframe is reloaded or a
-- postMessage is delivered more than once.
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

  -- A caller cannot mark a later task action without the preceding recorded
  -- action. Repeated calls to an already-completed milestone remain safe.
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

-- ============================================================
-- Sanity checks to run after this migration (see README.md Part 1):
--   curl "<project-url>/rest/v1/findings" -H "apikey: <anon-key>"
--     -> should return [] or a 401/403, NOT the 6 findings.
--   curl -X POST "<project-url>/rest/v1/rpc/assign_id" \
--     -H "apikey: <anon-key>" -H "Content-Type: application/json" \
--     -d '{"p_years_experience":"5","p_platforms":"Dart","p_role":"Test"}'
--     -> should return {"ok":true,"id":"SME-1"} (or the next number).
-- ============================================================
