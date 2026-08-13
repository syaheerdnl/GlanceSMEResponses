/**
 * Code.gs
 *
 * Backend for the SME Interview + Category Validation Exercise + SUS web page.
 * Deploy this as a Google Apps Script Web App bound to a Google Sheet. The
 * static page (index.html/app.js, hosted separately e.g. on GitHub Pages)
 * calls this script's doPost() for every action.
 *
 * WHY THE AI-ASSIGNED CATEGORIES LIVE HERE, NOT IN THE FRONTEND:
 * The Category Validation Exercise depends on the participant not being
 * able to see the application's assigned category before they give their
 * own blind guess. If the category were embedded in the page's JavaScript,
 * anyone could read it straight out of the page source before answering.
 * Keeping FINDINGS (below) server-side, and only ever sending a finding's
 * category back in the response to a submitted guess, is what actually
 * enforces the blind-before-reveal order.
 *
 * SETUP
 * 1. Create a new Google Sheet. Note its ID from the URL
 *    (docs.google.com/spreadsheets/d/<THIS PART>/edit).
 * 2. In the Sheet: Extensions > Apps Script. Delete the placeholder code,
 *    paste this whole file in.
 * 3. Set SHEET_ID below to the ID from step 1.
 * 4. Run `setupSheet` once from the Apps Script editor (select it in the
 *    function dropdown, click Run). Approve permissions when prompted.
 *    This creates the four tabs (Intake, Interview, CategoryValidation,
 *    SUS) with headers.
 * 5. Deploy > New deployment > type "Web app".
 *    - Execute as: Me
 *    - Who has access: Anyone
 *    Click Deploy, approve permissions again if asked.
 * 6. Copy the Web App URL it gives you (ends in /exec). Paste it into
 *    config.js as WEB_APP_URL in the frontend project.
 *
 * If you edit this file later, you must create a NEW deployment version
 * (Deploy > Manage deployments > edit > New version) for changes to take
 * effect on the existing /exec URL.
 */

// ---- Configuration ----

var SHEET_ID = 'PASTE_YOUR_SHEET_ID_HERE';

// The real findings data. This is the only place the AI-assigned category
// exists in the whole system before a participant has answered.
var FINDINGS = {
  1: { line: 5,  title: 'Hardcoded Production API Key',               category: 'Code Quality' },
  2: { line: 28, title: 'Incorrect Refund Calculation Logic',          category: 'Bugs' },
  3: { line: 40, title: 'Empty Catch Block Suppresses Failures',       category: 'Bugs' },
  4: { line: 17, title: 'Sequential Await in Loop',                   category: 'Optimization' },
  5: { line: 44, title: 'Inefficient Duplicate Reference Check',       category: 'Optimization' },
  6: { line: 51, title: 'Imperative String Joining',                  category: 'Readability' }
};

var VALID_CATEGORIES = ['Code Quality', 'Bugs', 'Optimization', 'Readability'];

// ---- Entry points ----

function doPost(e) {
  var out;
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;

    switch (action) {
      case 'assignId':
        out = assignId(body);
        break;
      case 'saveInterview':
        out = saveInterview(body);
        break;
      case 'submitGuess':
        out = submitGuess(body);
        break;
      case 'submitAgreement':
        out = submitAgreement(body);
        break;
      case 'saveSUS':
        out = saveSUS(body);
        break;
      default:
        out = { ok: false, error: 'Unknown action: ' + action };
    }
  } catch (err) {
    out = { ok: false, error: String(err) };
  }
  return jsonOutput(out);
}

function doGet(e) {
  // Simple health check: open the /exec URL in a browser and you should
  // see this. Useful for confirming the deployment is live before wiring
  // up the frontend.
  return jsonOutput({ ok: true, message: 'SME backend is running.' });
}

function jsonOutput(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---- One-time setup ----

function setupSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);

  ensureSheetWithHeaders(ss, 'Intake', [
    'Participant ID', 'Timestamp', 'Years of Experience',
    'Platforms / Languages', 'Current Role'
  ]);

  ensureSheetWithHeaders(ss, 'Interview', [
    'Participant ID', 'Timestamp',
    'Q2 - Prior AI Tool Experience',
    'Q3 - Feedback Quality',
    'Q4 - Important Issue Types',
    'Q5 - TAM Perceived Usefulness',
    'Q6 - TAM Perceived Ease of Use'
  ]);

  ensureSheetWithHeaders(ss, 'CategoryValidation', [
    'Participant ID', 'Finding #', 'Line', 'Finding Title',
    "Participant's Guess (blind)", 'AI-Assigned Category (revealed)',
    'Agreement', 'If Disagree, Correct Category', 'Could Also Be (ranked)',
    'Guess Timestamp', 'Agreement Timestamp'
  ]);

  ensureSheetWithHeaders(ss, 'SUS', [
    'Participant ID', 'Timestamp',
    'SUS1', 'SUS2', 'SUS3', 'SUS4', 'SUS5',
    'SUS6', 'SUS7', 'SUS8', 'SUS9', 'SUS10',
    'SUS Score (0-100)'
  ]);

  Logger.log('Sheet setup complete. Tabs: Intake, Interview, CategoryValidation, SUS.');
}

function ensureSheetWithHeaders(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
}

// ---- Actions ----

function assignId(body) {
  var sheet = getSheet('Intake');
  var nextNum = nextParticipantNumber(sheet);
  var id = 'SME-' + nextNum;

  sheet.appendRow([
    id,
    new Date(),
    body.yearsExperience || '',
    body.platforms || '',
    body.role || ''
  ]);

  return { ok: true, id: id };
}

function nextParticipantNumber(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 1;
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var max = 0;
  ids.forEach(function (row) {
    var m = /^SME-(\d+)$/.exec(row[0]);
    if (m) {
      var n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  });
  return max + 1;
}

function saveInterview(body) {
  requireId(body);
  var sheet = getSheet('Interview');
  sheet.appendRow([
    body.id,
    new Date(),
    body.q2 || '',
    body.q3 || '',
    body.q4 || '',
    body.q5 || '',
    body.q6 || ''
  ]);
  return { ok: true };
}

function submitGuess(body) {
  requireId(body);
  var findingNum = Number(body.findingNum);
  var finding = FINDINGS[findingNum];
  if (!finding) {
    return { ok: false, error: 'Unknown finding number: ' + body.findingNum };
  }
  var guess = body.guess;
  if (VALID_CATEGORIES.indexOf(guess) === -1) {
    return { ok: false, error: 'Invalid category guess: ' + guess };
  }

  var sheet = getSheet('CategoryValidation');
  sheet.appendRow([
    body.id,
    findingNum,
    finding.line,
    finding.title,
    guess,
    finding.category,
    '', // Agreement - filled in by submitAgreement
    '', // If Disagree, Correct Category
    '', // Could Also Be
    new Date(),
    '' // Agreement Timestamp
  ]);

  // This is the reveal: the real category is only ever sent back here,
  // after the guess has already been recorded.
  return {
    ok: true,
    title: finding.title,
    line: finding.line,
    category: finding.category
  };
}

function submitAgreement(body) {
  requireId(body);
  var findingNum = Number(body.findingNum);
  var sheet = getSheet('CategoryValidation');
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { ok: false, error: 'No CategoryValidation rows yet.' };

  var data = sheet.getRange(2, 1, lastRow - 1, 11).getValues();
  for (var i = 0; i < data.length; i++) {
    if (data[i][0] === body.id && Number(data[i][1]) === findingNum) {
      var rowIndex = i + 2; // 1-indexed, plus header row
      sheet.getRange(rowIndex, 7).setValue(body.agreement || '');
      sheet.getRange(rowIndex, 8).setValue(body.correctCategory || '');
      sheet.getRange(rowIndex, 9).setValue(body.couldAlsoBe || '');
      sheet.getRange(rowIndex, 11).setValue(new Date());
      return { ok: true };
    }
  }
  return { ok: false, error: 'Matching guess row not found for id/finding. Did you call submitGuess first?' };
}

function saveSUS(body) {
  requireId(body);
  var scores = body.scores; // array of 10 integers, 1-5
  if (!scores || scores.length !== 10) {
    return { ok: false, error: 'Expected 10 SUS scores.' };
  }
  scores = scores.map(Number);

  // Standard SUS scoring: odd items (1,3,5,7,9) contribute (score-1),
  // even items (2,4,6,8,10) contribute (5-score). Sum * 2.5 = 0-100.
  var total = 0;
  for (var i = 0; i < 10; i++) {
    var s = scores[i];
    total += (i % 2 === 0) ? (s - 1) : (5 - s);
  }
  var susScore = total * 2.5;

  var sheet = getSheet('SUS');
  sheet.appendRow([body.id, new Date()].concat(scores).concat([susScore]));

  return { ok: true, susScore: susScore };
}

// ---- Helpers ----

function getSheet(name) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    throw new Error('Sheet tab "' + name + '" not found. Run setupSheet() first.');
  }
  return sheet;
}

function requireId(body) {
  if (!body.id) throw new Error('Missing participant id.');
}
