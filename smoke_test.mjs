import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Use a small same-origin static server rather than file://. The production
// iframe contract deliberately requires an exact origin match, while file://
// documents have opaque origins and cannot faithfully exercise that check.
const server = http.createServer((req, res) => {
  const requestPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
  const target = path.resolve(__dirname, relativePath);
  if (!target.startsWith(__dirname + path.sep) && target !== path.join(__dirname, 'index.html')) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(target, (err, content) => {
    if (err) {
      // Flutter's real output is copied into prototype/ only after its web
      // build. Until then this same-origin fixture lets the questionnaire
      // test exercise the parent-side iframe contract without a 404 noise.
      if (requestPath.startsWith('/prototype/')) {
        res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>Prototype fixture</title>');
        return;
      }
      res.writeHead(404).end();
      return;
    }
    const type = target.endsWith('.js') ? 'application/javascript' : target.endsWith('.css') ? 'text/css' : 'text/html';
    res.writeHead(200, { 'content-type': type }).end(content);
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const fileUrl = 'http://127.0.0.1:' + port + '/';

// A fake config.js loaded via addInitScript, so SUPABASE_URL/SUPABASE_ANON_KEY
// look configured and app.js's real fetch-driven logic runs (not the
// placeholder screen).
const FAKE_CONFIG = "const SUPABASE_URL = 'https://fake-project.supabase.co'; const SUPABASE_ANON_KEY = 'fake-anon-key';";

// supabase/migration.sql's findings table (line/title/category) — mirrored
// here so the stub's submit_guess response matches the real RPC contract,
// including the line number (a prior version of this stub hardcoded line: 0,
// which nothing checked until the reveal UI started displaying it).
const FINDINGS = {
  1: { line: 5,  title: 'Hardcoded Production API Key',          category: 'Code Quality',  explanation: 'The production merchant key is embedded directly in the source as a string literal.' },
  2: { line: 28, title: 'Incorrect Refund Calculation Logic',     category: 'Bugs',           explanation: 'A refunded transaction amount is subtracted twice, over-correcting the total.' },
  3: { line: 40, title: 'Empty Catch Block Suppresses Failures',  category: 'Bugs',           explanation: 'Every exception from a failed payment retry is silently discarded here.' },
  4: { line: 17, title: 'Sequential Await in Loop',               category: 'Optimization',   explanation: 'Each payment in the batch is awaited before the next one starts.' },
  5: { line: 44, title: 'Inefficient Duplicate Reference Check',  category: 'Optimization',   explanation: 'This check scans the entire recentRefs list linearly on every call.' },
  6: { line: 51, title: 'Imperative String Joining',              category: 'Readability',    explanation: 'The loop manually tracks the index to decide when to add a separator.' }
};

// Exact highlighted spans from the reviewed JomPAYAlpha.dart record in the
// real Glance app. The website may expose these ranges before a guess, but
// never the category assigned to a particular finding.
const FINDING_LINE_COUNTS = { 1: 1, 2: 2, 3: 1, 4: 6, 5: 6, 6: 9 };

const RESEARCHER_DASHBOARD = {
  generatedAt: '2026-08-13T12:00:00.000Z',
  participants: [
    {
      participantId: 'SME-10', participantName: 'Aisha Rahman', studyPath: 'full_sme', createdAt: '2026-08-13T09:00:00.000Z',
      yearsExperience: '8 years', platforms: 'Android, Kotlin', role: 'Mobile Engineer', languageFamiliarity: null, consentedAt: '2026-08-13T09:01:00.000Z',
      sus1: 4, sus2: 2, sus3: 4, sus4: 2, sus5: 4, sus6: 2, sus7: 4, sus8: 2, sus9: 4, sus10: 2, susScore: 75,
      susFeedbackDifficulty: 'The code preview needs clearer line highlighting.', susFeedbackImprovement: 'Make the review result easier to scan.',
      sampleId: 'mysejahtera-alpha-dart-v1', openedAt: '2026-08-13T09:05:00.000Z', reviewCompletedAt: '2026-08-13T09:06:00.000Z', feedbackOpenedAt: '2026-08-13T09:07:00.000Z', fixAppliedAt: '2026-08-13T09:08:00.000Z'
    },
    {
      participantId: 'SME-11', participantName: 'Farid Omar', studyPath: 'sus_only', createdAt: '2026-08-13T10:00:00.000Z',
      yearsExperience: null, platforms: null, role: null, languageFamiliarity: 'Dart and Kotlin', consentedAt: '2026-08-13T10:01:00.000Z',
      sus1: 5, sus2: 1, sus3: 5, sus4: 1, sus5: 5, sus6: 1, sus7: 5, sus8: 1, sus9: 5, sus10: 1, susScore: 100,
      susFeedbackDifficulty: null, susFeedbackImprovement: null,
      sampleId: 'mysejahtera-alpha-dart-v1', openedAt: '2026-08-13T10:05:00.000Z', reviewCompletedAt: '2026-08-13T10:06:00.000Z', feedbackOpenedAt: '2026-08-13T10:07:00.000Z', fixAppliedAt: '2026-08-13T10:08:00.000Z'
    }
  ],
  categoryValidation: [
    { participantId: 'SME-10', studyPath: 'full_sme', findingNum: 1, line: 5, findingTitle: 'Hardcoded Production API Key', guess: 'Code Quality', aiCategory: 'Code Quality', agreement: 'Yes', correctCategory: null, couldAlsoBe: null, guessAt: '2026-08-13T09:02:00.000Z', agreementAt: '2026-08-13T09:03:00.000Z' },
    { participantId: 'SME-10', studyPath: 'full_sme', findingNum: 2, line: 28, findingTitle: 'Incorrect Refund Calculation Logic', guess: 'Code Quality', aiCategory: 'Bugs', agreement: 'No', correctCategory: 'Code Quality', couldAlsoBe: null, guessAt: '2026-08-13T09:03:00.000Z', agreementAt: '2026-08-13T09:04:00.000Z' }
  ],
  interviews: [
    { participantId: 'SME-10', studyPath: 'full_sme', createdAt: '2026-08-13T09:01:30.000Z', q2: 'Example answer', q3: '', q4: '', q5: '', q6: '' }
  ]
};

var submitGuessCallCount = {}; // findingNum -> count, so the resume test can prove no duplicate POST
var assignIdCallCount = 0; // proves the Back-to-Intake guard doesn't mint a second participant ID
var assignSusOnlyIdCallCount = 0;
var lastAssignIdPayload = null;
var lastAssignSusOnlyPayload = null;
var saveConsentCallCount = 0;
var lastConsentPayload = null;
var susPayloads = [];
var handsOnMilestoneCallCount = {}; // milestone -> count; the task RPC must be idempotent client-side too
var passwordSignInCallCount = 0;
var passwordSetupLinkCallCount = 0;
var passwordUpdateCallCount = 0;
var researcherDashboardCallCount = 0;
var researcherSignoutCallCount = 0;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1100 } });

// Intercept the real config.js request and serve the fake project instead.
await page.route('**/config.js', route => route.fulfill({ contentType: 'application/javascript', body: FAKE_CONFIG }));

await page.route('**/auth/v1/*', async (route) => {
  const req = route.request();
  const pathName = new URL(req.url()).pathname;
  if (pathName.endsWith('/token')) {
    const body = JSON.parse(req.postData());
    passwordSignInCallCount++;
    assert(new URL(req.url()).searchParams.get('grant_type') === 'password', 'researcher login uses Supabase password authentication');
    assert(body.email === 'muhammadsyaheerdaniel@gmail.com', 'password sign-in is limited to the approved researcher email');
    assert(body.password === 'researcher-test-password', 'researcher password is submitted only to Supabase Auth');
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ access_token: 'researcher-access-token' }) });
    return;
  }
  if (pathName.endsWith('/otp')) {
    const body = JSON.parse(req.postData());
    const otpUrl = new URL(req.url());
    passwordSetupLinkCallCount++;
    assert(body.email === 'muhammadsyaheerdaniel@gmail.com', 'one-time setup link is limited to the approved researcher email');
    assert(body.create_user === false, 'one-time setup does not create an additional Auth user');
    assert(otpUrl.searchParams.get('redirect_to') === 'https://syaheerdnl.github.io/GlanceSMEResponses/researcher.html', 'one-time setup link sends the authorised live dashboard page through GoTrue\'s required redirect query parameter');
    await route.fulfill({ contentType: 'application/json', body: '{}' });
    return;
  }
  if (pathName.endsWith('/user')) {
    if (req.method() === 'PUT') {
      const body = JSON.parse(req.postData());
      passwordUpdateCallCount++;
      assert(req.headers().authorization === 'Bearer researcher-access-token', 'password update requires the authenticated researcher session');
      assert(body.password === 'researcher-new-password', 'new password is sent only to Supabase Auth');
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ email: 'muhammadsyaheerdaniel@gmail.com' }) });
      return;
    }
    const authorized = req.headers().authorization === 'Bearer researcher-access-token';
    await route.fulfill({
      status: authorized ? 200 : 401,
      contentType: 'application/json',
      body: JSON.stringify(authorized ? { email: 'muhammadsyaheerdaniel@gmail.com' } : { message: 'Invalid JWT' })
    });
    return;
  }
  if (pathName.endsWith('/logout')) {
    researcherSignoutCallCount++;
    assert(req.headers().authorization === 'Bearer researcher-access-token', 'researcher sign-out revokes the authenticated server session');
    await route.fulfill({ contentType: 'application/json', body: '{}' });
    return;
  }
  await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
});

// Stub the Supabase backend itself: intercept every RPC call
// (POST {SUPABASE_URL}/rest/v1/rpc/<function_name>) and dispatch on the
// function name in the URL path, matching how PostgREST actually routes
// these — not on a body.action field like the old Apps Script stub did.
await page.route('**/rest/v1/rpc/*', async (route) => {
  const req = route.request();
  const fnName = new URL(req.url()).pathname.split('/').pop();
  const body = JSON.parse(req.postData());
  let resp;
  switch (fnName) {
    case 'assign_id':
      assignIdCallCount++;
      lastAssignIdPayload = body;
      assert(body.p_participant_name === 'Jane Doe', 'full-SME assignment records the participant name in its protected field');
      // Real assign_id always mints a fresh SME-N — a second call would be
      // SME-2. Returning that here (rather than hardcoding SME-1) means the
      // app.js guard against re-submitting Intake is actually exercised,
      // not just assumed.
      resp = { ok: true, id: 'SME-' + assignIdCallCount };
      break;
    case 'assign_sus_only_id':
      assert(!Object.prototype.hasOwnProperty.call(body, 'p_access_code'), 'SUS-only assignment never sends the browser-only SME access code');
      assert(Object.keys(body).length === 2 && body.p_participant_name === 'SUS Test Participant' && body.p_language_familiarity === 'Dart and Kotlin', 'SUS-only assignment sends only the participant name and language familiarity');
      lastAssignSusOnlyPayload = body;
      assignSusOnlyIdCallCount++;
      // Both assignment RPCs share the same identity-backed SME-N sequence.
      resp = { ok: true, id: 'SME-' + (assignIdCallCount + assignSusOnlyIdCallCount) };
      break;
    case 'save_consent':
      saveConsentCallCount++;
      lastConsentPayload = body;
      resp = { ok: true };
      break;
    case 'save_interview':
      resp = { ok: true };
      break;
    case 'submit_guess': {
      submitGuessCallCount[body.p_finding_num] = (submitGuessCallCount[body.p_finding_num] || 0) + 1;
      const f = FINDINGS[body.p_finding_num];
      resp = { ok: true, title: f.title, category: f.category, line: f.line, explanation: f.explanation };
      break;
    }
    case 'submit_agreement':
      resp = { ok: true };
      break;
    case 'save_sus':
      susPayloads.push(body);
      resp = { ok: true, susScore: 82.5 };
      break;
    case 'save_hands_on_milestone':
      assert(body.p_sample_id === 'mysejahtera-alpha-dart-v1', 'hands-on RPC sends only the fixed sample id');
      handsOnMilestoneCallCount[body.p_milestone] = (handsOnMilestoneCallCount[body.p_milestone] || 0) + 1;
      resp = { ok: true };
      break;
    case 'researcher_dashboard':
      researcherDashboardCallCount++;
      if (req.headers().authorization !== 'Bearer researcher-access-token') {
        await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Researcher access required.' }) });
        return;
      }
      resp = RESEARCHER_DASHBOARD;
      break;
    default:
      resp = { ok: false, error: 'unhandled RPC function in stub: ' + fnName };
  }
  await route.fulfill({ contentType: 'application/json', body: JSON.stringify(resp) });
});

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

await page.goto(fileUrl);
await page.waitForTimeout(200);

async function shot(name) {
  await page.screenshot({ path: path.join(__dirname, 'preview', name), fullPage: true });
}

function assert(cond, msg) {
  if (!cond) throw new Error('SMOKE TEST FAILED: ' + msg);
  console.log('OK: ' + msg);
}

// --- 1. Study cover loads for real (not the setup-needed message) ---
const bodyText = await page.textContent('body');
assert(!bodyText.includes('Setup needed'), 'real app.js runs (no setup-needed placeholder)');
assert(await page.locator('#section-cover.active').count() === 1, 'study cover active on load');
assert(await page.locator('#stepper.hidden').count() === 1, 'study flow stepper is hidden on the cover');
assert(await page.locator('#resume-banner:not(.hidden)').count() === 0, 'resume banner hidden with no saved session');
assert((await page.textContent('#section-cover')).includes('Dart and Kotlin'), 'cover clearly names the study focus');
await shot('real-0-cover.png');
await page.click('#btn-cover-start');
await page.waitForSelector('#section-consent.active');
assert(await page.locator('#stepper.hidden').count() === 1, 'stepper remains hidden while consent is considered');
assert((await page.textContent('#section-consent')).includes('Consent version: SME-web-consent-v4'), 'consent page displays the same current version recorded by the consent RPC');
await shot('real-0b-consent.png');
await page.click('#btn-consent-continue');
assert(await page.locator('#consent-error:not(.hidden)').count() === 1, 'blocks continuing without explicit consent');
await page.click('#btn-consent-decline');
assert(await page.locator('#consent-declined:not(.hidden)').count() === 1, 'declining consent records no response and explains the next choice');
await page.check('#consent-agree');
await page.click('#btn-consent-continue');
await page.waitForSelector('#section-access.active');
assert(await page.locator('#stepper.hidden').count() === 1, 'stepper remains hidden while the researcher-supervised study path is selected');
await shot('real-0c-study-access.png');
await page.fill('#access-code', '1234');
await page.click('#btn-access-sme');
assert(await page.locator('#access-error:not(.hidden)').count() === 1, 'wrong SME code does not switch the participant to a different study path');
await page.fill('#access-code', '0811');
await page.click('#btn-access-sme');
await page.waitForSelector('#section-intake.active');
assert(!(await page.evaluate(() => localStorage.getItem('smeSession_v1'))).includes('0811'), 'browser access code is not persisted in the session');
await shot('real-1-intake.png');

// --- 1b. Resume boundary: typing into Intake (unsubmitted) and reloading must NOT
// resume anything — nothing is persisted until assignId actually succeeds. ---
await page.fill('#in-role', 'Some role typed but never submitted');
await page.reload();
await page.waitForTimeout(200);
assert(await page.locator('#section-cover.active').count() === 1, 'reload before assignId returns to the cover (no premature persistence)');
assert(await page.locator('#resume-banner:not(.hidden)').count() === 0, 'resume banner still hidden — unsubmitted intake fields are not a resumable session');
await page.click('#btn-cover-start');
await page.waitForSelector('#section-consent.active');
await page.check('#consent-agree');
await page.click('#btn-consent-continue');
await page.waitForSelector('#section-access.active');
await page.fill('#access-code', '0811');
await page.click('#btn-access-sme');
await page.waitForSelector('#section-intake.active');
assert((await page.inputValue('#in-role')) === '', 'unsubmitted intake field is not restored (was never persisted)');

// --- 2. Fill intake, submit, expect assigned ID + the Demo section ---
await page.fill('#in-name', 'Jane Doe');
await page.fill('#in-years-slider', '8');
await page.dispatchEvent('#in-years-slider', 'input');
await page.click('#platform-chips .chip:has-text("Android")');
await page.click('#platform-chips .chip:has-text("Kotlin")');
await page.click('#platform-chips .chip:has-text("Dart")');
await page.click('#platform-chips .chip:has-text("Flutter")');
await page.fill('#in-role', 'Senior Mobile Engineer');
assert((await page.textContent('#in-years-readout')).includes('8 years'), 'years slider readout updates live');
await page.click('#btn-intake-submit');
await page.waitForSelector('#section-demo.active');
await page.waitForTimeout(350);
assert((await page.textContent('#id-badge-demo')).trim() === 'SME-1', 'assigned ID SME-1 shown after intake, on the Demo section');
assert(saveConsentCallCount === 1, 'explicit consent is recorded exactly once after the anonymous participant ID is assigned');
assert(lastAssignIdPayload.p_years_experience === '8 years' && lastAssignIdPayload.p_platforms.includes('Dart') && lastAssignIdPayload.p_role === 'Senior Mobile Engineer', 'full-SME assignment records the shared professional background');
assert(lastConsentPayload.p_id === 'SME-1' && lastConsentPayload.p_accepted === true && lastConsentPayload.p_consent_version === 'sme-web-consent-v4', 'consent RPC stores only the participant ID, true acceptance, and the current form version');
assert(!(await page.evaluate(() => localStorage.getItem('smeSession_v1'))).includes('Jane Doe'), 'participant name is not retained in the browser recovery session');
await shot('real-2-demo.png');

// --- 2b. Back-button chain: Demo -> Intake -> (Continue again) -> Demo,
// without minting a second participant ID. assignId is NOT idempotent
// (unlike saveInterview's upsert), so re-clicking Continue on Intake after
// going back must navigate forward without re-calling the backend. ---
await page.click('#btn-demo-back');
await page.waitForSelector('#section-intake.active');
assert((await page.inputValue('#in-role')) === 'Senior Mobile Engineer', 'going back to Intake keeps the previously entered values (DOM untouched, not re-rendered)');
await page.click('#btn-intake-submit');
await page.waitForSelector('#section-demo.active');
assert((await page.textContent('#id-badge-demo')).trim() === 'SME-1', 'still SME-1 after going back and forward again — no duplicate participant created');
assert(assignIdCallCount === 1, 'assign_id was only actually POSTed once, despite Continue being clicked twice');

// --- 2c. Resume: reload right on the Demo section ---
await page.reload();
await page.waitForTimeout(250);
assert(await page.locator('#resume-banner:not(.hidden)').count() === 1, 'resume banner shows after reload once a participant ID exists');
assert((await page.textContent('#resume-banner-text')).includes('SME-1'), 'resume banner names the correct participant ID');
assert(await page.locator('#section-demo.active').count() === 1, 'reload resumes directly on the Demo section');

// --- 2d. Continue to Interview, then test its Back button too ---
await page.click('#btn-demo-continue');
await page.waitForSelector('#section-interview.active');
await page.waitForTimeout(350);
await shot('real-2b-interview.png');
await page.click('#btn-interview-back');
await page.waitForSelector('#section-demo.active');
await page.click('#btn-demo-continue');
await page.waitForSelector('#section-interview.active');

// --- 2e. Resume: reload right after reaching interview, before any draft ---
await page.reload();
await page.waitForTimeout(250);
assert(await page.locator('#section-interview.active').count() === 1, 'reload resumes directly on the interview section');

// --- 2f. Resume: type a partial interview draft, reload, expect it restored ---
await page.fill('#q2', 'Used GitHub Copilot before.');
await page.waitForTimeout(600); // let the 400ms debounced autosave fire
assert(await page.locator('#interview-draft-status:not(.hidden)').count() === 1, '"Draft saved" indicator shows after the debounced autosave');
await page.reload();
await page.waitForTimeout(250);
assert(await page.locator('#section-interview.active').count() === 1, 'reload still resumes on interview section');
assert((await page.inputValue('#q2')) === 'Used GitHub Copilot before.', 'in-progress interview draft is restored after reload');

// --- 3. Submit interview notes, expect CVE section with code listing + finding 1 ---
await page.click('#btn-interview-submit');
await page.waitForSelector('#section-cve.active');
await page.waitForTimeout(350); // let the section fade-in finish before asserting/screenshotting (see CLAUDE.md)
assert((await page.textContent('#code-listing')).includes('BillPaymentGateway'), 'code listing rendered');

// Title/line are safe to show before a guess (only the category is gated) —
// see CLAUDE.md's blind-reveal boundary note.
assert((await page.textContent('#cve-progress')).includes('Finding 1 of 6'), 'progress line shows Finding 1 of 6');
assert((await page.textContent('#cve-finding-heading')).includes('Hardcoded Production API Key'), 'first finding title shown up front');
assert(await page.locator('#code-listing .code-line.current').count() === 1, 'exactly one code line marked as the current finding');
assert((await page.locator('#code-listing .code-line.current').textContent()).trim().startsWith('5'), 'current-marked line is line 5, matching finding 1');
assert(await page.locator('#code-listing .code-line.flagged').count() === 0, 'no line is category-colored yet — nothing has been revealed');
assert(await page.locator('.step[data-step="cve"].current').count() === 1, 'stepper shows Category Check as current step');
assert(await page.locator('.step[data-step="intake"].done').count() === 1, 'stepper shows Background as done');

// The fixed category key is deliberately color-coded before a guess. It helps
// participants distinguish the four available taxonomy choices, without
// revealing which one belongs to this particular finding.
const CATEGORY_SWATCHES = {
  'Code Quality': 'rgb(191, 79, 75)',
  'Bugs': 'rgb(168, 121, 30)',
  'Optimization': 'rgb(60, 127, 99)',
  'Readability': 'rgb(110, 99, 166)'
};
for (const [category, color] of Object.entries(CATEGORY_SWATCHES)) {
  const option = page.locator('#guess-options .radio-option', { has: page.locator('input[value="' + category + '"]') });
  const optionColor = await option.evaluate((el) => getComputedStyle(el).color);
  const inputBorderColor = await option.locator('input').evaluate((el) => getComputedStyle(el).borderTopColor);
  assert(optionColor === color, category + ' guess label uses its fixed taxonomy color');
  assert(inputBorderColor === color, category + ' guess control uses its fixed taxonomy color');
}
await shot('real-3-cve-before-reveal.png');

// --- 3b. Boundary check: before any guess, the category must not be
// anywhere reachable — not in the dot's fill, not as a flagged rail. ---
const dotStyleBefore = await page.locator('#finding-dot').evaluate((el) => getComputedStyle(el).backgroundColor);
assert(await page.locator('#finding-dot.revealed').count() === 0, 'finding dot not marked revealed before a guess');
assert(dotStyleBefore === 'rgba(0, 0, 0, 0)' || dotStyleBefore === 'transparent', 'finding dot has no fill color before a guess (' + dotStyleBefore + ')');
assert((await page.textContent('#reveal-explanation')).trim() === '', 'the "why" explanation is not present before a guess either — same gate as the category, since it would give the category away just as much');

// --- 4. Try to submit without picking a category: expect validation error ---
await page.click('#btn-submit-guess');
assert(await page.locator('#guess-error:not(.hidden)').count() === 1, 'blocks empty guess submission');

// --- 5. Pick a guess, submit, expect reveal (category never in page source before this) ---
await page.click('#guess-options .radio-option >> nth=0'); // "Code Quality"
await page.click('#btn-submit-guess');
await page.waitForSelector('#reveal-box:not(.hidden)');
await page.waitForTimeout(350); // let the reveal-box fade-in animation finish before screenshotting
assert((await page.textContent('#reveal-text')).includes('Hardcoded Production API Key') === false, 'reveal-text no longer duplicates the title (shown up front instead)');
assert((await page.textContent('#reveal-text')).includes('Code Quality'), 'reveal shows correct category');
assert((await page.textContent('#cve-finding-meta')).includes('Code Quality') && (await page.textContent('#cve-finding-meta')).includes('Line 5'), 'finding meta line updates to Category · Line N after reveal');
assert((await page.textContent('#reveal-explanation')).includes('merchant key'), 'the "why" explanation shows after reveal, alongside the category');
assert(await page.locator('#finding-dot.revealed').count() === 1, 'finding dot marked revealed after the guess is submitted');
assert(await page.locator('#code-listing .code-line.flagged').count() === 1, 'exactly one line now carries the revealed category color');
assert(submitGuessCallCount[1] === 1, 'exactly one submitGuess POST sent for finding 1 so far');
// The AI's own revealed category (Code Quality for finding 1) must not be
// tickable as a redundant "could also be" option by default — this was a
// real bug caught in live use: agreeing "Yes" left the AI's own answer
// still selectable as its own secondary fit.
assert(await page.locator('#could-also-be-options input[value="Code Quality"]').count() === 0, 'the AI\'s own revealed category is excluded from could-also-be by default, before any agreement is even picked');
await shot('real-4-cve-after-reveal.png');

// --- 5b. Resume the trickiest case: tab closes after submitGuess but before
// submitAgreement. Reloading must re-enter directly at the reveal state —
// NOT ask for a fresh guess, which would duplicate the CategoryValidation row
// (Code.gs's submitGuess has no idempotency check). ---
await page.reload();
await page.waitForTimeout(300);
assert(await page.locator('#resume-banner:not(.hidden)').count() === 1, 'resume banner shows again after mid-CVE reload');
assert(await page.locator('#section-cve.active').count() === 1, 'reload resumes directly on the CVE section');
assert(await page.locator('#btn-submit-guess:not(.hidden)').count() === 0, 'guess button stays hidden on resume — not re-prompting for a guess already recorded');
assert(await page.locator('#reveal-box:not(.hidden)').count() === 1, 'reveal box is shown immediately on resume');
assert((await page.textContent('#reveal-text')).includes('Code Quality'), 'resumed reveal still shows the correct category');
assert((await page.textContent('#reveal-explanation')).includes('merchant key'), 'resumed reveal still shows the "why" explanation too');
assert(await page.locator('#finding-dot.revealed').count() === 1, 'finding dot still shows revealed after resume');
assert(await page.locator('#code-listing .code-line.flagged').count() === 1, 'code panel still shows the revealed line colored after resume');
assert(submitGuessCallCount[1] === 1, 'resuming did NOT re-POST submitGuess for finding 1 (still exactly one call)');

// --- 5c. Agreement UX: "correct category" only shows on "No", and whichever
// category currently counts as "the established answer" is excluded from
// "could also be" — the AI's own revealed category by default (Code Quality
// for finding 1), switching to the participant's own pick once they
// disagree and choose one, and back again once they don't. ---
assert(await page.locator('#disagree-block:not(.hidden)').count() === 0, 'disagree-block hidden by default right after reveal');
await page.click('#agreement-yesno .radio-option >> nth=1'); // "No"
assert(await page.locator('#disagree-block:not(.hidden)').count() === 1, 'disagree-block shows after picking "No"');
assert(await page.locator('#could-also-be-options input[value="Code Quality"]').count() === 0, 'AI\'s category (Code Quality) still excluded after "No" alone, before picking a correct category');
await page.click('#correct-category-options .radio-option:has-text("Bugs")');
assert(await page.locator('#could-also-be-options input[value="Bugs"]').count() === 0, 'the chosen correct category (Bugs) is now excluded from could-also-be options');
assert(await page.locator('#could-also-be-options input[value="Code Quality"]').count() === 1, 'Code Quality becomes available again once a different correct category is chosen');
await page.click('#agreement-yesno .radio-option >> nth=0'); // back to "Yes"
assert(await page.locator('#disagree-block:not(.hidden)').count() === 0, 'disagree-block hides again after switching back to "Yes"');
assert(await page.locator('#could-also-be-options input[value="Bugs"]').count() === 1, 'Bugs becomes available again once correct-category is cleared');
assert(await page.locator('#could-also-be-options input[value="Code Quality"]').count() === 0, 'exclusion reverts back to the AI\'s own category (Code Quality) after switching back to "Yes"');

// --- 6. Walk through all 6 findings ---
for (let i = 0; i < 6; i++) {
  await page.click('#agreement-yesno .radio-option >> nth=0'); // "Yes"
  await page.click('#btn-next-finding');
  await page.waitForTimeout(150);
  if (i < 5) {
    await page.waitForSelector('#cve-finding-card:not(.hidden)');
    const nextFinding = i + 2;
    assert(
      await page.locator('#code-listing .code-line.current').count() === FINDING_LINE_COUNTS[nextFinding],
      'finding ' + nextFinding + ' marks its full Glance line range before any category is revealed'
    );
    // pick a guess for the next finding
    await page.click('#guess-options .radio-option >> nth=1');
    await page.click('#btn-submit-guess');
    await page.waitForSelector('#reveal-box:not(.hidden)');
  }
}
await page.waitForSelector('#cve-done:not(.hidden)');
assert(true, 'all 6 findings walked through, cve-done shown');
assert(await page.locator('#code-listing .code-line.flagged').count() === 25, 'all 6 findings now show their full revealed Glance line ranges in the code panel');
for (let n = 1; n <= 6; n++) {
  assert(submitGuessCallCount[n] === 1, 'finding ' + n + ' got exactly one submitGuess POST across the whole run');
}

await page.click('#btn-to-prototype');
await page.waitForSelector('#section-prototype.active');
assert(await page.locator('#study-prototype-frame').count() === 1, 'hands-on page contains the embedded Glance iframe');
assert(await page.locator('#btn-prototype-continue:disabled').count() === 1, 'SUS remains locked before the hands-on task is complete');

const prototypeNonce = await page.evaluate(() => JSON.parse(localStorage.getItem('smeSession_v1')).prototype.nonce);
assert(typeof prototypeNonce === 'string' && prototypeNonce.length === 48, 'parent generated and persisted a 24-byte prototype nonce');

async function sendPrototypeMilestone(milestone, nonce = prototypeNonce) {
  await page.locator('#study-prototype-frame').evaluate((frame, payload) => {
    return new Promise((resolve) => {
      const encoded = JSON.stringify({ type: 'glance-study:milestone', nonce: payload.nonce, milestone: payload.milestone });
      frame.onload = resolve;
      frame.srcdoc = '<script>parent.postMessage(' + encoded + ',"*");</script>';
    });
  }, { milestone, nonce });
  await page.waitForTimeout(150);
}

await sendPrototypeMilestone('opened', 'incorrect-nonce');
assert(!handsOnMilestoneCallCount.opened, 'wrong-nonce iframe message is ignored');
await sendPrototypeMilestone('opened');
assert(handsOnMilestoneCallCount.opened === 1, 'opened milestone recorded once through the task RPC');
assert(await page.locator('#prototype-progress [data-milestone="opened"].complete').count() === 1, 'opened status is displayed after the RPC succeeds');
await sendPrototypeMilestone('review-completed');
await sendPrototypeMilestone('feedback-opened');
assert(handsOnMilestoneCallCount['review-completed'] === 1 && handsOnMilestoneCallCount['feedback-opened'] === 1, 'review and feedback milestones are each recorded once');

// A reload after partial task completion resumes inside the iframe step and
// preserves only the parent-side milestone state; it does not expose a
// participant ID or response data to the iframe.
await page.reload();
await page.waitForTimeout(300);
assert(await page.locator('#section-prototype.active').count() === 1, 'reload resumes on the hands-on step');
assert(await page.locator('#prototype-progress [data-milestone="review-completed"].complete').count() === 1, 'partial hands-on progress survives a questionnaire reload');
assert(await page.locator('#btn-prototype-continue:disabled').count() === 1, 'SUS stays locked after an incomplete resumed task');

await sendPrototypeMilestone('fix-applied');
await sendPrototypeMilestone('fix-applied');
assert(handsOnMilestoneCallCount['fix-applied'] === 1, 'duplicate fix milestone is not POSTed again');
assert(await page.locator('#btn-prototype-continue:not(:disabled)').count() === 1, 'SUS unlocks only after all four milestones are recorded');
await shot('real-5-prototype.png');

await page.click('#btn-prototype-continue');
await page.waitForSelector('#section-sus.active');
await page.waitForTimeout(350);
assert((await page.locator('#sus-items > div').count()) === 10, 'all 10 SUS items rendered');
assert((await page.locator('#sus-items > .sus-item').count()) === 10, 'SUS items use the structured response grid');
assert((await page.locator('#sus-items .sus-likert .radio-option').count()) === 50, 'SUS grid keeps all 50 selectable tap targets');
assert(await page.locator('#sus-feedback-difficulty, #sus-feedback-improvement').count() === 2, 'optional feedback fields appear below the fixed SUS instrument');
assert((await page.textContent('.sus-feedback')).includes('not part of the SUS score'), 'optional feedback is clearly separated from the SUS score');
await shot('real-5-sus.png');

// --- 6b. Resume: answer a few SUS items, reload, expect them restored ---
await page.click('#sus-items > div:nth-child(1) .radio-option >> nth=2'); // "3"
await page.click('#sus-items > div:nth-child(2) .radio-option >> nth=4'); // "5"
await page.fill('#sus-feedback-difficulty', 'A draft concern that must not survive a reload.');
await page.fill('#sus-feedback-improvement', 'A draft improvement that must not survive a reload.');
await page.waitForTimeout(200);
assert(!(await page.evaluate(() => localStorage.getItem('smeSession_v1'))).includes('A draft concern'), 'optional feedback is never written to browser recovery storage');
await page.reload();
await page.waitForTimeout(300);
assert(await page.locator('#section-sus.active').count() === 1, 'reload resumes on the SUS section');
assert(await page.locator('#sus-items > div:nth-child(1) .radio-option.selected').count() === 1, 'first SUS answer restored after reload');
assert(await page.locator('#sus-items > div:nth-child(2) .radio-option.selected').count() === 1, 'second SUS answer restored after reload');
assert((await page.inputValue('#sus-feedback-difficulty')) === '' && (await page.inputValue('#sus-feedback-improvement')) === '', 'optional feedback is cleared after a reload instead of being stored locally');

// --- 7. Submit SUS without answering all items: expect error ---
await page.click('#btn-sus-submit');
assert(await page.locator('#sus-error:not(.hidden)').count() === 1, 'blocks incomplete SUS submission');

// answer all 10 (re-picks the two already-restored ones too, harmless)
for (let i = 1; i <= 10; i++) {
  await page.click('#sus-items > div:nth-child(' + i + ') .radio-option >> nth=2'); // pick "3" for each
}
await page.fill('#sus-feedback-difficulty', 'The result view was difficult to scan on a phone.');
await page.fill('#sus-feedback-improvement', 'Group the most important review findings first.');
await page.click('#btn-sus-submit');
await page.waitForSelector('#section-done.active');
await page.waitForTimeout(350);
assert((await page.textContent('#done-id')).includes('SME-1'), 'done screen shows participant id');
assert((await page.textContent('#done-sus-score')).includes('responses have been recorded'), 'done screen confirms recording without presenting SUS as a participant pass/fail score');
assert(!(await page.textContent('#done-sus-score')).includes('82.5'), 'done screen does not reveal the numerical SUS score');
assert(susPayloads.length === 1 && susPayloads[0].p_feedback_difficulty.includes('difficult to scan') && susPayloads[0].p_feedback_improvement.includes('Group the most important'), 'full-SME SUS submission includes optional written feedback separately from the ten scores');
await shot('real-6-done.png');

// --- 7b. A completed run clears the saved session — reloading must NOT resume it ---
await page.reload();
await page.waitForTimeout(200);
assert(await page.locator('#resume-banner:not(.hidden)').count() === 0, 'no resume banner after a completed run (session was cleared)');
assert(await page.locator('#section-cover.active').count() === 1, 'a completed run reloads fresh at the study cover, not back at Done');

// --- 8. SUS-only route: no code selects the shorter route, but it still
// completes the shared Background screen before the hands-on task and SUS. ---
await page.click('#btn-cover-start');
await page.waitForSelector('#section-consent.active');
await page.check('#consent-agree');
await page.click('#btn-consent-continue');
await page.waitForSelector('#section-access.active');
await page.click('#btn-access-sus');
await page.waitForSelector('#section-intake.active');
assert(await page.locator('.step[data-step="intake"].current').count() === 1, 'SUS-only route begins with its route-specific Background step');
assert(await page.locator('.step[data-step="interview"].hidden').count() === 1, 'SUS-only stepper hides Interview');
assert(await page.locator('.step[data-step="cve"].hidden').count() === 1, 'SUS-only stepper hides Category Check');
assert((await page.locator('.step:not(.hidden)').count()) === 5, 'SUS-only stepper contains Background, Demo, Hands-on, SUS, and Done');
assert(await page.locator('#sme-background-fields.hidden').count() === 1 && await page.locator('#sus-language-fields:not(.hidden)').count() === 1, 'SUS-only Background hides SME professional fields and shows language familiarity');
await shot('real-6b-sus-background.png');
await page.fill('#in-name', 'SUS Test Participant');
await page.click('#sus-language-familiarity .radio-option:has-text("Dart and Kotlin")');
await page.click('#btn-intake-submit');
await page.waitForSelector('#section-demo.active');
assert(assignSusOnlyIdCallCount === 1, 'SUS-only route calls its narrow ID-assignment RPC exactly once');
assert(saveConsentCallCount === 2, 'SUS-only participant consent is recorded after the anonymous ID is assigned');
assert(lastConsentPayload.p_id === 'SME-2', 'SUS-only consent is linked to the next anonymous SME-N ID');
assert(lastAssignSusOnlyPayload.p_participant_name === 'SUS Test Participant' && lastAssignSusOnlyPayload.p_language_familiarity === 'Dart and Kotlin', 'SUS-only assignment saves name and Dart/Kotlin familiarity without the SME profile');
assert((await page.textContent('#id-badge-demo')).trim() === 'SME-2', 'SUS-only route displays its assigned anonymous ID');
assert((await page.textContent('#demo-help')).includes('guided hands-on task'), 'SUS-only demo explains its shorter route');

// A reload keeps the same path and participant ID rather than minting another.
await page.reload();
await page.waitForTimeout(250);
assert(await page.locator('#section-demo.active').count() === 1, 'SUS-only route resumes on its saved demonstration step');
assert((await page.textContent('#id-badge-demo')).trim() === 'SME-2', 'SUS-only resume retains the same participant ID');
assert(assignSusOnlyIdCallCount === 1, 'SUS-only resume does not mint another participant ID');

await page.click('#btn-demo-continue');
await page.waitForSelector('#section-prototype.active');
assert(await page.locator('#btn-prototype-continue:disabled').count() === 1, 'SUS-only route still locks SUS until the hands-on task is complete');
const susOnlyNonce = await page.evaluate(() => JSON.parse(localStorage.getItem('smeSession_v1')).prototype.nonce);
await sendPrototypeMilestone('opened', susOnlyNonce);
await sendPrototypeMilestone('review-completed', susOnlyNonce);
await sendPrototypeMilestone('feedback-opened', susOnlyNonce);
await sendPrototypeMilestone('fix-applied', susOnlyNonce);
assert(handsOnMilestoneCallCount.opened === 2 && handsOnMilestoneCallCount['fix-applied'] === 2, 'SUS-only hands-on milestones are recorded for its own participant');
assert(await page.locator('#btn-prototype-continue:not(:disabled)').count() === 1, 'SUS-only route unlocks SUS only after all four hands-on milestones');
await page.click('#btn-prototype-continue');
await page.waitForSelector('#section-sus.active');
assert((await page.locator('#sus-items > .sus-item').count()) === 10, 'SUS-only route reaches the same 10-item SUS instrument');
for (let i = 1; i <= 10; i++) {
  await page.click('#sus-items > div:nth-child(' + i + ') .radio-option >> nth=2');
}
await page.click('#btn-sus-submit');
await page.waitForSelector('#section-done.active');
assert(susPayloads.length === 2 && susPayloads[1].p_feedback_difficulty === '' && susPayloads[1].p_feedback_improvement === '', 'SUS-only route can submit the same scale with optional feedback left blank');

// --- 9. Researcher dashboard: public URL alone exposes no records. Password
// sign-in obtains a Supabase session token, then the server-side RPC receives
// that token. The dashboard itself has no browser PIN.
await page.goto(fileUrl + 'researcher.html');
await page.waitForSelector('#researcher-login:not(.hidden)');
assert((await page.locator('link[href="style.css?v=20260814-pie-charts"]').count()) === 1, 'researcher page cache-busts the stylesheet that lays out its pie charts');
assert(await page.locator('#researcher-dashboard.hidden').count() === 1, 'researcher dashboard is hidden before password authentication');
await page.fill('#researcher-password', 'researcher-test-password');
await page.click('#btn-researcher-login');
await page.waitForSelector('#researcher-dashboard:not(.hidden)');
assert(passwordSignInCallCount === 1, 'researcher login sends exactly one password sign-in request');
assert(await page.locator('#researcher-password-panel.hidden').count() === 1, 'routine password sign-in does not show the one-time setup panel');
assert(researcherDashboardCallCount === 1, 'researcher dashboard RPC runs only after the authenticated session is verified');
assert((await page.textContent('#metric-participants')).trim() === '2', 'researcher dashboard calculates completed SUS participants from protected data');
assert((await page.textContent('#metric-sus')).trim() === '87.5', 'researcher dashboard calculates the mean SUS score');
assert((await page.textContent('#researcher-cve-overall')).includes('50%'), 'researcher dashboard calculates the blind category match rate');
assert(await page.locator('#researcher-participant-rows tr').count() === 2, 'researcher dashboard shows anonymous participant overview rows');
assert((await page.textContent('#researcher-participant-rows')).includes('Aisha Rahman') && (await page.textContent('#researcher-participant-rows')).includes('Farid Omar'), 'researcher dashboard alone shows the separately protected participant names');
assert(!(await page.textContent('#researcher-participant-rows')).includes('clearer line highlighting'), 'free-text feedback is excluded from the participant overview table');
assert(!page.url().includes('researcher-access-token'), 'researcher access token is never placed in the URL');
assert(await page.locator('.researcher-chart-card').count() === 4, 'researcher dashboard provides four aggregate visual-summary charts');
assert((await page.textContent('#chart-sus-distribution')).includes('68 to 79') && (await page.textContent('#chart-sus-distribution')).includes('80 to 100'), 'SUS chart groups completed scores into readable score bands');
assert(await page.locator('#chart-sus-distribution .researcher-donut').count() === 1, 'SUS score-band distribution is rendered as an actual pie-style donut chart');
assert(await page.locator('#chart-route-split .researcher-donut').count() === 1, 'study-route distribution is rendered as an actual pie-style donut chart');
assert((await page.textContent('#chart-hands-on-progress')).includes('2 / 2'), 'hands-on chart reports milestone completion against the selected participant group');
assert((await page.textContent('#chart-category-match')).includes('100% (1/1)') && (await page.textContent('#chart-category-match')).includes('0% (0/1)'), 'category chart reports blind-match rates without exposing participant identities');
const summaryDownloadPromise = page.waitForEvent('download');
await page.click('#btn-export-summary');
const summaryDownload = await summaryDownloadPromise;
const summaryCsv = fs.readFileSync(await summaryDownload.path(), 'utf8');
assert(summaryCsv.includes('"mean_sus_score","87.5"') && !summaryCsv.includes('Aisha Rahman'), 'aggregate summary CSV exports the selected statistics without participant names');
const chartDownloadPromise = page.waitForEvent('download');
await page.click('#btn-export-charts');
const chartDownload = await chartDownloadPromise;
const chartPng = fs.readFileSync(await chartDownload.path());
assert(chartPng.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', 'visual-summary charts export as a PNG image');
const susDownloadPromise = page.waitForEvent('download');
await page.click('#btn-export-sus');
const susDownload = await susDownloadPromise;
const susCsv = fs.readFileSync(await susDownload.path(), 'utf8');
assert(susCsv.includes('"feedback_difficulty","feedback_improvement"') && susCsv.includes('The code preview needs clearer line highlighting.'), 'protected SUS CSV includes optional feedback and no other dashboard surface does');
await shot('real-7-researcher-dashboard.png');
await page.selectOption('#researcher-route-filter', 'sus_only');
assert((await page.textContent('#metric-participants')).trim() === '1', 'researcher filter separates SUS-only participants');
assert(await page.locator('#researcher-cve-unavailable:not(.hidden)').count() === 1, 'researcher dashboard explains why SUS-only records have no category-validation result');
assert((await page.textContent('#chart-category-match')).includes('Category validation is collected only in the full SME route.'), 'visual summary follows the SUS-only filter and does not fabricate category data');
await page.selectOption('#researcher-route-filter', 'full_sme');
assert(await page.locator('#researcher-participant-rows tr').count() === 1, 'researcher filter separates full-SME participants');
await page.click('#btn-researcher-signout');
await page.waitForSelector('#researcher-login:not(.hidden)');
assert(researcherSignoutCallCount === 1, 'researcher sign-out clears the local token and revokes the server session');

await page.click('#btn-researcher-setup');
await page.waitForSelector('#researcher-login-status:not(.hidden)');
assert(passwordSetupLinkCallCount === 1, 'first-time setup sends only one email link');
await page.goto(fileUrl + 'researcher.html?setup=1#access_token=researcher-access-token&token_type=bearer');
await page.waitForSelector('#researcher-dashboard:not(.hidden)');
assert(researcherDashboardCallCount === 2, 'one-time setup link still requires an authenticated Supabase session');
assert(await page.locator('#researcher-password-panel:not(.hidden)').count() === 1, 'one-time setup link reveals the password setup panel');
await page.fill('#researcher-new-password', 'researcher-new-password');
await page.click('#btn-researcher-password');
await page.waitForSelector('#researcher-password-status:not(.hidden)');
assert(passwordUpdateCallCount === 1, 'authenticated researcher can save a password for future password-only access');

console.log('errors observed:', errors);
assert(errors.length === 0, 'no console/page errors during the whole flow');

await browser.close();
await new Promise((resolve) => server.close(resolve));
console.log('SMOKE TEST PASSED');
