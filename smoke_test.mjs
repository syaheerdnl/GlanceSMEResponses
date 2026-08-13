import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fileUrl = 'file://' + path.join(__dirname, 'index.html');

// A fake config.js loaded via addInitScript, so WEB_APP_URL looks configured
// and app.js's real fetch-driven logic runs (not the placeholder screen).
const FAKE_CONFIG = "const WEB_APP_URL = 'https://example.com/exec';";

// Real Code.gs's FINDINGS (line/title/category) — mirrored here so the stub's
// submitGuess response matches the real backend contract, including the line
// number (a prior version of this stub hardcoded line: 0, which nothing
// checked until the reveal UI started displaying it).
const FINDINGS = {
  1: { line: 5,  title: 'Hardcoded Production API Key',          category: 'Code Quality' },
  2: { line: 28, title: 'Incorrect Refund Calculation Logic',     category: 'Bugs' },
  3: { line: 40, title: 'Empty Catch Block Suppresses Failures',  category: 'Bugs' },
  4: { line: 17, title: 'Sequential Await in Loop',               category: 'Optimization' },
  5: { line: 44, title: 'Inefficient Duplicate Reference Check',  category: 'Optimization' },
  6: { line: 51, title: 'Imperative String Joining',              category: 'Readability' }
};

var submitGuessCallCount = {}; // findingNum -> count, so the resume test can prove no duplicate POST

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1100 } });

// Intercept the real config.js request and serve the fake URL instead.
await page.route('**/config.js', route => route.fulfill({ contentType: 'application/javascript', body: FAKE_CONFIG }));

// Stub the Apps Script backend itself: intercept the fetch to the fake URL.
await page.route('https://example.com/exec', async (route) => {
  const req = route.request();
  const body = JSON.parse(req.postData());
  let resp;
  switch (body.action) {
    case 'assignId':
      resp = { ok: true, id: 'SME-1' };
      break;
    case 'saveInterview':
      resp = { ok: true };
      break;
    case 'submitGuess': {
      submitGuessCallCount[body.findingNum] = (submitGuessCallCount[body.findingNum] || 0) + 1;
      const f = FINDINGS[body.findingNum];
      resp = { ok: true, title: f.title, category: f.category, line: f.line };
      break;
    }
    case 'submitAgreement':
      resp = { ok: true };
      break;
    case 'saveSUS':
      resp = { ok: true, susScore: 82.5 };
      break;
    default:
      resp = { ok: false, error: 'unhandled action in stub: ' + body.action };
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

// --- 1. Intake screen loads for real (not the setup-needed message) ---
const bodyText = await page.textContent('body');
assert(!bodyText.includes('Setup needed'), 'real app.js runs (no setup-needed placeholder)');
assert(await page.locator('#section-intake.active').count() === 1, 'intake section active on load');
assert(await page.locator('#resume-banner:not(.hidden)').count() === 0, 'resume banner hidden with no saved session');
await shot('real-1-intake.png');

// --- 1b. Resume boundary: typing into Intake (unsubmitted) and reloading must NOT
// resume anything — nothing is persisted until assignId actually succeeds. ---
await page.fill('#in-role', 'Some role typed but never submitted');
await page.reload();
await page.waitForTimeout(200);
assert(await page.locator('#section-intake.active').count() === 1, 'reload before assignId stays on intake (no premature persistence)');
assert(await page.locator('#resume-banner:not(.hidden)').count() === 0, 'resume banner still hidden — unsubmitted intake fields are not a resumable session');
assert((await page.inputValue('#in-role')) === '', 'unsubmitted intake field is not restored (was never persisted)');

// --- 2. Fill intake, submit, expect assigned ID + interview section ---
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
await page.waitForSelector('#section-interview.active');
await page.waitForTimeout(350);
assert((await page.textContent('#id-badge-1')).trim() === 'SME-1', 'assigned ID SME-1 shown after intake');
await shot('real-2-interview.png');

// --- 2b. Resume: reload right after intake, before any interview draft ---
await page.reload();
await page.waitForTimeout(250);
assert(await page.locator('#resume-banner:not(.hidden)').count() === 1, 'resume banner shows after reload once a participant ID exists');
assert((await page.textContent('#resume-banner-text')).includes('SME-1'), 'resume banner names the correct participant ID');
assert(await page.locator('#section-interview.active').count() === 1, 'reload resumes directly on the interview section');

// --- 2c. Resume: type a partial interview draft, reload, expect it restored ---
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
assert(await page.locator('#finding-dot.revealed').count() === 1, 'finding dot marked revealed after the guess is submitted');
assert(await page.locator('#code-listing .code-line.flagged').count() === 1, 'exactly one line now carries the revealed category color');
assert(submitGuessCallCount[1] === 1, 'exactly one submitGuess POST sent for finding 1 so far');
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
assert(await page.locator('#finding-dot.revealed').count() === 1, 'finding dot still shows revealed after resume');
assert(await page.locator('#code-listing .code-line.flagged').count() === 1, 'code panel still shows the revealed line colored after resume');
assert(submitGuessCallCount[1] === 1, 'resuming did NOT re-POST submitGuess for finding 1 (still exactly one call)');

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
assert(await page.locator('#section-intake.active').count() === 1, 'a completed run reloads fresh at Intake, not back at Done');

console.log('errors observed:', errors);
assert(errors.length === 0, 'no console/page errors during the whole flow');

await browser.close();
console.log('SMOKE TEST PASSED');
