/* Researcher-only dashboard for the SME study.
 *
 * This is deliberately not protected by a browser PIN. Password sign-in gives
 * Supabase an authenticated JWT, and researcher_dashboard() checks that
 * JWT against the server-side allowlist before returning any study data.
 */
(function () {
  'use strict';

  var RESEARCHER_EMAIL = 'muhammadsyaheerdaniel@gmail.com';
  var SESSION_KEY = 'smeResearcherAccessToken_v1';
  var DEPLOYED_RESEARCHER_URL = 'https://syaheerdnl.github.io/GlanceSMEResponses/researcher.html';
  var results = null;

  function $(id) { return document.getElementById(id); }

  function configured() {
    return typeof SUPABASE_URL !== 'undefined' && typeof SUPABASE_ANON_KEY !== 'undefined' &&
      SUPABASE_URL && SUPABASE_ANON_KEY &&
      !SUPABASE_URL.includes('YOUR_PROJECT') && !SUPABASE_ANON_KEY.includes('YOUR_ANON');
  }

  function show(elId, message) {
    var el = $(elId);
    el.textContent = message;
    el.classList.remove('hidden');
  }

  function hide(elId) {
    var el = $(elId);
    el.textContent = '';
    el.classList.add('hidden');
  }

  function researcherUrl() {
    var currentUrl = new URL('researcher.html', window.location.href);
    if (currentUrl.origin === 'https://syaheerdnl.github.io' &&
        currentUrl.pathname.indexOf('/GlanceSMEResponses/') === 0) {
      return currentUrl.href;
    }
    return DEPLOYED_RESEARCHER_URL;
  }

  function getToken() {
    try { return sessionStorage.getItem(SESSION_KEY); } catch (e) { return null; }
  }

  function setToken(token) {
    try { sessionStorage.setItem(SESSION_KEY, token); } catch (e) {}
  }

  function clearToken() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  // A one-time setup link still yields a normal authenticated session. It is
  // retained only so the approved researcher can set the first password;
  // routine access uses signInWithPassword below.
  function absorbMagicLinkToken() {
    var hash = new URLSearchParams(window.location.hash.slice(1));
    var token = hash.get('access_token');
    if (!token) return;
    setToken(token);
    window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
  }

  function request(url, options) {
    return fetch(url, options).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error(data.message || data.msg || data.error_description || 'Request failed.');
        return data;
      });
    });
  }

  function apiHeaders(token) {
    var headers = {
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json'
    };
    if (token) headers.Authorization = 'Bearer ' + token;
    return headers;
  }

  function signInWithPassword(password) {
    return request(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({
        email: RESEARCHER_EMAIL,
        password: password
      })
    }).then(function (session) {
      if (!session.access_token) throw new Error('Password sign-in did not return a session.');
      return session.access_token;
    });
  }

  function requestPasswordSetupLink() {
    return request(SUPABASE_URL + '/auth/v1/otp', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({
        email: RESEARCHER_EMAIL,
        create_user: false,
        redirect_to: researcherUrl()
      })
    });
  }

  function updatePassword(token, password) {
    return request(SUPABASE_URL + '/auth/v1/user', {
      method: 'PUT',
      headers: apiHeaders(token),
      body: JSON.stringify({ password: password })
    });
  }

  function loadAuthenticatedResults(token) {
    return request(SUPABASE_URL + '/auth/v1/user', {
      headers: apiHeaders(token)
    }).then(function (user) {
      if (!user.email || user.email.toLowerCase() !== RESEARCHER_EMAIL) {
        throw new Error('This account is not approved for researcher access.');
      }
      return request(SUPABASE_URL + '/rest/v1/rpc/researcher_dashboard', {
        method: 'POST',
        headers: apiHeaders(token),
        body: '{}'
      });
    });
  }

  function revokeSession(token) {
    if (!token) return Promise.resolve();
    return request(SUPABASE_URL + '/auth/v1/logout', {
      method: 'POST',
      headers: apiHeaders(token)
    }).catch(function () {
      // Clearing the browser-held token still protects this device if a
      // network error prevents the server from revoking the session.
    });
  }

  function dateText(value) {
    if (!value) return 'Not recorded';
    var date = new Date(value);
    return isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  function csvCell(value) {
    var text = value === null || value === undefined ? '' : String(value);
    // Prevent a participant-provided value being interpreted as a formula if
    // a downloaded CSV is opened in spreadsheet software.
    if (/^[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function downloadCsv(filename, headers, rows) {
    var text = [headers.map(csvCell).join(',')].concat(rows.map(function (row) {
      return row.map(csvCell).join(',');
    })).join('\r\n');
    var url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function selectedPath() { return $('researcher-route-filter').value; }

  function filteredParticipants() {
    var path = selectedPath();
    return (results.participants || []).filter(function (participant) {
      return path === 'all' || participant.studyPath === path;
    });
  }

  function filteredCategories() {
    return (results.categoryValidation || []).filter(function (row) {
      return selectedPath() !== 'sus_only' && row.studyPath === 'full_sme';
    });
  }

  function filteredInterviews() {
    return (results.interviews || []).filter(function (row) {
      return selectedPath() !== 'sus_only' && row.studyPath === 'full_sme';
    });
  }

  function formatScore(value) {
    return value === null || value === undefined ? 'Not completed' : Number(value).toFixed(1);
  }

  function renderMetrics(participants) {
    var completedSUS = participants.filter(function (p) { return p.susScore !== null && p.susScore !== undefined; });
    var mean = completedSUS.length ? completedSUS.reduce(function (sum, p) { return sum + Number(p.susScore); }, 0) / completedSUS.length : null;
    var handsOn = participants.filter(function (p) { return !!p.fixAppliedAt; });
    $('metric-participants').textContent = String(completedSUS.length);
    $('metric-participants-detail').textContent = completedSUS.length === 1 ? 'participant completed SUS' : 'participants completed SUS';
    $('metric-sus').textContent = mean === null ? 'Not available' : mean.toFixed(1);
    $('metric-hands-on').textContent = handsOn.length + ' / ' + participants.length;
  }

  function renderCategoryValidation(categories) {
    var unavailable = selectedPath() === 'sus_only';
    $('researcher-category-bars').classList.toggle('hidden', unavailable);
    $('researcher-cve-unavailable').classList.toggle('hidden', !unavailable);
    if (unavailable) {
      $('researcher-cve-summary').textContent = '';
      $('researcher-cve-overall').textContent = 'Not available';
      return;
    }

    var total = categories.length;
    var matches = categories.filter(function (row) { return row.guess === row.aiCategory; }).length;
    $('researcher-cve-summary').textContent = total ? total + ' blind guesses from full-SME participants' : 'No category-validation records yet.';
    $('researcher-cve-overall').textContent = total ? Math.round((matches / total) * 100) + '% match' : 'Not available';

    var categoriesByName = ['Code Quality', 'Bugs', 'Optimization', 'Readability'];
    $('researcher-category-bars').innerHTML = categoriesByName.map(function (name) {
      var rows = categories.filter(function (row) { return row.aiCategory === name; });
      var matched = rows.filter(function (row) { return row.guess === row.aiCategory; }).length;
      var percent = rows.length ? Math.round((matched / rows.length) * 100) : 0;
      return '<div class="researcher-bar-row"><span>' + name + '</span><span class="researcher-bar-track"><span style="width:' + percent + '%"></span></span><strong>' + (rows.length ? percent + '%' : 'Not available') + '</strong></div>';
    }).join('');
  }

  function renderParticipantTable(participants) {
    $('researcher-no-participants').classList.toggle('hidden', participants.length > 0);
    $('researcher-participant-rows').innerHTML = participants.map(function (participant) {
      return '<tr>' +
        '<td>' + escapeHtml(participant.participantName || 'Not recorded') + '</td>' +
        '<td>' + escapeHtml(participant.participantId) + '</td>' +
        '<td>' + (participant.studyPath === 'full_sme' ? 'Full SME' : 'SUS-only') + '</td>' +
        '<td>' + formatScore(participant.susScore) + '</td>' +
        '<td>' + (participant.fixAppliedAt ? 'Completed' : 'Not completed') + '</td>' +
        '<td>' + (participant.consentedAt ? 'Recorded' : 'Missing') + '</td>' +
        '</tr>';
    }).join('');
  }

  function renderDashboard() {
    var participants = filteredParticipants();
    renderMetrics(participants);
    renderCategoryValidation(filteredCategories());
    renderParticipantTable(participants);
  }

  function participantRows() {
    return filteredParticipants().map(function (p) {
      return [p.participantName, p.participantId, p.studyPath, p.createdAt, p.yearsExperience, p.platforms, p.role, p.languageFamiliarity, p.consentedAt, p.susScore, p.openedAt, p.reviewCompletedAt, p.feedbackOpenedAt, p.fixAppliedAt];
    });
  }

  function susRows() {
    return filteredParticipants().filter(function (p) { return p.susScore !== null && p.susScore !== undefined; }).map(function (p) {
      return [p.participantId, p.studyPath, p.sus1, p.sus2, p.sus3, p.sus4, p.sus5, p.sus6, p.sus7, p.sus8, p.sus9, p.sus10, p.susScore, p.susFeedbackDifficulty, p.susFeedbackImprovement];
    });
  }

  function handsOnRows() {
    return filteredParticipants().map(function (p) {
      return [p.participantId, p.studyPath, p.sampleId, p.openedAt, p.reviewCompletedAt, p.feedbackOpenedAt, p.fixAppliedAt];
    });
  }

  function categoryRows() {
    return filteredCategories().map(function (row) {
      return [row.participantId, row.findingNum, row.line, row.findingTitle, row.guess, row.aiCategory, row.agreement, row.correctCategory, row.couldAlsoBe, row.guessAt, row.agreementAt];
    });
  }

  function interviewRows() {
    return filteredInterviews().map(function (row) {
      return [row.participantId, row.createdAt, row.q2, row.q3, row.q4, row.q5, row.q6];
    });
  }

  function initExports() {
    $('btn-export-participants').addEventListener('click', function () {
      downloadCsv('glance-participants.csv', ['participant_name', 'participant_id', 'study_path', 'created_at', 'years_experience', 'platforms', 'role', 'language_familiarity', 'consented_at', 'sus_score', 'opened_at', 'review_completed_at', 'feedback_opened_at', 'fix_applied_at'], participantRows());
    });
    $('btn-export-sus').addEventListener('click', function () {
      downloadCsv('glance-sus.csv', ['participant_id', 'study_path', 'sus1', 'sus2', 'sus3', 'sus4', 'sus5', 'sus6', 'sus7', 'sus8', 'sus9', 'sus10', 'sus_score', 'feedback_difficulty', 'feedback_improvement'], susRows());
    });
    $('btn-export-hands-on').addEventListener('click', function () {
      downloadCsv('glance-hands-on.csv', ['participant_id', 'study_path', 'sample_id', 'opened_at', 'review_completed_at', 'feedback_opened_at', 'fix_applied_at'], handsOnRows());
    });
    $('btn-export-category').addEventListener('click', function () {
      downloadCsv('glance-category-validation.csv', ['participant_id', 'finding_num', 'line', 'finding_title', 'blind_guess', 'ai_category', 'agreement', 'correct_category', 'could_also_be', 'guess_at', 'agreement_at'], categoryRows());
    });
    $('btn-export-interview').addEventListener('click', function () {
      downloadCsv('glance-interview.csv', ['participant_id', 'created_at', 'q2', 'q3', 'q4', 'q5', 'q6'], interviewRows());
    });
  }

  function showDashboard(data) {
    results = data;
    $('researcher-login').classList.add('hidden');
    $('researcher-dashboard').classList.remove('hidden');
    $('researcher-password-panel').classList.toggle('hidden', new URLSearchParams(window.location.search).get('setup') !== '1');
    $('researcher-generated-at').textContent = 'Loaded ' + dateText(data.generatedAt) + '. Data stays in Supabase until you export it.';
    renderDashboard();
  }

  function init() {
    if (!configured()) {
      show('researcher-login-error', 'Setup needed: add the Supabase project URL and anon key to config.js.');
      $('btn-researcher-login').disabled = true;
      return;
    }

    absorbMagicLinkToken();
    $('researcher-login-form').addEventListener('submit', function (event) {
      event.preventDefault();
      hide('researcher-login-error');
      hide('researcher-login-status');
      var password = $('researcher-password').value;
      if (!password) {
        show('researcher-login-error', 'Enter the researcher password.');
        return;
      }
      var button = $('btn-researcher-login');
      button.disabled = true;
      button.textContent = 'Signing in...';
      signInWithPassword(password)
        .then(function (token) {
          setToken(token);
          return loadAuthenticatedResults(token);
        })
        .then(showDashboard)
        .catch(function (error) {
          clearToken();
          show('researcher-login-error', 'Could not sign in: ' + error.message);
        })
        .finally(function () {
          $('researcher-password').value = '';
          button.disabled = false;
          button.textContent = 'Sign in to results';
        });
    });

    $('btn-researcher-setup').addEventListener('click', function () {
      hide('researcher-login-error');
      hide('researcher-login-status');
      var button = $('btn-researcher-setup');
      button.disabled = true;
      button.textContent = 'Sending setup link...';
      requestPasswordSetupLink()
        .then(function () {
          show('researcher-login-status', 'A one-time setup link has been sent. Open it in this browser, then set your researcher password in the dashboard.');
        })
        .catch(function (error) {
          show('researcher-login-error', 'Could not send the setup link: ' + error.message);
        })
        .finally(function () {
          button.disabled = false;
          button.textContent = 'email me a one-time setup link';
        });
    });

    $('researcher-password-form').addEventListener('submit', function (event) {
      event.preventDefault();
      hide('researcher-password-error');
      hide('researcher-password-status');
      var password = $('researcher-new-password').value;
      var token = getToken();
      if (!token) {
        show('researcher-password-error', 'Sign in before changing the password.');
        return;
      }
      if (password.length < 12) {
        show('researcher-password-error', 'Use at least 12 characters for the researcher password.');
        return;
      }
      var button = $('btn-researcher-password');
      button.disabled = true;
      button.textContent = 'Saving password...';
      updatePassword(token, password)
        .then(function () {
          $('researcher-new-password').value = '';
          show('researcher-password-status', 'Password saved. Use it for future researcher sign-ins; no email link is needed.');
        })
        .catch(function (error) {
          show('researcher-password-error', 'Could not save the password: ' + error.message);
        })
        .finally(function () {
          button.disabled = false;
          button.textContent = 'Save password';
        });
    });

    $('researcher-route-filter').addEventListener('change', renderDashboard);
    $('btn-researcher-signout').addEventListener('click', function () {
      var token = getToken();
      clearToken();
      revokeSession(token).finally(function () {
        window.location.replace('researcher.html');
      });
    });
    initExports();

    var token = getToken();
    if (!token) return;
    show('researcher-login-status', 'Checking researcher access...');
    loadAuthenticatedResults(token)
      .then(showDashboard)
      .catch(function (error) {
        clearToken();
        show('researcher-login-error', 'Researcher access could not be confirmed: ' + error.message);
      });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
