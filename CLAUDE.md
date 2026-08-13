# CLAUDE.md — SME Interview Web Instrument

This file is a handoff brief for a Claude Code session picking up this project cold. Read this whole file before touching any code — several design decisions here look arbitrary until you know why they exist, and a few of them are load-bearing (breaking them silently breaks the study's methodology, not just the code).

---

## What this project is

A single-page web app that runs an SME (subject-matter expert) interview for a master's thesis: *"Development of a Mobile-Native AI-Powered Code Review Application Using Serverless Architecture"* (Muhammad Syaheer Daniel, MMSD, UTeM). The participant (or a researcher, typing on their behalf during a live session) goes through five stages in order:

1. **Intake** — background/experience details, gets assigned a sequential anonymous ID (`SME-1`, `SME-2`, ...)
2. **Interview** — five open-ended discussion questions (Q2-Q6), free-text notes
3. **Category Validation Exercise** — the centerpiece. Six real findings from a code-review AI tool are shown one at a time. The participant must guess which of 4 categories (Code Quality / Bugs / Optimization / Readability) a finding belongs to **before** the AI's actual answer is revealed, then state agreement.
4. **SUS** — the standard 10-item System Usability Scale
5. **Done**

All responses are written to a Google Sheet via a Google Apps Script Web App backend.

## Why this exists instead of a Google Form or paper worksheet

The whole point of the Category Validation Exercise is measuring whether the participant's own independent judgment matches the AI's category assignment. If the AI's answer is visible before they guess — even by accident, even just by them scrolling ahead — the measurement is contaminated (anchoring bias). Google Forms cannot enforce "no looking ahead" (nothing stops back-navigation between sections). A paper worksheet requires the researcher to physically hide the answer sheet section by section, which is error-prone and doesn't scale to multiple researchers or self-administered sessions.

**This is the one rule that must never be violated in any future change:** the AI-assigned category for a finding must not exist anywhere reachable by the browser (page source, JS variables, network responses) until *after* the participant's guess for that specific finding has already been recorded server-side. See "The blind-reveal boundary" below for exactly how this is enforced.

---

## File map

```
index.html    Page structure — 5 <section> elements, one per stage, toggled via .active class
style.css     All styling. No CSS framework, no build step.
app.js        All client-side logic: state machine, validation, rendering, backend calls
config.js     Exactly one line: WEB_APP_URL. Currently a placeholder — see "Deployment status".
gas/Code.gs   The backend. Deploy this in Google Apps Script, bound to a Google Sheet.
README.md     End-user (non-technical) deploy instructions: create Sheet, deploy Code.gs, host the frontend.
smoke_test.mjs      Playwright test that drives the REAL app.js against a stubbed backend. Run this after any change.
preview_shots.mjs   Older/legacy script that fakes the UI by injecting DOM directly (bypasses app.js entirely).
                     Superseded by smoke_test.mjs's screenshots. Keep for reference, don't treat its output as authoritative.
```

There is no build step, no package.json, no framework. Everything is vanilla HTML/CSS/JS on purpose, so it can be dropped straight onto GitHub Pages (or any static host) with zero tooling. **Do not introduce a bundler, npm dependency, or framework unless the user explicitly asks for one** — that would break the "just push these 4 files to a repo" deploy story described in README.md.

---

## The blind-reveal boundary (read this before editing anything in app.js or Code.gs)

`gas/Code.gs` has a `FINDINGS` object (line, title, category for all 6 planted issues). This is the **only** place the category exists before a guess is submitted.

`app.js` has a parallel `FINDINGS_PUBLIC` array — same findings, **same line numbers and titles, but no `category` field**. This is intentional duplication, not a bug: line/title are safe to ship to the client (the researcher already reads these aloud per the exercise's own script), the category is not.

The flow: client POSTs `{action: 'submitGuess', id, findingNum, guess}` → server looks up the real category in `FINDINGS`, records the guess+category into the Sheet, and **only then** sends `{category, title}` back in the response. `revealFinding()` in app.js is the only place the category ever touches the DOM.

**If you ever change the findings** (different demo file, different planted issues, etc.), you must update both `FINDINGS` in `Code.gs` (with category) and `FINDINGS_PUBLIC` in `app.js` (without category) — and double check nothing in app.js accidentally imports or hardcodes a category value anywhere else.

---

## The CORS workaround (don't "fix" this)

`callBackend()` in app.js sends requests with `Content-Type: text/plain;charset=utf-8`, not `application/json`, even though the body IS JSON. This is deliberate: a `text/plain` POST body counts as a CORS "simple request" and skips the preflight `OPTIONS` request, which Apps Script Web Apps cannot answer (they only implement `doGet`/`doPost`). If you change this to `application/json`, cross-origin requests from GitHub Pages to the Apps Script `/exec` URL will start failing with CORS errors. `Code.gs`'s `doPost` parses `e.postData.contents` as JSON directly, ignoring the declared content type, so this asymmetry is intentional and matched on both ends.

---

## Backend contract (Code.gs actions)

All requests: `POST` to `WEB_APP_URL`, body `{"action": "...", ...fields}`. All responses: `{"ok": true, ...}` or `{"ok": false, "error": "..."}`.

| Action | Request fields | Response fields | Sheet effect |
|---|---|---|---|
| `assignId` | `yearsExperience`, `platforms`, `role` (all strings) | `id` (e.g. `"SME-3"`) | Appends a row to **Intake** |
| `saveInterview` | `id`, `q2`..`q6` (strings) | — | Appends a row to **Interview** |
| `submitGuess` | `id`, `findingNum` (1-6), `guess` (one of the 4 category strings) | `title`, `line`, `category` — **the reveal** | Appends a row to **CategoryValidation** (agreement columns blank) |
| `submitAgreement` | `id`, `findingNum`, `agreement`, `correctCategory`, `couldAlsoBe` (all strings) | — | Finds the matching CategoryValidation row (by id+findingNum) and fills in the agreement columns |
| `saveSUS` | `id`, `scores` (array of 10 integers 1-5) | `susScore` (0-100, computed server-side using standard SUS scoring) | Appends a row to **SUS** |

`yearsExperience`, `platforms`, `agreement`, `correctCategory`, and `couldAlsoBe` are all sent as **plain strings**, even though the UI uses richer controls (slider, chips, toggle switch, ranked checkboxes) to produce them. This is deliberate — it means the Sheet schema and `Code.gs` never need to change when the frontend's input widgets change. If you add a new field that needs its own Sheet column, you must update **both** `Code.gs`'s action handler (the `appendRow`/`getRange` call) **and** `setupSheet()`'s header list, in the same column order, or you'll get silent column misalignment. Re-run `setupSheet()` only works for brand-new tabs — it will NOT retrofit new columns onto an existing tab with data in it. If a real Sheet already has participant data and you need a new column, add it manually via the Sheets UI in the correct position, or via a small one-off migration script — do not just change `Code.gs` and assume it'll match.

---

## Sheet schema (4 tabs, created by `setupSheet()`)

- **Intake**: Participant ID, Timestamp, Years of Experience, Platforms / Languages, Current Role
- **Interview**: Participant ID, Timestamp, Q2..Q6 (5 columns)
- **CategoryValidation**: Participant ID, Finding #, Line, Finding Title, Participant's Guess (blind), AI-Assigned Category (revealed), Agreement, If Disagree Correct Category, Could Also Be (ranked), Guess Timestamp, Agreement Timestamp — **one row per finding**, so 6 rows per participant, not 1
- **SUS**: Participant ID, Timestamp, SUS1..SUS10, SUS Score (0-100)

Join on Participant ID across tabs for analysis.

---

## Deployment status (as of this handoff)

**Nothing is deployed yet.** `config.js` still has the placeholder `WEB_APP_URL`, and `Code.gs` still has the placeholder `SHEET_ID`. `app.js` actually checks for this on load (`backendConfigured()`) and shows a "Setup needed" message instead of the real form if the URL looks unconfigured — this is intentional UX, not a bug, so don't be alarmed if you open `index.html` locally and see that screen instead of the intake form.

The user's plan (from `README.md`) is: deploy `Code.gs` as an Apps Script Web App bound to a new Google Sheet, then host the 4 frontend files (`index.html`, `style.css`, `app.js`, `config.js`) on GitHub Pages. Neither has happened yet as of this handoff. If asked to "test it end to end," you cannot do so live — no Google account or GitHub credentials are available in a typical sandboxed session. Use the stubbed-backend approach in `smoke_test.mjs` instead (see below), or ask the user to test the real deployment themselves.

---

## How to verify changes (do this before calling anything done)

`smoke_test.mjs` is a Playwright script that:
1. Intercepts `config.js` to inject a fake `WEB_APP_URL`
2. Intercepts POST requests to that fake URL and returns realistic stubbed responses matching the real `Code.gs` contract above
3. Drives the actual `app.js` through the entire flow via real DOM interactions (clicks, fills) — not mocked/injected content
4. Asserts on real behavior: ID assignment, validation blocking (empty guess, incomplete SUS), the reveal only showing after guess submission, the stepper updating, the code line highlighting matching the current finding, zero console/page errors
5. Screenshots each of the 6 major states to `preview/real-*.png`

Run it with:
```bash
cd <project folder>
npm install playwright   # if not already available
node smoke_test.mjs
```
(If `node` can't resolve `playwright` via a normal `npm install` in your environment, you may need `PLAYWRIGHT_BROWSERS_PATH`/`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` env vars or a local `node_modules/playwright` symlink to a global install — this was needed in one sandboxed environment already, may not apply to yours.)

**Known non-bug:** `.section.active` and `.reveal-box` have a ~0.2-0.25s CSS fade-in animation. If you screenshot immediately after a state change without waiting, you'll capture a washed-out, partially-transparent frame that looks broken but isn't — it's mid-animation. Always `await page.waitForTimeout(300-350)` after a section/reveal transition before screenshotting, or check `smoke_test.mjs` for the pattern already in place. This bit us once already during this project; don't rediscover it as a "regression."

After running the smoke test, actually **look at the screenshots** (don't just trust the assertions) — several real layout bugs during this project were only caught visually (a code block clipping long lines instead of wrapping, for instance), not by the assertions.

---

## UX/design conventions already established (match these in any new work)

- **No raw free-text where a structured control does the job better.** This was an explicit ask from the user partway through the project — see the years-of-experience slider, platform chips, agreement toggle, and ranked could-also-be checkboxes for the pattern to follow. If you're adding a new input, ask whether a slider/chips/toggle/pills would serve better than a text box before defaulting to `<input type="text">`.
- **Never send a different payload shape to the backend just because the input widget changed.** Convert structured UI state back into the same string format the backend already expects (see "Backend contract" above). This keeps `Code.gs` stable across frontend iterations so the user doesn't have to redeploy the Apps Script for every UI tweak.
- **No em dashes in any UI copy or generated text.** This is a standing convention across the user's whole thesis project (enforced elsewhere via an explicit "dash-check" step in their document-editing workflow). Use a comma, semicolon, or restructure the sentence instead.
- **Progress stepper at the top must stay in sync** with whatever section is actually showing — `updateStepper()` in app.js is the single place this happens, driven by `showSection()`. If you add a new section, add it to `STEP_ORDER` and give it a `<div class="step" data-step="...">` entry in `index.html`.
- Visual style: serif body font (Georgia/Times), navy (`#16324a`) + teal (`#1b6fa8`) palette, pill-shaped badges/chips, generous whitespace, minimal iconography (none currently — text and color do the work). Keep new UI consistent with this rather than introducing a new visual language.

---

## Things NOT to do without checking with the user first

- Don't add localStorage/sessionStorage without confirming it's wanted — it would be a genuinely useful feature (resume an interrupted session), but changes the privacy story slightly (participant data would briefly sit in browser storage) and the user hasn't asked for it yet.
- Don't change the participant ID scheme (`SME-N`, sequential, assigned server-side) — it's referenced by this exact convention in the thesis's own supporting documents (SME Interview Draft Questions, Post-Viva materials).
- Don't add analytics, external fonts, or any third-party script tags — this is a small academic-research instrument, not a product; minimize external dependencies and privacy surface area.
- Don't change the 4 feedback categories (Code Quality / Bugs / Optimization / Readability) or their definitions — these are fixed by the thesis's own taxonomy, not this tool's to redefine.

---

## Reasonable next steps, if asked for enhancement ideas (not a to-do list, just context)

- Resume-in-progress support (localStorage-backed) so a researcher can survive an accidental tab close mid-interview — ask the user first, per above.
- A researcher-only "review before submit" screen at the end of each section, in case they want to correct a typo before it's written to the Sheet (currently every section submit is immediate/final).
- Exporting a printable/PDF summary of one participant's full session from the Sheet, for attaching to thesis appendices.
- Accessibility pass (keyboard navigation through the custom radio-pill/chip controls, ARIA roles) — the current controls are clickable divs with a native `<input>` inside for semantics, but haven't been tested with a screen reader.

None of these were requested yet. Confirm scope with the user before building any of them.
