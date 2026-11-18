/*
 * DMP calculator UI. Runs inside the iframe.
 * Step 1: inputs. Step 2: results. Branding comes from the partner config.
 */
(function () {
  'use strict';

  // Phase 2: point this at the partner-config API. The response shape stays the same.
  var CONFIG_BASE = '../config/partners/';

  var params = new URLSearchParams(location.search);
  var partnerId = (params.get('partner') || 'default').toLowerCase();
  if (!/^[a-z0-9-]{1,64}$/.test(partnerId)) partnerId = 'default';
  var instanceId = params.get('i') || '';

  var $ = function (id) { return document.getElementById(id); };
  var els = {};
  ['app', 'logo', 'title', 'subtitle', 'step1', 'step2', 'step1-btn', 'form', 'apr-help', 'result-sub', 'live', 'debt', 'debt-box', 'debt-range', 'debt-error',
   'apr', 'apr-box', 'apr-reset', 'apr-error',
   'back', 'summary', 'result-title', 'bar-now', 'bar-plan', 'bar-now-val', 'bar-plan-val', 'term-seg',
   'c-pay', 'd-pay', 'c-cost', 'd-cost', 'c-tot', 'd-tot', 'notes',
   'cta', 'cta-label', 'cta-title', 'cta-text', 'cta-note', 'powered', 'foot', 'font-css'
  ].forEach(function (id) { els[id] = $(id); });

  var config, term, lastResult;

  /* ---------- config ---------- */

  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
  function deepMerge(base, over) {
    var out = {};
    Object.keys(base).forEach(function (k) { out[k] = base[k]; });
    Object.keys(over || {}).forEach(function (k) {
      out[k] = isObj(base[k]) && isObj(over[k]) ? deepMerge(base[k], over[k]) : over[k];
    });
    return out;
  }
  function getJson(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.json();
    });
  }
  function loadConfig() {
    return getJson(CONFIG_BASE + 'default.json').then(function (base) {
      if (partnerId === 'default') return base;
      return getJson(CONFIG_BASE + partnerId + '.json')
        .then(function (p) { return deepMerge(base, p); })
        .catch(function (e) { console.warn('[dmp-calc] partner config not found, using default:', e.message); return base; });
    });
  }

  /* ---------- branding ---------- */

  function safeColor(v) { return typeof v === 'string' && window.CSS && CSS.supports('color', v) ? v : null; }
  function luminance(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return [n >> 16, (n >> 8) & 255, n & 255].map(function (c) {
      c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }).reduce(function (a, c, i) { return a + c * [0.2126, 0.7152, 0.0722][i]; }, 0);
  }
  function contrast(l1, l2) { return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }
  // Darken a hex color in small steps until it has the given contrast on the background.
  function readableOn(hex, bgHex, target) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || ''), bgL = luminance(bgHex);
    if (!m || bgL === null) return null;
    var n = parseInt(m[1], 16), rgb = [n >> 16, (n >> 8) & 255, n & 255], out = '#' + m[1];
    for (var k = 1; k <= 20 && contrast(luminance(out), bgL) < target; k++) {
      out = '#' + rgb.map(function (c) { return ('0' + Math.round(c * (1 - k * 0.05)).toString(16)).slice(-2); }).join('');
    }
    return out;
  }
  function applyBranding(b) {
    var root = document.documentElement.style;
    var map = { primaryColor: '--primary', accentColor: '--accent', textColor: '--text', mutedTextColor: '--muted',
      backgroundColor: '--bg', surfaceColor: '--surface', borderColor: '--border' };
    Object.keys(map).forEach(function (k) { var c = safeColor(b[k]); if (c) root.setProperty(map[k], c); });
    // White or black button text, whichever stays readable on the partner's color.
    var L = luminance(b.primaryColor);
    if (L !== null) root.setProperty('--primary-ink', L > 0.4 ? '#111111' : '#FFFFFF');
    // Small accent text must have 4.5:1 contrast. Bars and the large figure keep the brand accent.
    var ink = readableOn(b.accentColor || '#147A50', b.backgroundColor || '#FFFFFF', 4.5);
    if (ink) root.setProperty('--accent-ink', ink);
    if (typeof b.fontFamily === 'string' && b.fontFamily.length < 200) root.setProperty('--font', b.fontFamily);
    if (typeof b.fontUrl === 'string' && b.fontUrl.indexOf('https://fonts.googleapis.com/') === 0) els['font-css'].href = b.fontUrl;
    if (typeof b.borderRadius === 'number') root.setProperty('--radius', Math.max(0, Math.min(24, b.borderRadius)) + 'px');
    if (b.logoUrl && /^(https:\/\/|\/|\.\.?\/)/.test(b.logoUrl)) {
      els.logo.src = b.logoUrl; els.logo.alt = b.logoAlt || ''; els.logo.hidden = false;
    }
  }

  /* ---------- helpers ---------- */

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  var int0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  function money(n) { return isFinite(n) ? usd0.format(Math.round(n)) : '—'; }
  function duration(months, short) {
    if (!isFinite(months)) return 'Never';
    if (months >= DMPCalc.MAX_MONTHS) return '50+ years';
    var y = Math.floor(months / 12), m = months % 12, parts = [];
    if (short) {
      if (y) parts.push(y + (y === 1 ? ' yr' : ' yrs'));
      if (m) parts.push(m + ' mo');
      return parts.join(' ') || '0 mo';
    }
    if (y) parts.push(y + (y === 1 ? ' year' : ' years'));
    if (m) parts.push(m + (m === 1 ? ' month' : ' months'));
    return parts.join(', ') || '0 months';
  }
  function roughSooner(months) {
    var y = Math.round(months / 12);
    return y >= 2 ? 'about ' + y + ' years' : months + (months === 1 ? ' month' : ' months');
  }
  function parseNum(s) {
    var v = parseFloat(String(s).replace(/[^0-9.]/g, ''));
    return isFinite(v) ? v : null;
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function post(msg) {
    if (window.parent === window) return;
    msg.instance = instanceId;
    // Nothing sensitive is sent. The embed script checks the sender origin.
    window.parent.postMessage(msg, '*');
  }
  function postHeight() { post({ type: 'dmpc:resize', height: Math.ceil(els.app.getBoundingClientRect().height) }); }

  /* ---------- step 1 ---------- */

  function setFill() {
    var r = els['debt-range'];
    var pct = (Number(r.value) - Number(r.min)) / (Number(r.max) - Number(r.min)) * 100;
    r.style.setProperty('--fill', Math.max(0, Math.min(100, pct)) + '%');
    r.setAttribute('aria-valuetext', money(Number(r.value)));
  }
  function syncAprChip() {
    var v = parseNum(els.apr.value);
    var isDefault = v === config.defaults.currentApr;
    els['apr-reset'].hidden = isDefault;
    els['apr-help'].textContent = isDefault
      ? 'Not sure? Keep the U.S. average.'
      : 'Not sure? Select “Use U.S. average”.';
  }
  function showError(box, input, errEl, msg) {
    box.dataset.invalid = msg ? 'true' : 'false';
    if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    errEl.textContent = msg || '';
    errEl.hidden = !msg;
  }
  function debtError() {
    var L = config.limits, debt = parseNum(els.debt.value);
    if (debt === null || debt === 0) return 'Enter the total you owe on your credit cards.';
    if (debt < L.debtMin) return 'Enter an amount of at least ' + money(L.debtMin) + '.';
    if (debt > L.debtMax) return 'Enter an amount of ' + money(L.debtMax) + ' or less.';
    return '';
  }
  function aprError() {
    var L = config.limits, apr = parseNum(els.apr.value);
    if (apr === null) return 'Enter an interest rate, or use the U.S. average.';
    if (apr < L.aprMin || apr > L.aprMax) return 'Enter a rate between ' + L.aprMin + '% and ' + L.aprMax + '%.';
    return '';
  }
  function checkDebt() { var m = debtError(); showError(els['debt-box'], els.debt, els['debt-error'], m); return !m; }
  function checkApr() { var m = aprError(); showError(els['apr-box'], els.apr, els['apr-error'], m); return !m; }
  function validate() {
    var debtOk = checkDebt(), aprOk = checkApr();
    if (!debtOk) els.debt.focus(); else if (!aprOk) els.apr.focus();
    return debtOk && aprOk;
  }
  function readInput() {
    return {
      debt: parseNum(els.debt.value),
      currentApr: parseNum(els.apr.value),
      currentPayment: null, // the form has no payment field; the math uses the typical minimum
      termMonths: term
    };
  }

  /* ---------- step 2 ---------- */

  function renderResults(animate) {
    var r = DMPCalc.estimate(readInput(), config);
    lastResult = r;
    var c = r.current, d = r.dmp, f = r.flags, p = config.program;

    els.summary.textContent = money(r.input.debt) + ' at ' + r.input.currentApr + '% APR, ' +
      (r.input.currentPayment ? 'paying ' + money(r.input.currentPayment) + ' a month' : 'minimum payments');

    els.step2.dataset.nosavings = String(!!f.noSavings);

    // Headline
    var h = els['result-title'], sub = '';
    h.className = 'w-result';
    if (f.currentNeverPaysOff) {
      h.classList.add('w-result--neutral');
      h.innerHTML = esc(f.paymentDoesNotCoverInterest
          ? 'At ' + money(c.monthlyPayment) + ' a month, your balance won’t go down. With a plan, you could be debt-free in'
          : 'At ' + money(c.monthlyPayment) + ' a month, payoff would take more than 50 years. With a plan, you could be debt-free in') +
        '<span class="w-big">' + esc(duration(d.months)) + '</span>';
    } else if (f.noSavings) {
      h.classList.add('w-result--neutral');
      h.textContent = 'Your current payment already pays off your debt quickly. A plan might not save you money.';
      // State the real trade-off: a lower payment each month, a higher total.
      if (d.monthlyPayment < c.monthlyPayment - 0.5) {
        sub = 'A plan would lower your monthly payment by ' + money(c.monthlyPayment - d.monthlyPayment) +
          (r.savings < -0.5 ? ', but you would pay ' + money(-r.savings) + ' more in total.' : '.');
      }
    } else {
      h.innerHTML = 'You could save' + '<span class="w-big">' + money(r.savings) + '</span>' +
        (r.monthsSooner > 0 ? esc('and be debt-free ' + roughSooner(r.monthsSooner) + ' sooner.') : 'in interest and fees.');
    }

    els['result-sub'].textContent = sub;
    els['result-sub'].hidden = !sub;

    // The call box changes when a plan does not save money.
    var cta = config.cta;
    els['cta-title'].textContent = (f.noSavings && cta.noSavingsTitle) || cta.title || '';
    els['cta-text'].textContent = (f.noSavings && cta.noSavingsText) || cta.text || '';

    // Timeline bars
    var cap = DMPCalc.MAX_MONTHS;
    var nowMonths = c.paysOff ? Math.min(c.months, cap) : cap;
    var scale = Math.max(nowMonths, d.months);
    var nowW = (nowMonths / scale * 100) + '%', planW = Math.max(2, d.months / scale * 100) + '%';
    els['bar-now'].dataset.never = String(!c.paysOff);
    els['bar-now-val'].textContent = duration(c.months, true);
    els['bar-plan-val'].textContent = duration(d.months, true);
    if (animate) {
      els['bar-now'].style.setProperty('--w', '0%');
      els['bar-plan'].style.setProperty('--w', '0%');
      requestAnimationFrame(function () { requestAnimationFrame(function () {
        els['bar-now'].style.setProperty('--w', nowW);
        els['bar-plan'].style.setProperty('--w', planW);
      }); });
    } else {
      els['bar-now'].style.setProperty('--w', nowW);
      els['bar-plan'].style.setProperty('--w', planW);
    }

    // Table
    els['c-pay'].innerHTML = esc(money(c.monthlyPayment)) +
      (c.mode === 'minimum' ? '<span class="w-cell-note">first month</span>' : '');
    els['d-pay'].textContent = money(d.monthlyPayment);
    els['c-cost'].textContent = money(c.interest + c.fees);
    els['d-cost'].textContent = money(d.interest + d.fees);
    els['c-tot'].textContent = money(c.totalPaid);
    els['d-tot'].textContent = money(d.totalPaid);

    // Notes: only the ones that apply.
    var notes = [];
    if (f.belowMinimumDebt) {
      notes.push(['warn', 'With less than ' + money(p.minDebt) + ' in card debt, a plan might not be your best option. Program fees can use up much of the savings. A counselor can help you compare choices.']);
    }
    if (f.dmpPaymentHigher && !f.currentNeverPaysOff && !f.noSavings) {
      notes.push(['info', 'The plan costs ' + money(d.monthlyPayment - c.monthlyPayment) + ' more a month, but less of it goes to interest, so you finish much sooner.']);
    }
    els.notes.innerHTML = notes.map(function (n) { return '<li data-tone="' + n[0] + '">' + esc(n[1]) + '</li>'; }).join('');
  }

  // Short text for screen readers after the plan length changes.
  function announceResults() {
    var r = lastResult, f = r.flags;
    var msg = r.dmp.months + '-month plan. ';
    if (f.currentNeverPaysOff) msg += 'Debt-free in ' + duration(r.dmp.months) + '. ';
    else if (f.noSavings) msg += 'A plan might not save you money. ';
    else msg += 'You could save ' + money(r.savings) + '. ';
    els.live.textContent = msg + 'Monthly payment with a plan: ' + money(r.dmp.monthlyPayment) + '.';
  }

  function buildTermControl() {
    var p = config.program, step = p.termStep || 12, html = '';
    for (var m = p.termMin; m <= p.termMax; m += step) {
      html += '<label><input type="radio" name="term" value="' + m + '"' + (m === term ? ' checked' : '') +
        ' aria-label="' + m + ' months"><span>' + m + ' mo</span></label>';
    }
    els['term-seg'].innerHTML = html;
    els['term-seg'].addEventListener('change', function (e) {
      term = Number(e.target.value);
      renderResults(false);
      announceResults();
    });
  }

  /* ---------- navigation ---------- */

  function showStep(n) {
    els.step1.hidden = n !== 1;
    els.step2.hidden = n !== 2;
    document.querySelectorAll('.w-step').forEach(function (li) {
      var s = Number(li.dataset.step);
      if (s === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
      li.dataset.done = String(s < n);
    });
    // Step 1 in the progress list is a button on the results step.
    els['step1-btn'].disabled = n === 1;
    if (n === 1) els['step1-btn'].removeAttribute('aria-label');
    else els['step1-btn'].setAttribute('aria-label', 'Step 1, Your debt. Edit my numbers');
    post({ type: 'dmpc:step', step: n });
  }
  function goResults(animate) {
    els.live.textContent = '';
    renderResults(animate);
    showStep(2);
    els['result-title'].focus({ preventScroll: true });
    post({ type: 'dmpc:scrollTop' });
  }
  function goInputs() {
    showStep(1);
    els.debt.focus({ preventScroll: true });
    post({ type: 'dmpc:scrollTop' });
  }
  // The results step has its own history entry, so the browser Back button returns to the form.
  function onResultsEntry() { return !!(history.state && history.state.dmpcStep === 2); }
  function back() { if (onResultsEntry()) history.back(); else goInputs(); }

  /* ---------- static content ---------- */

  function renderStatic() {
    var ct = config.content, cta = config.cta, p = config.program, dft = config.defaults, mp = config.minimumPayment, L = config.limits;
    els.title.textContent = ct.title;
    els.subtitle.textContent = ct.subtitle || '';
    document.title = ct.title;

    var phoneHref = String(cta.phoneHref || '').replace(/[^0-9+]/g, '');
    els.cta.href = 'tel:' + phoneHref;
    els['cta-label'].textContent = 'Call ' + cta.phoneDisplay;
    els.cta.setAttribute('aria-label', 'Call ' + cta.phoneDisplay);
    els['cta-note'].textContent = cta.note || '';

    if (ct.showPoweredBy && ct.providerName) {
      els.powered.textContent = 'Debt management plans offered by ' + ct.providerName + ', a nonprofit credit counseling agency.';
      els.powered.hidden = false;
      els.foot.hidden = false;
    }

    // The slider and the field have the same limits.
    var r = els['debt-range'];
    r.min = L.debtMin; r.max = L.debtMax; r.step = 500; r.value = dft.debt;
    els.debt.value = int0.format(dft.debt);
    els.apr.value = String(dft.currentApr);
    term = p.termDefault;
    setFill();
    syncAprChip();
    buildTermControl();
  }

  function wire() {
    els['debt-box'].addEventListener('click', function () { els.debt.focus(); });
    els['apr-box'].addEventListener('click', function () { els.apr.focus(); });

    els.debt.addEventListener('input', function () {
      // Keep thousands separators while typing.
      var v = parseNum(els.debt.value);
      if (v !== null) { els.debt.value = int0.format(Math.floor(v)); els['debt-range'].value = v; setFill(); }
      if (els['debt-box'].dataset.invalid === 'true') showError(els['debt-box'], els.debt, els['debt-error'], '');
    });
    // Check each field when the user leaves it.
    els.debt.addEventListener('blur', checkDebt);
    els.apr.addEventListener('blur', checkApr);
    els['debt-range'].addEventListener('input', function () {
      els.debt.value = int0.format(Number(els['debt-range'].value)); setFill();
      showError(els['debt-box'], els.debt, els['debt-error'], '');
    });
    els.apr.addEventListener('input', function () {
      syncAprChip();
      if (els['apr-box'].dataset.invalid === 'true') showError(els['apr-box'], els.apr, els['apr-error'], '');
    });
    els['apr-reset'].addEventListener('click', function () {
      els.apr.value = String(config.defaults.currentApr); syncAprChip();
      showError(els['apr-box'], els.apr, els['apr-error'], '');
    });

    els.form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!validate()) return;
      try { history.pushState({ dmpcStep: 2 }, ''); } catch (err) { /* history is not available; the buttons still work */ }
      goResults(true);
    });
    els.back.addEventListener('click', back);
    els['step1-btn'].addEventListener('click', back);
    window.addEventListener('popstate', function () {
      if (onResultsEntry() && !debtError() && !aprError()) goResults(false);
      else goInputs();
    });
  }

  /* ---------- start ---------- */

  loadConfig().then(function (cfg) {
    config = cfg;
    applyBranding(cfg.branding || {});
    renderStatic();
    wire();
    showStep(1);
    els.app.setAttribute('aria-busy', 'false');
    if ('ResizeObserver' in window) new ResizeObserver(postHeight).observe(els.app);
    postHeight();
  }).catch(function (e) {
    console.error('[dmp-calc] could not load config', e);
    els.app.setAttribute('aria-busy', 'false');
    els.app.innerHTML = '<p style="padding:20px">The calculator is not available right now. Try again later.</p>';
    postHeight();
  });
})();
