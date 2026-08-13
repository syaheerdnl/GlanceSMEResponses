// app.js
// Frontend logic for the SME Interview + Category Validation Exercise + SUS
// web page. Talks only to the Supabase project (URL + anon key) set in
// config.js, via plain fetch() calls to its auto-generated RPC endpoints —
// see supabase/migration.sql for the Postgres functions backing this.
// The AI-assigned category for each finding is never present in this file
// or anywhere else client-side — it only ever arrives in the response to
// submitGuess, after a guess has already been recorded server-side (inside
// the submit_guess Postgres function, itself gated by Row Level Security).
//
// Every value sent to the backend keeps the same shape callBackend has
// always used (plain strings for yearsExperience/platforms/agreement/
// correctCategory/couldAlsoBe), even though several inputs now use
// richer controls (sliders, chips, toggles, ranked checkboxes) — this
// means the RPC functions never need to change when frontend widgets do.

(function () {
  'use strict';

  // ---- Public data (safe to ship to the client: no categories here) ----

  var FINDINGS_PUBLIC = [
    { num: 1, line: 5,  title: 'Hardcoded Production API Key' },
    { num: 2, line: 28, title: 'Incorrect Refund Calculation Logic' },
    { num: 3, line: 40, title: 'Empty Catch Block Suppresses Failures' },
    { num: 4, line: 17, title: 'Sequential Await in Loop' },
    { num: 5, line: 44, title: 'Inefficient Duplicate Reference Check' },
    { num: 6, line: 51, title: 'Imperative String Joining' }
  ];

  var SUS_ITEMS = [
    'I think that I would like to use this system frequently.',
    'I found the system unnecessarily complex.',
    'I thought the system was easy to use.',
    'I think that I would need the support of a technical person to be able to use this system.',
    'I found the various functions in this system were well integrated.',
    'I thought there was too much inconsistency in this system.',
    'I would imagine that most people would learn to use this system very quickly.',
    'I found the system very cumbersome to use.',
    'I felt very confident using the system.',
    'I needed to learn a lot of things before I could get going with this system.'
  ];

  var CODE_LINES = [
    "import 'dart:convert';",
    "import 'package:http/http.dart' as http;",
    "",
    "class BillPaymentGateway {",
    '  static const String merchantKey = "jompay_live_c771a0AlphaGATEWAYPROD99";',
    '  static const String gatewayHost = "https://gateway.internal.example.gov";',
    "",
    "  Future<PaymentResult> submitPayment(String billerCode, double amount) async {",
    "    final res = await http.get(Uri.parse('$gatewayHost/pay?biller=$billerCode&amt=$amount&key=$merchantKey'));",
    "    final body = jsonDecode(res.body);",
    "    final ref = body['refNumber'];",
    "    final st = body['status'];",
    "    return PaymentResult(ref, st == 'success');",
    "  }",
    "",
    "  Future<List<PaymentResult>> submitBatchPayments(List<String> billerCodes, double amount) async {",
    "    final results = <PaymentResult>[];",
    "    for (final b in billerCodes) {",
    "      final r = await submitPayment(b, amount);",
    "      results.add(r);",
    "    }",
    "    return results;",
    "  }",
    "",
    "  double calculateTotal(List<Transaction> transactions) {",
    "    var t = 0.0;",
    "    for (var i = 0; i < transactions.length; i++) {",
    "      t = t + transactions[i].amount;",
    "      if (transactions[i].status == 'refunded') t = t - transactions[i].amount * 2;",
    "    }",
    "    return t;",
    "  }",
    "",
    "  Future<PaymentResult?> retryFailedPayment(String billerCode, double amount, int maxAttempts) async {",
    "    try {",
    "      for (var i = 0; i < maxAttempts; i++) {",
    "        final r = await submitPayment(billerCode, amount);",
    "        if (r.success) return r;",
    "      }",
    "    } catch (e) {}",
    "    return null;",
    "  }",
    "",
    "  bool isDuplicateReference(String ref, List<String> recentRefs) {",
    "    for (final r in recentRefs) {",
    "      if (r == ref) return true;",
    "    }",
    "    return false;",
    "  }",
    "",
    "  String formatReference(String rawRef) {",
    "    final p = rawRef.split('-');",
    "    var s = '';",
    "    for (var i = 0; i < p.length; i++) {",
    "      s = s + p[i];",
    "      if (i != p.length - 1) s = s + '/';",
    "    }",
    "    return s;",
    "  }",
    "",
    "  String classifyAmount(double amount) {",
    "    final lo = 100;",
    "    final hi = 5000;",
    "    if (amount < lo) return 'SMALL';",
    "    if (amount < hi) return 'STANDARD';",
    "    return 'LARGE';",
    "  }",
    "}",
    "",
    "class PaymentResult {",
    "  final String refNumber;",
    "  final bool success;",
    "  PaymentResult(this.refNumber, this.success);",
    "}",
    "",
    "class Transaction {",
    "  final String id;",
    "  final double amount;",
    "  final String status;",
    "  Transaction(this.id, this.amount, this.status);",
    "}"
  ];

  var CATEGORIES = ['Code Quality', 'Bugs', 'Optimization', 'Readability'];

  // Real Glance category colors (glance/lib/theme/colors.dart — GlanceColors.category).
  // These are the same 4 categories already fixed by this project's taxonomy. Static
  // labels may use these colors as a category key, but a finding-specific color is
  // only assigned after that finding's guess has been recorded server-side (see
  // revealFinding) — the blind-reveal boundary remains unchanged.
  var CATEGORY_COLORS = {
    'Code Quality': '#BF4F4B',
    'Bugs': '#A8791E',
    'Optimization': '#3C7F63',
    'Readability': '#6E63A6'
  };

  var FULL_SME_ACCESS_CODE = '0811';
  var FULL_SME_STEPS = ['intake', 'demo', 'interview', 'cve', 'prototype', 'sus', 'done'];
  var SUS_ONLY_STEPS = ['demo', 'prototype', 'sus', 'done'];
  var PROTOTYPE_SAMPLE_ID = 'mysejahtera-alpha-dart-v1';
  var PROTOTYPE_MILESTONES = ['opened', 'review-completed', 'feedback-opened', 'fix-applied'];
  var CONSENT_VERSION = 'sme-web-consent-v1';

  // ---- State (live, in-memory) ----

  var state = {
    participantId: null,
    findingIndex: 0,
    currentGuess: null,
    correctCategory: null, // the "If you disagree, what is the correct category?" pick
    revealedCategory: null, // the AI's own answer for the current finding — the
                             // default "established" category until the participant
                             // explicitly disagrees and picks a different one
    couldAlsoBeOrder: [], // array of category strings, in the order the user ranked them
    revealedFindings: {}  // findingNum -> category string, filled in only after that
                           // finding's guess has already been recorded server-side
  };

  // ---- Session persistence (resume-in-progress) ----
  //
  // A small localStorage-backed mirror of already-submitted/in-progress state, so an
  // accidental tab close mid-session doesn't force starting over from Intake. Only
  // ever written at the same points the app already talks to the backend (or, for
  // free-text drafts, on a short debounce) — never invents new client-side state.
  //
  // The one value here that could touch the blind-reveal boundary is
  // cve.revealData/cve.revealedFindings: both are written at the exact moment
  // revealFinding() already puts that category on screen, i.e. strictly after
  // submitGuess has returned and the guess is already a row in the Sheet.

  var SESSION_KEY = 'smeSession_v1';
  var sessionDraftTimer = null;
  var session = emptySession();

  function emptySession() {
    return {
      participantId: null,
      section: 'intake',
      studyPath: null,
      consent: { accepted: false, saved: false, version: CONSENT_VERSION },
      interviewDraft: { q2: '', q3: '', q4: '', q5: '', q6: '' },
      cve: { findingIndex: 0, guessSubmitted: false, revealData: null, revealedFindings: {}, allDone: false },
      prototype: { nonce: null, milestones: { opened: false, 'review-completed': false, 'feedback-opened': false, 'fix-applied': false } },
      susDraft: new Array(SUS_ITEMS.length).fill(null)
    };
  }

  function loadSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.participantId) return null;
      // Merge onto a fresh default shape rather than trusting the stored object
      // directly — defensive only at this one boundary (reading back something
      // that could be stale/partial), not elsewhere in the app.
      var base = emptySession();
      base.participantId = parsed.participantId;
      base.section = parsed.section || 'intake';
      // Saved sessions created before the path selector existed were all full
      // SME sessions, so retaining that route is backwards-compatible.
      base.studyPath = parsed.studyPath === 'sus_only' ? 'sus_only' : 'full_sme';
      base.consent = Object.assign(base.consent, parsed.consent || {});
      base.interviewDraft = Object.assign(base.interviewDraft, parsed.interviewDraft || {});
      base.cve = Object.assign(base.cve, parsed.cve || {});
      base.prototype = Object.assign(base.prototype, parsed.prototype || {});
      base.prototype.milestones = Object.assign(base.prototype.milestones, (parsed.prototype && parsed.prototype.milestones) || {});
      base.susDraft = parsed.susDraft || base.susDraft;
      return base;
    } catch (e) {
      return null;
    }
  }

  function saveSession() {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch (e) {
      // Storage unavailable (private-browsing quota, etc.) — resume silently
      // won't work this session; nothing here is required for the exercise itself.
    }
  }

  function clearSession() {
    session = emptySession();
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  function saveSessionDebounced(indicatorElId) {
    clearTimeout(sessionDraftTimer);
    sessionDraftTimer = setTimeout(function () {
      saveSession();
      if (indicatorElId) showDraftSaved(indicatorElId);
    }, 400);
  }

  // ---- Small helpers ----

  function $(id) { return document.getElementById(id); }

  function showSection(id) {
    document.querySelectorAll('.section').forEach(function (s) { s.classList.remove('active'); });
    $(id).classList.add('active');
    var isPreIntake = id === 'section-cover' || id === 'section-consent' || id === 'section-access';
    $('stepper').classList.toggle('hidden', isPreIntake);
    if (!isPreIntake) updateStepper(id.replace('section-', ''));
    if (id === 'section-access') renderAccessGate();
    if (id === 'section-demo') renderDemoRoute();
  }

  function activeSteps() {
    return session.studyPath === 'sus_only' ? SUS_ONLY_STEPS : FULL_SME_STEPS;
  }

  function updateStepper(activeStep) {
    var steps = activeSteps();
    var idx = steps.indexOf(activeStep);
    document.querySelectorAll('.step').forEach(function (el) {
      var stepIdx = steps.indexOf(el.dataset.step);
      var visible = stepIdx !== -1;
      el.classList.toggle('hidden', !visible);
      el.classList.remove('current', 'done', 'step-last');
      if (!visible) return;
      el.querySelector('.step-dot').textContent = String(stepIdx + 1);
      if (stepIdx < idx) el.classList.add('done');
      else if (stepIdx === idx) el.classList.add('current');
    });
    var last = document.querySelector('.step:not(.hidden)[data-step="' + steps[steps.length - 1] + '"]');
    if (last) last.classList.add('step-last');
  }

  function showError(elId, message) {
    var el = $(elId);
    el.textContent = message;
    el.classList.remove('hidden');
  }

  function clearError(elId) {
    var el = $(elId);
    el.textContent = '';
    el.classList.add('hidden');
  }

  function showDraftSaved(elId) {
    var el = $(elId);
    if (!el) return;
    el.classList.remove('hidden');
    el.classList.remove('status-flash');
    void el.offsetWidth; // restart the CSS animation on repeated saves
    el.classList.add('status-flash');
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(function () { el.classList.add('hidden'); }, 1800);
  }

  function setBadges(id) {
    ['id-badge-demo', 'id-badge-1', 'id-badge-2', 'id-badge-prototype', 'id-badge-3'].forEach(function (b) {
      var el = $(b);
      if (el) el.textContent = id;
    });
  }

  function showResumeBanner(id) {
    var banner = $('resume-banner');
    if (!banner) return;
    $('resume-banner-text').textContent = 'Welcome back — continuing as ' + id + '.';
    banner.classList.remove('hidden');
  }

  // Colors just the 4 fixed category names wherever they appear as a choice
  // (guess options, correct-category, could-also-be) — matches the same
  // legend/reference-card colors, and is safe pre-guess since it's a fixed
  // property of the category system itself, not tied to any one finding's
  // actual answer. Anything that isn't a category name (Yes/No, 1-5 SUS
  // scale, etc.) renders as plain text, unaffected.
  function categoryClassName(category) {
    return 'category-' + category.toLowerCase().replace(/\s+/g, '-');
  }

  function addCategoryClass(element, category) {
    if (!CATEGORY_COLORS[category]) return;
    element.classList.add('category-choice');
    element.classList.add(categoryClassName(category));
  }

  function categoryLabelNode(text) {
    if (CATEGORY_COLORS[text]) {
      var span = document.createElement('span');
      span.className = 'category-name ' + categoryClassName(text);
      span.textContent = text;
      return span;
    }
    return document.createTextNode(text);
  }

  function makeRadioOption(groupName, value, labelText, onPick) {
    var label = document.createElement('label');
    label.className = 'radio-option';
    addCategoryClass(label, value);
    var input = document.createElement('input');
    input.type = 'radio';
    input.name = groupName;
    input.value = value;
    label.appendChild(input);
    label.appendChild(document.createTextNode(' '));
    label.appendChild(categoryLabelNode(labelText));
    label.addEventListener('click', function () {
      var group = label.parentElement.querySelectorAll('.radio-option');
      group.forEach(function (o) { o.classList.remove('selected'); });
      label.classList.add('selected');
      input.checked = true;
      if (onPick) onPick(value);
    });
    return label;
  }

  function selectedValue(containerEl) {
    var checked = containerEl.querySelector('input:checked');
    return checked ? checked.value : null;
  }

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = (el.scrollHeight + 2) + 'px';
  }

  function findingByLine(lineNum) {
    for (var i = 0; i < FINDINGS_PUBLIC.length; i++) {
      if (FINDINGS_PUBLIC[i].line === lineNum) return FINDINGS_PUBLIC[i];
    }
    return null;
  }

  // ---- Backend calls ----
  // Supabase's PostgREST layer has real CORS support, so this is a plain
  // application/json fetch — no text/plain workaround needed (that trick
  // only existed because Apps Script Web Apps can't answer CORS preflight).
  //
  // Postgres function parameter names are snake_case (p_-prefixed); this
  // map translates the camelCase payload keys every call site already uses
  // into the RPC parameter names the Postgres functions expect, so nothing
  // above this function needs to change. Response bodies from every RPC use
  // the same top-level keys (ok/id/title/line/category/susScore) the old
  // Code.gs returned.

  var ACTION_MAP = {
    assignId:        { fn: 'assign_id',        params: { yearsExperience: 'p_years_experience', platforms: 'p_platforms', role: 'p_role' } },
    assignSusOnlyId: { fn: 'assign_sus_only_id', params: {} },
    saveConsent:     { fn: 'save_consent',     params: { id: 'p_id', accepted: 'p_accepted', version: 'p_consent_version' } },
    saveInterview:   { fn: 'save_interview',   params: { id: 'p_id', q2: 'p_q2', q3: 'p_q3', q4: 'p_q4', q5: 'p_q5', q6: 'p_q6' } },
    submitGuess:     { fn: 'submit_guess',     params: { id: 'p_id', findingNum: 'p_finding_num', guess: 'p_guess' } },
    submitAgreement: { fn: 'submit_agreement', params: { id: 'p_id', findingNum: 'p_finding_num', agreement: 'p_agreement', correctCategory: 'p_correct_category', couldAlsoBe: 'p_could_also_be' } },
    saveSUS:         { fn: 'save_sus',         params: { id: 'p_id', scores: 'p_scores' } },
    saveHandsOnMilestone: { fn: 'save_hands_on_milestone', params: { id: 'p_id', milestone: 'p_milestone', sampleId: 'p_sample_id' } }
  };

  function callBackend(action, payload) {
    var cfg = ACTION_MAP[action];
    if (!cfg) return Promise.reject(new Error('Unknown action: ' + action));

    var body = {};
    Object.keys(cfg.params).forEach(function (jsKey) {
      body[cfg.params[jsKey]] = (payload || {})[jsKey];
    });

    return fetch(SUPABASE_URL + '/rest/v1/rpc/' + cfg.fn, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
      },
      body: JSON.stringify(body)
    })
      .then(function (resp) {
        return resp.json().catch(function () { return null; }).then(function (data) {
          if (!resp.ok) throw new Error((data && (data.message || data.error)) || ('Server returned HTTP ' + resp.status));
          if (!data || data.ok === false) throw new Error((data && data.error) || 'Unknown server error');
          return data;
        });
      });
  }

  // ---- Setup check ----

  function backendConfigured() {
    return typeof SUPABASE_URL === 'string' && typeof SUPABASE_ANON_KEY === 'string' &&
      SUPABASE_URL.indexOf('YOUR-PROJECT-REF') === -1 &&
      SUPABASE_ANON_KEY.indexOf('YOUR-ANON-PUBLIC-KEY') === -1 &&
      SUPABASE_URL.indexOf('http') === 0;
  }

  function showSetupNeeded() {
    var main = document.querySelector('main');
    main.innerHTML =
      '<div class="card">' +
      '<h2>Setup needed</h2>' +
      '<p>This page is not connected to a backend yet. <code>config.js</code> still has the placeholder ' +
      'values for <code>SUPABASE_URL</code>/<code>SUPABASE_ANON_KEY</code> instead of a real Supabase project.</p>' +
      '<p class="help">See README.md for the deploy steps: create a Supabase project, run supabase/migration.sql ' +
      'in its SQL Editor, then paste the project URL and anon public key into config.js.</p>' +
      '</div>';
  }

  // ---- Study cover ----

  function initCover() {
    $('btn-cover-start').addEventListener('click', function () {
      showSection('section-consent');
    });
  }

  // ---- Participant consent ----
  // Consent is read before Intake, then written against the anonymous
  // participant ID immediately after assign_id succeeds. No name or other
  // participant-entered answer is included in the consent RPC.

  function saveConsentRecord() {
    if (!state.participantId || !session.consent.accepted) {
      return Promise.reject(new Error('Consent must be confirmed before the interview can begin.'));
    }
    return callBackend('saveConsent', {
      id: state.participantId,
      accepted: true,
      version: CONSENT_VERSION
    }).then(function () {
      session.consent.saved = true;
      session.consent.version = CONSENT_VERSION;
      saveSession();
    });
  }

  function enterDemoAfterConsent() {
    session.section = 'demo';
    saveSession();
    showSection('section-demo');
  }

  function initConsent() {
    $('btn-consent-decline').addEventListener('click', function () {
      $('consent-agree').checked = false;
      clearError('consent-error');
      $('consent-declined').classList.remove('hidden');
    });

    $('btn-consent-continue').addEventListener('click', function () {
      clearError('consent-error');
      $('consent-declined').classList.add('hidden');
      if (!$('consent-agree').checked) {
        showError('consent-error', 'Please confirm your consent before continuing.');
        return;
      }

      session.consent.accepted = true;
      session.consent.saved = false;
      session.consent.version = CONSENT_VERSION;
      // There is no participant ID yet during a new session, so this page
      // does not write a record prematurely. The next screen selects either
      // the full SME path (where Intake creates the ID) or the SUS-only path
      // (where its narrow assignment RPC creates it), then consent is saved.
      if (!state.participantId) {
        showSection('section-access');
        return;
      }

      var btn = $('btn-consent-continue');
      btn.disabled = true;
      btn.textContent = 'Recording…';
      saveConsentRecord()
        .then(enterDemoAfterConsent)
        .catch(function (err) {
          showError('consent-error', 'Could not record consent: ' + err.message);
        })
        .finally(function () {
          btn.disabled = false;
          btn.textContent = 'I consent and continue';
        });
    });
  }

  // ---- Study-path access selector ----
  //
  // This browser-only code is intentionally a researcher-supervised route
  // selector, not a security boundary. It selects the full SME instrument;
  // continuing without it creates a distinct SUS-only participant record.

  function renderAccessGate() {
    var susOnlyLocked = session.studyPath === 'sus_only' && !!state.participantId;
    $('access-title').textContent = susOnlyLocked ? 'Usability session selected' : 'Study access';
    $('access-summary').textContent = susOnlyLocked
      ? 'This participant is assigned to the usability session. Continue to the demonstration when ready.'
      : 'If the researcher gave you an SME access code, enter it to continue with the full SME session. Otherwise, continue to the usability session.';
    $('access-code-block').classList.toggle('hidden', susOnlyLocked);
    $('btn-access-sme').classList.toggle('hidden', susOnlyLocked);
    $('btn-access-sus').textContent = susOnlyLocked ? 'Return to demonstration' : 'Continue to usability session';
    if (!susOnlyLocked) $('access-code').value = '';
    clearError('access-error');
  }

  function continueSusOnlySession() {
    if (state.participantId) {
      if (session.consent.saved) {
        enterDemoAfterConsent();
        return Promise.resolve();
      }
      return saveConsentRecord().then(enterDemoAfterConsent);
    }

    session.studyPath = 'sus_only';
    return callBackend('assignSusOnlyId', {})
      .then(function (data) {
        state.participantId = data.id;
        setBadges(data.id);
        session.participantId = data.id;
        // Persist the ID before the consent RPC so a reload after a network
        // interruption retries consent instead of minting another SME-N.
        session.section = 'access';
        saveSession();
        return saveConsentRecord();
      })
      .then(enterDemoAfterConsent)
      .catch(function (err) {
        // If assignment itself failed, leave the selector usable. Once an ID
        // exists, retain the selected path so the idempotent consent retry is
        // the only possible follow-up action.
        if (!state.participantId) session.studyPath = null;
        throw err;
      });
  }

  function initAccessGate() {
    $('btn-access-sme').addEventListener('click', function () {
      clearError('access-error');
      if ($('access-code').value.trim() !== FULL_SME_ACCESS_CODE) {
        showError('access-error', 'This SME access code is not recognised. Please check with the researcher.');
        return;
      }
      session.studyPath = 'full_sme';
      session.section = 'intake';
      saveSession();
      showSection('section-intake');
    });

    $('btn-access-sus').addEventListener('click', function () {
      clearError('access-error');
      var btn = $('btn-access-sus');
      btn.disabled = true;
      btn.textContent = state.participantId ? 'Continuing…' : 'Preparing…';
      continueSusOnlySession()
        .catch(function (err) {
          showError('access-error', 'Could not prepare this usability session: ' + err.message);
        })
        .finally(function () {
          btn.disabled = false;
          renderAccessGate();
        });
    });
  }

  // ---- Section 0: Intake ----

  function initIntake() {
    var slider = $('in-years-slider');
    var readout = $('in-years-readout');
    var cap = $('in-years-cap');

    function updateReadout() {
      if (cap.checked) {
        readout.textContent = '20+ years';
        return;
      }
      var v = Number(slider.value);
      readout.textContent = v === 0 ? '<1 year' : (v + (v === 1 ? ' year' : ' years'));
    }

    slider.addEventListener('input', updateReadout);
    cap.addEventListener('change', function () {
      slider.disabled = cap.checked;
      updateReadout();
    });
    updateReadout();

    document.querySelectorAll('#platform-chips .chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        // Let the native checkbox toggle happen, then sync the visual state.
        setTimeout(function () {
          chip.classList.toggle('selected', chip.querySelector('input').checked);
        }, 0);
      });
    });

    $('btn-intake-submit').addEventListener('click', function () {
      clearError('intake-error');

      if (!session.consent.accepted) {
        showSection('section-consent');
        return;
      }

      // A participant ID is only ever assigned once. Reaching Intake again
      // via the Back button (from Demo) must not re-call assignId — unlike
      // saveInterview, assignId always inserts a fresh row, so calling it
      // twice would mint a second SME-N for the same person. Just move on.
      if (state.participantId) {
        if (session.consent.saved) {
          enterDemoAfterConsent();
          return;
        }
        var existingBtn = $('btn-intake-submit');
        existingBtn.disabled = true;
        existingBtn.textContent = 'Recording consent…';
        saveConsentRecord()
          .then(enterDemoAfterConsent)
          .catch(function (err) {
            showError('intake-error', 'Could not record consent: ' + err.message);
          })
          .finally(function () {
            existingBtn.disabled = false;
            existingBtn.textContent = 'Continue';
          });
        return;
      }

      var years = cap.checked ? '20+ years' : (Number(slider.value) === 0 ? 'less than 1 year' : slider.value + ' years');

      var selectedChips = Array.prototype.slice
        .call(document.querySelectorAll('#platform-chips .chip input:checked'))
        .map(function (i) { return i.value; });
      var other = $('in-platforms-other').value.trim();
      var platforms = selectedChips.concat(other ? [other] : []).join(', ');

      var role = $('in-role').value.trim();

      if (!platforms) {
        showError('intake-error', 'Pick at least one platform/language, or fill in "Other".');
        return;
      }
      if (!role) {
        showError('intake-error', 'Please fill in the current role.');
        return;
      }

      var btn = $('btn-intake-submit');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      callBackend('assignId', { yearsExperience: years, platforms: platforms, role: role })
        .then(function (data) {
          state.participantId = data.id;
          setBadges(data.id);
          session.participantId = data.id;
          // Persist the assigned ID before the second RPC. If the network
          // drops while recording consent, a reload can retry that idempotent
          // RPC without ever minting another participant ID.
          session.section = 'intake';
          saveSession();
          return saveConsentRecord();
        })
        .then(function () {
          enterDemoAfterConsent();
        })
        .catch(function (err) {
          showError('intake-error', 'Could not save your details: ' + err.message);
        })
        .finally(function () {
          btn.disabled = false;
          btn.textContent = 'Continue';
        });
    });
  }

  // ---- Section Demo: Application Demonstration ----

  function renderDemoRoute() {
    var susOnly = session.studyPath === 'sus_only';
    $('demo-help').textContent = susOnly
      ? 'Watch this short walkthrough of the application before the guided hands-on task and System Usability Scale questionnaire.'
      : 'Watch this short walkthrough of the application before the interview questions; the next section asks about what you observed here.';
    $('btn-demo-continue').textContent = susOnly
      ? 'Continue to Hands-on Prototype'
      : 'Continue to Interview';
  }

  function initDemo() {
    $('btn-demo-back').addEventListener('click', function () {
      session.section = session.studyPath === 'sus_only' ? 'access' : 'intake';
      saveSession();
      showSection(session.studyPath === 'sus_only' ? 'section-access' : 'section-intake');
    });

    $('btn-demo-continue').addEventListener('click', function () {
      var susOnly = session.studyPath === 'sus_only';
      session.section = susOnly ? 'prototype' : 'interview';
      saveSession();
      showSection(susOnly ? 'section-prototype' : 'section-interview');
      if (susOnly) openPrototype();
    });
  }

  // ---- Section 1: Interview Q2-Q6 ----

  function restoreInterviewDraft() {
    ['q2', 'q3', 'q4', 'q5', 'q6'].forEach(function (id) {
      var val = session.interviewDraft && session.interviewDraft[id];
      if (val) {
        $(id).value = val;
        autoGrow($(id));
      }
    });
  }

  function initInterview() {
    document.querySelectorAll('#section-interview textarea.autogrow').forEach(function (t) {
      t.addEventListener('input', function () { autoGrow(t); });
    });

    $('btn-interview-back').addEventListener('click', function () {
      session.section = 'demo';
      saveSession();
      showSection('section-demo');
    });

    ['q2', 'q3', 'q4', 'q5', 'q6'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        session.interviewDraft[id] = $(id).value;
        saveSessionDebounced('interview-draft-status');
      });
    });

    $('btn-interview-submit').addEventListener('click', function () {
      clearError('interview-error');
      var btn = $('btn-interview-submit');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      callBackend('saveInterview', {
        id: state.participantId,
        q2: $('q2').value.trim(),
        q3: $('q3').value.trim(),
        q4: $('q4').value.trim(),
        q5: $('q5').value.trim(),
        q6: $('q6').value.trim()
      })
        .then(function () {
          session.interviewDraft = { q2: '', q3: '', q4: '', q5: '', q6: '' };
          session.section = 'cve';
          saveSession();
          showSection('section-cve');
          renderCodeListing(null);
          state.findingIndex = 0;
          renderFinding();
        })
        .catch(function (err) {
          showError('interview-error', 'Could not save these answers: ' + err.message);
        })
        .finally(function () {
          btn.disabled = false;
          btn.textContent = 'Continue to Category Validation Exercise';
        });
    });
  }

  // ---- Section 2: Category Validation Exercise ----
  //
  // The source panel and finding card here are restyled after the real Glance
  // app's own "Results" screen (glance/lib/widgets/code_panel.dart and
  // feedback_row.dart) — same category colors, same flagged-line rail pattern.
  // The one adaptation: in Glance every flagged line is colored immediately,
  // since there's no guessing step there. Here, a line only gets its category
  // color once state.revealedFindings has an entry for it, which only happens
  // inside revealFinding() — i.e. strictly after that finding's guess already
  // went to the server. Findings not yet reached stay plain code, same as
  // the app's behavior before this change.

  function renderCodeListing(currentLineNum) {
    var html = CODE_LINES.map(function (text, i) {
      var lineNum = i + 1;
      var numStr = (lineNum < 10 ? ' ' : '') + lineNum;
      var srcHtml = '<span class="src">' + (escapeHtml(text) || ' ') + '</span>';
      var finding = findingByLine(lineNum);
      var revealedCat = finding ? state.revealedFindings[finding.num] : null;

      if (revealedCat) {
        var color = CATEGORY_COLORS[revealedCat];
        return '<div class="code-line flagged" data-line="' + lineNum + '" style="--rail:' + color + '">' +
          '<span class="ln">' + numStr + '</span>' + srcHtml +
          '<span class="mark" style="color:' + color + '">●</span></div>';
      }
      if (lineNum === currentLineNum) {
        return '<div class="code-line current" data-line="' + lineNum + '"><span class="ln">' + numStr + '</span>' + srcHtml + '</div>';
      }
      return '<div class="code-line" data-line="' + lineNum + '"><span class="ln">' + numStr + '</span>' + srcHtml + '</div>';
    }).join('');
    $('code-listing').innerHTML = html;
  }

  // Brings the current finding's line into view within the source panel's
  // own scroll region (see .glance-code's max-height/overflow-y in
  // style.css) instead of leaving the participant to hunt for it manually.
  function scrollToCurrentLine(lineNum) {
    var el = document.querySelector('#code-listing [data-line="' + lineNum + '"]');
    if (el && el.scrollIntoView) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  function renderMiniProgress() {
    var el = $('cve-mini-progress');
    el.innerHTML = '';
    for (var i = 0; i < FINDINGS_PUBLIC.length; i++) {
      var span = document.createElement('span');
      if (i < state.findingIndex) span.classList.add('filled');
      if (i === state.findingIndex) span.classList.add('current');
      el.appendChild(span);
    }
  }

  function renderFinding() {
    var finding = FINDINGS_PUBLIC[state.findingIndex];
    state.currentGuess = null;
    state.correctCategory = null;
    state.revealedCategory = null;
    state.couldAlsoBeOrder = [];

    renderMiniProgress();
    renderCodeListing(finding.line);
    scrollToCurrentLine(finding.line);

    $('cve-finding-card').classList.remove('hidden');
    $('cve-done').classList.add('hidden');
    $('cve-progress').textContent = 'Finding ' + finding.num + ' of ' + FINDINGS_PUBLIC.length;

    // Title and line are safe to show before the guess — only the category is
    // gated (see the "blind-reveal boundary" note in CLAUDE.md).
    $('cve-finding-heading').textContent = finding.title;
    $('cve-finding-meta').textContent = 'Line ' + finding.line;
    var dot = $('finding-dot');
    dot.classList.remove('revealed');
    dot.style.background = 'transparent';
    dot.style.borderColor = '';

    $('cve-finding-line').textContent =
      'Highlighted in the source panel above. The application’s category is not shown yet — give your own guess first.';

    var opts = $('guess-options');
    opts.innerHTML = '';
    CATEGORIES.forEach(function (cat) {
      opts.appendChild(makeRadioOption('guess', cat, cat, function (v) { state.currentGuess = v; }));
    });

    $('btn-submit-guess').classList.remove('hidden');
    $('btn-submit-guess').disabled = false;
    clearError('guess-error');
    $('reveal-box').classList.add('hidden');
  }

  function renderCorrectCategoryOptions() {
    var el = $('correct-category-options');
    el.innerHTML = '';
    CATEGORIES.forEach(function (cat) {
      el.appendChild(makeRadioOption('correct-category', cat, cat, function (v) {
        state.correctCategory = v;
        // Ticking a category as THE correct answer here makes it redundant
        // as a "could also be" secondary option — re-render to drop it.
        renderCouldAlsoBeOptions();
      }));
    });
  }

  function clearCorrectCategory() {
    state.correctCategory = null;
    var el = $('correct-category-options');
    el.querySelectorAll('.radio-option').forEach(function (o) { o.classList.remove('selected'); });
    el.querySelectorAll('input').forEach(function (i) { i.checked = false; });
    renderCouldAlsoBeOptions();
  }

  function renderCouldAlsoBeOptions() {
    // Whatever category currently counts as "the established answer" can't
    // also be a secondary "could also be" fit. That's the participant's own
    // correct-category pick once they've disagreed and chosen one — but
    // until then (including simply agreeing "Yes"), it defaults to the AI's
    // own revealed category, since ticking the exact answer you just agreed
    // with as merely "also could be" is the same redundancy.
    var excluded = state.correctCategory || state.revealedCategory;
    if (excluded) {
      state.couldAlsoBeOrder = state.couldAlsoBeOrder.filter(function (c) { return c !== excluded; });
    }

    var el = $('could-also-be-options');
    el.innerHTML = '';
    CATEGORIES.forEach(function (cat) {
      if (cat === excluded) return; // already the established answer, not a secondary option

      var row = document.createElement('div');
      row.className = 'rank-row';
      addCategoryClass(row, cat);
      var checked = state.couldAlsoBeOrder.indexOf(cat) !== -1;
      row.classList.toggle('active', checked);

      var label = document.createElement('label');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = cat;
      cb.checked = checked;
      var badge = document.createElement('span');
      badge.className = 'pill rank-badge hidden';

      label.appendChild(cb);
      label.appendChild(categoryLabelNode(cat));

      cb.addEventListener('change', function () {
        if (cb.checked) {
          state.couldAlsoBeOrder.push(cat);
        } else {
          state.couldAlsoBeOrder = state.couldAlsoBeOrder.filter(function (c) { return c !== cat; });
        }
        row.classList.toggle('active', cb.checked);
        renderRankBadges();
      });

      row.appendChild(label);
      row.appendChild(badge);
      el.appendChild(row);
    });
    renderRankBadges();
  }

  function renderRankBadges() {
    var rows = document.querySelectorAll('#could-also-be-options .rank-row');
    rows.forEach(function (row) {
      var cb = row.querySelector('input');
      var badge = row.querySelector('.rank-badge');
      var rank = state.couldAlsoBeOrder.indexOf(cb.value);
      if (rank === -1) {
        badge.classList.add('hidden');
      } else {
        badge.textContent = '#' + (rank + 1);
        badge.classList.remove('hidden');
      }
    });
  }

  function couldAlsoBeString() {
    return state.couldAlsoBeOrder
      .map(function (cat, i) { return (i + 1) + '. ' + cat; })
      .join(', ');
  }

  function initCVE() {
    $('btn-submit-guess').addEventListener('click', function () {
      clearError('guess-error');
      if (!state.currentGuess) {
        showError('guess-error', 'Pick a category before submitting.');
        return;
      }
      var finding = FINDINGS_PUBLIC[state.findingIndex];
      var btn = $('btn-submit-guess');
      btn.disabled = true;
      btn.textContent = 'Submitting…';
      callBackend('submitGuess', { id: state.participantId, findingNum: finding.num, guess: state.currentGuess })
        .then(function (data) {
          session.cve.guessSubmitted = true;
          session.cve.revealData = data;
          session.cve.findingIndex = state.findingIndex;
          revealFinding(data);
          session.cve.revealedFindings = state.revealedFindings;
          saveSession();
        })
        .catch(function (err) {
          showError('guess-error', 'Could not submit guess: ' + err.message);
        })
        .finally(function () {
          btn.disabled = false;
          btn.textContent = 'Submit guess';
        });
    });

    $('btn-next-finding').addEventListener('click', function () {
      clearError('agreement-error');
      var finding = FINDINGS_PUBLIC[state.findingIndex];
      var agreement = selectedValue($('agreement-yesno'));

      if (!agreement) {
        showError('agreement-error', 'Record an agreement answer before continuing.');
        return;
      }

      var correctCategory = selectedValue($('correct-category-options')) || '';

      var btn = $('btn-next-finding');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      callBackend('submitAgreement', {
        id: state.participantId,
        findingNum: finding.num,
        agreement: agreement,
        correctCategory: correctCategory,
        couldAlsoBe: couldAlsoBeString()
      })
        .then(function () {
          state.findingIndex++;
          session.cve.findingIndex = state.findingIndex;
          session.cve.guessSubmitted = false;
          session.cve.revealData = null;
          if (state.findingIndex < FINDINGS_PUBLIC.length) {
            session.cve.allDone = false;
            saveSession();
            renderFinding();
          } else {
            session.cve.allDone = true;
            saveSession();
            renderMiniProgress();
            renderCodeListing(null);
            $('cve-finding-card').classList.add('hidden');
            $('cve-done').classList.remove('hidden');
          }
        })
        .catch(function (err) {
          showError('agreement-error', 'Could not save this answer: ' + err.message);
        })
        .finally(function () {
          btn.disabled = false;
          btn.textContent = 'Save and continue';
        });
    });

    $('btn-to-prototype').addEventListener('click', function () {
      session.section = 'prototype';
      saveSession();
      showSection('section-prototype');
      openPrototype();
    });
  }

  function revealFinding(data) {
    $('btn-submit-guess').classList.add('hidden');

    // The reveal: recorded into state.revealedFindings only here, after
    // submitGuess has already returned — the guess is already a row in the
    // Sheet by this point, so coloring the line now doesn't touch the
    // blind-reveal boundary.
    var finding = FINDINGS_PUBLIC[state.findingIndex];
    state.revealedFindings[finding.num] = data.category;
    state.revealedCategory = data.category;
    renderCodeListing(finding.line);
    scrollToCurrentLine(finding.line);

    var color = CATEGORY_COLORS[data.category];
    var dot = $('finding-dot');
    dot.classList.add('revealed');
    dot.style.background = color;
    dot.style.borderColor = color;
    $('cve-finding-meta').textContent = data.category + ' · Line ' + data.line;
    $('cve-finding-line').textContent = 'Your guess has been recorded — see the application’s answer below.';

    var box = $('reveal-box');
    box.classList.remove('hidden');
    $('reveal-text').innerHTML =
      'Application assigned this to: <strong>' + escapeHtml(data.category) + '</strong>';
    // The "why" explanation gets the exact same blind-reveal treatment as
    // the category itself — it only ever arrives in this same submitGuess
    // response, never before, since it would give the category away just
    // as effectively as printing the label.
    $('reveal-explanation').textContent = data.explanation || '';

    // "If you disagree, what is the correct category?" only makes sense
    // once they've actually said they disagree — shown on "No", hidden
    // (and cleared) on "Yes", rather than always visible.
    var yn = $('agreement-yesno');
    yn.innerHTML = '';
    ['Yes', 'No'].forEach(function (v) {
      yn.appendChild(makeRadioOption('agree-yn', v, v, function (picked) {
        if (picked === 'No') {
          $('disagree-block').classList.remove('hidden');
        } else {
          $('disagree-block').classList.add('hidden');
          clearCorrectCategory();
        }
      }));
    });
    $('disagree-block').classList.add('hidden');

    renderCorrectCategoryOptions();
    renderCouldAlsoBeOptions();
  }

  function restoreCVESection() {
    state.revealedFindings = (session.cve && session.cve.revealedFindings) || {};
    state.findingIndex = (session.cve && session.cve.findingIndex) || 0;

    if ((session.cve && session.cve.allDone) || state.findingIndex >= FINDINGS_PUBLIC.length) {
      state.findingIndex = FINDINGS_PUBLIC.length;
      renderMiniProgress();
      renderCodeListing(null);
      $('cve-finding-card').classList.add('hidden');
      $('cve-done').classList.remove('hidden');
      return;
    }

    renderFinding();
    // If the tab closed between submitGuess and submitAgreement, re-enter
    // directly at the reveal state rather than asking for a fresh guess —
    // resubmitting submitGuess would duplicate a CategoryValidation row,
    // since Code.gs has no idempotency check on it.
    if (session.cve.guessSubmitted && session.cve.revealData) {
      revealFinding(session.cve.revealData);
    }
  }

  // ---- Section 3: Hands-on prototype ----
  //
  // The iframe receives only a per-session random nonce in its URL. In
  // particular, the participant ID and all questionnaire/CVE data stay in
  // this page and are never disclosed to Glance. The child uses the nonce in
  // a same-origin postMessage when the participant completes each action.
  // Messages are accepted only from this exact iframe window, at this exact
  // origin, with the matching nonce.

  var prototypeSaving = {};

  function randomPrototypeNonce() {
    var bytes = new Uint8Array(24);
    if (!window.crypto || !window.crypto.getRandomValues) {
      throw new Error('This browser cannot create the secure study session required for the prototype.');
    }
    window.crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  function prototypeComplete() {
    return PROTOTYPE_MILESTONES.every(function (milestone) {
      return session.prototype && session.prototype.milestones && session.prototype.milestones[milestone];
    });
  }

  function renderPrototypeProgress() {
    var milestones = (session.prototype && session.prototype.milestones) || {};
    document.querySelectorAll('#prototype-progress [data-milestone]').forEach(function (el) {
      var done = !!milestones[el.dataset.milestone];
      el.classList.toggle('complete', done);
      el.setAttribute('aria-current', done ? 'true' : 'false');
    });
    $('btn-prototype-continue').disabled = !prototypeComplete();
    if (prototypeComplete()) {
      $('prototype-status').textContent = 'All task actions recorded. You can now continue to the SUS questionnaire.';
      $('prototype-status').classList.remove('hidden');
    } else {
      $('prototype-status').classList.add('hidden');
    }
  }

  function openPrototype() {
    try {
      if (!session.prototype.nonce) {
        session.prototype.nonce = randomPrototypeNonce();
        saveSession();
      }
      clearError('prototype-error');
      renderPrototypeProgress();
      var frame = $('study-prototype-frame');
      var target = new URL('prototype/', window.location.href);
      target.searchParams.set('studyNonce', session.prototype.nonce);
      if (frame.src !== target.href) frame.src = target.href;
    } catch (err) {
      showError('prototype-error', err.message || 'Could not start the hands-on prototype.');
    }
  }

  function recordPrototypeMilestone(milestone) {
    if (PROTOTYPE_MILESTONES.indexOf(milestone) === -1 || prototypeSaving[milestone]) return;
    if (session.prototype.milestones[milestone]) return;

    prototypeSaving[milestone] = true;
    clearError('prototype-error');
    callBackend('saveHandsOnMilestone', {
      id: state.participantId,
      milestone: milestone,
      sampleId: PROTOTYPE_SAMPLE_ID
    })
      .then(function () {
        session.prototype.milestones[milestone] = true;
        saveSession();
        renderPrototypeProgress();
      })
      .catch(function (err) {
        showError('prototype-error', 'Could not record this task action. Please repeat the action: ' + err.message);
      })
      .finally(function () {
        prototypeSaving[milestone] = false;
      });
  }

  function initPrototype() {
    window.addEventListener('message', function (event) {
      var frame = $('study-prototype-frame');
      var message = event.data;
      if (!frame || event.source !== frame.contentWindow) return;
      if (event.origin !== window.location.origin) return;
      if (!message || message.type !== 'glance-study:milestone') return;
      if (!session.prototype || message.nonce !== session.prototype.nonce) return;
      recordPrototypeMilestone(message.milestone);
    });

    $('btn-prototype-continue').addEventListener('click', function () {
      if (!prototypeComplete()) return;
      session.section = 'sus';
      saveSession();
      showSection('section-sus');
      renderSUS();
      restoreSUSDraft();
    });
  }

  // ---- Section 4: SUS ----

  function renderSUS() {
    var container = $('sus-items');
    container.innerHTML = '';
    SUS_ITEMS.forEach(function (text, i) {
      var wrap = document.createElement('div');
      wrap.className = 'sus-item';
      var label = document.createElement('label');
      label.className = 'sus-statement';
      label.textContent = 'SUS' + (i + 1) + '. ' + text;
      wrap.appendChild(label);

      var row = document.createElement('div');
      row.className = 'likert-row sus-likert';
      ['1', '2', '3', '4', '5'].forEach(function (v, vi) {
        var text2 = v;
        if (vi === 0) text2 = '1 (Strongly Disagree)';
        if (vi === 4) text2 = '5 (Strongly Agree)';
        row.appendChild(makeRadioOption('sus' + (i + 1), v, text2, function (val) {
          session.susDraft[i] = val;
          saveSession();
          showDraftSaved('sus-draft-status');
        }));
      });
      wrap.appendChild(row);
      container.appendChild(wrap);
    });
  }

  function restoreSUSDraft() {
    (session.susDraft || []).forEach(function (val, i) {
      if (!val) return;
      var input = document.querySelector('input[name="sus' + (i + 1) + '"][value="' + val + '"]');
      if (input && input.parentElement) input.parentElement.click();
    });
  }

  function initSUS() {
    $('btn-sus-submit').addEventListener('click', function () {
      clearError('sus-error');
      // Client-side session recovery must never provide a route around the
      // supervised task. This is also checked when a stale saved `sus`
      // section is restored below.
      if (!prototypeComplete()) {
        session.section = 'prototype';
        saveSession();
        showSection('section-prototype');
        openPrototype();
        return;
      }
      var scores = [];
      for (var i = 0; i < SUS_ITEMS.length; i++) {
        var row = document.querySelectorAll('#sus-items > div')[i].querySelector('.likert-row');
        var v = selectedValue(row);
        if (!v) {
          showError('sus-error', 'Please answer all 10 statements (missing item ' + (i + 1) + ').');
          return;
        }
        scores.push(Number(v));
      }

      var btn = $('btn-sus-submit');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      callBackend('saveSUS', { id: state.participantId, scores: scores })
        .then(function (data) {
          $('done-id').textContent = state.participantId;
          $('done-sus-score').textContent = 'SUS score recorded: ' + data.susScore + ' / 100';
          clearSession();
          showSection('section-done');
        })
        .catch(function (err) {
          showError('sus-error', 'Could not save SUS scores: ' + err.message);
        })
        .finally(function () {
          btn.disabled = false;
          btn.textContent = 'Finish';
        });
    });
  }

  // ---- Boot ----

  document.addEventListener('DOMContentLoaded', function () {
    if (!backendConfigured()) {
      showSetupNeeded();
      return;
    }

    initCover();
    initConsent();
    initAccessGate();
    initIntake();
    initDemo();
    initInterview();
    initCVE();
    initPrototype();
    initSUS();

    var startOverBtn = $('btn-start-over');
    if (startOverBtn) {
      startOverBtn.addEventListener('click', function () {
        if (!window.confirm('Start over? This clears your saved progress on this device — nothing already submitted is removed from the database.')) return;
        clearSession();
        window.location.reload();
      });
    }

    var saved = loadSession();
    if (saved) {
      session = saved;
      state.participantId = session.participantId;
      setBadges(session.participantId);
      showResumeBanner(session.participantId);

      // A session created before consent was recorded, or one interrupted
      // between assign_id and save_consent, must return to the consent gate.
      // This keeps every response-bearing section behind a server-saved
      // consent record.
      if (!session.consent.accepted || !session.consent.saved) {
        session.section = session.studyPath === 'sus_only' ? 'access' : 'intake';
        saveSession();
        showSection('section-consent');
      } else if (session.studyPath === 'sus_only' &&
                 (session.section === 'intake' || session.section === 'interview' || session.section === 'cve')) {
        // A SUS-only participant has no normal UI route to these SME-only
        // sections. If an old/stale browser session claims otherwise, recover
        // to the first valid step rather than showing incomplete study data.
        session.section = 'demo';
        saveSession();
        showSection('section-demo');
      } else if (session.section === 'access') {
        showSection('section-access');
      } else if (session.section === 'demo') {
        showSection('section-demo');
      } else if (session.section === 'interview') {
        showSection('section-interview');
        restoreInterviewDraft();
      } else if (session.section === 'cve') {
        showSection('section-cve');
        restoreCVESection();
      } else if (session.section === 'prototype') {
        showSection('section-prototype');
        openPrototype();
      } else if (session.section === 'sus') {
        if (prototypeComplete()) {
          showSection('section-sus');
          renderSUS();
          restoreSUSDraft();
        } else {
          session.section = 'prototype';
          saveSession();
          showSection('section-prototype');
          openPrototype();
        }
      } else {
        showSection('section-intake');
      }
    } else {
      showSection('section-cover');
    }
  });
})();
