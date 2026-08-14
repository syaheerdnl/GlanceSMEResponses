# SME Interview + Category Validation Exercise + SUS — Web Instrument

A single web page that supports two researcher-supervised routes. Invited
SMEs complete background/TAM interview questions and the Category Validation
Exercise (blind guess, then reveal), while SUS-only participants complete the
demonstration, a supervised embedded Glance hands-on task, and the same SUS
instrument. Both routes receive a pseudonymous participant ID in Supabase
(Postgres), but collect only background information relevant to that route.
The participant name is kept in a separate, protected identity record for the
researcher only.

**Why this exists instead of a Google Form:** the Category Validation
Exercise needs the AI-assigned category to stay hidden until *after* the
participant gives their own guess. Google Forms can't enforce that order
(nothing stops someone navigating back). This page enforces it for real —
the category never exists anywhere in the page's code; it only comes back
from the database in response to a submitted guess, and the database
itself is locked down (Row Level Security) so nothing but that one
response path can ever return a category.

**If a tab is accidentally closed mid-session,** reopening the page picks
right back up where the participant left off (same participant ID, same
section, and any typed-but-not-yet-submitted answers) — nothing already
saved to the database is lost, and nothing needs to be re-entered from
scratch. A "Start over" button clears this saved progress on that device
if you'd rather begin fresh.

## Files

| File | What it is |
|---|---|
| `index.html` | The page structure |
| `style.css` | Styling |
| `app.js` | All the client-side logic (section flow, validation, talking to the backend) |
| `researcher.html` / `researcher.js` | Private results dashboard, aggregate charts, and CSV/PNG exports, protected by Supabase Auth password sign-in |
| `config.js` | **Edit this** — holds the Supabase project URL and anon (public) key |
| `supabase/migration.sql` | The backend — run this once in your Supabase project's SQL Editor |
| `supabase/003_add_hands_on_task.sql` | Incremental migration for an already-live study project |
| `supabase/004_add_participant_consent.sql` | Incremental migration for the recorded consent gate |
| `supabase/005_add_study_path.sql` | Incremental migration for full-SME and SUS-only route records |
| `supabase/006_add_researcher_dashboard.sql` | Incremental migration for the private researcher results dashboard |
| `supabase/007_add_shared_background_and_identity.sql` | Incremental migration for shared background fields and protected participant names |
| `supabase/008_make_sus_background_route_specific.sql` | Follow-up migration for installations that already ran the first version of 007 |
| `supabase/009_add_optional_sus_feedback.sql` | Optional post-SUS feedback, consent v4, and protected SUS CSV export |

## Part 1 — Deploy the backend (Supabase)

1. Go to [supabase.com](https://supabase.com) and sign in (or create a free account).
2. Click **New Project**. Give it a name (e.g. "SME Interview Study"), set a database password (save it somewhere safe — you likely won't need it day-to-day, but you will if you ever need direct DB access), pick a region, and create it. Provisioning takes a minute or two.
3. In the project dashboard, open the **SQL Editor** (left sidebar), click **New query**, paste in the entire contents of `supabase/migration.sql`, and click **Run**. This creates all 9 tables, locks every one of them down with Row Level Security (so nothing is readable/writable except through the functions below), seeds the 6 findings, and creates the 9 functions the frontend calls.
4. For an already-live project, run `supabase/003_add_hands_on_task.sql`, `supabase/004_add_participant_consent.sql`, `supabase/005_add_study_path.sql`, and the current `supabase/007_add_shared_background_and_identity.sql` once, in that order. Migration 007 adds the protected name record, the route-appropriate SUS language-familiarity field, and the private researcher dashboard without exposing direct table reads. If you ran the earlier version of 007 before this update, also run `supabase/008_make_sus_background_route_specific.sql` afterwards. Then run `supabase/009_add_optional_sus_feedback.sql` to enable the optional feedback fields and consent v4. If `006_add_researcher_dashboard.sql` was already run, leave it in place and still run 007.
5. Verify it worked: **Table Editor** (left sidebar) should now show `intake`, `participant_identity`, `consent`, `interview`, `category_validation`, `hands_on_task`, `sus`, `findings`, and `researcher_access`. **Database > Functions** should list `assign_id`, `assign_sus_only_id`, `save_consent`, `save_interview`, `submit_guess`, `submit_agreement`, `save_hands_on_milestone`, `save_sus`, and `researcher_dashboard`.
6. Go to **Project Settings > API**. Copy the **Project URL** and the **anon public** key — **not** the `service_role` key, which must never be used client-side. You'll paste these into `config.js` in Part 2.

**If you ever need to change the functions later:** just re-run the `create or replace function ...` block for the one you changed, in the SQL Editor — unlike the old Apps Script setup, there's no separate "deploy a new version" step; changes take effect immediately.

**One operational note for a research timeline:** Supabase's free tier pauses a project after about a week of no API activity. If there's a gap between a pilot run and the real interview sessions, open the dashboard (which usually triggers it to wake up) before the session, so the first participant doesn't hit a slow first request.

## Part 2 — Host the frontend (GitHub Pages)

1. Open `config.js` in this folder and replace the placeholders with the URL and key from step 5 above:
   ```js
   const SUPABASE_URL = 'https://your-project-ref.supabase.co';
   const SUPABASE_ANON_KEY = 'eyJ...'; // the anon public key, not service_role
   ```
2. Create a new GitHub repository (or use an existing one you want this in).
3. Push these files (`index.html`, `style.css`, `app.js`, `config.js` — the `supabase/` folder doesn't need to go here, it only matters for Part 1) to that repo's default branch. The Glance `build/web` output must additionally be copied into `prototype/` after following `glance/STUDY_WEB_DEPLOYMENT.md`; do not publish a mock-service build.
4. In the repo on GitHub: **Settings > Pages**. Under "Build and deployment", set Source to **Deploy from a branch**, pick your branch and the `/ (root)` folder, then Save.
5. GitHub gives you a URL like `https://<your-username>.github.io/<repo-name>/`. That's the link participants (or you, running the interview) open.
6. It can take a minute or two after the first push for the page to go live.

## Part 3 — Enable private researcher results

The public study footer links to `researcher.html`, but knowing that URL does not reveal any data. The page signs in only the email allowlisted in `supabase/007_add_shared_background_and_identity.sql` with a researcher-controlled password; the database independently verifies the signed email claim before returning records.

1. Run the current `supabase/007_add_shared_background_and_identity.sql` in the Supabase SQL Editor after migrations 003, 004, and 005. It includes the dashboard allowlist and protected dashboard function; it also supersedes the dashboard function from migration 006. If the old 007 is already in your database, run `008_make_sus_background_route_specific.sql` next.
2. In **Authentication > Providers**, ensure the Email provider is enabled for password sign-in.
3. Open the live study page and select **Researcher results**. If this is the first password setup, choose **email me a one-time setup link**, open it in the same browser, then use the protected dashboard’s **Researcher sign-in password** panel to set a strong 12-character-or-longer password. Do not put it in source code or share it with participants.
4. For all future access, enter that password and select **Sign in to results**. The dashboard then provides the combined participant overview, route-filtered CSV exports, four aggregate charts, a Summary CSV, and a downloadable charts PNG without sending another email. The summary exports contain no names, interview notes, or SUS free-text feedback.

Do not replace this with a browser PIN. A browser PIN can be read from public JavaScript, while the dashboard here is protected by a Supabase Auth session and a server-side email allowlist.

## Testing it before a real session

Open the GitHub Pages URL (or just open `index.html` directly in a browser for a quick local check) and click through once yourself:

- If you see a "Setup needed" message instead of the study cover, `config.js` still has the placeholder values; go back to step 1 of Part 2.
- After consent, use the researcher-supplied browser code `0811` for the full SME route. This is a route selector, not a login or security control. The SME route collects professional experience, platforms/languages, and role. Continuing without a code selects the SUS-only route, which collects only the participant name and Dart/Kotlin familiarity, then skips Interview and Category Check.
- Complete one test route. It should receive `SME-1` (or the next number, if the tables already have rows) after the shared Background page, then land on the demonstration.
- Check the Supabase **Table Editor** after a test run — the `intake` table should show your test row. If nothing shows up, check the **Logs** section in the Supabase dashboard (Logs > Postgres/API) for an error.
- Confirm the consent checkbox. After background submission, `consent` should contain only the participant ID, acceptance, form version, and timestamp; the name should be in the separate `participant_identity` table. Complete the embedded hands-on task once. `hands_on_task` should receive only its fixed sample id and four timestamps, then SUS should unlock. The two written questions after SUS are optional, do not affect the SUS score, and appear only in the protected SUS CSV. Delete your test row(s) from `participant_identity`, `intake`, and matching rows in `consent`/`interview`/`category_validation`/`hands_on_task`/`sus` before the first real participant, so IDs start clean at SME-1.

## How responses are organized

Nine tables (the protected researcher dashboard is the recommended export path), one row per participant per table (except `category_validation`, which gets one row per finding, 6 rows per participant):

- **intake** — participant code (e.g. `SME-1`), timestamp, `study_path` (`full_sme` or `sus_only`), full-SME professional background fields, and the SUS-only `language_familiarity` value (`Dart`, `Kotlin`, `Dart and Kotlin`, or `Neither`).
- **participant_identity** — participant ID, participant name, and timestamp. It is RLS-locked and is joined only by the authenticated researcher dashboard, not the public study flow.
- **consent** — participant ID, explicit acceptance, consent form version, and first consent timestamp. No name or study response is stored here.
- **interview** — participant ID, timestamp, and free-text notes for Q2–Q6.
- **category_validation** — one row per finding (6 per participant): participant ID, finding number, line, finding title, the participant's blind guess, the AI-assigned category, their agreement answer, correct category if they disagreed, and any "could also be" ranking.
- **hands_on_task** — the fixed sample ID plus first timestamps for prototype opened, review completed, feedback opened, and suggested fix applied. It never stores code, Firebase IDs, email, or Glance history.
- **sus** — participant ID, timestamp, all 10 item scores, the computed 0–100 SUS score, and optional difficulty/improvement feedback (each limited to 1,000 characters). The written feedback is returned only by the authenticated dashboard and its SUS CSV export.
- **findings** — the 6 planted issues (line/title/category). Server-only; not meant to be browsed as study data.
- **researcher_access** — the server-only allowlist for the private dashboard. It contains the approved researcher email, never participant data.

Join on participant ID across tables (via the Table Editor's relationships, or a `select ... join ...` query in the SQL Editor) when you're ready to analyse everything together.

## Interpreting SUS results

Keep all ten original SUS statements and five response choices unchanged. A score of 68 is a commonly cited reference point for interpreting the **aggregate** result; it is not a pass mark for an individual participant and is not shown on the participant thank-you page. Report the participant count, mean, median, range, and the optional written feedback alongside the SME interview themes. A lower result is valid evidence of usability issues to address in a future iteration.

## A privacy/security note

The database is locked down with Row Level Security: the public `anon`
key (the one in `config.js`) has zero direct read/write access to any
table, and can only call the 8 participant functions in
`supabase/migration.sql`. The ninth function, `researcher_dashboard`, is
available only to an authenticated session whose signed email matches the
server-side allowlist. That said, anyone with the anon key can
still call those functions directly (e.g. with `curl`), the same as
anyone could `POST` to the old `/exec` URL — so don't publish the key
anywhere public beyond the people running the interview, even though it's
technically safe to ship in client-side code by design.
