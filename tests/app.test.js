// Trakora regression suite — boots the real index.html in jsdom and exercises
// the critical surface. No framework: prints PASS/FAIL lines, exits non-zero on failure.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { webcrypto } = require('node:crypto');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS — ' + name); }
  else { fail++; console.log('FAIL — ' + name + (extra !== undefined ? '  >> ' + JSON.stringify(extra) : '')); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'https://x.test/', pretendToBeVisual: true });
const { window } = dom;
const d = window.document;
window.crypto = webcrypto;
window.TextEncoder = global.TextEncoder;
// jsdom has no layout engine — give the tour realistic rects so positions are finite
window.Element.prototype.getBoundingClientRect = function () { return { top: 100, left: 90, right: 260, bottom: 140, width: 170, height: 40, x: 90, y: 100 }; };
Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
window.addEventListener('error', (e) => console.log('WINDOW ERROR >>', (e.error && e.error.stack) || e.message));

function click(el) { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); }
function fire(el, t) { el.dispatchEvent(new window.Event(t, { bubbles: true, cancelable: true })); }
function resp(status, body) { return Promise.resolve({ ok: status >= 200 && status < 300, status, text: () => Promise.resolve(body), json: () => Promise.resolve(JSON.parse(body)) }); }

async function main() {
  try {
    window.GATE.enabled = false;
    window.bootApp();
    await wait(60);

    // ---------- boot + every view renders ----------
    ok('app boots (state present)', !!window.state);
    window.loadSampleData();
    await wait(40);
    const routes = ['dashboard','insights','accounts','finance','invoices','report','calculators','metrics','products','orders','utang','goals','roadmap','tasks','clients','notes','reviews','settings'];
    const viewErrors = [];
    for (const rt of routes) {
      try { window.location.hash = '#/' + rt; window.render(); if (d.getElementById('main').innerHTML.length < 50) viewErrors.push(rt + '(empty)'); }
      catch (e) { viewErrors.push(rt + ': ' + e.message); }
    }
    ok('every one of the 18 views renders without error', viewErrors.length === 0, viewErrors);

    // ---------- security: escaping + CSP + safeColor ----------
    ok('no unescaped image src in source', html.match(/src="'\+(?!esc\()/g) === null);
    ok('CSP meta present', !!d.querySelector('meta[http-equiv="Content-Security-Policy"]'));
    ok('CSP blocks objects + framing', /object-src 'none'/.test(html) && /frame-ancestors 'none'/.test(html));
    ok('safeColor rejects injection', window.safeColor('red"><img>') === '#6366f1' && window.safeColor('#10b981') === '#10b981');
    window.state.settings.bizLogo = 'x" onerror="alert(1)';
    window.renderSidebar();
    ok('malicious bizLogo is escaped (no raw onerror)', d.getElementById('sidebar').innerHTML.indexOf('onerror="alert(1)"') === -1);
    window.state.settings.bizLogo = '';

    // ---------- CSV import: detect + normalize ----------
    (function () {
      window.csvCtx = { headers: ['Date','Description','Amount','Customer'], rows: [['06/01/2026','Candle order','1500','Joanna'],['06/02/2026','Supplies','(800)','']], entity: null, map: {}, dateOrder: 'mdy', options: { financeType: 'auto', dedupe: true, dateFormat: 'auto' }, scores: {} };
      let best = null, bs = -1;
      Object.keys(window.IMPORT_ENTITIES).forEach((e) => { const s = window.csvScoreEntity(e, window.csvCtx.headers); if (s > bs) { bs = s; best = e; } });
      ok('CSV detects finance', best === 'finance', best);
      window.csvCtx.entity = best; window.csvCtx.map = window.csvAutoMap(best);
      const res = window.csvBuild();
      ok('CSV builds 2 rows, () => expense', res.ready.length === 2 && res.ready[1].type === 'expense' && res.ready[1].amount === 800, res.ready);
    })();
    ok('money EU format parses', window.csvMoney('1.234,50') === 1234.5);
    ok('money parentheses negative', window.csvMoney('(500)') === -500);

    // ---------- activation diagnostics (mocked fetch) ----------
    const K = 'RAVZ-1J1W-7WYQ', E = 'buyer@x.com';
    window.fetch = () => resp(401, '{"error":"Permission denied"}');
    await window.verifyActivation(K, E).then(() => ok('locked rules rejected', false)).catch((e) => ok('locked rules -> rules code', e.code === 'rules', e));
    window.fetch = (u, o) => { const m = (o && o.method) || 'GET'; if (m === 'PUT') return resp(200, '{}'); return resp(200, JSON.stringify({ email: E, name: 'Buyer', devices: {} })); };
    await window.verifyActivation(K, E).then((a) => ok('valid key activates', a && a.key === K)).catch((e) => ok('valid key activates', false, e));

    // ---------- PIN lock (PBKDF2) ----------
    ok('no lock initially', window.hasLock() === false);
    await window.setPin('1357');
    ok('setPin stores no plaintext', window.hasLock() && JSON.stringify(window.getLock()).indexOf('1357') === -1);
    ok('verifyPin correct/wrong', (await window.verifyPin('1357')) === true && (await window.verifyPin('0000')) === false);
    window.sessionUnlocked = false; window.bootApp();
    ok('boot gates to lock screen', d.getElementById('lock-root').innerHTML.indexOf('is locked') > -1);
    d.getElementById('lock-pin').value = '1357'; fire(d.getElementById('lock-form'), 'submit'); await wait(120);
    ok('correct PIN unlocks', window.sessionUnlocked === true && d.getElementById('lock-root').innerHTML === '');
    window.removeLock();

    // ---------- dashboard: 13 per-card widgets + reorder ----------
    window.state.finance = [{ id: 'f', type: 'income', amount: 1000, date: '2026-06-01', category: 'Sales' }];
    window.state.settings.dashOrder = null; window.state.settings.dashHidden = [];
    window.location.hash = '#/dashboard'; window.render(); await wait(20);
    const widgets = Array.from(d.querySelectorAll('.dash-widget')).map((w) => w.getAttribute('data-widget'));
    ok('dashboard renders 13 individual cards', widgets.length === 13, widgets);
    ok('each widget wraps exactly one card', Array.from(d.querySelectorAll('.dash-widget')).every((w) => w.querySelectorAll(':scope > .card').length === 1));
    window.reorderDash('miles', 'rev'); await wait(20);
    ok('single-card reorder persists', d.querySelectorAll('.dash-widget')[0].getAttribute('data-widget') === 'miles');

    // ---------- welcome tour — guards the NaN regression ----------
    window.state.settings.navCollapsed = true; window.render();
    let tourErr = null;
    for (let st = 0; st < 6; st++) {
      window.showTour(st);
      const card = d.querySelector('.tour-card');
      if (!card) { tourErr = 'no card at step ' + st; break; }
      const top = parseFloat(card.style.top), left = parseFloat(card.style.left);
      if (!isFinite(top) || !isFinite(left) || top < 0 || left < 0 || top > window.innerHeight || left > window.innerWidth) { tourErr = 'off-screen/NaN at step ' + st + ' (' + left + ',' + top + ')'; break; }
    }
    ok('tour positions all 6 steps on-screen (no NaN)', tourErr === null, tourErr);
    window.endTour();
    ok('endTour clears overlay + restores collapse', d.getElementById('lightbox-root').innerHTML === '' && d.getElementById('app').classList.contains('nav-collapsed'));
    window.state.settings.navCollapsed = false;

    // ---------- recurring invoices: generate + idempotent + catch-up ----------
    window.state.invoices = []; window.state.recurringInvoices = [{ id: 'r1', client: 'Lumina', desc: 'Retainer', amount: 9000, currency: 'PHP', day: 1, netDays: 14, active: true, lastGenerated: null, startMonth: window.thisMonthKey() }];
    window.processRecurringInvoices();
    ok('recurring generates this month', window.state.invoices.length === 1 && window.state.invoices[0].status === 'Sent');
    const n1 = window.state.invoices.length; window.processRecurringInvoices();
    ok('recurring idempotent (no duplicate)', window.state.invoices.length === n1);
    window.state.recurringInvoices[0].lastGenerated = window.shiftMonth(window.thisMonthKey(), -3);
    window.processRecurringInvoices();
    ok('recurring catches up missed months', window.state.invoices.length === n1 + 3);

    // ---------- getting-started checklist ----------
    window.state.settings.startDismissed = false; window.state.settings.businessName = 'My Business'; window.state.settings.country = ''; window.state.settings.monthlyTarget = 0;
    window.state.finance = []; window.state.products = []; window.state.goals = [];
    window.location.hash = '#/dashboard'; window.render(); await wait(20);
    ok('checklist shows for new account', /Get started ·/.test(d.getElementById('main').innerHTML));

    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.log('SUITE THREW >>', e.stack);
    process.exit(2);
  }
}
setTimeout(main, 300);
