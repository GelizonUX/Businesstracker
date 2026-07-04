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
    const routes = ['dashboard','assistant','insights','accounts','finance','invoices','report','calculators','metrics','products','orders','utang','manpower','goals','roadmap','tasks','clients','notes','reviews','settings'];
    const viewErrors = [];
    for (const rt of routes) {
      try { window.location.hash = '#/' + rt; window.render(); if (d.getElementById('main').innerHTML.length < 50) viewErrors.push(rt + '(empty)'); }
      catch (e) { viewErrors.push(rt + ': ' + e.message); }
    }
    ok('every one of the 20 views renders without error', viewErrors.length === 0, viewErrors);

    // ---------- security: escaping + CSP + safeColor ----------
    ok('no unescaped image src in source', html.match(/src="'\+(?!esc\()/g) === null);
    ok('CSP meta present', !!d.querySelector('meta[http-equiv="Content-Security-Policy"]'));
    ok('CSP blocks objects + framing', /object-src 'none'/.test(html) && /frame-ancestors 'none'/.test(html));
    ok('safeColor rejects injection', window.safeColor('red"><img>') === '#4653e8' && window.safeColor('#10b981') === '#10b981');
    window.state.settings.bizLogo = 'x" onerror="alert(1)';
    window.renderSidebar();
    ok('malicious bizLogo is escaped (no raw onerror)', d.getElementById('sidebar').innerHTML.indexOf('onerror="alert(1)"') === -1);
    window.state.settings.bizLogo = '';
    // user-chosen colors are sanitized before going into style="" attributes (no CSS/attr injection)
    ok('account color tamed + sanitized at source', /var col=tameColor\(a\.color/.test(html) && /c=safeColor\(c,fb\|\|'#4653e8'\)/.test(html));
    ok('task table color tamed (sanitizes via safeColor inside)', html.indexOf("'box-shadow:inset 3px 0 0 '+tameColor(t.color)") > -1);
    ok('calendar task color tamed', /tcol=\s*t\.color\?tameColor\(t\.color\)/.test(html));
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
    // iOS "liquid glass": frosted tab bar + FAB, gated behind @supports (progressive enhancement, solid fallback)
    ok('floating chrome gets frosted glass only where backdrop-filter is supported', /@supports \(\(-webkit-backdrop-filter:blur\(12px\)\) or \(backdrop-filter:blur\(12px\)\)\)/.test(html));
    ok('glass tab bar is translucent + blurred in both themes, FAB is accent glass', /\.tabbar\{background:rgba\(255,255,255,\.7\);[\s\S]{0,160}backdrop-filter:blur\(20px\)/.test(html) && /html\[data-theme="dark"\] \.tabbar\{background:rgba\(18,20,29,\.58\)/.test(html) && /\.fab\{background:linear-gradient\(140deg,color-mix\(in srgb,var\(--accent\)/.test(html));
    // macOS Control-Center liquid glass on the KPI stat tiles + wallet tiles, over an ambient mesh
    ok('Ledger design: canvas is a clean paper surface (no ambient mesh)', !/body\{background-image:\s*radial-gradient/.test(html) && /--bg:#f3f3ef/.test(html));
    ok('Ledger design: stat values use the embedded display face (tables keep tabular numerals)', /\.stat-card \.stat-value\{font-family:var\(--font-display\)/.test(html) && /font-family:'Schibsted Grotesk'/.test(html) && /font-family:'Instrument Sans'/.test(html) && /td\{[^}]*font-variant-numeric:tabular-nums\}/.test(html));
    ok('wallet tiles are flat premium cards (identity lives in the tamed icon chip, no stripe)', /\.acct-card\{position:relative;overflow:hidden;background:var\(--bg-card\)\}/.test(html) && /function tameColor/.test(html));
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
    // Collapsing the rail must never leave the messy editor UI crammed into 74px
    (function () {
      window.ui.navEdit = true; window.state.settings.navCollapsed = false; window.renderSidebar();
      const btn = d.createElement('button');
      btn.setAttribute('data-action', 'toggle-nav-collapse');
      d.body.appendChild(btn);
      btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      ok('collapsing the sidebar force-exits edit mode', window.state.settings.navCollapsed === true && window.ui.navEdit === false);
      ok('collapsed rail hides the Edit-menu button + edit bar (CSS)', /\.app\.nav-collapsed \.nav-edit-open,\.app\.nav-collapsed \.nav-edit-bar\{display:none\}/.test(html));
      btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      ok('expanding the sidebar restores the full rail', window.state.settings.navCollapsed === false);
      d.body.removeChild(btn); window.ui.navEdit = false; window.renderSidebar();
    })();
    // Business-owner friction fixes: a real Credit card account type + a Theme control in Settings
    ok('account types include a dedicated Credit card option', Array.isArray(window.ACCOUNT_TYPES) && window.ACCOUNT_TYPES.indexOf('Credit card') >= 0);
    (function () {
      window.state.settings.theme = 'light'; window.applyTheme();
      const tb = d.createElement('button');
      tb.setAttribute('data-action', 'set-theme'); tb.setAttribute('data-theme', 'dark'); d.body.appendChild(tb);
      tb.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      ok('Settings theme control switches to dark', window.state.settings.theme === 'dark' && d.documentElement.getAttribute('data-theme') === 'dark');
      tb.setAttribute('data-theme', ''); tb.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      ok('Settings theme "System" clears the override', (window.state.settings.theme || '') === '');
      d.body.removeChild(tb);
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
    ok('sidebar nav text uses the themed rail token (light rail in light mode)', /\.nav-item\{[\s\S]{0,220}color:var\(--sidebar-text\)/.test(html) && /--bg-sidebar:#fbfbf9/.test(html) && /html\[data-theme="dark"\]\{[\s\S]{0,400}--bg-sidebar:#121317/.test(html));
    ok('sidebar nav icons follow the themed text colour', /\.nav-item svg\{color:currentColor\}/.test(html));

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
    ok('AA contrast: --text-3 verified 4.5:1+ (light #5d5f6a / dark #9b9dad)', html.indexOf('--text-3:#5d5f6a') > -1 && html.indexOf('--text-3:#9b9dad') > -1);
    ok('focus-visible covers custom controls', /\.chip:focus-visible,\.seg button:focus-visible/.test(html));
    ok('snappy easing token added', html.indexOf('--ease-snappy:') > -1);
    ok('modal focus trap + return-focus wired', html.indexOf('modalReturnFocus') > -1 && /e\.key!=='Tab'/.test(html));
    // overdue invoice row marker
    window.state.invoices = [{ id: 'o1', number: 'INV-1', client: 'X', amount: 100, currency: 'PHP', issueDate: '2026-01-01', dueDate: '2026-01-15', status: 'Sent' }];
    window.location.hash = '#/invoices'; window.render();
    ok('overdue invoices get a visual row marker', d.getElementById('main').innerHTML.indexOf('inv-overdue') > -1);

    // ---------- assistant (beta): NL parser + log-through ----------
    const T = new Date('2026-06-30T08:00:00');
    // designer colour discipline: raw user colours are tamed before decorating the UI
    (function(){
      var t=window.tameColor('#ff0000');
      ok('tameColor mutes a pure red (no traffic-light accents)', /^#[0-9a-f]{6}$/i.test(t) && t.toLowerCase()!=='#ff0000');
      ok('tameColor sanitizes injection attempts', /^#[0-9a-f]{6}$/i.test(window.tameColor('red"><img onerror=x>')));
      ok('tameColor keeps hue family (red stays warm)', (function(){ var n=parseInt(t.slice(1),16); return (n>>16&255) > (n&255); })());
    })();
    ok('assistant nav route registered', html.indexOf("{id:'assistant'") > -1);
    ok('assistant view in render map', /assistant:viewAssistant/.test(html));
    ok('chat state key in DEFAULT_STATE', /chat:\[\]/.test(html));
    // parser: the headline example from the brief
    const pInv = window.nlParse('Create invoice for john doe, amount is $100, payment due on july 21st, 2026.', T);
    ok('parses invoice intent', pInv.intent === 'invoice');
    ok('parses invoice client', pInv.client === 'John Doe', pInv.client);
    ok('parses invoice amount', pInv.amount === 100, pInv.amount);
    ok('parses invoice due date', pInv.dueDate === '2026-07-21', pInv.dueDate);
    // parser: expense + income
    const pExp = window.nlParse('Spent ₱500 on Facebook ads today', T);
    ok('parses expense + category', pExp.intent === 'expense' && pExp.category === 'Marketing & Ads', pExp);
    const pIncm = window.nlParse('Received 1,000 from Acme for website', T);
    ok('parses income + client', pIncm.intent === 'income' && pIncm.amount === 1000 && pIncm.client === 'Acme', pIncm);
    ok('non-financial text yields no intent', window.nlParse('what is my balance?', T).intent === null);
    ok('amount handles k shorthand', window.nlParseAmount('worth 2k') === 2000);
    ok('date handles tomorrow', window.nlParseDate('pay tomorrow', T).iso === '2026-07-01');
    // hardening from the business-owner stress test:
    ok('"got X from a customer" → income (not dropped)', (function(){ var r=window.nlParse('got 1500 from a customer', T); return r.intent==='income' && r.amount===1500 && r.client===''; })());
    ok('bare "electricity bill 2400" → expense, not invoice', (function(){ var r=window.nlParse('electricity bill 2400', T); return r.intent==='expense' && r.amount===2400 && r.category==='Rent & Utilities'; })());
    ok('bare "rent 15000" → expense', window.nlParse('rent 15000', T).intent === 'expense');
    ok('invoice name wins over "for" clause', (function(){ var r=window.nlParse('invoice maria 5000 for catering', T); return r.client==='Maria' && r.desc==='Catering'; })());
    ok('"invoice for X" keeps X as client', window.nlParse('create invoice for John Doe, amount 100', T).client === 'John Doe');
    ok('"total" beats unit price', window.nlParse('sold 5 boxes at 250 each total 1250', T).amount === 1250);
    ok('generic "from a client" is not a name', window.nlParse('collected 7500 from a client', T).client === '');
    ok('invalid ISO date is rejected', window.nlParseDate('due 2026-13-45', T) === null);
    ok('"paid suppliers 8k" → Inventory/Supplies', window.nlParse('paid suppliers 8k', T).category === 'Inventory / Supplies');
    // behavioral: confirming a parsed expense actually logs a finance entry
    window.state.chat = []; window.state.finance = [];
    const beforeFin = window.state.finance.length;
    window.location.hash = '#/assistant'; window.render();
    d.getElementById('asst-input').value = 'Spent 750 on grab yesterday';
    click(d.querySelector('[data-action="assistant-send"]'));
    await waitFor(() => (window.state.chat || []).some(m => m.kind === 'preview'));
    const prev = window.state.chat.filter(m => m.kind === 'preview')[0];
    ok('send creates a preview draft (nothing logged yet)', !!prev && window.state.finance.length === beforeFin);
    window.render();
    click(d.querySelector('[data-action="assistant-confirm"]'));
    await waitFor(() => window.state.finance.length === beforeFin + 1);
    ok('confirm logs the expense to finance', window.state.finance.length === beforeFin + 1 && window.state.finance[window.state.finance.length-1].amount === 750, window.state.finance[window.state.finance.length-1]);
    ok('confirmed draft is marked resolved', window.state.chat.filter(m => m.id === prev.id)[0].resolved === true);
    // behavioral: confirming a parsed invoice creates an invoice
    const beforeInv = window.state.invoices.length;
    d.getElementById('asst-input').value = 'Invoice Maria Santos 15000 due aug 5';
    click(d.querySelector('[data-action="assistant-send"]'));
    await waitFor(() => window.state.chat.filter(m => m.kind === 'preview' && !m.resolved).length > 0);
    window.render();
    const invBtns = d.querySelectorAll('[data-action="assistant-confirm"]');
    click(invBtns[invBtns.length - 1]);
    await waitFor(() => window.state.invoices.length === beforeInv + 1);
    ok('confirm creates the invoice', window.state.invoices.length === beforeInv + 1 && window.state.invoices[window.state.invoices.length-1].client === 'Maria Santos');
    // discard logs nothing
    const finCount = window.state.finance.length;
    d.getElementById('asst-input').value = 'bought a printer for 3000';
    click(d.querySelector('[data-action="assistant-send"]'));
    await waitFor(() => window.state.chat.filter(m => m.kind === 'preview' && !m.resolved).length > 0);
    window.render();
    const cancelBtns = d.querySelectorAll('[data-action="assistant-cancel"]');
    click(cancelBtns[cancelBtns.length - 1]);
    await waitFor(() => window.state.chat.filter(m => m.kind === 'preview' && !m.resolved).length === 0);
    ok('discard logs nothing to finance', window.state.finance.length === finCount);

    // ---------- assistant: more sections (tasks, clients) + Taglish + adaptive learning ----------
    ok('assistant state.assistant.terms exists', !!(window.state.assistant && window.state.assistant.terms));
    // parser: task + client + Taglish
    ok('parses a task', (function(){ var r=window.nlParse('Remind me to follow up with Maria on friday', T); return r.intent==='task' && r.title==='Follow up with Maria' && r.deadline==='2026-07-03'; })());
    ok('parses a new client', (function(){ var r=window.nlParse('Add client Dela Cruz Trading', T); return r.intent==='client' && r.name==='Dela Cruz Trading'; })());
    ok('Taglish "bayad kuryente 2400" → expense/Utilities', (function(){ var r=window.nlParse('bayad kuryente 2400', T); return r.intent==='expense' && r.amount===2400 && r.category==='Rent & Utilities'; })());
    ok('Taglish "nabenta ... 500" → income', window.nlParse('nabenta 5 cupcakes 500', T).intent === 'income');
    // behavioral: a task logs into state.tasks
    window.state.chat = []; var beforeTasks = window.state.tasks.length;
    window.location.hash = '#/assistant'; window.render();
    d.getElementById('asst-input').value = 'task: order more packaging tomorrow';
    click(d.querySelector('[data-action="assistant-send"]'));
    await waitFor(() => window.state.chat.filter(m => m.kind === 'preview' && !m.resolved).length > 0);
    window.render(); { const b = d.querySelectorAll('[data-action="assistant-confirm"]'); click(b[b.length-1]); }
    await waitFor(() => window.state.tasks.length === beforeTasks + 1);
    ok('confirm logs a task to Tasks', window.state.tasks.length === beforeTasks + 1 && /packaging/i.test(window.state.tasks[window.state.tasks.length-1].title));
    // behavioral: a client logs into state.clients
    const beforeClients = window.state.clients.length;
    d.getElementById('asst-input').value = 'add client Santos Bakeshop';
    click(d.querySelector('[data-action="assistant-send"]'));
    await waitFor(() => window.state.chat.filter(m => m.kind === 'preview' && !m.resolved).length > 0);
    window.render(); { const b = d.querySelectorAll('[data-action="assistant-confirm"]'); click(b[b.length-1]); }
    await waitFor(() => window.state.clients.length === beforeClients + 1);
    ok('confirm logs a client to Clients', window.state.clients.length === beforeClients + 1 && window.state.clients[window.state.clients.length-1].name === 'Santos Bakeshop');
    // behavioral: learning — confirm an expense with a corrected custom category, then the next parse adopts it
    window.state.assistant = { terms: {} };
    window.nlLearnRecord(window.state.assistant.terms, 'paid aqua station 200', 'expense', 'Water Refill');
    ok('a single correction adopts a custom category', (function(){ var r=window.nlParse('aqua station 200', T, window.state.assistant.terms); return r.intent==='expense' && r.category==='Water Refill'; })());
    ok('learning is persisted in state (survives save)', JSON.stringify(window.state.assistant.terms).indexOf('Water Refill') > -1);
    // review fixes: a confident built-in category needs 2 corrections (not 1) to be overridden
    ok('one learned token does NOT override a confident "Sales" match', (function(){ var s={}; window.nlLearnRecord(s,'sold cake 500','income','Catering'); return window.nlParse('sold cake 500', T, s).category==='Sales'; })());
    ok('two corrections DO override a confident match', (function(){ var s={}; window.nlLearnRecord(s,'sold cake 500','income','Catering'); window.nlLearnRecord(s,'sold cake 500','income','Catering'); return window.nlParse('sold cake 500', T, s).category==='Catering'; })());
    // review fix: soft reminder words don't hijack a clear money intent (amount not silently lost)
    ok('"reminder: client paid 3000" logs income, not a task', window.nlParse('reminder: client paid 3000', T).intent === 'income');
    ok('explicit "remind me…" is still a task', window.nlParse('Remind me to deposit cash tomorrow', T).intent === 'task');

    // ---------- floating chat bubble + quick-log popover ----------
    ok('shell has a chat bubble + popover container', !!d.getElementById('chat-bubble') && !!d.getElementById('asst-pop'));
    // open it from another view (dashboard) and confirm the popover mounts its own chat input
    window.location.hash = '#/dashboard'; window.render();
    ok('bubble is visible off the Assistant page', !d.body.classList.contains('route-assistant'));
    click(d.getElementById('chat-bubble'));
    ok('clicking the bubble opens the popover', d.getElementById('asst-pop').classList.contains('open') && !!d.getElementById('asst-pop-input'));
    // log an expense entirely from the popover (send → preview → confirm)
    const beforePop = window.state.finance.length;
    d.getElementById('asst-pop-input').value = 'spent 320 on grab today';
    click(d.getElementById('asst-pop').querySelector('[data-action="assistant-send"]'));
    await waitFor(() => d.getElementById('asst-pop') && d.getElementById('asst-pop').querySelector('[data-action="assistant-confirm"]'));
    click(d.getElementById('asst-pop').querySelector('[data-action="assistant-confirm"]'));
    await waitFor(() => window.state.finance.length === beforePop + 1);
    ok('popover logs an expense end-to-end', window.state.finance.length === beforePop + 1 && window.state.finance[window.state.finance.length-1].amount === 320);
    // toggle closed
    click(d.getElementById('chat-bubble'));
    ok('clicking the bubble again closes the popover', !d.getElementById('asst-pop').classList.contains('open'));
    // on the Assistant page the bubble is suppressed (you're already in the chat)
    window.location.hash = '#/assistant'; window.render();
    ok('bubble hidden on the Assistant page', d.body.classList.contains('route-assistant'));

    // ---------- smarter v2: qty-math, word-numbers, smart dates, account routing, multi-entry ----------
    ok('quantity math: "3 boxes at 250 each" → 750', window.nlParse('sold 3 boxes at 250 each', T).amount === 750);
    ok('"3 x 250" → 750', window.nlQtyMath('3 x 250') === 750);
    ok('"3 candles for 900" stays 900 (total, not multiplied)', window.nlParse('sold 3 candles for 900', T).amount === 900);
    ok('word-number: "spent two thousand on rent" → 2000', window.nlParse('spent two thousand on rent', T).amount === 2000);
    ok('smart date: "last friday"', window.nlParseDate('last friday', T).iso === '2026-06-26');
    ok('smart date: "end of month"', window.nlParseDate('due end of month', T).iso === '2026-06-30');
    ok('smart date: "in 2 weeks"', window.nlParseDate('in 2 weeks', T).iso === '2026-07-14');
    // account routing: name a wallet → it pre-selects on the draft
    window.state.accounts = [{ id: 'wGcash', name: 'GCash', type: 'E-wallet', opening: 0, adjust: [] }, { id: 'wCash', name: 'Cash', type: 'Cash', opening: 0, adjust: [] }];
    ok('account match: "from gcash" → wallet id', window.nlMatchAccount('paid 500 from gcash', window.state.accounts) === 'wGcash');
    // multi-entry end-to-end: one message → two drafts → confirm both → two finance entries
    window.state.chat = []; const beforeMulti = window.state.finance.length;
    window.location.hash = '#/assistant'; window.render();
    d.getElementById('asst-input').value = 'spent 500 on facebook ads and 300 on grab today';
    click(d.querySelector('[data-action="assistant-send"]'));
    await waitFor(() => window.state.chat.filter(m => m.kind === 'preview' && !m.resolved).length >= 2);
    ok('one message yields two drafts', window.state.chat.filter(m => m.kind === 'preview' && !m.resolved).length === 2);
    window.render();
    { const b = d.querySelectorAll('[data-action="assistant-confirm"]'); click(b[0]); }
    await waitFor(() => window.state.finance.length === beforeMulti + 1);
    window.render();
    { const b = d.querySelectorAll('[data-action="assistant-confirm"]'); click(b[b.length - 1]); }
    await waitFor(() => window.state.finance.length === beforeMulti + 2);
    ok('confirming both logs two separate expenses', window.state.finance.length === beforeMulti + 2);
    (function(){ const last2 = window.state.finance.slice(-2).map(e => e.amount).sort((a,b)=>a-b); ok('the two amounts are 300 and 500', last2[0] === 300 && last2[1] === 500, last2); })();

    // ---------- v2 review/stress hardening ----------
    ok('"for 2 cakes" no longer steals the amount', window.nlParse('received 1500 from customer for 2 cakes', T).amount === 1500);
    ok('a stray "one" in a note is not an amount', window.nlParse('paid one staff member', T).amount === null);
    ok('bare "3 x 250" logs as an expense of 750', (function(){ var r=window.nlParse('3 x 250', T); return r.intent==='expense' && r.amount===750; })());
    ok('reference/order numbers are not read as the amount', window.nlParse('order number 5567 paid 890', T).amount === 890);
    ok('"two weeks from now" resolves to a real date', window.nlParseDate('two weeks from now', T).iso === '2026-07-14');
    ok('"from now" is not captured as a client', window.nlParse('received 1000 2 days from now', T).client === '');
    ok('multi-entry drops a bare quantity ("2 boxes")', (function(){ var m=window.nlParseMulti('bought 2 boxes and sold 5 cakes for 1500', T); return m.length===1 && m[0].amount===1500; })());
    // DST-safety: the date math must not drift across a transition (uses calendar days, not ms)
    ok('"in 2 weeks" is exactly 14 calendar days out', (function(){ var base=new Date(2026,9,19,0,30,0); var d=window.nlParseDate('in 2 weeks', base); var exp=new Date(2026,10,2); return d.iso === (exp.getFullYear()+'-'+String(exp.getMonth()+1).padStart(2,'0')+'-'+String(exp.getDate()).padStart(2,'0')); })());

    // ================= new features: onboarding wizard, receipt scan, dashboard, backup =================

    // ---- first-run section picker (choose which modules show in the sidebar) ----
    (function(){ const picker = window.wizardSectionPickerHTML();
      ok('setup wizard offers a section picker', picker.indexOf('Which sections do you want') > -1 && /data-mod="invoices"/.test(picker) && /data-mod="products"/.test(picker));
      ok('essentials are not in the picker (always shown)', picker.indexOf('data-mod="dashboard"') < 0 && picker.indexOf('data-mod="settings"') < 0);
    })();
    window.state.settings.hiddenModules = ['products','orders','roadmap'];
    (function(){ const ids = window.visibleRoutes().map(r => r.id);
      ok('chosen-hidden modules leave the sidebar', ids.indexOf('products') < 0 && ids.indexOf('orders') < 0 && ids.indexOf('dashboard') >= 0 && ids.indexOf('finance') >= 0); })();
    window.state.settings.hiddenModules = [];

    // ---- dashboard: a fresh/sparse dashboard shows only populated cards ----
    window.state.finance = []; window.state.goals = []; window.state.tasks = []; window.state.invoices = [];
    window.state.clients = []; window.state.products = []; window.state.orders = []; window.state.notes = [];
    window.state.roadmaps = []; window.state.phases = [];
    window.state.settings.dashHidden = []; window.state.settings.dashOrder = null;
    window.location.hash = '#/dashboard'; window.render();
    (function(){ const wids = [].map.call(d.querySelectorAll('.dash-widget'), w => w.getAttribute('data-widget'));
      ok('fresh dashboard shows only KPI tiles, no empty placeholders', wids.length > 0 && wids.every(id => ['rev','exp','prof','margin'].indexOf(id) >= 0), wids); })();

    // ---- receipt scan: parser + draft + attach button + end-to-end (stubbed OCR) ----
    (function(){ const items = window.parseReceiptItems('SUPER MART\nMILK 2 @ 55  110.00\nBREAD  45.00\nEGGS x12  84.00\nSUBTOTAL 239.00\nTOTAL  239.00\nCASH 300.00');
      ok('receipt line items are extracted (name/qty/total)', items.length >= 3 && items.some(i => /milk/i.test(i.name) && i.qty === 2), items); })();
    (function(){ const dr = window.buildReceiptDraft('GROCERY MART\nRICE  250.00\nOIL  120.00\nTOTAL  370.00\n02/03/2026', 'data:image/jpeg;base64,AAAA');
      ok('receipt → expense draft (total, date, image)', dr.intent === 'expense' && dr.amount === 370 && dr.date === '2026-02-03' && dr.receipt.indexOf('data:') === 0 && dr.items.length === 2, {a:dr.amount,d:dr.date,n:dr.items.length}); })();
    // items-only receipt (no printed TOTAL) must SUM the items, not take the largest one
    (function(){ const dr = window.buildReceiptDraft('SARI-SARI STORE\nCoke  20.00\nLucky Me x3  39.00\nLoad card  30.00\nCandle wax  320.00', '');
      ok('items-only receipt sums the items (not the largest)', dr.amount === 409, dr.amount); })();
    // a printed total stays authoritative (includes tax) even if item sum differs
    (function(){ const dr = window.buildReceiptDraft('RESTO\nSiopao  60.00\nCoffee  50.00\nService Charge 11.00\nVAT 13.20\nTOTAL  134.20', '');
      ok('printed TOTAL wins over item sum', dr.amount === 134.20, dr.amount);
      ok('VAT / service charge are not listed as items', !dr.items.some(i => /vat|service/i.test(i.name)), dr.items.map(i=>i.name)); })();
    (function(){ const items = window.parseReceiptItems('Ministop\nSiopao  35.00\nCoffee  45.00\nVATable Sales  71.43\nTOTAL  80.00');
      ok('"VATable Sales" is excluded from line items', !items.some(i => /vatable/i.test(i.name)), items.map(i=>i.name)); })();
    window.location.hash = '#/assistant'; window.render();
    ok('assistant input row has a receipt-attach button', !!d.querySelector('[data-action="assistant-attach"]'));
    // end-to-end: stub OCR, run the scan pipeline, confirm it logs an expense with the receipt
    window.loadTesseract = function(){ return Promise.resolve({ recognize: function(){ return Promise.resolve({ data: { text: 'GROCERY MART\nRICE 5kg  250.00\nOIL 1L  120.00\nTOTAL  370.00\n02/03/2026' } }); } }); };
    window.state.chat = [{ id: 'rc1', role: 'bot', kind: 'scanning', text: 'Reading…', ts: 1 }];
    window.assistantRunReceiptOcr('rc1', 'data:image/jpeg;base64,ZZZ');
    await waitFor(() => window.state.chat.some(m => m.id === 'rc1' && m.kind === 'preview'));
    (function(){ const m = window.state.chat.filter(x => x.id === 'rc1')[0];
      ok('scan turns into an expense draft (total 370)', m.kind === 'preview' && m.parsed.intent === 'expense' && m.parsed.amount === 370 && !!m.parsed.receipt); })();
    window.location.hash = '#/assistant'; window.render();
    const beforeRcp = window.state.finance.length;
    click(d.getElementById('apv-rc1').querySelector('[data-action="assistant-confirm"]'));
    await waitFor(() => window.state.finance.length === beforeRcp + 1);
    (function(){ const e = window.state.finance[window.state.finance.length-1];
      ok('confirming a scanned receipt logs an expense with the image', e.type === 'expense' && e.amount === 370 && e.receipt.indexOf('data:') === 0); })();

    // ---- backup safety system ----
    window.state.finance = Array.from({length:6}, (_,i) => ({ id:'bk'+i, type:'expense', amount:100, date:'2026-01-01', category:'Other expense' }));
    window.state.settings.lastBackup = null; window.state.settings.sync = { enabled:false, lastSync:null }; window.state.settings.backupSnooze = null;
    ok('dataAtRisk() is true with records and no backup/sync', window.dataAtRisk() === true);
    window.location.hash = '#/dashboard'; window.render();
    ok('safety banner shows on the dashboard when at risk', !!d.querySelector('.backup-banner'));
    click(d.querySelector('[data-action="snooze-backup"]'));
    ok('snoozing hides the banner', !d.querySelector('.backup-banner') && !!window.state.settings.backupSnooze);
    window.state.settings.backupSnooze = null; window.state.settings.lastBackup = window.todayISO(); window.render();
    ok('a fresh backup clears the risk (no banner)', window.dataAtRisk() === false && !d.querySelector('.backup-banner'));
    (function(){ window.state.settings.lastBackup = null; window.state.settings.sync = { enabled:true, lastSync: window.todayISO()+'T00:00:00' };
      ok('active cloud sync also clears the risk', window.dataAtRisk() === false); })();

    // ---------- island top navigation (desktop shell) ----------
    window.location.hash = '#/dashboard'; window.render();
    const isl = d.getElementById('island-bar');
    ok('island bar renders brand + menu + utility cluster', !!isl && !!isl.querySelector('.isl-brand') && !!isl.querySelector('.island') && !!isl.querySelector('.isl-right'));
    ok('dashboard is a standalone active pill', (function(){ var b=isl.querySelector('.isl-item.active'); return !!b && /Dashboard/.test(b.textContent); })());
    ok('sections render as dropdown groups', isl.querySelectorAll('.isl-group').length >= 4);
    ok('a dropdown lists its section routes', (function(){ var g=isl.querySelector('.isl-group[data-isl-sec="Money"]'); return !!g && g.querySelectorAll('.isl-drop [data-action="nav"]').length >= 5; })());
    (function(){
      var g=isl.querySelector('.isl-group[data-isl-sec="Money"]'), t=g.querySelector('[data-action="isl-toggle"]');
      click(t);
      ok('clicking a menu opens its dropdown (aria-expanded true)', g.classList.contains('open') && t.getAttribute('aria-expanded')==='true');
      var g2=isl.querySelector('.isl-group[data-isl-sec="Shop"]'), t2=g2.querySelector('[data-action="isl-toggle"]');
      click(t2);
      ok('opening another menu closes the first (single-open discipline)', g2.classList.contains('open') && !g.classList.contains('open'));
      click(d.getElementById('main'));
      ok('outside click closes all island dropdowns', !isl.querySelector('.isl-group.open'));
    })();
    window.state.settings.hiddenModules = ['utang']; window.render();
    ok('hidden modules stay out of the island', !d.getElementById('island-bar').querySelector('[data-route="utang"]'));
    window.state.settings.hiddenModules = [];
    window.state.customModules = [{id:'cmx1', name:'Suppliers', icon:'box', fields:[], records:[]}]; window.render();
    ok('custom modules appear in a My Modules island group', (function(){ var g=d.getElementById('island-bar').querySelector('.isl-group[data-isl-sec="My Modules"]'); return !!g && !!g.querySelector('[data-route="custom-cmx1"]'); })());
    window.state.customModules = []; window.render();
    (function(){
      var isl2=d.getElementById('island-bar');
      var g=isl2.querySelector('.isl-group[data-isl-sec="Money"]'); click(g.querySelector('[data-action="isl-toggle"]'));
      click(g.querySelector('[data-route="finance"]'));
      ok('navigating from a dropdown closes it and routes', window.location.hash === '#/finance');
    })();
    ok('desktop CSS swaps sidebar for the island (min-width:861px)', /@media \(min-width:861px\)\{[\s\S]{0,400}\.sidebar\{display:none\}/.test(html) && /\.island-bar\{position:fixed/.test(html));
    ok('design language untouched: paper canvas + Ledger radii intact', /--bg:#f3f3ef/.test(html) && /--r-sm:8px; --r:11px; --r-lg:14px; --r-xl:18px;/.test(html));
    // island polish: the production dropdown-clip bug + adaptive active pill + glass
    ok('island can never clip its dropdowns (no overflow/contain on the pill bar)', !/\.island\{[^}]*(overflow|contain)/.test(html));
    ok('island wraps gracefully when user labels/custom modules overflow the row', /\.island\{[^}]*flex-wrap:wrap/.test(html) && /\.island\{[^}]*max-width:calc\(100vw - 400px\)/.test(html));
    ok('dropdowns reveal via opacity/visibility spring (clip-proof)', /\.isl-drop\{[^}]*opacity:0;visibility:hidden/.test(html) && /\.isl-group\.open \.isl-drop\{opacity:1;visibility:visible/.test(html));
    ok('standard UX: dropdowns are click-only — no hover/focus auto-open', !/\.isl-group:hover \.isl-drop/.test(html) && !/\.isl-group:focus-within \.isl-drop/.test(html));
    ok('liquid glass: islands react to scroll with deeper blur + specular rim', /body\.isl-scrolled \.isl-brand,body\.isl-scrolled \.island,body\.isl-scrolled \.isl-right\{/.test(html) && /function islandScrollSync/.test(html) && /addEventListener\('scroll', islandScrollSync, \{passive:true\}\)/.test(html));
    ok('active island pill adapts to the user accent (CTA tokens, not hard ink)', /\.isl-item\.active\{background:var\(--accent-cta\);color:var\(--accent-cta-ink\)\}/.test(html));
    ok('cards sit at ~86% opacity with a solid fallback (no per-card blur cost)', /\.card\{\s*background:var\(--bg-card\);background:color-mix\(in srgb,var\(--bg-card\) 86%,transparent\)/.test(html) && !/\.card\{-webkit-backdrop-filter/.test(html));
    ok('island squeezes on medium desktops (two tiers, fits down to 861px)', /@media \(min-width:861px\) and \(max-width:1180px\)/.test(html) && /@media \(min-width:861px\) and \(max-width:1040px\)/.test(html) && /\.isl-brand b\{display:none\}/.test(html));
    ok('health ring follows the user accent (no hardcoded gradient stops)', /stop-color:var\(--accent-cta,#4653e8\)/.test(html) && !/<stop offset="0" stop-color="#4653e8"/.test(html));

    // build beacon: instantly answers "did the deploy update?"
    ok('build stamp exists and is surfaced in Settings', typeof window.APP_BUILD === 'string' && window.APP_BUILD.length >= 8 && (function(){ window.location.hash='#/settings'; window.render(); return d.querySelector('.page-title p').textContent.indexOf(window.APP_BUILD) > -1; })());

    // ---------- roadmap mind-map canvas ----------
    window.loadSampleData(); await wait(30);
    window.location.hash = '#/roadmap'; window.render();
    (function(){
      const m = d.getElementById('main');
      ok('roadmap defaults to the Map mode with a canvas', !!m.querySelector('.rm-canvas') && !!m.querySelector('#rm-board'));
      const center = m.querySelector('.rm-node.rm-center');
      const phases = m.querySelectorAll('.rm-node.rm-phase');
      const leaves = m.querySelectorAll('.rm-node.rm-leaf');
      ok('map renders centre + branch + leaf nodes', !!center && phases.length >= 1 && leaves.length >= 1);
      ok('every non-centre node has a connecting edge', m.querySelectorAll('.rm-edges path').length === phases.length + leaves.length);
      ok('auto-layout positions every node', Array.prototype.every.call(m.querySelectorAll('.rm-node'), n => parseFloat(n.style.left) > 0 && parseFloat(n.style.top) > 0));
      const p0 = window.state.roadmaps[0].phases[0];
      window.rmSetNodePos('phase', p0.id, 500, 400);
      ok('dragged position persists on the model', window.state.roadmaps[0].phases[0].x === 500 && window.state.roadmaps[0].phases[0].y === 400);
      window.render();
      const pn = d.querySelector('.rm-node.rm-phase[data-id="' + p0.id + '"]');
      ok('persisted position wins over auto-layout on re-render', pn && parseFloat(pn.style.left) === 500 && parseFloat(pn.style.top) === 400);
      const before = p0.color || null;
      click(d.querySelector('.rm-tool[data-action="rm-node-color"][data-kind="phase"][data-id="' + p0.id + '"]'));
      ok('node colour cycle persists a new colour', window.state.roadmaps[0].phases[0].color && window.state.roadmaps[0].phases[0].color !== before);
      window.render();
      click(d.querySelector('.rm-node.rm-phase .rm-tool[data-action="open-phase-task-modal"]'));
      ok('+ on a branch opens the task modal', d.getElementById('modal-root').innerHTML.indexOf('modal') > -1 && d.getElementById('modal-root').innerHTML.length > 100);
      window.closeModal();
      click(d.querySelector('[data-action="roadmap-mode"][data-mode="list"]'));
      ok('List mode still renders the classic phase rows', !!d.querySelector('.rm-task-row'));
      click(d.querySelector('[data-action="roadmap-mode"][data-mode="map"]'));
      // camera engine: cursor-centred zoom writes a full transform + keeps world point fixed
      window.render();
      window.rmZoomTo(2, 400, 300);
      ok('zoom writes a translate+scale camera transform', /translate\([^)]*\) scale\(2\)/.test(d.getElementById('rm-board').getAttribute('style')) && window.ui.rmCam.z === 2);
      ok('cursor-centred zoom keeps the point under the cursor fixed', (function(){ var w=window.rmScreenToWorld(400,300); window.rmZoomTo(3,400,300); var w2=window.rmScreenToWorld(400,300); return Math.abs(w.x-w2.x)<0.5 && Math.abs(w.y-w2.y)<0.5; })());
      // fit-to-screen frames all nodes within the viewport
      window.rmFit();
      ok('fit-to-screen produces a sane camera (all nodes visible)', window.ui.rmCam.z >= 0.12 && window.ui.rmCam.z <= 1.4 && isFinite(window.ui.rmCam.x) && isFinite(window.ui.rmCam.y));
      // minimap + grid cycle
      ok('minimap renders node dots + a viewport rect', !!d.getElementById('rm-mini') && d.querySelectorAll('.rm-mini-dot').length >= 3 && !!d.getElementById('rm-mini-view'));
      click(d.querySelector('[data-action="rm-grid-cycle"]'));
      ok('grid style cycles (dots → lines → none)', /rm-grid-lines/.test(d.querySelector('.rm-canvas-card').className));
      // double-click empty canvas drops a new branch at that world point
      (function(){ var n0=window.state.roadmaps[0].phases.length; window.rmPendingPos={x:1234,y:888}; window.phaseModal();
        var f=d.getElementById('modal-form'); f.elements['name'].value='DblClick Branch';
        f.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
        var np=window.state.roadmaps[0].phases[window.state.roadmaps[0].phases.length-1];
        ok('double-click-to-create drops the branch at the clicked point', window.state.roadmaps[0].phases.length===n0+1 && np.x===1234 && np.y===888);
      })();
      // premium polish from the 3-agent canvas validation ---------------------
      (function(){ var css=''; d.querySelectorAll('style').forEach(function(s){ css+=s.textContent; });
        ok('done tasks are not struck through (premium done-state, not "deleted")', !/rm-leaf\.done[^{]*\{[^}]*line-through/.test(css) && /rm-leaf\.done::before/.test(css));
        ok('minimap is anchored bottom-left, clear of the toast/chat corner', /\.rm-mini\{[^}]*left:14px/.test(css) && !/\.rm-mini\{[^}]*right:14px/.test(css));
      })();
      // camera keys only fire when the canvas is the intended target (M1 fix)
      (function(){ var btn=d.querySelector('button');
        d.body.classList.remove('rm-grabbing');
        if(btn){ btn.focus();
          d.dispatchEvent(new window.KeyboardEvent('keydown',{code:'Space',key:' ',bubbles:true,cancelable:true}));
          ok('Space is not hijacked while a non-canvas control is focused', !d.body.classList.contains('rm-grabbing'));
          d.dispatchEvent(new window.KeyboardEvent('keyup',{code:'Space',key:' ',bubbles:true}));
          if(btn.blur) btn.blur();
        }
        d.body.classList.remove('rm-grabbing');
        d.dispatchEvent(new window.KeyboardEvent('keydown',{code:'Space',key:' ',bubbles:true,cancelable:true}));
        ok('Space pans the canvas when nothing else holds focus', d.body.classList.contains('rm-grabbing'));
        d.dispatchEvent(new window.KeyboardEvent('keyup',{code:'Space',key:' ',bubbles:true}));
      })();
      window.ui.rmCam = null;
    })();

    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.log('SUITE THREW >>', e.stack);
    process.exit(2);
  }
}
setTimeout(main, 300);
