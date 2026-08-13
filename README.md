# SME Interview + Category Validation Exercise + SUS — Web Instrument

A single web page that walks a participant (or the researcher, typing on
their behalf) through the background/TAM interview questions, the
Category Validation Exercise (blind guess, then reveal), and the SUS
scale, saving everything into a Supabase (Postgres) database.

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
| `config.js` | **Edit this** — holds the Supabase project URL and anon (public) key |
| `supabase/migration.sql` | The backend — run this once in your Supabase project's SQL Editor |

## Part 1 — Deploy the backend (Supabase)

1. Go to [supabase.com](https://supabase.com) and sign in (or create a free account).
2. Click **New Project**. Give it a name (e.g. "SME Interview Study"), set a database password (save it somewhere safe — you likely won't need it day-to-day, but you will if you ever need direct DB access), pick a region, and create it. Provisioning takes a minute or two.
3. In the project dashboard, open the **SQL Editor** (left sidebar), click **New query**, paste in the entire contents of `supabase/migration.sql`, and click **Run**. This creates all 5 tables, locks every one of them down with Row Level Security (so nothing is readable/writable except through the functions below), seeds the 6 findings, and creates the 5 functions the frontend calls.
4. Verify it worked: **Table Editor** (left sidebar) should now show `intake`, `interview`, `category_validation`, `sus`, and `findings`. **Database > Functions** should list `assign_id`, `save_interview`, `submit_guess`, `submit_agreement`, `save_sus`.
5. Go to **Project Settings > API**. Copy the **Project URL** and the **anon public** key — **not** the `service_role` key, which must never be used client-side. You'll paste these into `config.js` in Part 2.

**If you ever need to change the functions later:** just re-run the `create or replace function ...` block for the one you changed, in the SQL Editor — unlike the old Apps Script setup, there's no separate "deploy a new version" step; changes take effect immediately.

**One operational note for a research timeline:** Supabase's free tier pauses a project after about a week of no API activity. If there's a gap between a pilot run and the real interview sessions, open the dashboard (which usually triggers it to wake up) before the session, so the first participant doesn't hit a slow first request.

## Part 2 — Host the frontend (GitHub Pages)

1. Open `config.js` in this folder and replace the placeholders with the URL and key from step 5 above:
   ```js
   const SUPABASE_URL = 'https://your-project-ref.supabase.co';
   const SUPABASE_ANON_KEY = 'eyJ...'; // the anon public key, not service_role
   ```
2. Create a new GitHub repository (or use an existing one you want this in).
3. Push these files (`index.html`, `style.css`, `app.js`, `config.js` — the `supabase/` folder doesn't need to go here, it only matters for Part 1) to that repo's default branch.
4. In the repo on GitHub: **Settings > Pages**. Under "Build and deployment", set Source to **Deploy from a branch**, pick your branch and the `/ (root)` folder, then Save.
5. GitHub gives you a URL like `https://<your-username>.github.io/<repo-name>/`. That's the link participants (or you, running the interview) open.
6. It can take a minute or two after the first push for the page to go live.

## Testing it before a real session

Open the GitHub Pages URL (or just open `index.html` directly in a browser for a quick local check) and click through once yourself:

- If you see a "Setup needed" message instead of the intake form, `config.js` still has the placeholder values — go back to step 1 of Part 2.
- Fill in the intake fields and submit — you should get assigned `SME-1` (or the next number, if the tables already have rows) and land on the interview section.
- Check the Supabase **Table Editor** after a test run — the `intake` table should show your test row. If nothing shows up, check the **Logs** section in the Supabase dashboard (Logs > Postgres/API) for an error.
- Delete your test row(s) from the `intake` table (and any matching rows in `interview`/`category_validation`/`sus`) before the first real participant, so IDs start clean at SME-1.

## How responses are organized

Five tables (Table Editor in the Supabase dashboard gives a spreadsheet-like grid per table, with CSV export), one row per participant per table (except `category_validation`, which gets one row per finding — 6 rows per participant):

- **intake** — participant code (e.g. `SME-1`), timestamp, years of experience, platforms/languages, current role. (Name is never sent to the database — it's only used on-screen to confirm identity.)
- **interview** — participant ID, timestamp, and free-text notes for Q2–Q6.
- **category_validation** — one row per finding (6 per participant): participant ID, finding number, line, finding title, the participant's blind guess, the AI-assigned category, their agreement answer, correct category if they disagreed, and any "could also be" ranking.
- **sus** — participant ID, timestamp, all 10 item scores, and the computed 0–100 SUS score.
- **findings** — the 6 planted issues (line/title/category). Server-only; not meant to be browsed as study data.

Join on participant ID across tables (via the Table Editor's relationships, or a `select ... join ...` query in the SQL Editor) when you're ready to analyse everything together.

## A privacy/security note

The database is locked down with Row Level Security: the public `anon`
key (the one in `config.js`) has zero direct read/write access to any
table, and can only call the 5 specific functions in
`supabase/migration.sql`, each of which does exactly what the old Apps
Script backend did — no more. That said, anyone with the anon key can
still call those functions directly (e.g. with `curl`), the same as
anyone could `POST` to the old `/exec` URL — so don't publish the key
anywhere public beyond the people running the interview, even though it's
technically safe to ship in client-side code by design.
