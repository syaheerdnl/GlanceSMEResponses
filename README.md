# SME Interview + Category Validation Exercise + SUS — Web Instrument

A single web page that walks a participant (or the researcher, typing on
their behalf) through the background/TAM interview questions, the
Category Validation Exercise (blind guess, then reveal), and the SUS
scale, saving everything into one Google Sheet.

**Why this exists instead of a Google Form:** the Category Validation
Exercise needs the AI-assigned category to stay hidden until *after* the
participant gives their own guess. Google Forms can't enforce that order
(nothing stops someone navigating back). This page enforces it for real —
the category never exists anywhere in the page's code; it only comes back
from the server in response to a submitted guess.

**If a tab is accidentally closed mid-session,** reopening the page picks
right back up where the participant left off (same participant ID, same
section, and any typed-but-not-yet-submitted answers) — nothing already
saved to the Sheet is lost, and nothing needs to be re-entered from
scratch. A "Start over" button clears this saved progress on that device
if you'd rather begin fresh.

## Files

| File | What it is |
|---|---|
| `index.html` | The page structure |
| `style.css` | Styling |
| `app.js` | All the client-side logic (section flow, validation, talking to the backend) |
| `config.js` | **Edit this** — holds the Apps Script Web App URL |
| `gas/Code.gs` | The backend — deploy this in Google Apps Script |

## Part 1 — Deploy the backend (Google Apps Script)

1. Go to [sheets.google.com](https://sheets.google.com) and create a new, blank Sheet. Name it something like "Glance SME Responses".
2. Copy the Sheet's ID out of its URL: `docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`.
3. In the Sheet, go to **Extensions > Apps Script**. Delete the placeholder `myFunction() {}` code, and paste in the entire contents of `gas/Code.gs`.
4. Near the top of the pasted code, find `var SHEET_ID = 'PASTE_YOUR_SHEET_ID_HERE';` and replace it with the ID from step 2.
5. In the function dropdown at the top of the Apps Script editor, select **`setupSheet`**, then click the **Run (▶)** button. This creates the four tabs (Intake, Interview, CategoryValidation, SUS) with headers.
   - First run: it'll ask to review permissions. Click through, choose your Google account, then "Advanced" > "Go to (project name) (unsafe)" > Allow. This warning shows up because the script isn't published by Google, not because it does anything unsafe — it only writes to the Sheet you just made.
6. Check the Sheet — you should now see 4 tabs with header rows. If not, check the Execution log (View > Logs) for an error.
7. Back in the Apps Script editor: **Deploy > New deployment**. Click the gear icon next to "Select type" and choose **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy**, approve permissions again if asked.
8. Copy the **Web app URL** it gives you (ends in `/exec`). You'll need this in Part 2.

**If you ever edit `Code.gs` later:** go to Deploy > Manage deployments > click the pencil/edit icon > select "New version" > Deploy. Just saving the script doesn't update the live `/exec` URL.

## Part 2 — Host the frontend (GitHub Pages)

1. Open `config.js` in this folder and replace the placeholder with the URL from step 8 above:
   ```js
   const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycb.../exec';
   ```
2. Create a new GitHub repository (or use an existing one you want this in).
3. Push these files (`index.html`, `style.css`, `app.js`, `config.js` — the `gas/` folder doesn't need to go here, it only matters for step 1) to that repo's default branch.
4. In the repo on GitHub: **Settings > Pages**. Under "Build and deployment", set Source to **Deploy from a branch**, pick your branch and the `/ (root)` folder, then Save.
5. GitHub gives you a URL like `https://<your-username>.github.io/<repo-name>/`. That's the link participants (or you, running the interview) open.
6. It can take a minute or two after the first push for the page to go live.

## Testing it before a real session

Open the GitHub Pages URL (or just open `index.html` directly in a browser for a quick local check) and click through once yourself:

- If you see a "Setup needed" message instead of the intake form, `config.js` still has the placeholder URL — go back to step 1 of Part 2.
- Fill in the intake fields and submit — you should get assigned `SME-1` (or the next number, if the Sheet already has rows) and land on the interview section.
- Check the Google Sheet after a test run — the `Intake` tab should show your test row. If nothing shows up, open the Apps Script editor's Execution log (View > Executions) to see the error.
- Delete your test row(s) from the Sheet before the first real participant, so IDs start clean at SME-1.

## How responses are organized in the Sheet

Four tabs, one row per participant per tab (except CategoryValidation, which gets one row per finding — 6 rows per participant):

- **Intake** — Participant ID, timestamp, years of experience, platforms/languages, current role. (Name is never sent to the Sheet — it's only used on-screen to confirm identity.)
- **Interview** — Participant ID, timestamp, and free-text notes for Q2–Q6.
- **CategoryValidation** — one row per finding (6 per participant): Participant ID, Finding #, Line, Finding Title, the participant's blind guess, the AI-assigned category, their agreement answer, correct category if they disagreed, and any "could also be" ranking.
- **SUS** — Participant ID, timestamp, all 10 item scores, and the computed 0–100 SUS score.

Join on Participant ID across tabs (e.g. with `VLOOKUP` or a pivot table) when you're ready to analyse everything together.

## A privacy/security note

The Web App is deployed with "Anyone" access, meaning anyone with the
`/exec` URL can technically POST to it. That's normal for this kind of
lightweight setup and fine for a handful of SME interviews, but don't
publish the URL anywhere public beyond the people running the interview.
If you want tighter control later, Apps Script also supports restricting
access to specific Google accounts instead of "Anyone" — worth asking
your supervisor whether that level of control is expected for the study.
