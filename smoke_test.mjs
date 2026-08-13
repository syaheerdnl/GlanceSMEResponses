import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fileUrl = 'file://' + path.join(__dirname, 'index.html');

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
assert((await page.textContent('#cover-title')).includes('Dart and Kotlin'), 'cover clearly names the study focus');
await shot('real-0-cover.png');
await page.click('#btn-cover-start');
await page.waitForSelector('#section-intake.active');
await shot('real-1-intake.png');

// --- 1b. Resume boundary: typing into Intake (unsubmitted) and reloading must NOT
// resume anything — nothing is persisted until assignId actually succeeds. ---
await page.fill('#in-role', 'Some role typed but never submitted');
await page.reload();
await page.waitForTimeout(200);
assert(await page.locator('#section-cover.active').count() === 1, 'reload before assignId returns to the cover (no premature persistence)');
assert(await page.locator('#resume-banner:not(.hidden)').count() === 0, 'resume banner still hidden — unsubmitted intake fields are not a resumable session');
await page.click('#btn-cover-start');
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

await page.click('#btn-to-sus');
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

console.log('errors observed:', errors);
assert(errors.length === 0, 'no console/page errors during the whole flow');

await browser.close();
console.log('SMOKE TEST PASSED');
