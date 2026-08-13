// app.js
// Frontend logic for the SME Interview + Category Validation Exercise + SUS
// web page. Talks only to the Apps Script Web App URL set in config.js.
// The AI-assigned category for each finding is never present in this file
// or anywhere else client-side — it only ever arrives in the response to
// submitGuess, after a guess has already been recorded server-side.
//
// Every value sent to the backend keeps the same shape callBackend has
// always used (plain strings for yearsExperience/platforms/agreement/
// correctCategory/couldAlsoBe), even though several inputs now use
// richer controls (sliders, chips, toggles, ranked checkboxes) — this
// means the already-deployed Code.gs never needs to change.

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
  // These are the same 4 categories already fixed by this project's taxonomy; only
  // the color mapping is new. A category color is only ever assigned to a DOM element
  // after that finding's guess has been recorded server-side (see revealFinding) —
  // that's the same blind-reveal boundary the rest of the app already enforces.
  var CATEGORY_COLORS = {
    'Code Quality': '#BF4F4B',
    'Bugs': '#A8791E',
    'Optimization': '#3C7F63',
    'Readability': '#6E63A6'
  };

  var STEP_ORDER = ['intake', 'interview', 'cve', 'sus', 'done'];

  // ---- State (live, in-memory) ----

  var state = {
    participantId: null,
    findingIndex: 0,
    currentGuess: null,
    agreementMode: 'yesno',
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
      interviewDraft: { q2: '', q3: '', q4: '', q5: '', q6: '' },
      cve: { findingIndex: 0, guessSubmitted: false, revealData: null, revealedFindings: {}, allDone: false },
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
      base.interviewDraft = Object.assign(base.interviewDraft, parsed.interviewDraft || {});
      base.cve = Object.assign(base.cve, parsed.cve || {});
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
    updateStepper(id.replace('section-', ''));
  }

  function updateStepper(activeStep) {
    var idx = STEP_ORDER.indexOf(activeStep);
    document.querySelectorAll('.step').forEach(function (el) {
      var stepIdx = STEP_ORDER.indexOf(el.dataset.step);
      el.classList.remove('current', 'done');
      if (stepIdx < idx) el.classList.add('done');
      else if (stepIdx === idx) el.classList.add('current');
    });
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
    ['id-badge-1', 'id-badge-2', 'id-badge-3'].forEach(function (b) {
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

  function makeRadioOption(groupName, value, labelText, onPick) {
    var label = document.createElement('label');
    label.className = 'radio-option';
    var input = document.createElement('input');
    input.type = 'radio';
    input.name = groupName;
    input.value = value;
    label.appendChild(input);
    label.appendChild(document.createTextNode(' ' + labelText));
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
  // Content-Type text/plain deliberately avoids a CORS preflight request,
  // which Apps Script Web Apps cannot answer. The body is still JSON;
  // Code.gs parses e.postData.contents itself regardless of the declared
  // content type.

  function callBackend(action, payload) {
    var body = Object.assign({ action: action }, payload || {});
    return fetch(WEB_APP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    })
      .then(function (resp) {
        if (!resp.ok) throw new Error('Server returned HTTP ' + resp.status);
        return resp.json();
      })
      .then(function (data) {
        if (!data.ok) throw new Error(data.error || 'Unknown server error');
        return data;
      });
  }

  // ---- Setup check ----

  function backendConfigured() {
    return typeof WEB_APP_URL === 'string' &&
      WEB_APP_URL.indexOf('PASTE_YOUR') === -1 &&
      WEB_APP_URL.indexOf('http') === 0;
  }

  function showSetupNeeded() {
    var main = document.querySelector('main');
    main.innerHTML =
      '<div class="card">' +
      '<h2>Setup needed</h2>' +
      '<p>This page is not connected to a backend yet. <code>config.js</code> still has the placeholder ' +
      'value for <code>WEB_APP_URL</code> instead of a real Apps Script Web App URL.</p>' +
      '<p class="help">See README.md for the deploy steps: create the Sheet, paste in gas/Code.gs, deploy it ' +
      'as a Web App, then paste the resulting /exec URL into config.js.</p>' +
      '</div>';
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
          session.section = 'interview';
          saveSession();
          showSection('section-interview');
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
        return '<div class="code-line flagged" style="--rail:' + color + '">' +
          '<span class="ln">' + numStr + '</span>' + srcHtml +
          '<span class="mark" style="color:' + color + '">●</span></div>';
      }
      if (lineNum === currentLineNum) {
        return '<div class="code-line current"><span class="ln">' + numStr + '</span>' + srcHtml + '</div>';
      }
      return '<div class="code-line"><span class="ln">' + numStr + '</span>' + srcHtml + '</div>';
    }).join('');
    $('code-listing').innerHTML = html;
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
    state.agreementMode = 'yesno';
    state.couldAlsoBeOrder = [];

    renderMiniProgress();
    renderCodeListing(finding.line);

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

  function setAgreementMode(mode) {
    state.agreementMode = mode;
    document.querySelectorAll('#agreement-mode .toggle-option').forEach(function (btn) {
      btn.classList.toggle('selected', btn.dataset.mode === mode);
    });
    $('agreement-yesno').classList.toggle('hidden', mode !== 'yesno');
    $('agreement-likert').classList.toggle('hidden', mode !== 'likert');
  }

  function renderCorrectCategoryOptions() {
    var el = $('correct-category-options');
    el.innerHTML = '';
    CATEGORIES.forEach(function (cat) {
      el.appendChild(makeRadioOption('correct-category', cat, cat));
    });
  }

  function renderCouldAlsoBeOptions() {
    var el = $('could-also-be-options');
    el.innerHTML = '';
    CATEGORIES.forEach(function (cat) {
      var row = document.createElement('div');
      row.className = 'rank-row';

      var label = document.createElement('label');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = cat;
      var badge = document.createElement('span');
      badge.className = 'pill rank-badge hidden';

      label.appendChild(cb);
      label.appendChild(document.createTextNode(cat));

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
    document.querySelectorAll('#agreement-mode .toggle-option').forEach(function (btn) {
      btn.addEventListener('click', function () { setAgreementMode(btn.dataset.mode); });
    });

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
      var agreement = state.agreementMode === 'yesno'
        ? selectedValue($('agreement-yesno'))
        : selectedValue($('agreement-likert'));

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

    $('btn-to-sus').addEventListener('click', function () {
      session.section = 'sus';
      saveSession();
      showSection('section-sus');
      renderSUS();
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
    renderCodeListing(finding.line);

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

    var yn = $('agreement-yesno');
    yn.innerHTML = '';
    ['Yes', 'No'].forEach(function (v) { yn.appendChild(makeRadioOption('agree-yn', v, v)); });

    var lk = $('agreement-likert');
    lk.innerHTML = '';
    ['1 - Strongly Disagree', '2', '3', '4', '5 - Strongly Agree'].forEach(function (v) {
      lk.appendChild(makeRadioOption('agree-likert', v, v));
    });

    setAgreementMode('yesno');
    $('disagree-block').classList.remove('hidden');
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

  // ---- Section 3: SUS ----

  function renderSUS() {
    var container = $('sus-items');
    container.innerHTML = '';
    SUS_ITEMS.forEach(function (text, i) {
      var wrap = document.createElement('div');
      var label = document.createElement('label');
      label.textContent = 'SUS' + (i + 1) + '. ' + text;
      wrap.appendChild(label);

      var row = document.createElement('div');
      row.className = 'likert-row';
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

    initIntake();
    initInterview();
    initCVE();
    initSUS();

    var startOverBtn = $('btn-start-over');
    if (startOverBtn) {
      startOverBtn.addEventListener('click', function () {
        if (!window.confirm('Start over? This clears your saved progress on this device — nothing already submitted is removed from the Sheet.')) return;
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

      if (session.section === 'interview') {
        showSection('section-interview');
        restoreInterviewDraft();
      } else if (session.section === 'cve') {
        showSection('section-cve');
        restoreCVESection();
      } else if (session.section === 'sus') {
        showSection('section-sus');
        renderSUS();
        restoreSUSDraft();
      } else {
        updateStepper('intake');
      }
    } else {
      updateStepper('intake');
    }
  });
})();
