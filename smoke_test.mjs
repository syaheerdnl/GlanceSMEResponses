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

var submitGuessCallCount = {}; // findingNum -> count, so the resume test can prove no duplicate POST
var assignIdCallCount = 0; // proves the Back-to-Intake guard doesn't mint a second participant ID
var assignSusOnlyIdCallCount = 0;
var saveConsentCallCount = 0;
var lastConsentPayload = null;
var handsOnMilestoneCallCount = {}; // milestone -> count; the task RPC must be idempotent client-side too

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1100 } });

// Intercept the real config.js request and serve the fake project instead.
await page.route('**/config.js', route => route.fulfill({ contentType: 'application/javascript', body: FAKE_CONFIG }));

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
      // Real assign_id always mints a fresh SME-N — a second call would be
      // SME-2. Returning that here (rather than hardcoding SME-1) means the
      // app.js guard against re-submitting Intake is actually exercised,
      // not just assumed.
      resp = { ok: true, id: 'SME-' + assignIdCallCount };
      break;
    case 'assign_sus_only_id':
      assert(Object.keys(body).length === 0, 'SUS-only assignment RPC receives no browser code or participant data');
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
      resp = { ok: true, susScore: 82.5 };
      break;
    case 'save_hands_on_milestone':
      assert(body.p_sample_id === 'mysejahtera-alpha-dart-v1', 'hands-on RPC sends only the fixed sample id');
      handsOnMilestoneCallCount[body.p_milestone] = (handsOnMilestoneCallCount[body.p_milestone] || 0) + 1;
      resp = { ok: true };
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
assert(lastConsentPayload.p_id === 'SME-1' && lastConsentPayload.p_accepted === true && lastConsentPayload.p_consent_version === 'sme-web-consent-v1', 'consent RPC stores only the participant ID, true acceptance, and the form version');
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
    // pick a guess for the next finding
    await page.click('#guess-options .radio-option >> nth=1');
    await page.click('#btn-submit-guess');
    await page.waitForSelector('#reveal-box:not(.hidden)');
  }
}
await page.waitForSelector('#cve-done:not(.hidden)');
assert(true, 'all 6 findings walked through, cve-done shown');
assert(await page.locator('#code-listing .code-line.flagged').count() === 6, 'all 6 findings now show their revealed category color in the code panel');
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
await shot('real-5-sus.png');

// --- 6b. Resume: answer a few SUS items, reload, expect them restored ---
await page.click('#sus-items > div:nth-child(1) .radio-option >> nth=2'); // "3"
await page.click('#sus-items > div:nth-child(2) .radio-option >> nth=4'); // "5"
await page.waitForTimeout(200);
await page.reload();
await page.waitForTimeout(300);
assert(await page.locator('#section-sus.active').count() === 1, 'reload resumes on the SUS section');
assert(await page.locator('#sus-items > div:nth-child(1) .radio-option.selected').count() === 1, 'first SUS answer restored after reload');
assert(await page.locator('#sus-items > div:nth-child(2) .radio-option.selected').count() === 1, 'second SUS answer restored after reload');

// --- 7. Submit SUS without answering all items: expect error ---
await page.click('#btn-sus-submit');
assert(await page.locator('#sus-error:not(.hidden)').count() === 1, 'blocks incomplete SUS submission');

// answer all 10 (re-picks the two already-restored ones too, harmless)
for (let i = 1; i <= 10; i++) {
  await page.click('#sus-items > div:nth-child(' + i + ') .radio-option >> nth=2'); // pick "3" for each
}
await page.click('#btn-sus-submit');
await page.waitForSelector('#section-done.active');
await page.waitForTimeout(350);
assert((await page.textContent('#done-id')).includes('SME-1'), 'done screen shows participant id');
assert((await page.textContent('#done-sus-score')).includes('82.5'), 'done screen shows SUS score from backend');
await shot('real-6-done.png');

// --- 7b. A completed run clears the saved session — reloading must NOT resume it ---
await page.reload();
await page.waitForTimeout(200);
assert(await page.locator('#resume-banner:not(.hidden)').count() === 0, 'no resume banner after a completed run (session was cleared)');
assert(await page.locator('#section-cover.active').count() === 1, 'a completed run reloads fresh at the study cover, not back at Done');

// --- 8. SUS-only route: no code creates a distinct anonymous record, skips
// SME-only sections, still completes the real hands-on step before SUS. ---
await page.click('#btn-cover-start');
await page.waitForSelector('#section-consent.active');
await page.check('#consent-agree');
await page.click('#btn-consent-continue');
await page.waitForSelector('#section-access.active');
await page.click('#btn-access-sus');
await page.waitForSelector('#section-demo.active');
assert(assignSusOnlyIdCallCount === 1, 'SUS-only route calls its narrow ID-assignment RPC exactly once');
assert(saveConsentCallCount === 2, 'SUS-only participant consent is recorded after the anonymous ID is assigned');
assert(lastConsentPayload.p_id === 'SME-2', 'SUS-only consent is linked to the next anonymous SME-N ID');
assert((await page.textContent('#id-badge-demo')).trim() === 'SME-2', 'SUS-only route displays its assigned anonymous ID');
assert((await page.textContent('#demo-help')).includes('guided hands-on task'), 'SUS-only demo explains its shorter route');
assert(await page.locator('.step[data-step="intake"].hidden').count() === 1, 'SUS-only stepper hides Background');
assert(await page.locator('.step[data-step="interview"].hidden').count() === 1, 'SUS-only stepper hides Interview');
assert(await page.locator('.step[data-step="cve"].hidden').count() === 1, 'SUS-only stepper hides Category Check');
assert((await page.locator('.step:not(.hidden)').count()) === 4, 'SUS-only stepper contains only Demo, Hands-on, SUS, and Done');

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

console.log('errors observed:', errors);
assert(errors.length === 0, 'no console/page errors during the whole flow');

await browser.close();
await new Promise((resolve) => server.close(resolve));
console.log('SMOKE TEST PASSED');
