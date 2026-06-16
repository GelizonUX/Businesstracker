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
// Poll until a condition holds — robust against slow CI runners doing PBKDF2/AES.
async function waitFor(fn, timeout = 8000, step = 15) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { try { if (fn()) return true; } catch (_) {} await wait(step); }
  try { return !!fn(); } catch (_) { return false; }
}

const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'https://x.test/', pretendToBeVisual: true });
const { window } = dom;
const d = window.document;
Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true, writable: true });
window.TextEncoder = global.TextEncoder;
window.TextDecoder = global.TextDecoder;
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
    if (d.getElementById('gate-root')) d.getElementById('gate-root').innerHTML = ''; // simulate post-activation (gate bypassed in tests)

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

    // ---------- onboarding carousel (replaces the old spotlight tour) ----------
    let onbErr = null;
    for (let st = 0; st < window.ONBOARD_SLIDES.length; st++) {
      window.showOnboard(st);
      const card = d.querySelector('.onb-card');
      if (!card) { onbErr = 'no slide at ' + st; break; }
      if (!/of /.test(card.textContent) || !card.querySelector('.onb-mock-svg') || card.querySelectorAll('.onb-dot').length !== window.ONBOARD_SLIDES.length) { onbErr = 'malformed slide ' + st; break; }
    }
    ok('carousel renders all slides with mockups + dots', onbErr === null, onbErr);
    window.showOnboard(0);
    ok('first slide has Skip not Back', /Skip/.test(d.querySelector('.onb-card').textContent));
    // blink fix: advancing must NOT rebuild the overlay/card — only swap the inner stage
    const overlayRef = d.querySelector('.onb-overlay');
    const cardRef = d.querySelector('.onb-card');
    click(d.querySelector('.onb-card [data-action="onb-go"][data-i="1"]'));
    ok('Next advances the carousel', /2 of /.test(d.querySelector('.onb-card').textContent));
    ok('advancing reuses the same overlay+card (no blink rebuild)',
       d.querySelector('.onb-overlay') === overlayRef && d.querySelector('.onb-card') === cardRef);
    ok('slide gets a directional transition class', /onb-in-(l|r)/.test(d.querySelector('.onb-stage').className));
    window.showOnboard(window.ONBOARD_SLIDES.length - 1);
    ok('last slide shows Get started', /Get started/.test(d.querySelector('.onb-card').textContent));
    click(d.querySelector('.onb-card [data-action="onb-finish"]'));
    ok('finishing closes the carousel', d.getElementById('lightbox-root').innerHTML === '');

    // ---------- Advisor page (upgraded Insights) ----------
    window.state.finance = [{ id: 'fa', type: 'income', amount: 5000, date: window.todayISO(), category: 'Sales', note: 'x' }, { id: 'fb', type: 'expense', amount: 2000, date: window.todayISO(), category: 'Marketing & Ads', note: 'y' }];
    window.location.hash = '#/insights'; window.render();
    const advHtml = d.getElementById('main').innerHTML;
    ok('Advisor shows a narrative read', /Here is your read/.test(advHtml) && /brought in/.test(advHtml));
    ok('Advisor shows a prioritized action list or all-clear', /Do this now/.test(advHtml));
    ok('Advisor route relabeled in sidebar', /Advisor/.test(d.getElementById('sidebar').innerHTML));

    // ---------- floating Advisor bubble ----------
    window.state.settings.advisorBubbleOff = false;
    window.location.hash = '#/dashboard'; window.render();
    await waitFor(() => d.getElementById('advisor-bubble').querySelector('.advisor-bubble') !== null);
    ok('bubble appears off the Advisor page', !!d.getElementById('advisor-bubble').querySelector('.advisor-bubble'));
    window.location.hash = '#/insights'; window.render();
    ok('bubble hides on the Advisor page', d.getElementById('advisor-bubble').innerHTML === '');
    window.location.hash = '#/dashboard'; window.render();
    await waitFor(() => !!d.getElementById('ab-text'));
    await waitFor(() => d.getElementById('ab-text') && d.getElementById('ab-text').textContent.length > 5);
    ok('bubble types its prompt', d.getElementById('ab-text').textContent.length > 5);
    // bubble should have a small set of lines to cycle (feels like it is talking)
    ok('bubble has 3-5 messages to cycle', (() => { const p = window.advisorPrompts(); return Array.isArray(p) && p.length >= 3 && p.length <= 5; })());
    click(d.querySelector('[data-action="advisor-bubble-dismiss"]'));
    ok('dismissing hides the bubble + persists', window.state.settings.advisorBubbleOff === true && d.getElementById('advisor-bubble').innerHTML === '');

    // ---------- sidebar default white text + white icons ----------
    ok('sidebar nav text is white by default', html.indexOf('color:#fff;font-size:.9rem') > -1 || /\.nav-item\{[^}]*color:#fff/.test(html));
    ok('sidebar nav icons are white by default', /\.nav-item svg\{color:#fff\}/.test(html));

    // ---------- recurring invoices: generate + idempotent + catch-up ----------
    window.state.invoices = []; window.state.recurringInvoices = [{ id: 'r1', client: 'Lumina', desc: 'Retainer', amount: 9000, currency: 'PHP', day: 1, netDays: 14, active: true, lastGenerated: null, startMonth: window.thisMonthKey() }];
    window.processRecurringInvoices();
    ok('recurring generates this month', window.state.invoices.length === 1 && window.state.invoices[0].status === 'Sent');
    const n1 = window.state.invoices.length; window.processRecurringInvoices();
    ok('recurring idempotent (no duplicate)', window.state.invoices.length === n1);
    window.state.recurringInvoices[0].lastGenerated = window.shiftMonth(window.thisMonthKey(), -3);
    window.processRecurringInvoices();
    ok('recurring catches up missed months', window.state.invoices.length === n1 + 3);

    // ---------- at-rest encryption (PIN-derived AES-GCM) ----------
    ok('WebCrypto available in test env', window.cryptoOK && window.cryptoOK() === true);
    window.state.finance = [{ id: 'F1', type: 'income', amount: 4242, date: '2026-06-01', category: 'Sales', note: 'secret-marker' }];
    window.save();
    await window.setPin('1234');
    await window.enableEncryption('1234'); // resolves only after the encrypted snapshot is written
    const isEnc = () => { try { return JSON.parse(window.localStorage.getItem('bizpilot.v1')).__enc === 1; } catch (_) { return false; } };
    await waitFor(isEnc);
    const encRaw = window.localStorage.getItem('bizpilot.v1');
    // note: ciphertext is hex, so only test for a non-hex plaintext marker (e.g. '4242' is valid hex and collides by chance)
    ok('storage encrypted, no plaintext leak', isEnc() && encRaw.indexOf('secret-marker') === -1);
    // simulate a fresh reload
    window.cryptoKey = null; window.pendingEncBlob = null; window.state = null; window.sessionUnlocked = false;
    window.loadState();
    ok('reload loads encrypted shell (no data until unlock)', window.pendingEncBlob && (window.state.finance || []).length === 0);
    window.bootApp();
    await waitFor(() => d.getElementById('lock-root').innerHTML.indexOf('is locked') > -1);
    d.getElementById('lock-pin').value = '9999'; fire(d.getElementById('lock-form'), 'submit');
    await waitFor(() => (window.getLock().fails || 0) >= 1); // wrong-PIN attempt processed
    ok('wrong PIN does not decrypt', (window.state.finance || []).length === 0 && d.getElementById('lock-root').innerHTML.indexOf('is locked') > -1);
    d.getElementById('lock-pin').value = '1234'; fire(d.getElementById('lock-form'), 'submit');
    await waitFor(() => window.sessionUnlocked === true && (window.state.finance || []).length === 1);
    ok('correct PIN decrypts with data intact', window.sessionUnlocked === true && window.state.finance[0].amount === 4242 && window.state.finance[0].note === 'secret-marker');
    // re-lock drops the AES key from memory; re-unlock re-derives it so saves stay encrypted
    window.lockNow();
    ok('re-lock clears AES key from memory', window.cryptoKey === null && d.getElementById('lock-root').innerHTML.indexOf('is locked') > -1);
    d.getElementById('lock-pin').value = '1234'; fire(d.getElementById('lock-form'), 'submit');
    await waitFor(() => window.cryptoKey !== null && window.sessionUnlocked === true);
    ok('re-unlock re-derives key with data intact', !!window.cryptoKey && (window.state.finance || []).length === 1);
    window.removeLock(); window.cryptoKey = null; await window.save();
    ok('remove lock restores plaintext storage', window.localStorage.getItem('bizpilot.v1').indexOf('__enc') === -1 && window.localStorage.getItem('bizpilot.v1').indexOf('secret-marker') > -1);

    // ---------- getting-started checklist ----------
    window.state.settings.startDismissed = false; window.state.settings.businessName = 'My Business'; window.state.settings.country = ''; window.state.settings.monthlyTarget = 0;
    window.state.finance = []; window.state.products = []; window.state.goals = [];
    window.location.hash = '#/dashboard'; window.render(); await wait(20);
    ok('checklist shows for new account', /Get started ·/.test(d.getElementById('main').innerHTML));

    // ---------- design/a11y polish ----------
    window.state.tasks = []; window.render();
    ok('onboarding de-cluttered: hero hidden while checklist shows', d.getElementById('main').innerHTML.indexOf('Welcome to your business command center') === -1);
    window.state.settings.startDismissed = true; window.render();
    ok('hero returns once checklist dismissed (still empty)', d.getElementById('main').innerHTML.indexOf('Welcome to your business command center') > -1);
    window.toast('hello world');
    const tEl = d.getElementById('toast-root').querySelector('.toast');
    ok('toast is announced to screen readers (role=alert)', tEl && tEl.getAttribute('role') === 'alert' && !!tEl.getAttribute('aria-live'));
    ok('AA contrast: --text-3 darkened (light #646b82 / dark #828bac)', html.indexOf('--text-3:#646b82') > -1 && html.indexOf('--text-3:#828bac') > -1);
    ok('focus-visible covers custom controls', /\.chip:focus-visible,\.seg button:focus-visible/.test(html));
    ok('snappy easing token added', html.indexOf('--ease-snappy:') > -1);
    ok('modal focus trap + return-focus wired', html.indexOf('modalReturnFocus') > -1 && /e\.key!=='Tab'/.test(html));
    // overdue invoice row marker
    window.state.invoices = [{ id: 'o1', number: 'INV-1', client: 'X', amount: 100, currency: 'PHP', issueDate: '2026-01-01', dueDate: '2026-01-15', status: 'Sent' }];
    window.location.hash = '#/invoices'; window.render();
    ok('overdue invoices get a visual row marker', d.getElementById('main').innerHTML.indexOf('inv-overdue') > -1);

    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.log('SUITE THREW >>', e.stack);
    process.exit(2);
  }
}
setTimeout(main, 300);
