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
    // GoTrue reads this as a query parameter. Sending it in the JSON body
    // makes Supabase fall back to the configured Site URL instead.
    var endpoint = SUPABASE_URL + '/auth/v1/otp?redirect_to=' + encodeURIComponent(researcherUrl());
    return request(endpoint, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({
        email: RESEARCHER_EMAIL,
        create_user: false
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

  function downloadBlob(filename, blob) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function downloadCsv(filename, headers, rows) {
    var text = [headers.map(csvCell).join(',')].concat(rows.map(function (row) {
      return row.map(csvCell).join(',');
    })).join('\r\n');
    downloadBlob(filename, new Blob([text], { type: 'text/csv;charset=utf-8' }));
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

  function routeLabel(path) {
    if (path === 'full_sme') return 'Full SME route';
    if (path === 'sus_only') return 'SUS-only route';
    return 'All participants';
  }

  function plural(count, singular, pluralText) {
    return count + ' ' + (count === 1 ? singular : (pluralText || singular + 's'));
  }

  // These values are derived only after the allowlisted researcher RPC has
  // returned. They intentionally contain no participant identity, interview
  // response, or SUS free-text field, which makes the chart image safe to
  // use as an aggregate thesis figure when appropriate.
  function buildStudySummary(participants, categories) {
    var completedSUS = participants.filter(function (p) { return p.susScore !== null && p.susScore !== undefined; });
    var scores = completedSUS.map(function (p) { return Number(p.susScore); });
    var mean = scores.length ? scores.reduce(function (sum, score) { return sum + score; }, 0) / scores.length : null;
    var handsOnMilestones = [
      { label: 'Opened', value: participants.filter(function (p) { return !!p.openedAt; }).length },
      { label: 'Review run', value: participants.filter(function (p) { return !!p.reviewCompletedAt; }).length },
      { label: 'Feedback opened', value: participants.filter(function (p) { return !!p.feedbackOpenedAt; }).length },
      { label: 'Fix applied', value: participants.filter(function (p) { return !!p.fixAppliedAt; }).length }
    ];
    var summary = {
      participantCount: participants.length,
      completedSUS: completedSUS.length,
      meanSUS: mean,
      susDistribution: [
        { label: '0 to 49', value: scores.filter(function (score) { return score < 50; }).length, color: '#d4351c' },
        { label: '50 to 67', value: scores.filter(function (score) { return score >= 50 && score < 68; }).length, color: '#f47738' },
        { label: '68 to 79', value: scores.filter(function (score) { return score >= 68 && score < 80; }).length, color: '#1d70b8' },
        { label: '80 to 100', value: scores.filter(function (score) { return score >= 80; }).length, color: '#00703c' }
      ],
      routeSplit: [
        { label: 'Full SME', value: participants.filter(function (p) { return p.studyPath === 'full_sme'; }).length, color: '#00703c' },
        { label: 'SUS-only', value: participants.filter(function (p) { return p.studyPath === 'sus_only'; }).length, color: '#1d70b8' }
      ],
      handsOnMilestones: handsOnMilestones,
      categoryMatch: null
    };

    if (selectedPath() !== 'sus_only') {
      var categoryColors = {
        'Code Quality': '#BF4F4B',
        Bugs: '#A8791E',
        Optimization: '#3C7F63',
        Readability: '#6E63A6'
      };
      summary.categoryMatch = ['Code Quality', 'Bugs', 'Optimization', 'Readability'].map(function (name) {
        var rows = categories.filter(function (row) { return row.aiCategory === name; });
        var matched = rows.filter(function (row) { return row.guess === row.aiCategory; }).length;
        return {
          label: name,
          value: rows.length ? Math.round((matched / rows.length) * 100) : 0,
          total: rows.length,
          matched: matched,
          color: categoryColors[name]
        };
      });
    }
    return summary;
  }

  function renderChartBars(elementId, series, options) {
    var element = $(elementId);
    var emptyMessage = options && options.emptyMessage;
    var color = (options && options.color) || '#00703c';
    if (!series) {
      element.innerHTML = '<p class="researcher-chart-empty">' + escapeHtml(emptyMessage || 'Not available for this participant group.') + '</p>';
      element.setAttribute('aria-label', emptyMessage || 'Not available');
      return;
    }

    var max = Math.max.apply(null, series.map(function (item) { return item.value; }).concat([1]));
    element.innerHTML = series.map(function (item) {
      var percent = Math.round((item.value / max) * 100);
      var itemColor = item.color || color;
      var valueText = options && options.valueText ? options.valueText(item) : String(item.value);
      return '<div class="researcher-chart-row">' +
        '<span class="researcher-chart-label">' + escapeHtml(item.label) + '</span>' +
        '<span class="researcher-chart-track"><span style="background:' + itemColor + ';width:' + percent + '%"></span></span>' +
        '<strong>' + escapeHtml(valueText) + '</strong>' +
      '</div>';
    }).join('');
    element.setAttribute('aria-label', series.map(function (item) {
      var valueText = options && options.valueText ? options.valueText(item) : String(item.value);
      return item.label + ': ' + valueText;
    }).join('; '));
  }

  // Pie/donut charts are used only for mutually exclusive parts of a whole.
  // SUS bands and the two study routes meet that condition. Task milestones
  // and category-match rates do not, so bars remain more honest for them.
  function renderDonutChart(elementId, series, options) {
    var element = $(elementId);
    var emptyMessage = (options && options.emptyMessage) || 'No completed records yet.';
    var color = (options && options.color) || '#00703c';
    if (!series) {
      element.innerHTML = '<p class="researcher-chart-empty">' + escapeHtml(emptyMessage) + '</p>';
      element.setAttribute('aria-label', emptyMessage);
      return;
    }

    var total = series.reduce(function (sum, item) { return sum + item.value; }, 0);
    if (!total) {
      element.innerHTML = '<p class="researcher-chart-empty">' + escapeHtml(emptyMessage) + '</p>';
      element.setAttribute('aria-label', emptyMessage);
      return;
    }

    var start = 0;
    var stops = series.filter(function (item) { return item.value > 0; }).map(function (item) {
      var end = start + (item.value / total) * 100;
      var stop = (item.color || color) + ' ' + start.toFixed(2) + '% ' + end.toFixed(2) + '%';
      start = end;
      return stop;
    }).join(', ');
    var legend = series.map(function (item) {
      var percent = Math.round((item.value / total) * 100);
      var valueText = options && options.valueText ? options.valueText(item) : String(item.value);
      return '<li><span class="researcher-donut-key" style="background:' + (item.color || color) + '"></span>' +
        '<span>' + escapeHtml(item.label) + '</span>' +
        '<strong>' + escapeHtml(valueText) + ' (' + percent + '%)</strong></li>';
    }).join('');

    element.classList.add('researcher-chart--donut');
    element.innerHTML = '<div class="researcher-donut-layout">' +
      '<div class="researcher-donut" style="background:conic-gradient(' + stops + ')"><span class="researcher-donut-hole"><strong>' + total + '</strong><small>' + escapeHtml((options && options.totalLabel) || 'total') + '</small></span></div>' +
      '<ul class="researcher-donut-legend">' + legend + '</ul>' +
    '</div>';
    element.setAttribute('aria-label', series.map(function (item) {
      var percent = Math.round((item.value / total) * 100);
      var valueText = options && options.valueText ? options.valueText(item) : String(item.value);
      return item.label + ': ' + valueText + ' (' + percent + '%)';
    }).join('; '));
  }

  function renderStudyCharts(participants, categories) {
    var summary = buildStudySummary(participants, categories);
    renderDonutChart('chart-sus-distribution', summary.susDistribution, {
      totalLabel: 'SUS results',
      valueText: function (item) { return plural(item.value, 'participant'); }
    });
    renderDonutChart('chart-route-split', summary.routeSplit, {
      totalLabel: 'records',
      valueText: function (item) { return plural(item.value, 'participant'); }
    });
    renderChartBars('chart-hands-on-progress', summary.handsOnMilestones, {
      color: '#00703c',
      valueText: function (item) { return item.value + ' / ' + summary.participantCount; }
    });
    renderChartBars('chart-category-match', summary.categoryMatch, {
      emptyMessage: 'Category validation is collected only in the full SME route.',
      valueText: function (item) { return item.total ? item.value + '% (' + item.matched + '/' + item.total + ')' : 'No responses'; }
    });
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
    var categories = filteredCategories();
    renderMetrics(participants);
    renderStudyCharts(participants, categories);
    renderCategoryValidation(categories);
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

  function summaryRows() {
    var participants = filteredParticipants();
    var summary = buildStudySummary(participants, filteredCategories());
    var rows = [
      ['participant_group', routeLabel(selectedPath())],
      ['participant_records', summary.participantCount],
      ['completed_sus', summary.completedSUS],
      ['mean_sus_score', summary.meanSUS === null ? '' : summary.meanSUS.toFixed(1)]
    ];
    summary.susDistribution.forEach(function (item) { rows.push(['sus_score_' + item.label.replace(/ /g, '_'), item.value]); });
    summary.routeSplit.forEach(function (item) { rows.push(['route_' + item.label.toLowerCase().replace(/[^a-z]+/g, '_'), item.value]); });
    summary.handsOnMilestones.forEach(function (item) { rows.push(['hands_on_' + item.label.toLowerCase().replace(/[^a-z]+/g, '_'), item.value]); });
    if (summary.categoryMatch) {
      summary.categoryMatch.forEach(function (item) {
        rows.push(['category_match_' + item.label.toLowerCase().replace(/[^a-z]+/g, '_'), item.value + '% (' + item.matched + '/' + item.total + ')']);
      });
    } else {
      rows.push(['category_match', 'Not collected for SUS-only participants']);
    }
    return rows;
  }

  function drawExportChart(context, x, y, width, title, series, options) {
    var height = 230;
    context.strokeStyle = '#b1b4b6';
    context.lineWidth = 2;
    context.strokeRect(x, y, width, height);
    context.fillStyle = '#0b0c0c';
    context.font = '700 24px Arial, sans-serif';
    context.fillText(title, x + 22, y + 35);

    if (!series) {
      context.fillStyle = '#505a5f';
      context.font = '18px Arial, sans-serif';
      context.fillText(options.emptyMessage, x + 22, y + 85);
      return;
    }

    var max = Math.max.apply(null, series.map(function (item) { return item.value; }).concat([1]));
    var labelWidth = 155;
    var trackWidth = width - labelWidth - 118;
    series.forEach(function (item, index) {
      var rowY = y + 72 + index * 34;
      var barWidth = Math.round((item.value / max) * trackWidth);
      context.fillStyle = '#e8e8e8';
      context.fillRect(x + labelWidth, rowY - 15, trackWidth, 16);
      context.fillStyle = item.color || options.color;
      context.fillRect(x + labelWidth, rowY - 15, barWidth, 16);
      context.fillStyle = '#0b0c0c';
      context.font = '600 16px Arial, sans-serif';
      context.fillText(item.label, x + 22, rowY - 2);
      context.textAlign = 'right';
      context.fillText(options.valueText(item), x + width - 22, rowY - 2);
      context.textAlign = 'left';
    });
  }

  function drawExportDonutChart(context, x, y, width, title, series, options) {
    var height = 230;
    context.strokeStyle = '#b1b4b6';
    context.lineWidth = 2;
    context.strokeRect(x, y, width, height);
    context.fillStyle = '#0b0c0c';
    context.font = '700 24px Arial, sans-serif';
    context.fillText(title, x + 22, y + 35);

    var total = series ? series.reduce(function (sum, item) { return sum + item.value; }, 0) : 0;
    if (!total) {
      context.fillStyle = '#505a5f';
      context.font = '18px Arial, sans-serif';
      context.fillText(options.emptyMessage || 'No completed records yet.', x + 22, y + 85);
      return;
    }

    var centerX = x + 130;
    var centerY = y + 140;
    var radius = 62;
    var angle = -Math.PI / 2;
    series.forEach(function (item) {
      if (!item.value) return;
      var end = angle + (item.value / total) * Math.PI * 2;
      context.beginPath();
      context.moveTo(centerX, centerY);
      context.arc(centerX, centerY, radius, angle, end);
      context.closePath();
      context.fillStyle = item.color || options.color;
      context.fill();
      angle = end;
    });
    context.beginPath();
    context.arc(centerX, centerY, 30, 0, Math.PI * 2);
    context.fillStyle = '#ffffff';
    context.fill();
    context.fillStyle = '#0b0c0c';
    context.textAlign = 'center';
    context.font = '700 24px Arial, sans-serif';
    context.fillText(String(total), centerX, centerY + 6);
    context.textAlign = 'left';

    series.forEach(function (item, index) {
      var rowY = y + 82 + index * 31;
      var percent = Math.round((item.value / total) * 100);
      context.fillStyle = item.color || options.color;
      context.fillRect(x + 232, rowY - 14, 14, 14);
      context.fillStyle = '#0b0c0c';
      context.font = '600 16px Arial, sans-serif';
      context.fillText(item.label, x + 256, rowY - 2);
      context.textAlign = 'right';
      context.fillText(options.valueText(item) + ' (' + percent + '%)', x + width - 22, rowY - 2);
      context.textAlign = 'left';
    });
  }

  function exportChartsPng() {
    var participants = filteredParticipants();
    var summary = buildStudySummary(participants, filteredCategories());
    var canvas = document.createElement('canvas');
    canvas.width = 1500;
    canvas.height = 760;
    var context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#0b0c0c';
    context.font = '700 38px Arial, sans-serif';
    context.fillText('Glance study results', 54, 62);
    context.fillStyle = '#505a5f';
    context.font = '20px Arial, sans-serif';
    context.fillText(routeLabel(selectedPath()) + ' | ' + plural(summary.participantCount, 'participant'), 54, 95);
    context.fillText('Aggregate summary only. No participant names or written responses are included.', 54, 122);

    drawExportDonutChart(context, 54, 160, 670, 'SUS score distribution', summary.susDistribution, {
      color: '#1d70b8',
      valueText: function (item) { return plural(item.value, 'participant'); }
    });
    drawExportDonutChart(context, 776, 160, 670, 'Study route', summary.routeSplit, {
      color: '#00703c',
      valueText: function (item) { return plural(item.value, 'participant'); }
    });
    drawExportChart(context, 54, 440, 670, 'Hands-on task progress', summary.handsOnMilestones, {
      color: '#00703c',
      valueText: function (item) { return item.value + ' / ' + summary.participantCount; }
    });
    drawExportChart(context, 776, 440, 670, 'Blind category match', summary.categoryMatch, {
      color: '#00703c',
      emptyMessage: 'Category validation is collected only in the full SME route.',
      valueText: function (item) { return item.total ? item.value + '% (' + item.matched + '/' + item.total + ')' : 'No responses'; }
    });

    canvas.toBlob(function (blob) {
      if (blob) downloadBlob('glance-study-summary.png', blob);
    }, 'image/png');
  }

  function initExports() {
    $('btn-export-summary').addEventListener('click', function () {
      downloadCsv('glance-study-summary.csv', ['metric', 'value'], summaryRows());
    });
    $('btn-export-charts').addEventListener('click', exportChartsPng);
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
