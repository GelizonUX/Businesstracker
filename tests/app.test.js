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
    const routes = ['dashboard','insights','accounts','finance','invoices','report','calculators','metrics','products','orders','utang','manpower','goals','roadmap','tasks','clients','notes','reviews','settings'];
    const viewErrors = [];
    for (const rt of routes) {
      try { window.location.hash = '#/' + rt; window.render(); if (d.getElementById('main').innerHTML.length < 50) viewErrors.push(rt + '(empty)'); }
      catch (e) { viewErrors.push(rt + ': ' + e.message); }
    }
    ok('every one of the 19 views renders without error', viewErrors.length === 0, viewErrors);

    // ---------- security: escaping + CSP + safeColor ----------
    ok('no unescaped image src in source', html.match(/src="'\+(?!esc\()/g) === null);
    ok('CSP meta present', !!d.querySelector('meta[http-equiv="Content-Security-Policy"]'));
    ok('CSP blocks objects + framing', /object-src 'none'/.test(html) && /frame-ancestors 'none'/.test(html));
    ok('safeColor rejects injection', window.safeColor('red"><img>') === '#6366f1' && window.safeColor('#10b981') === '#10b981');
    window.state.settings.bizLogo = 'x" onerror="alert(1)';
    window.renderSidebar();
    ok('malicious bizLogo is escaped (no raw onerror)', d.getElementById('sidebar').innerHTML.indexOf('onerror="alert(1)"') === -1);
    window.state.settings.bizLogo = '';
    // user-chosen colors are sanitized before going into style="" attributes (no CSS/attr injection)
    ok('account color sanitized at source', /var col=safeColor\(a\.color/.test(html));
    ok('task table color sanitized', html.indexOf("'box-shadow:inset 3px 0 0 '+safeColor(t.color)") > -1);
    ok('calendar task color sanitized', /tcol=\s*t\.color\?safeColor\(t\.color\)/.test(html));
    // file-attachment href is scheme-allowlisted (no javascript: / attribute breakout)
    ok('attachment href is scheme-allowlisted', html.indexOf('/^(data:|https?:|blob:)/i.test(v.data') > -1);
    // behavioral: a malicious account color cannot break out of the style attribute
    window.state.accounts = [{ id: 'secT', name: 'Sec', type: 'Cash', color: 'red"></span><img src=x onerror="alert(1)">', opening: 0 }];
    window.location.hash = '#/accounts'; window.render();
    (function () { const am = d.getElementById('main').innerHTML; ok('malicious account color cannot break out of style', am.indexOf('onerror="alert(1)"') === -1 && am.indexOf('<img src=x') === -1); })();

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
    // privacy: a PII-free record (emailHash only, no plaintext email) still activates, and rejects a wrong email
    const eh = await window.licEmailHash(K, E);
    window.fetch = (u, o) => { const m = (o && o.method) || 'GET'; if (m === 'PUT') return resp(200, '{}'); return resp(200, JSON.stringify({ emailHash: eh, devices: {} })); };
    await window.verifyActivation(K, E).then((a) => ok('hashed-email license activates (no PII in DB)', a && a.key === K)).catch((e) => ok('hashed-email license activates', false, e));
    window.fetch = () => resp(200, JSON.stringify({ emailHash: eh, devices: {} }));
    await window.verifyActivation(K, 'attacker@evil.com').then(() => ok('hashed-email rejects wrong email', false)).catch((e) => ok('hashed-email rejects wrong email', e.code === 'email', e));

    // ---------- OFFLINE signed license: verifies with ZERO network (no Firebase) ----------
    const PRIV = { kty:'EC', crv:'P-256', x:'ehXZYwQBYbP8HhHKZ6_hvK1Yp3e2fgQyzqJTXCqdXBc', y:'tyv_vdWFYP84K8O3gYfpLR5RIYQx_s0rm6jmySyysFg', d:'6mksRId8vn1ZRhc4O34WgWVroFsWm9JFPhKaTq9apjg' };
    const b64u = (a) => Buffer.from(a).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    async function makeToken(email, limit) {
      const pk = await webcrypto.subtle.importKey('jwk', PRIV, { name:'ECDSA', namedCurve:'P-256' }, false, ['sign']);
      const ehBuf = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(email.toLowerCase()));
      const eh = [...new Uint8Array(ehBuf)].map((b) => ('0'+b.toString(16)).slice(-2)).join('');
      const pb = new TextEncoder().encode(JSON.stringify({ eh, d: limit, i: '2026-06-19' }));
      const sig = await webcrypto.subtle.sign({ name:'ECDSA', hash:'SHA-256' }, pk, pb);
      return b64u(pb) + '.' + b64u(new Uint8Array(sig));
    }
    const tok = await makeToken('buyer@x.com', 2);
    let netHit = false; window.fetch = () => { netHit = true; return resp(500, '{}'); };
    await window.verifyActivation(tok, 'buyer@x.com')
      .then((a) => ok('offline signed key activates with NO network', a && a.offline === true && netHit === false, { netHit }))
      .catch((e) => ok('offline signed key activates with NO network', false, e));
    await window.verifyActivation(tok, 'someone@else.com').then(() => ok('offline key rejects wrong email', false)).catch((e) => ok('offline key rejects wrong email', e.code === 'email'));
    await window.verifyActivation(tok.slice(0, -4) + 'AAAA', 'buyer@x.com').then(() => ok('tampered offline key rejected', false)).catch((e) => ok('tampered offline key rejected', !!e));
    // the gate input must NOT mangle a pasted long signed token
    window.GATE.enabled = true; window.renderGate(); window.GATE.enabled = false;
    const gk = d.getElementById('gate-key');
    if (gk) { gk.value = tok; gk.dispatchEvent(new window.Event('input', { bubbles: true })); ok('gate input preserves a pasted signed token (no mangling)', gk.value === tok, { len: gk.value.length }); }
    else ok('gate input preserves a pasted signed token (no mangling)', false, 'no gate-key');
    if (d.getElementById('gate-root')) d.getElementById('gate-root').innerHTML = '';

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

    // ---------- dashboard: live drag-to-reorder (placeholder gap + persist) ----------
    window.state.settings.dashOrder = null; window.location.hash = '#/dashboard'; window.render(); await wait(20);
    const dgrid = d.querySelector('.dash-grid');
    const dws = Array.from(dgrid.querySelectorAll('.dash-widget'));
    const dragId = dws[0].getAttribute('data-widget');
    const dHandle = dws[0].querySelector('[data-dh]');
    const fireEv = (el, type) => { const ev = new window.Event(type, { bubbles: true, cancelable: true }); el.dispatchEvent(ev); return ev; };
    fireEv(dHandle, 'dragstart');
    ok('drag start flags the grid immediately', dgrid.classList.contains('is-dragging'));
    await wait(10); // placeholder is applied on the next tick (so the drag image is the full card)
    ok('the dragged slot becomes a placeholder', dws[0].classList.contains('dragging'));
    fireEv(dws[2], 'dragover');
    await wait(25); // reorder is throttled to one animation frame (smooth, no thrash)
    const liveOrder = Array.from(dgrid.querySelectorAll('.dash-widget')).map((w) => w.getAttribute('data-widget'));
    ok('dragging over another card live-reorders the DOM (gap follows cursor)', liveOrder[0] !== dragId && liveOrder.indexOf(dragId) > 0);
    fireEv(dHandle, 'dragend');
    const domOrder = Array.from(dgrid.querySelectorAll('.dash-widget')).map((w) => w.getAttribute('data-widget'));
    ok('drag end clears the placeholder state', !dgrid.querySelector('.dash-widget.dragging') && !dgrid.classList.contains('is-dragging'));
    ok('drag end persists the new order', JSON.stringify((window.state.settings.dashOrder || []).slice(0, domOrder.length)) === JSON.stringify(domOrder));
    // touch long-press drag (mobile): wiring + CSS present, reorder helper falls back to the touch element
    ok('mobile long-press drag is wired (touch state + lift CSS + scroll-lock)', typeof window.dashTouchApplyTransform === 'function' && !!window.dashTouch && /\.dash-widget\.dash-lift\{/.test(html) && /body\.dash-dragging \.main\{overflow:hidden/.test(html));

    // ---------- first-open greeting (name setup → time-based hello → dismiss) ----------
    window.state.settings.displayName = '';
    window.showGreeting();
    const greetRoot = d.getElementById('greet-root');
    ok('greeting shows name-setup when no display name', !!greetRoot.querySelector('[data-greet="setup"]') && !!greetRoot.querySelector('#greet-name'));
    // REGRESSION (reported 3x): the form is #greet-form but the spacing CSS was .greet-form (class) — they never matched.
    (function () {
      const form = greetRoot.querySelector('form#greet-form');
      ok('greeting form carries BOTH id and class greet-form (so spacing CSS applies)', !!form && form.classList.contains('greet-form'));
      // the input and the "That's me" button must be DIRECT flex children so the gap actually separates them
      const kids = form ? Array.prototype.filter.call(form.children, (c) => c.tagName === 'INPUT' || c.tagName === 'BUTTON') : [];
      ok('greeting input + submit are direct children of the form (gap separates them)', kids.length === 2 && kids[0].tagName === 'INPUT' && kids[1].tagName === 'BUTTON');
      // the stylesheet must target the actual rendered selector (#greet-form) with a real gap, not a dead class-only rule
      ok('greeting spacing CSS targets #greet-form with a gap', /#greet-form[^{]*,?[^{]*\{[^}]*gap:\s*\d/.test(html) || /#greet-form,\.greet-form\{[^}]*gap:\s*\d/.test(html));
      ok('greeting input + button are width-capped (not full-bleed)', /#greet-form,\.greet-form\{[^}]*max-width:\s*\d/.test(html));
    })();
    d.getElementById('greet-name').value = 'Ira'; window.greetSaveName();
    ok('saving a name persists displayName + switches to a personalised hello', window.state.settings.displayName === 'Ira' && !!greetRoot.querySelector('[data-greet="hello"]') && /Ira/.test(greetRoot.innerHTML));
    ok('greeting is time-based', /Good (morning|afternoon|evening)/.test(greetRoot.innerHTML));
    ok('greeting shows the business logo / Logo cue in the circle (no sun emoji)', /greet-logo"|greet-logohint/.test(greetRoot.innerHTML) && !/greet-time/.test(greetRoot.innerHTML));
    ok('greeting locks background scroll', /body\.greeting-on\{overflow:hidden\}/.test(html));

    // ---------- sidebar: favorites + section reorder ----------
    window.state.settings.favorites = ['finance']; window.renderSidebar();
    const sb = d.getElementById('sidebar').innerHTML;
    ok('favorites section renders the pinned item', /Favorites/.test(sb) && /nav-fav on/.test(sb));
    window.state.settings.sectionOrder = []; window.moveSidebarSection('Shop', -1);
    ok('moving a section persists a custom order', Array.isArray(window.state.settings.sectionOrder) && window.state.settings.sectionOrder.length > 0 && window.state.settings.sectionOrder.indexOf('Shop') < window.state.settings.sectionOrder.indexOf('Money'));
    window.state.settings.favorites = []; window.state.settings.sectionOrder = [];
    // foundation polish: independent sidebar scroll, full-readable labels, no licensee watermark
    ok('sidebar scrolls independently (overscroll contained)', /\.nav\{[^}]*overscroll-behavior:contain/.test(html));
    (function () {
      const m = html.match(/\.nav-item>span:not\(\.nav-badge\):not\(\.nav-fav\)\{([^}]*)\}/);
      const rule = m ? m[1] : '';
      ok('sidebar labels render on one line (nowrap + ellipsis, no wrap)', /white-space:nowrap/.test(rule) && /text-overflow:ellipsis/.test(rule) && !/-webkit-line-clamp/.test(rule) && !/white-space:normal/.test(rule));
    })();
    // adjustable menu size scales both text and icon via --nav-scale, and the sidebar width tracks it
    ok('sidebar font + icon + width scale with --nav-scale', /font-size:calc\(\.9rem\*var\(--nav-scale/.test(html) && /\.nav-item svg\{width:calc\(17px\*var\(--nav-scale/.test(html) && /\.sidebar\{[^}]*width:calc\(248px\*var\(--nav-scale/.test(html));
    // design-system normalization: type-scale + grid-gap tokens defined and used; no 13px gutters / half-pixel padding
    ok('design tokens defined (type scale + grid gutter)', /--fs-2xl:/.test(html) && /--grid-gap:/.test(html));
    ok('card grids use the gutter token, not magic 13px', /\.grid\{display:grid;gap:var\(--grid-gap\)\}/.test(html) && !/\.grid\{display:grid;gap:13px\}/.test(html) && !/padding:6\.5px/.test(html));
    // mobile-first: on phones the stat grids go 2-up (not full-width stacked) and dashboard KPIs sit 2-up
    ok('mobile stat grids are 2-up (not single-column) at <=560px', /@media \(max-width:560px\)\{\s*\.grid-3,\.grid-4\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/.test(html));
    ok('mobile grid tracks use minmax(0,1fr) so no child can force horizontal overflow', /\.grid-2,\.grid-hero\{grid-template-columns:minmax\(0,1fr\)\}/.test(html) && /\.calc-fields\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(html));
    ok('mobile: table/order rows have 16px inner padding (not tight to border)', /\.table-wrap tr\{[^}]*padding:11px 16px\}/.test(html) && /\.order-row\{[^}]*padding:14px 16px!important\}/.test(html));
    ok('FX compare + narrow-phone metric grid never overflow (min(100%) tracks / 1-col)', /minmax\(min\(100%,150px\),1fr\)/.test(html) && /@media \(max-width:360px\)\{\s*\.grid-3\{grid-template-columns:minmax\(0,1fr\)\}/.test(html));
    ok('roadmap task rows stack on mobile (title not crushed by the status select)', /class="list-row rm-task-row"/.test(html) && /\.rm-task-row \.rm-task-main\{flex:1 1 100%!important;order:-1/.test(html));
    ok('mobile dashboard KPIs sit 2-up while rich widgets go full-width', /\.dash-grid \.dash-widget\{grid-column:1 \/ -1\}/.test(html) && /data-widget="rev"\][\s\S]{0,160}grid-column:auto/.test(html));
    ok('mobile compacts cards + hides floating sparkline at 2-up', /\.stat-card \.spark\{display:none\}/.test(html));
    // sleek mobile redesign: account cards become a 2-up colourful wallet grid
    ok('mobile account cards sit 2-up (the wallet grid) and override the desktop inline track', /\.acct-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/.test(html) && /class="grid acct-grid mt"/.test(html));
    ok('mobile account name wraps to 2 lines (no "BPI Busines…" clip) and balance clips gracefully', /\.acct-card \.acct-name\{[^}]*-webkit-line-clamp:2/.test(html) && /\.acct-card \.acct-balance\{[^}]*white-space:nowrap\}/.test(html) && /<b class="acct-name"/.test(html));
    ok('mobile add-account tile spans the full wallet-grid row', /\.acct-grid>\[data-action="account-new"\]\{grid-column:1 \/ -1/.test(html));
    ok('mobile cards adopt the larger radius for the spacious look', /@media \(max-width:560px\)\{[\s\S]*\.card\{padding:16px 17px;border-radius:var\(--r-xl\)\}/.test(html));
    // finance: desktop keeps the spreadsheet table; phones get a clean day-grouped timeline
    ok('finance timeline is desktop-hidden and swaps in for the table on phones', /\.fin-timeline\{display:none\}/.test(html) && /\.fin-table-wrap\{display:none\}\s*\.fin-timeline\{display:block\}/.test(html) && /class="table-wrap fin-table-wrap"/.test(html));
    ok('finance timeline groups by day with colour-coded dots + amounts', /function financeTimelineHTML/.test(html) && /\.fin-tl-row\[data-type="income"\] \.fin-tl-dot\{background:var\(--income\)/.test(html) && /class="fin-day"/.test(html) && /class="fin-tl-amt"/.test(html));
    // standard-mobile shell: bottom tab bar + FAB + header overflow menu + tables→cards
    ok('shell has a FAB and a bottom tab bar container', /class="fab"/.test(html) && /id="tabbar"/.test(html));
    (function () {
      window.location.hash = '#/dashboard'; window.render();
      const tb = d.getElementById('tabbar');
      const active = tb && tb.querySelector('.tab-item.active');
      ok('tab bar renders 5 destinations with Home active on dashboard', !!tb && tb.querySelectorAll('.tab-item').length === 5 && !!active && active.getAttribute('aria-label') === 'Home');
    })();
    ok('header collapses actions into an overflow menu on mobile', /class="topbar-more"/.test(html) && /data-action="toggle-topbar-actions"/.test(html) && /id="topbar-actions"/.test(html) && /\.topbar-actions\.open\{display:flex/.test(html));
    ok('mobile turns data tables into stacked labeled cards', /\.table-wrap thead\{position:absolute/.test(html) && /\.table-wrap td\[data-label\]::before\{content:attr\(data-label\)/.test(html));
    ok('mobile hides empty/dash cells + stacks the hand-built order rows (no overflow)', /\.table-wrap td:empty,\.table-wrap td\[data-mobempty\]\{display:none\}/.test(html) && /\.order-row>div\{min-width:0!important;flex:1 1 100%!important\}/.test(html));
    (function () {
      window.location.hash = '#/orders'; window.render();
      ok('order cards are tagged for the mobile stack rule', /class="list-row order-row"/.test(d.getElementById('main').innerHTML));
      window.location.hash = '#/dashboard'; window.render();
    })();
    (function () {
      window.location.hash = '#/finance'; window.render();
      const labeled = d.getElementById('main').querySelectorAll('.table-wrap td[data-label]').length;
      ok('labelizeTables auto-labels table cells from their headers', labeled > 0);
      window.location.hash = '#/dashboard'; window.render();
    })();
    (function () {
      window.state.settings.navScale = 1;
      window.setNavScale(1);
      ok('menu size control increases the scale (clamped)', window.state.settings.navScale === 1.1);
      for (let i = 0; i < 10; i++) window.setNavScale(1);
      ok('menu size is clamped to a sane maximum', window.state.settings.navScale <= 1.3);
      window.state.settings.navScale = 1;
      window.ui.navEdit = true; window.renderSidebar();
      const sbEdit = d.getElementById('sidebar').innerHTML;
      ok('edit mode shows size control + section reorder arrows', /data-action="nav-size"/.test(sbEdit) && /data-action="sec-move"/.test(sbEdit) && /nav-edit-bar/.test(sbEdit));
      window.ui.navEdit = false; window.renderSidebar();
      ok('non-edit mode shows the Edit menu button below the CSV import', /data-action="nav-edit-toggle"/.test(d.getElementById('sidebar').innerHTML));
    })();
    // END-TO-END: dispatch REAL clicks through the delegated dispatcher (proves wiring, not just markup)
    (function () {
      const fire = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      const sb = d.getElementById('sidebar');
      window.ui.navEdit = false; window.state.settings.navScale = 1; window.renderSidebar();
      // click "Edit menu" -> enters edit mode
      fire(sb.querySelector('[data-action="nav-edit-toggle"]'));
      ok('clicking "Edit menu" actually opens edit mode', window.ui.navEdit === true && !!d.getElementById('sidebar').querySelector('.nav-edit-bar'));
      // click the A+ stepper -> scale rises and the CSS var updates
      fire(d.getElementById('sidebar').querySelector('[data-action="nav-size"][data-dir="1"]'));
      ok('clicking A+ raises the menu scale + sets --nav-scale', window.state.settings.navScale === 1.1 && d.documentElement.style.getPropertyValue('--nav-scale') === '1.1');
      // click a section's "move up" arrow -> order actually changes
      window.state.settings.sectionOrder = [];
      const upBtn = Array.prototype.find.call(d.getElementById('sidebar').querySelectorAll('[data-action="sec-move"][data-dir="up"]'), (b) => b.getAttribute('data-sec') === 'Shop');
      if (upBtn) fire(upBtn);
      ok('clicking a section "move up" arrow reorders + persists', Array.isArray(window.state.settings.sectionOrder) && window.state.settings.sectionOrder.length > 0);
      // click "Done" -> leaves edit mode
      fire(d.getElementById('sidebar').querySelector('[data-action="nav-edit-toggle"]'));
      ok('clicking "Done" exits edit mode', window.ui.navEdit === false);
      window.state.settings.navScale = 1; window.state.settings.sectionOrder = []; window.renderSidebar();
    })();
    // Manpower must be present and routable (regression: it was blanked to id:Employees with no label)
    ok('Manpower nav item is restored (labelled + routes to manpower view)', window.ROUTES.some((r) => r.id === 'manpower' && r.label === 'Manpower') && !window.ROUTES.some((r) => r.id === 'Employees'));
    (function () {
      window.renderSidebar();
      const mp = d.getElementById('sidebar').querySelector('.nav-item[data-route="manpower"]');
      ok('Manpower renders with a visible label (not a blank icon)', !!mp && /Manpower/.test(mp.querySelector('span').textContent));
      mp.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      ok('clicking Manpower routes to the manpower view', window.currentRoute() === 'manpower');
      window.location.hash = '#/dashboard';
    })();
    ok('documents carry no "Licensed to" watermark', window.licTag() === '' && !/· Licensed to /.test((function(){ try { return document.getElementById('sidebar').innerHTML; } catch(_) { return ''; } })()));
    // Tailwind-compatible utility layer ships IN-FILE (no CDN/build) and stays CSP/offline-safe
    ok('in-file Tailwind-style utility layer present', /\.flex\{display:flex\}/.test(html) && /\.gap-2\{gap:8px\}/.test(html) && /\.items-center\{align-items:center\}/.test(html) && /\.truncate\{overflow:hidden;text-overflow:ellipsis;white-space:nowrap\}/.test(html));
    ok('no external CSS/JS framework introduced (CSP + offline intact)', !/cdn\.tailwindcss|tailwindcss\.com|<script[^>]+src=|<link[^>]+stylesheet|@import/i.test(html));
    window.dismissGreeting();
    ok('dismiss clears the greeting state (unblurs)', !d.body.classList.contains('greeting-on'));
    window.state.settings.displayName = '';

    // ---------- Manpower (employees): stats, payroll math, vale, custom card ----------
    window.state.employees = [
      { id: 'e1', name: 'Maria', role: 'Tindera', employmentType: 'Regular', payBasis: 'Daily', payRate: 500, status: 'Active', colorTag: '#10b981', customFields: [] },
      { id: 'e2', name: 'Jose', role: 'Helper', employmentType: 'Part-time', payBasis: 'Monthly', payRate: 12000, status: 'Inactive', colorTag: '#f59e0b', customFields: [] },
    ];
    window.state.hrAdvances = [{ id: 'v1', employeeId: 'e1', date: '2026-06-01', amount: 800, reason: 'load', repaid: 300 }];
    window.state.hrPayouts = [];
    window.location.hash = '#/manpower'; window.render(); await wait(10);
    ok('Manpower lists employees', /Maria/.test(d.getElementById('main').innerHTML) && /Jose/.test(d.getElementById('main').innerHTML));
    ok('daily pay normalizes to monthly (×26)', window.hrMonthlyPay(window.state.employees[0]) === 13000);
    ok('vale balance nets repayments', window.hrValeBalance('e1') === 500 && window.hrValeOutstanding() === 500);
    ok('employee colors are sanitized in render', d.getElementById('main').innerHTML.indexOf('onerror') === -1);
    // --- full-audit correctness + a11y hardening ---
    ok('financeTotals ignores corrupt amounts (no NaN poisoning)', (function () { const t = window.financeTotals([{ type: 'income', amount: 1000 }, { type: 'income', amount: undefined }, { type: 'expense', amount: 'x' }]); return t.revenue === 1000 && t.expenses === 0 && !Number.isNaN(t.profit); })());
    ok('fxRateValid rejects missing/zero rates, accepts positive', (function () { window.state.settings.fx = { phpPer: { USD: 58.5, EUR: 0 } }; return window.fxRateValid('PHP') === true && window.fxRateValid('USD') === true && window.fxRateValid('EUR') === false && window.fxRateValid('GBP') === false; })());
    ok('invPHP converts with the stored rate and is num-safe', window.invPHP({ currency: 'USD', amount: 100, fxRate: 58.5 }) === 5850 && window.invPHP({ currency: 'PHP', amount: 'x' }) === 0);
    ok('editing a PAID invoice reconciles its recorded finance income', (function () {
      const savedFin = window.state.finance;
      window.state.finance = [];
      const iv = { id: 'ivx', number: 'INV-X', client: 'A', amount: 5000, currency: 'PHP', status: 'Paid' };
      window.recordInvoiceIncome(iv);
      const fe = window.state.finance.find((x) => x.id === iv.financeId);
      const before = fe && fe.amount;
      iv.amount = 8000; window.reconcileInvoiceIncome(iv);
      const okk = before === 5000 && fe.amount === 8000 && window.state.finance.length === 1;
      window.state.finance = savedFin;
      return okk;
    })());
    ok('enhanceA11y associates field labels + labels icon-only buttons', (function () {
      window.employeeModal({ id: 'e1', name: 'Maria Santos', role: 'Head Baker', payBasis: 'Monthly', payRate: 18000, status: 'Active', colorTag: '#6366f1', customFields: [] });
      const form = d.getElementById('modal-form');
      const lbl = form.querySelector('.field > label');
      const linked = lbl && lbl.htmlFor && form.querySelector('#' + lbl.htmlFor);
      window.closeModal();
      return !!linked;
    })());
    ok('keyboard handler activates role=button controls (Enter)', (function () {
      const el = d.createElement('div'); el.setAttribute('role', 'button'); let fired = false; el.addEventListener('click', function () { fired = true; });
      d.body.appendChild(el); el.focus();
      el.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      d.body.removeChild(el);
      return fired;
    })());
    (function () {
      window.ui.taskView = 'board'; window.location.hash = '#/tasks'; window.render();
      const h = d.getElementById('main').innerHTML;
      ok('tasks kanban is responsive via --lanes (no hardcoded inline grid-template)', /--lanes:/.test(h) && !/style="grid-template-columns:repeat\(\d/.test(h));
      window.ui.taskView = 'list'; window.location.hash = '#/manpower'; window.render();
    })();
    // custom stat card composes safely (no eval)
    window.state.settings.hrCustomCards = [{ id: 'c1', label: 'Riders', metric: 'count', field: 'payRate', filter: 'Active', fmt: '' }];
    window.render();
    ok('custom Manpower stat card renders', /Riders/.test(d.getElementById('main').innerHTML));

    // ---------- Manpower upgrade: bank, documents, contracts, e-sign, sanitizer ----------
    ok('contract HTML sanitizer strips scripts + on* handlers', !/onerror|<script/i.test(window.sanitizeContractHTML('<p onerror="x()">hi<script>bad()</script><img src=x onerror="alert(1)"></p>')));
    (function () {
      const s = window.sanitizeContractHTML('<svg><script>x()</script></svg><a xlink:href="javascript:alert(1)">a</a><button formaction="javascript:x()">b</button><p style="x:y">t</p>');
      ok('sanitizer also blocks SVG/MathML scripts, javascript: URLs (xlink/formaction) + style', !/<svg|<script|javascript:|formaction|style=/i.test(s));
    })();
    const empX = { id:'eX', name:'Ana', role:'Cashier', payBasis:'Daily', payRate:500, status:'Active', colorTag:'#10b981', customFields:[], bank:{name:'GCash',acct:'0917 555',holder:'Ana'}, documents:[], contracts:[] };
    window.state.employees = [empX];
    const tpl = window.contractTemplate(empX);
    ok('contract template includes the employee + employer', /Ana/.test(tpl) && /Employment Contract/.test(tpl));
    window.employeeDetail(empX);
    const det = d.getElementById('modal-root').innerHTML;
    ok('employee detail shows Bank, Documents & Contracts sections', /Bank \/ payout/.test(det) && /Documents/.test(det) && /Contracts/.test(det));
    ok('employee detail exposes a delete action (regression: grid removed the table delete)', /data-action="hr-del"/.test(det));
    window.closeModal();
    // header has no dangling separator when employmentType is blank
    window.employeeDetail({ id:'eT', name:'Noemi', role:'Helper', employmentType:'', colorTag:'#6366f1', customFields:[] });
    (function () { const h = d.getElementById('modal-root').innerHTML; ok('detail header has no trailing " · " when type is empty', h.indexOf('Helper · </span>') === -1 && /Helper<\/span>/.test(h)); })();
    window.closeModal();
    // employee photo + address: form fields exist, detail surfaces them, directory grid shows photo
    window.employeeModal(empX);
    (function () { const f = d.getElementById('modal-form'); ok('employee form has photo + address fields', !!(f && f.elements['photo'] && f.elements['address'])); })();
    window.closeModal();
    const empP = { id:'eP', name:'Liza', role:'Rider', payBasis:'Daily', payRate:500, status:'Active', colorTag:'#6366f1', address:'123 Mabini St, Cebu', photo:'data:image/png;base64,iVBORw0KGgo=', contact:'0917 000', customFields:[] };
    window.state.employees = [empP];
    window.employeeDetail(empP);
    (function () { const h = d.getElementById('modal-root').innerHTML; ok('employee detail surfaces photo + address', /hr-detail-photo/.test(h) && /Mabini/.test(h)); })();
    window.closeModal();
    window.location.hash = '#/manpower'; window.render(); await wait(10);
    ok('directory grid renders employee photo', /hr-emp-photo/.test(d.getElementById('main').innerHTML));
    window.state.employees = [empX];
    // malicious bank/doc/contract fields render escaped — no LIVE (unescaped) tags injected
    const empM = { id: 'eM', name: 'Z', bank: { name: '<img src=x onerror="alert(1)">', acct: '1', holder: 'x' }, documents: [{ id: 'd1', name: '<svg onload=alert(2)>.pdf', size: 100, data: 'data:,', addedAt: '2026-06-19' }], contracts: [{ id: 'k1', title: '<b onmouseover=alert(3)>t</b>', createdAt: '2026-06-19' }], customFields: [] };
    window.state.employees.push(empM);
    window.employeeDetail(empM);
    (function () { const h = d.getElementById('modal-root').innerHTML; ok('malicious bank/doc/contract fields render escaped (no live tags)', h.indexOf('<img src=x onerror') === -1 && h.indexOf('<svg onload') === -1 && h.indexOf('<b onmouseover') === -1); })();
    window.closeModal();
    window.state.employees = window.state.employees.filter((e) => e.id !== 'eM');
    window.contractEditorModal('eX'); await wait(10);
    const cmHTML = () => d.getElementById('modal-root').innerHTML;
    ok('contract editor opens a contenteditable doc page + toolbar', !!d.getElementById('contract-body') && /doc-toolbar/.test(cmHTML()) && empX.contracts.length === 1);
    // A4 page model + font/size controls
    ok('contract editor shows an A4 page sheet sized in px', !!d.getElementById('contract-sheet') && /width:794px/.test(d.getElementById('contract-sheet').getAttribute('style') || ''));
    ok('contract editor exposes page-size, font and text-size controls', /data-action-change="doc-pagesize"/.test(cmHTML()) && /data-action-change="doc-font"/.test(cmHTML()) && /data-action-change="doc-fontsize"/.test(cmHTML()));
    ok('contract defaults to A4 / Times New Roman / 12pt', empX.contracts[0].pageSize === 'A4' && empX.contracts[0].font === 'Times New Roman' && empX.contracts[0].fontPt === 12);
    // print/PDF output is a real, sized document (not the tiny generic block)
    empX.contracts[0].pageSize = 'Legal'; empX.contracts[0].fontPt = 14;
    (function () {
      const pr = window.contractPrintHTML(empX.contracts[0]);
      ok('contract print sets the true @page size', /@page\{size:8\.5in 14in;margin:0\}/.test(pr));
      ok('contract print uses the chosen base font size in points', /font-size:14pt/.test(pr) && /\.pr-contract/.test(pr));
      ok('contract print applies real document margins', /padding:25\.4mm 25\.4mm/.test(pr));
    })();
    empX.contracts[0].pageSize = 'A4'; empX.contracts[0].fontPt = 12;
    empX.contracts[0].signedBy = 'Ana Cruz'; empX.contracts[0].signedAt = '2026-06-19';
    window.employeeDetail(empX);
    ok('a signed contract shows as signed', /signed</.test(d.getElementById('modal-root').innerHTML));
    window.closeModal();
    window.state.employees = []; window.state.hrAdvances = []; window.state.hrPayouts = []; window.state.settings.hrCustomCards = [];

    // ---------- delight: KPI count-up is non-destructive (settles to the EXACT figure) ----------
    window.state.finance = [{ id: 'f2', type: 'income', amount: 123456, date: '2026-06-02', category: 'Sales' }];
    window.location.hash = '#/dashboard'; window.render(); await wait(900); // let the entrance count-up finish
    ok('animateCounts helper exists', typeof window.animateCounts === 'function');
    const svEl = d.querySelector('.stat-value');
    const finalStat = svEl ? svEl.textContent : '';
    ok('a stat value is present and non-empty', !!finalStat);
    window.animateCounts(d.getElementById('main')); // re-trigger
    ok('count-up does not corrupt the value synchronously', d.querySelector('.stat-value').textContent === finalStat);
    await wait(900);
    ok('count-up settles back to the exact figure', d.querySelector('.stat-value').textContent === finalStat);

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
    // bubble must step aside while a modal is open, then return WITHOUT being rebuilt
    // (visibility toggle, not a rebuild — so it never re-types when a dialog closes)
    const builtBubble = d.getElementById('advisor-bubble').querySelector('.advisor-bubble');
    window.openModal('Test', '<p>hi</p>');
    ok('bubble hides while a modal is open', d.getElementById('advisor-bubble').style.display === 'none');
    window.closeModal();
    ok('bubble returns after the modal closes (not re-typed)', d.getElementById('advisor-bubble').style.display !== 'none' && d.getElementById('advisor-bubble').querySelector('.advisor-bubble') === builtBubble);
    click(d.querySelector('[data-action="advisor-bubble-dismiss"]'));
    ok('dismissing hides the bubble + persists', window.state.settings.advisorBubbleOff === true && d.getElementById('advisor-bubble').innerHTML === '');

    // ---------- sidebar default white text + white icons ----------
    ok('sidebar nav text is white by default', html.indexOf('color:#fff;font-size:.9rem') > -1 || /\.nav-item\{[^}]*color:#fff/.test(html));
    ok('sidebar nav icons are white by default', /\.nav-item svg\{color:#fff\}/.test(html));

    // ---------- print hygiene: floating overlays must NOT bleed into printed docs ----------
    // (regression: the advisor bubble appeared on a printed invoice)
    // Leak-proof approach: hide EVERY body-level element while printing, reveal only #print-area.
    ok('print hides all body-level overlays (wildcard)', /body\.printing\s*>\s*\*\{display:none\s*!important\}/.test(html));
    ok('print reveals only the print document', /body\.printing\s*>\s*#print-area\{display:block\s*!important\}/.test(html));

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
    ok('checklist is a collapsible <details> (collapsed on phones so money stays above the fold)', /class="card start-card start-details"/.test(window.getStartedHTML()) && /<summary class="start-summary"/.test(window.getStartedHTML()) && /\.start-details:not\(\[open\]\) \.progress,\.start-details:not\(\[open\]\) \.start-list\{display:none\}/.test(html));

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
