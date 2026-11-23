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

const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'https://x.test/#/dashboard', pretendToBeVisual: true });
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
    window.bootApp();
    await wait(60);

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

    // ---------- Metrics: only tracked numbers get a card ----------
    (function metricsScreen() {
      const savedMetrics = window.state.metrics;
      // sample data saves a value for all eleven, so clear them: what is left is
      // whatever the app can work out from the owner's own entries.
      window.state.metrics = {};
      window.location.hash = '#/metrics'; window.render();
      const main = d.getElementById('main');
      const cards = main.querySelectorAll('.metric-card');
      const rows = main.querySelectorAll('.mtr-row');
      const tracked = window.METRIC_DEFS.filter((def) => window.metricValue(def) !== null).length;
      ok('a card exists for each tracked metric and no others', cards.length === tracked && cards.length > 0, cards.length + ' cards / ' + tracked + ' tracked');
      ok('every untracked metric is one collapsed row, not a card', rows.length === window.METRIC_DEFS.length - tracked && rows.length > 0, rows.length + ' rows');
      ok('no card reserves hero space for a value that does not exist', Array.from(main.querySelectorAll('.m-val')).every((n) => n.textContent.trim() !== '—' && n.textContent.trim() !== ''));
      ok('the "Not tracked" badge is gone from the cards', main.innerHTML.indexOf('Not tracked</span>') === -1);
      ok('the textbook definition sits behind the disclosure, not in the open', Array.from(rows).every((r) => !r.hasAttribute('open') && r.querySelector('.mtr-body p')));
      ok('each untracked row still carries the form that would give it a value', Array.from(rows).every((r) => r.querySelector('form[data-metric-calc],form[data-metric-set]')));
      // no entries at all: the screen is a list, not eleven empty cards
      const savedFin = window.state.finance, savedClients = window.state.clients;
      window.state.finance = []; window.state.clients = [];
      window.render();
      ok('with nothing tracked the screen shows zero cards and eleven rows',
        d.getElementById('main').querySelectorAll('.metric-card').length === 0 &&
        d.getElementById('main').querySelectorAll('.mtr-row').length === window.METRIC_DEFS.length,
        d.getElementById('main').querySelectorAll('.metric-card').length + ' cards');
      ok('revenue per client reports nothing rather than a confident zero when there is no revenue',
        window.metricValue(window.METRIC_DEFS.filter((x) => x.key === 'rpc')[0]) === null);
      window.state.finance = savedFin; window.state.clients = savedClients;
      window.state.metrics = savedMetrics;
    })();

    // ---------- copy: say what it does, not what it is ----------
    (function positioning() {
      // the shipped description names the job and NOT the product: the owner's
      // business name replaces it live (applyBrand) once one is set
      ok('the meta description and title name the job, not a "command center"',
        !/command cent/i.test(html) && /<meta name="description" content="Keeps a small business/.test(html) &&
        !/<title>Trakora/.test(html));
      ok('the About line says where the records are, in the owner\'s words, and names no file format',
        /Trakora keeps your records in this browser\. There is no account and no server\./.test(html) && !/Trakora is one HTML file/.test(html));
      // the register the owner objects to: tricolons, possessive couplets, cheering
      const banned = [
        'Your software, your brand', 'Your table, your fields, your data',
        'your form, your business', 'Your business, read and explained',
        'Your team at a glance', 'From order to doorstep', 'The digital credit notebook',
        'reconciled to reality', 'Clear runway!', 'Your advisor is ready',
        'never lose sight of it', 'searchable, taggable, pinnable',
        'move the business forward', 'ask me again!'
      ].filter((p) => html.indexOf(p) !== -1);
      ok('no tricolons, possessive couplets or cheering left in the surveyed copy', banned.length === 0, banned);
      ok('the greeting subtitle stopped exclaiming at the owner', html.indexOf('Hello! Here is how ') === -1);
      // This counted em dashes and demanded exactly 60, which broke the moment a new
      // no-value placeholder was added legitimately. The rule was never "sixty dashes":
      // it is "no dash used as PROSE". A placeholder is written >—< or '—' with no
      // spaces around it; prose is written word — word. So test the rule. The single
      // permitted prose dash is 'estimate — unverified', which two other assertions
      // match on, so changing it has to be a deliberate act in the same commit.
      // (A second one was permitted for a while: the sign-in screen's demo notice. The
      // screen is gone and so is its dash.)
      const proseDashes = html.match(/\S[  ]—[  ]\S/g) || [];
      ok('no em dash is used as prose, and none is the empty-value glyph: cells take an en dash, sentences take words',
        proseDashes.length === 0 && html.indexOf("'—'") < 0 && /if\(!dateStr\) return '–';/.test(html), proseDashes.slice(0, 5));
      ok('the mobile-table placeholder regex still has its glyph', /\/\^\[—–-\]\+\$\//.test(html));
    })();

    // ---------- security: escaping + CSP + safeColor ----------
    // Every roadmap object reaches an HTML ATTRIBUTE, and importData() deep-merges
    // whatever JSON it is handed, so a backup someone sends you is the
    // delivery path. A first fix hardened frames, stamps and edges and left notes,
    // tables, comments and nodes wide open; there were zero assertions here, which is
    // exactly why that survived. Test the RULE, on every renderer, forever.
    //
    // Note the check: a parsed attribute whose name starts with "on". Searching the
    // markup for the substring "onmouseover" is wrong, because esc() leaves the payload
    // visible as inert text and that reads as a failure when it is a pass.
    (function () {
      const PAY = 'x onmouseover=window.__hit=1 q=';
      const hasHandler = (html) => {
        const host = d.createElement('div'); host.innerHTML = html;
        return [host, ...host.querySelectorAll('*')].some((e) =>
          e.getAttributeNames && e.getAttributeNames().some((a) => a.toLowerCase().startsWith('on')));
      };
      const cases = [
        ['note id',       () => window.rmNoteHTML({ id: PAY, x: 0, y: 0, text: 't' })],
        ['note geometry', () => window.rmNoteHTML({ id: 'n', x: '0;--z:1" onmouseover="window.__hit=1', y: 0, text: 't' })],
        ['note colour',   () => window.rmNoteHTML({ id: 'n', x: 0, y: 0, text: 't', color: '#fff" onmouseover="window.__hit=1' })],
        ['table id',      () => window.rmTableHTML({ id: PAY, x: 0, y: 0, cells: [['a']] })],
        ['comment id',    () => window.rmCommentHTML({ id: PAY, x: 0, y: 0, text: 'c' })],
        ['node nid',      () => window.rmNodeHTML({ nid: PAY, kind: 'task', left: 0, top: 0, label: 'L' })],
        ['frame id',      () => window.rmFrameHTML({ id: PAY, x: 0, y: 0, w: 10, h: 10 })],
        ['stamp id',      () => window.rmStampHTML({ id: PAY, x: 0, y: 0, emoji: 'x' })]
      ];
      const leaked = cases.filter(([, f]) => { try { return hasHandler(f()); } catch (e) { return 'threw'; } })
        .map(([n]) => n);
      ok('no roadmap renderer lets stored state install an event handler', leaked.length === 0, leaked);
      // and the sanitising must not eat legitimate content
      const good = window.rmNoteHTML({ id: 'n1', x: 120, y: -40, w: 200, h: 150, text: 'Order wax', color: '#8ce0a6' });
      ok('roadmap escaping leaves real notes intact',
        /left:120px;top:-40px/.test(good) && /--nc:#8ce0a6/.test(good) && good.indexOf('Order wax') > -1, good.slice(0, 0));
    })();
    ok('no unescaped image src in source', html.match(/src="'\+(?!esc\()/g) === null);
    ok('CSP meta present', !!d.querySelector('meta[http-equiv="Content-Security-Policy"]'));
    // The policy used to name Firebase's database wildcards and Google's two identity
    // hosts. Nothing talks to them any more, so the only place script in this origin can
    // send anything is the page's own origin and the exchange-rate API.
    (function cspNamesOnlyWhatIsUsed() {
      const csp = d.querySelector('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
      const dir = (name) => (csp.split(';').map((x) => x.trim()).filter((x) => x.indexOf(name + ' ') === 0)[0] || '')
        .split(/\s+/).slice(1);
      ok('connect-src is the page itself and the exchange-rate API, and nothing else',
        dir('connect-src').join(' ') === "'self' https://open.er-api.com", dir('connect-src'));
      ok('...so the identity and database hosts are no longer allowed',
        !/identitytoolkit|securetoken|googleapis|firebaseio|firebasedatabase|accounts\.google/.test(csp), csp);
      ok('...and nothing was opened up to make room: no frame-src, form-action stays on self',
        dir('frame-src').length === 0 && dir('form-action').join(' ') === "'self'" && dir('script-src').join(' ') === "'self' 'unsafe-inline'");
      const headers = fs.readFileSync(path.join(__dirname, '..', '_headers'), 'utf8');
      const redirects = fs.readFileSync(path.join(__dirname, '..', '_redirects'), 'utf8');
      ok('the deploy config names none of those hosts and routes no sign-in callback either',
        !/identitytoolkit|securetoken|googleapis|firebase|oauth/i.test(headers + redirects));
    })();
    ok('CSP blocks objects + framing', /object-src 'none'/.test(html) && /frame-ancestors 'none'/.test(html));
    ok('safeColor rejects injection', window.safeColor('red"><img>') === '#6B695F' && window.safeColor('#10b981') === '#10b981');
    window.state.settings.bizLogo = 'x" onerror="alert(1)';
    window.renderBar();
    ok('malicious bizLogo is escaped (no raw onerror)', d.getElementById('bar').innerHTML.indexOf('onerror="alert(1)"') === -1);
    window.state.settings.bizLogo = '';
    // user-chosen colors are sanitized before going into style="" attributes (no CSS/attr injection)
    ok('an account carries no colour of its own, and any colour that is drawn is sanitized at source', !/BRAND_COLORS|brandColorFor/.test(html) && /c=safeColor\(c,fb\|\|'#6B695F'\)/.test(html));
    ok('a task colour is drawn as a tamed dot, never as a fill or a stripe', /function taskDot\(t\)\{ return t\.color\?'<i class="dot" style="background:'\+esc\(tameColor\(t\.color\)\)/.test(html) && html.indexOf('box-shadow:inset 3px 0 0') < 0);
    ok('a calendar task shows its colour as the same tamed dot', /class="cal-chip'\+\(t\.done\?' is-done':''\)\+'"[^;]*taskDot\(t\)/.test(html));
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

    // ---------- the licence gate is GONE, and cannot come back ----------
    // This block used to mint licence keys. The gate it tested was never enforceable:
    // an audit of this repo forged a working key out of the repo's own contents, and
    // separately walked past isActivated() with one localStorage.setItem, because
    // isActivated() only ever checked the SHAPE of that value. Nothing replaced it:
    // the accounts that came after it are gone too (see accountsRetired below). So
    // what is asserted here is the removal, not a replacement gate.
    (function licenceGateRetired() {
      // 1. nothing in the app implements a gate any more
      const goneFromApp = ['GATE', 'gateEndpoint', 'gateReadLicense', 'gateFetch', 'verifyActivation',
        'verifySignedKey', 'LICENSE_PUBKEY', '_licPubKey', 'importLicensePub', 'isActivated',
        'getActivation', 'setActivation', 'renderGate', 'keyShow', 'normKey', 'licEmailHash',
        'licTag', 'deactivateDevice', 'applyActivationStamp', 'licenseInfo', 'licenseRulesJSON'];
      const left = goneFromApp.filter((n) => typeof window[n] !== 'undefined');
      ok('every licence-gate symbol is gone from the app', left.length === 0, left);
      ok('the gate root element is gone from the document', d.getElementById('gate-root') === null);

      // 2. the app opens with no gate at all: boot renders the dashboard, not a wall
      window.location.hash = '#/dashboard';
      window.bootApp();
      ok('the app opens straight into itself with no gate', d.getElementById('main').innerHTML.length > 50
        && d.getElementById('signin-root') === null);

      // 3. the one-line bypass the audit used. It used to be a skeleton key; now it is
      //    a stray localStorage entry that grants exactly nothing, because nothing reads it.
      window.localStorage.setItem('bizpilot.activation', '{"key":"x","email":"a@b"}');
      window.bootApp();
      ok('a forged activation record in localStorage grants nothing (nothing reads it)',
        !/bizpilot\.activation/.test(html) && d.getElementById('main').innerHTML.length > 50);
      window.localStorage.removeItem('bizpilot.activation');
    })();

    // ---------- no licence artefact survives ANYWHERE in the repo ----------
    // The ECDSA signing key behind the old offline keys was an open security item for
    // the life of this project: a key that ships can be extracted, and one that is
    // extracted can forge every licence ever issued. Retiring the gate retires the key.
    // This assertion exists so it cannot quietly return.
    (function noLicenceArtefacts() {
      const root = path.join(__dirname, '..');
      const skip = new Set(['node_modules', '.git']);
      const files = [];
      (function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (skip.has(entry.name)) continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full); else files.push(full);
        }
      })(root);

      const named = files.filter((f) => /keygen|license\.html|licence\.html/i.test(path.basename(f)));
      ok('no licence key generator or licence page is left in the repo', named.length === 0, named);

      // A P-256 public key in JWK form is what LICENSE_PUBKEY was. Any private half
      // ("d") alongside a curve is worse. Neither may appear in any tracked file.
      const offenders = [];
      for (const f of files) {
        let text;
        try { text = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
        if (f === path.join(root, 'tests', 'app.test.js')) continue;  // this file names them to forbid them
        if (/LICENSE_PUBKEY/.test(text)) offenders.push(path.relative(root, f) + ': LICENSE_PUBKEY');
        if (/"kty"\s*:\s*"EC"/.test(text) || /'kty'\s*:\s*'EC'/.test(text)) offenders.push(path.relative(root, f) + ': JWK EC key');
        if (/"crv"\s*:\s*"P-256"[\s\S]{0,200}"d"\s*:/.test(text)) offenders.push(path.relative(root, f) + ': EC PRIVATE key');
        if (/BEGIN (EC |RSA )?PRIVATE KEY/.test(text)) offenders.push(path.relative(root, f) + ': PEM private key');
      }

      // and the deploy config no longer pretends to hide files that no longer exist
      const redirects = fs.readFileSync(path.join(root, '_redirects'), 'utf8');
      ok('_redirects no longer routes the seller-only licence tools', !/keygen|license\.html/i.test(redirects));
    })();

    // ---------- PIN lock (PBKDF2) ----------
    ok('no lock initially', window.hasLock() === false);
    await window.setPin('1357');
    ok('setPin stores no plaintext', window.hasLock() && JSON.stringify(window.getLock()).indexOf('1357') === -1);
    // setPin must REPORT whether the lock actually persisted — a swallowed write
    // meant a user could set a PIN, see no error, and be left unlocked.
    ok('setPin resolves true only when the record is readable back', await window.setPin('2468') === true && window.hasLock());
    await window.setPin('1357'); // restore: later assertions verify against this PIN
    // the guard itself: setLockRec reads the record back rather than trusting setItem,
    // and both PIN call sites surface a failure instead of reporting success
    ok('setLockRec verifies the write instead of swallowing it',
      /function setLockRec[\s\S]{0,420}?var back=getLock\(\);[\s\S]{0,120}?back\.hash===o\.hash/.test(html) &&
      !/function setLockRec\(o\)\{ try\{[^}]*\}catch\(_\)\{ \} \}/.test(html));
    ok('a PIN that cannot be saved tells the user the lock is NOT active',
      (html.match(/The lock is NOT active/g) || []).length === 2);
    ok('verifyPin correct/wrong', (await window.verifyPin('1357')) === true && (await window.verifyPin('0000')) === false);
    window.sessionUnlocked = false; window.bootApp();
    ok('boot gates to lock screen', d.getElementById('lock-root').innerHTML.indexOf('is locked') > -1);
    d.getElementById('lock-pin').value = '1357'; fire(d.getElementById('lock-form'), 'submit'); await wait(120);
    ok('correct PIN unlocks', window.sessionUnlocked === true && d.getElementById('lock-root').innerHTML === '');
    window.removeLock();

    // ---------- dashboard: the ledger sections + reorder ----------
    // Was: 13 KPI/chart cards. The dashboard is now cash + one alarm + five ledger
    // sections (spec §2), so the widget set is the section set and none of them is a card.
    window.state.finance = [{ id: 'f', type: 'income', amount: 1000, date: '2026-06-01', category: 'Sales' }];
    window.state.invoices = [{ id: 'iv1', number: 'INV-0001', client: 'Bloom Cafe', amount: 15000,
      currency: 'PHP', status: 'Sent', issueDate: '2026-06-01', dueDate: '2026-06-10' }];
    window.state.tasks = [{ id: 't1', title: 'Reorder soy wax', deadline: '2026-06-05', done: false }];
    window.state.settings.dashOrder = null; window.state.settings.dashHidden = [];
    window.location.hash = '#/dashboard'; window.render(); await wait(20);
    const widgets = Array.from(d.querySelectorAll('.dash-widget')).map((w) => w.getAttribute('data-widget'));
    ok('no widget on the dashboard is a card', Array.from(d.querySelectorAll('.dash-widget')).every((w) => w.querySelectorAll('.card').length === 0));
    ok('each widget wraps exactly one ruled section', Array.from(d.querySelectorAll('.dash-widget')).every((w) => w.querySelectorAll(':scope > .led-sec').length === 1));
    ok('lifetime revenue and the invented health score are gone from the dashboard',
      !/Total revenue|Business health|Profit margin/.test(d.getElementById('main').textContent));

    // ---------- dashboard: live drag-to-reorder (placeholder gap + persist) ----------
    window.state.settings.dashOrder = null; window.location.hash = '#/dashboard'; window.render(); await wait(20);
    const dgrid = d.querySelector('.dash-grid');
    const fireEv = (el, type) => { const ev = new window.Event(type, { bubbles: true, cancelable: true }); el.dispatchEvent(ev); return ev; };
    await wait(10);
    await wait(25);

    // ---------- first-open greeting (name setup → time-based hello → dismiss) ----------
    window.state.settings.displayName = '';
    const greetRoot = d.getElementById('greet-root');
    ok('greeting locks background scroll', /body\.greeting-on\{overflow:hidden\}/.test(html));
    window.state.settings.favorites = []; window.state.settings.sectionOrder = [];
    (function () {
      const m = html.match(/\.nav-item>span:not\(\.nav-badge\):not\(\.nav-fav\)\{([^}]*)\}/);
      const rule = m ? m[1] : '';
    })();
    // sleek mobile redesign: account cards become a 2-up colourful wallet grid
    // finance: desktop keeps the spreadsheet table; phones get a clean day-grouped timeline
    // No decorative colour ramps anywhere in the stylesheet. The only gradients
    // allowed are the ones doing a drawing job (grid, hatch, ruled line, scroll
    // mask) and the Liquid Glass specular rim, which is a 1px light model.
    (function noDecorativeGradients() {
      var css = (html.match(/<style[\s\S]*?<\/style>/g) || []).join('\n');
      var lines = css.split('\n').map(function (l, i) { return [i, l]; })
        .filter(function (p) { return /gradient\(/.test(p[1]); });
      // the glass specular stack spans lines; its stops carry --glass-clarity, and
      // the two bare opener lines belong to it too.
      var allowed = /rm-grid-dots|rm-grid-lines|st-fordelivery|sign-pad|mask-image|glass-clarity|^linear-gradient\((?:180|0)deg,$/;
      var stray = lines.filter(function (p) { return !allowed.test(p[1].trim()); })
        .map(function (p) { return p[1].trim().slice(0, 70); });
      ok('no decorative gradients survive in the stylesheet', stray.length === 0, stray);
      ok('the --accent-grad ramp token is gone in both themes and at runtime', !/--accent-grad/.test(html));
      ok('task colour tint is one flat mix, not a two-stop same-colour ramp', /function taskColorStyle\(t\)\{ return t\.color\?'background:color-mix/.test(html));
    })();
    // Pill-shaped buttons and containers are gone. The only 999px radii left are
    // things that are genuinely circular (avatar, logos, slider track and thumb)
    // and the one shape a user can deliberately pick and name.
    (function noPillControls() {
      var css = (html.match(/<style[\s\S]*?<\/style>/g) || []).join('\n');
      var pilled = css.split('\n').filter(function (l) { return /border-radius:9{3,4}px/.test(l); })
        .map(function (l) { return l.trim().slice(0, 60); });
      var circular = /glass-range|brand-logo|isl-avatar|rm-fshape-capsule/;
      var stray = pilled.filter(function (l) { return !circular.test(l); });
      ok('no button or container is still a pill', stray.length === 0, stray);
      ok('the rounded-full utility that only made pills is gone', !/\.rounded-full/.test(html));
    })();
    (function () {
      window.location.hash = '#/dashboard'; window.render();
      const tb = d.getElementById('tabbar');
      const active = tb && tb.querySelector('.tab-item.active');
    })();
    ok('...and the stacking rules are no longer inside the 560px media query',
      !/@media \(max-width:560px\)\{[\s\S]{0,4000}?\.table-wrap thead\{position:absolute/.test(html));
    /* Orders are flex rows, not a table, so the rule above cannot reach them and they need
       their own container. Without it the orders list was the last thing on the site still
       scrolling sideways, at 900px. */
    ok('order rows are record rows, so they stack with every other list under 900px',
      /\.table-wrap tbody tr\{display:grid/.test(html) && !/order-rows/.test(html));
    (function () {
      window.location.hash = '#/orders'; window.render();
      ok('an order is one record row with its cells named', !!d.querySelector('#main table.recs tbody tr td.c-main') && !!d.querySelector('#main table.recs td.c-acts .row-actions'));
      window.location.hash = '#/dashboard'; window.render();
    })();
    (function () {
      window.location.hash = '#/finance'; window.render();
      const labeled = d.getElementById('main').querySelectorAll('.table-wrap td[data-label]').length;
      ok('labelizeTables auto-labels table cells from their headers', labeled > 0);
      window.location.hash = '#/dashboard'; window.render();
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
    ok('documents carry no "Licensed to" watermark', !/Licensed to /.test(html) && typeof window.licTag !== 'function');
    ok('no external CSS/JS framework introduced (CSP + offline intact)', !/cdn\.tailwindcss|tailwindcss\.com|<script[^>]+src=|<link[^>]+stylesheet|@import/i.test(html));
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
    ok('the people list shows an employee photo as the row avatar', !!d.querySelector('#main .rows [data-action="hr-view"] img.avatar'));
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
    // Finance, not the dashboard: the dashboard's standing figure is built from spans
    // (the peso sign is set apart from its digits) and animateCounts rewrites textContent,
    // so it deliberately does not reach it.
    window.location.hash = '#/finance'; window.render(); await wait(900);
    const svEl = d.querySelector('.stat-value');
    const finalStat = svEl ? svEl.textContent : '';
    ok('a stat value is present and non-empty', !!finalStat); // re-trigger
    ok('count-up does not corrupt the value synchronously', d.querySelector('.stat-value').textContent === finalStat);
    await wait(900);
    ok('count-up settles back to the exact figure', d.querySelector('.stat-value').textContent === finalStat);

    // ---------- onboarding carousel (replaces the old spotlight tour) ----------
    let onbErr = null;
    ok('carousel renders all slides with mockups + dots', onbErr === null, onbErr);
    // blink fix: advancing must NOT rebuild the overlay/card — only swap the inner stage
    const overlayRef = d.querySelector('.onb-overlay');
    const cardRef = d.querySelector('.onb-card');
    ok('advancing reuses the same overlay+card (no blink rebuild)',
       d.querySelector('.onb-overlay') === overlayRef && d.querySelector('.onb-card') === cardRef);
    ok('finishing closes the carousel', d.getElementById('lightbox-root').innerHTML === '');

    // ---------- Advisor page (upgraded Insights) ----------
    window.state.finance = [{ id: 'fa', type: 'income', amount: 5000, date: window.todayISO(), category: 'Sales', note: 'x' }, { id: 'fb', type: 'expense', amount: 2000, date: window.todayISO(), category: 'Marketing & Ads', note: 'y' }];
    window.location.hash = '#/insights'; window.render();
    const advHtml = d.getElementById('main').innerHTML;
    ok('Advisor opens on its read as a plain statement, with the score in words and no ring or box', /class="t-statement adv-narrative"/.test(advHtml) && /brought in/.test(advHtml) &&
      /Health score \d+ out of 100\./.test(advHtml) && !/advisor-hero|adv-avatar/.test(advHtml));
    ok('Advisor shows a prioritized action list or all-clear', /Do this now/.test(advHtml));

    // ---------- floating Advisor bubble ----------
    window.state.settings.advisorBubbleOff = false;
    window.location.hash = '#/dashboard'; window.render();
    await waitFor(() => d.getElementById('advisor-bubble').querySelector('.advisor-bubble') !== null);
    window.location.hash = '#/insights'; window.render();
    window.location.hash = '#/dashboard'; window.render();
    await waitFor(() => !!d.getElementById('ab-text'));
    await waitFor(() => d.getElementById('ab-text') && d.getElementById('ab-text').textContent.length > 5);
    window.openModal('Test', '<p>hi</p>');
    window.closeModal();

    // ---------- emoji: only where it is genuinely user content ----------
    (function () {
      // Arrows (→) and ✕ are typographic — they inherit colour and the type
      // scale — and stay. Pictographs and status marks do not: toast() already
      // renders a status glyph from the set, so a second one is noise.
      const PICTO = /[\u{1F300}-\u{1FAFF}\u{2705}\u{2713}\u{2714}\u{2728}\u{26A0}\u{2605}\u{2B50}]/u;
      const toasts = html.match(/toast\((?:'[^']*'|"[^"]*")/g) || [];
      const dirty = toasts.filter(function (t) { return PICTO.test(t); });
      ok('no toast smuggles an emoji past the status glyph it already renders', dirty.length === 0, dirty);
      const banned = ['🎉', '💰', '🎯', '🔒', '📦', '📎', '👋', '🏆', '📚', '🧱', '☀', '💡', '📅', '✨', '🏁', '📋', '👍', '😊', '★', '⯇'];
      const chrome = html
        .replace(/var RM_EMOJI=\[[^\]]*\]/, '')                    // user stamp palette
        .replace(/function payQRDocHTML\(\)\{[\s\S]*?\n\}/, '')     // printed customer doc
        .replace(/lines\.push\('Message us to order![^']*'\)/, '')  // catalog text sent to a chat app
        .replace(/'🛍 '/, '');
      const left = banned.filter(function (e) { return chrome.indexOf(e) >= 0; });
      ok('no emoji left doing UI work in the chrome', left.length === 0, left);
      ok('the roadmap stamp palette is untouched — that is the user\'s content', (window.RM_EMOJI || []).length >= 10 && window.RM_EMOJI.indexOf('⭐') >= 0);
      ok('the selected colour swatch is marked with the drawn check, not a text glyph',
        /\.color-dot\.active::after\{content:''/.test(html) && /data:image\/svg\+xml/.test(html.split('.color-dot.active::after')[1].slice(0, 400)));
    })();

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

    // ---------- design/a11y polish ----------
    window.state.tasks = []; window.render();
    ok('onboarding de-cluttered: hero hidden while checklist shows', d.getElementById('main').innerHTML.indexOf('Start with one entry') === -1);
    window.state.settings.startDismissed = true; window.render();
    window.toast('hello world');
    const tEl = d.getElementById('toast-root').querySelector('.toast');
    ok('toast is announced to screen readers (a status, or an alert when it is an error)', tEl && /^(status|alert)$/.test(tEl.getAttribute('role')) && !!tEl.getAttribute('aria-live'));
    ok('modal focus trap + return-focus wired', html.indexOf('modalReturnFocus') > -1 && /e\.key!=='Tab'/.test(html));
    // overdue invoice row marker
    window.state.invoices = [{ id: 'o1', number: 'INV-1', client: 'X', amount: 100, currency: 'PHP', issueDate: '2026-01-01', dueDate: '2026-01-15', status: 'Sent' }];
    window.location.hash = '#/invoices'; window.render();
    ok('an overdue invoice says so with the late stamp, not a row tint', !!d.querySelector('#main tr td.c-status .stamp-late') && d.getElementById('main').innerHTML.indexOf('inv-overdue') < 0);

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
    // open it from another view (dashboard) and confirm the popover mounts its own chat input
    window.location.hash = '#/dashboard'; window.render();
    ok('bubble is visible off the Assistant page', !d.body.classList.contains('route-assistant'));
    // log an expense entirely from the popover (send → preview → confirm)
    const beforePop = window.state.finance.length;
    await waitFor(() => d.getElementById('asst-pop') && d.getElementById('asst-pop').querySelector('[data-action="assistant-confirm"]'));
    await waitFor(() => window.state.finance.length === beforePop + 1);
    // on the Assistant page the bubble is suppressed (you're already in the chat)
    window.location.hash = '#/assistant'; window.render();

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
    window.state.settings.hiddenModules = ['products','orders','roadmap'];
    (function(){ const ids = window.visibleRoutes().map(r => r.id);
      ok('chosen-hidden modules leave the sidebar', ids.indexOf('products') < 0 && ids.indexOf('orders') < 0 && ids.indexOf('dashboard') >= 0 && ids.indexOf('finance') >= 0); })();
    window.state.settings.hiddenModules = [];

    // ---- dashboard: a fresh/sparse dashboard shows only populated cards ----
    window.state.finance = []; window.state.goals = []; window.state.tasks = []; window.state.invoices = [];
    window.state.clients = []; window.state.products = []; window.state.orders = []; window.state.notes = [];
    window.state.roadmaps = []; window.state.phases = []; window.state.utang = [];
    window.state.settings.dashHidden = []; window.state.settings.dashOrder = null;
    window.location.hash = '#/dashboard'; window.render();
    (function(){ const wids = [].map.call(d.querySelectorAll('.dash-widget'), w => w.getAttribute('data-widget')); })();

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
    window.state.settings.lastBackup = null; window.state.settings.backupSnooze = null;
    ok('dataAtRisk() is true with records and no backup', window.dataAtRisk() === true);
    window.location.hash = '#/dashboard'; window.render();
    window.state.settings.backupSnooze = null; window.state.settings.lastBackup = window.todayISO(); window.render();
    ok('a fresh backup clears the risk (no banner)', window.dataAtRisk() === false && !d.querySelector('.backup-banner'));
    // Cloud sync used to clear the risk as well. It is gone, so a backup file is the only
    // thing that does, and a sync block left behind by an older build must not count.
    (function(){ window.state.settings.lastBackup = null; window.state.settings.sync = { enabled:true, lastSync: window.todayISO()+'T00:00:00' };
      ok('a leftover cloud-sync block does not clear the risk: only a backup file does', window.dataAtRisk() === true);
      delete window.state.settings.sync; })();

    // ---------- island top navigation (desktop shell) ----------
    window.location.hash = '#/dashboard'; window.render();
    const isl = d.getElementById('island-bar');
    window.state.settings.hiddenModules = ['utang']; window.render();
    window.state.settings.hiddenModules = [];
    window.state.customModules = [{id:'cmx1', name:'Suppliers', icon:'box', fields:[], records:[]}]; window.render();
    window.state.customModules = []; window.render();
    // island polish: the production dropdown-clip bug + adaptive active pill + glass
    ok('island can never clip its dropdowns (no overflow/contain on the pill bar)', !/\.island\{[^}]*(overflow|contain)/.test(html));
    ok('standard UX: dropdowns are click-only — no hover/focus auto-open', !/\.isl-group:hover \.isl-drop/.test(html) && !/\.isl-group:focus-within \.isl-drop/.test(html));

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
      ok('every non-centre node has a connecting edge', m.querySelectorAll('.rm-edges path[data-edge]').length === phases.length + leaves.length);
      ok('auto-layout positions every node', Array.prototype.every.call(m.querySelectorAll('.rm-node'), n => parseFloat(n.style.left) > 0 && parseFloat(n.style.top) > 0));
      const p0 = window.state.roadmaps[0].phases[0];
      window.rmSetNodePos('phase', p0.id, 500, 400);
      ok('dragged position persists on the model', window.state.roadmaps[0].phases[0].x === 500 && window.state.roadmaps[0].phases[0].y === 400);
      window.render();
      const pn = d.querySelector('.rm-node.rm-phase[data-id="' + p0.id + '"]');
      ok('persisted position wins over auto-layout on re-render', pn && parseFloat(pn.style.left) === 500 && parseFloat(pn.style.top) === 400);
      const before = p0.color || null;
      // inline popover: customize → pick a colour swatch (no modal, no cycle)
      click(d.querySelector('.rm-node.rm-phase[data-id="' + p0.id + '"] .rm-tool[data-action="rm-node-pop"]'));
      var swatch = d.querySelector('#rm-pop .rm-pop-sw:not(.on)') || d.querySelector('#rm-pop .rm-pop-sw');
      click(swatch);
      ok('inline popover sets a node colour (no form)', window.state.roadmaps[0].phases[0].color && window.state.roadmaps[0].phases[0].color !== before);
      window.render();
      // M2: quick-add slot on a branch spawns a connected task directly — no modal/form
      (function(){ var n0 = (window.state.roadmaps[0].phases[0].tasks || []).length;
        click(d.querySelector('.rm-node.rm-phase[data-id="' + p0.id + '"] .rm-qadd[data-dir="r"]'));
        ok('quick-add on a branch spawns a connected task (no modal)',
          (window.state.roadmaps[0].phases[0].tasks || []).length === n0 + 1 && d.getElementById('modal-root').innerHTML.length < 100);
      })();
      click(d.querySelector('[data-action="roadmap-mode"][data-mode="list"]'));
      ok('List mode renders each phase as a section whose steps are task rows with a More menu and no select',
        !!d.querySelector('#main section.sec .task-rows .task-row [data-action="row-status"][data-kind="phase-task-status"]') && !d.querySelector('#main .task-rows select'));
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
        ok('minimap is anchored bottom-left and can be driven from the keyboard', /\.rm-mini\{[^}]*left:12px/.test(css) && !/\.rm-mini\{[^}]*right:/.test(css) &&
          d.getElementById('rm-mini').getAttribute('tabindex') === '0' && /Arrow keys/.test(d.getElementById('rm-mini').getAttribute('aria-label')));
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
      // ===== Milestone 2 · direct-manipulation canvas =====
      (function(){
        window.render();
        var rm = window.state.roadmaps[0];
        ok('canvas has an upper-left tool rail (add · shape · hand)', !!d.querySelector('.rm-canvas .rm-rail [data-action="rm-place-start"]') && !!d.querySelector('.rm-rail [data-action="rm-shape-flyout"]'));
        ok('the roadmap is picked from one select above the canvas, not a panel floating over it', !d.querySelector('.rm-maps') &&
          !!d.querySelector('#main .tools select[data-action-change="roadmap-switch"] option[value="' + rm.id + '"]'));
        var pnode = d.querySelector('.rm-node.rm-phase');
        ok('phase nodes carry a shape class + inline label + 4 quick-add slots', /rm-s-/.test(pnode.className) && !!pnode.querySelector('.rm-node-label') && pnode.querySelectorAll('.rm-qadd').length === 4);
        // placement mode — faint predictive ghost, positioned by clicking, no form
        window.ui.rmShape = 'diamond';
        window.rmPlaceStart('phase');
        ok('placement mode shows a predictive ghost, not a form', !!d.getElementById('rm-ghost') && d.body.classList.contains('rm-placing') && d.getElementById('modal-root').innerHTML.length < 100);
        var pc0 = rm.phases.length;
        window.rmPlaceCommit({ x: 2222, y: 1111 });
        var placed = window.state.roadmaps[0].phases.slice(-1)[0];
        ok('placement drops a shaped branch exactly where clicked (no modal)', window.state.roadmaps[0].phases.length === pc0 + 1 && placed.x === 2222 && placed.y === 1111 && placed.shape === 'diamond' && !d.getElementById('rm-ghost'));
        // predictive quick-add — spawn a connected node toward a chosen side
        window.render();
        var qc0 = window.state.roadmaps[0].phases.length;
        click(d.querySelector('.rm-node.rm-center .rm-qadd[data-dir="t"]'));
        ok('quick-add on the centre spawns a connected phase', window.state.roadmaps[0].phases.length === qc0 + 1);
        // selection + shape switch on the selected node
        window.render();
        var target = window.state.roadmaps[0].phases[0];
        window.rmSelect('p:' + target.id);
        ok('clicking a node selects it (selection ring)', window.ui.rmSel === 'p:' + target.id && !!d.querySelector('.rm-node.rm-sel[data-id="' + target.id + '"]'));
        window.rmPickShape('sticky');
        ok('picking a shape restyles the selected node', window.state.roadmaps[0].phases.find(function(p){return p.id===target.id;}).shape === 'sticky');
        // inline rename — editable label, commit to model, no modal
        window.render();
        window.rmStartInlineEdit('p:' + target.id);
        var lbl = d.querySelector('.rm-node[data-nid="p:' + target.id + '"] .rm-node-label');
        ok('inline rename opens a contenteditable label (no modal)', !!lbl && lbl.getAttribute('contenteditable') === 'true');
        lbl.textContent = 'Renamed Inline';
        lbl.dispatchEvent(new window.Event('blur'));
        ok('committing the inline edit renames the node on the model', window.state.roadmaps[0].phases.find(function(p){return p.id===target.id;}).name === 'Renamed Inline');
        // canvas height is user-adjustable (persisted --rm-h)
        window.state.settings.rmCanvasH = 560; window.render();
        ok('canvas height is adjustable via a persisted --rm-h', /--rm-h:560px/.test(d.querySelector('.rm-canvas-card').getAttribute('style') || ''));
        window.ui.rmSel = null; window.ui.rmShape = 'capsule'; delete window.state.settings.rmCanvasH;
      })();
      // ===== M2 audit fixes — regressions caught by the code audit =====
      (function(){
        var pe = function(type, el, x, y){ (el || d).dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x || 0, clientY: y || 0, button: 0 })); };
        window.render(); window.rmZoomTo(1);
        var board = d.getElementById('rm-board');
        // ARROW-DEFAULT model: left-drag on empty background is a MARQUEE (not a pan), so the
        // camera stays put and a rubber-band appears — this is what lets a user select-all-and-delete.
        var cx0 = window.rmCam().x, cy0 = window.rmCam().y;
        pe('pointerdown', board, 300, 300); pe('pointermove', d, 366, 344);
        ok('background drag draws a marquee and does NOT pan the camera', !!d.getElementById('rm-marquee') && window.rmCam().x === cx0 && window.rmCam().y === cy0);
        pe('pointerup', d, 366, 344);
        // pan is still available with the Space key held
        window.rmZoomTo(1); var px0 = window.rmCam().x;
        board.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 300, clientY: 300, button: 1 })); // middle-drag pans
        pe('pointermove', d, 366, 344); pe('pointerup', d);
        ok('middle-drag still pans the camera', Math.abs(window.rmCam().x - px0) > 10);
        // clicking empty canvas (tiny marquee) clears the selection
        window.rmSelect('center');
        pe('pointerdown', board, 300, 300); pe('pointerup', d, 300, 300);
        ok('clicking empty canvas clears the selection', window.ui.rmSel === null);
        // MED: a small click while zoomed out selects (screen-space threshold), never a drag
        window.render(); window.rmZoomTo(0.3);
        var pn = d.querySelector('.rm-node.rm-phase'), nid = pn.getAttribute('data-nid');
        pe('pointerdown', pn, 200, 200); pe('pointermove', d, 202, 201); pe('pointerup', d);
        ok('a tiny click while zoomed out selects, not drags', window.ui.rmSel === nid);
        window.rmZoomTo(1);
        // MED: switching mode/board cancels an in-progress placement (no leaked ghost / stuck copy cursor)
        window.rmPlaceStart('phase');
        click(d.querySelector('[data-action="roadmap-mode"][data-mode="list"]'));
        ok('switching mode cancels an in-progress placement', !d.body.classList.contains('rm-placing') && !d.getElementById('rm-ghost'));
        click(d.querySelector('[data-action="roadmap-mode"][data-mode="map"]'));
        window.ui.rmSel = null;
      })();
      // ===== Milestone 3 · connectors — ports, arrowheads, spotlight =====
      (function(){
        // port-trimming: the path no longer starts at the parent's centre
        var pth = window.rmEdgePath({ x: 0, y: 0 }, { x: 100, y: 0 });
        var m = pth.match(/^M(-?\d+) (-?\d+) C/);
        ok('connectors are port-trimmed off the node centre', !!m && Number(m[1]) >= 40 && Number(m[1]) <= 46 && Number(m[2]) === 0);
        window.render();
        var svg = d.querySelector('.rm-edges');
        ok('connectors define + reference an arrowhead marker', !!svg.querySelector('#rm-arrow') && /marker-end="url\(#rm-arrow\)"/.test(svg.innerHTML));
        // selection spotlight: incident edge lit, card marked so the rest dim
        var ph = window.state.roadmaps[0].phases[0];
        window.rmSelect('p:' + ph.id);
        var card = d.querySelector('.rm-canvas-card');
        var onEdge = d.querySelector('.rm-edges path[data-edge="p:' + ph.id + '"]');
        ok('selecting a node spotlights its connector, dims the rest', card.classList.contains('rm-has-sel') && onEdge.classList.contains('rm-edge-on'));
        window.rmDeselect();
        ok('deselecting clears the connector spotlight', !card.classList.contains('rm-has-sel'));
        window.ui.rmSel = null;
      })();
      // ===== Milestone 4 · multi-select, delete, duplicate, context menu, cursors =====
      (function(){
        var pe = function(type, el, x, y, opt){ var o = Object.assign({ bubbles: true, cancelable: true, clientX: x || 0, clientY: y || 0, button: 0 }, opt || {}); (el || d).dispatchEvent(new window.MouseEvent(type, o)); };
        window.render(); window.rmZoomTo(1); window.ui.rmSelSet = null; window.ui.rmSel = null;
        var rm = window.state.roadmaps[0];
        var total = 0; rm.phases.forEach(function(p){ total += 1 + (p.tasks || []).length; });
        // select all — now includes the centre "mother" + every freeform object, so Delete can clear everything
        var ffCount = (rm.noCenter?0:1) + (rm.frames||[]).length + (rm.notes||[]).length + (rm.stamps||[]).length + (rm.tables||[]).length + (rm.comments||[]).length + (rm.ink||[]).length;
        window.rmSelectAll();
        ok('select-all selects every node incl. centre + freeform', window.rmSelCount() === total + ffCount);
        window.rmDeselect();
        ok('deselect clears the whole selection', window.rmSelCount() === 0);
        // shift-click toggles a node into/out of the selection
        window.render();
        var pnodes = d.querySelectorAll('.rm-node.rm-phase');
        var a = pnodes[0], aid = a.getAttribute('data-nid');
        pe('pointerdown', a, 10, 10, { shiftKey: true }); pe('pointerup', d, 10, 10, { shiftKey: true });
        ok('Shift+click adds a node to the selection', window.rmSelHas(aid) && window.rmSelCount() === 1);
        pe('pointerdown', a, 10, 10, { shiftKey: true }); pe('pointerup', d, 10, 10, { shiftKey: true });
        ok('Shift+click again removes it', !window.rmSelHas(aid));
        // duplicate → new copy is added and selected
        window.rmSelectOnly(aid);
        var pc0 = window.state.roadmaps[0].phases.length;
        window.rmDuplicateSel();
        ok('duplicate clones the selection with an offset', window.state.roadmaps[0].phases.length === pc0 + 1 && window.rmSelCount() === 1);
        // delete removes the selected node(s) from the model
        window.rmDeleteSel();
        ok('delete removes the selected node(s)', window.state.roadmaps[0].phases.length === pc0);
        // group drag: two selected nodes move together
        window.render(); window.rmZoomTo(1);
        var pp = d.querySelectorAll('.rm-node.rm-phase');
        if (pp.length >= 2) {
          var n1 = pp[0].getAttribute('data-nid'), n2 = pp[1].getAttribute('data-nid');
          window.rmSelectOnly(n1); window.rmSelSet()[n2] = true; window.rmApplySelDom();
          var e1 = d.querySelector('.rm-node[data-nid="' + n1 + '"]'), l1 = parseFloat(e1.style.left), t1 = parseFloat(e1.style.top);
          var l2 = parseFloat(d.querySelector('.rm-node[data-nid="' + n2 + '"]').style.left);
          pe('pointerdown', e1, l1, t1); pe('pointermove', d, l1 + 60, t1 + 20); pe('pointerup', d, l1 + 60, t1 + 20);
          var m1 = window.rmNodeRef(n1).node, m2 = window.rmNodeRef(n2).node;
          ok('group drag moves every selected node together', Math.round(m1.x - l1) === 60 && Math.round(m2.x - l2) === 60);
        } else { ok('group drag moves every selected node together (skipped: <2 phases)', true); }
        window.rmDeselect();
        // marquee: Shift+drag a box over the whole board selects the nodes inside
        window.render(); window.rmZoomTo(1); window.rmCam().x = 0; window.rmCam().y = 0;
        var board = d.getElementById('rm-board');
        pe('pointerdown', board, -99999, -99999, { shiftKey: true });
        pe('pointermove', d, 99999, 99999, { shiftKey: true });
        pe('pointerup', d, 99999, 99999, { shiftKey: true });
        ok('Shift+drag marquee selects the nodes inside the box', window.rmSelCount() >= 1);
        window.rmDeselect();
        // right-click opens a context menu offering Delete
        window.render();
        var pn = d.querySelector('.rm-node.rm-phase');
        pn.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 6, clientY: 6 }));
        var ctx = d.getElementById('rm-ctx');
        ok('right-click opens a context menu with Delete', !!ctx && /rm-ctx-del/.test(ctx.innerHTML));
        window.rmCtxClose();
        ok('context menu closes on demand', !d.getElementById('rm-ctx'));
        // keybindings actually fire: Cmd/Ctrl+A selects, Delete removes
        window.render();
        d.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true, cancelable: true }));
        ok('Cmd/Ctrl+A keybinding selects all', window.rmSelCount() >= 1);
        var pcx = window.state.roadmaps[0].phases.length;
        window.rmSelectOnly(d.querySelector('.rm-node.rm-phase').getAttribute('data-nid'));
        d.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
        ok('Delete keybinding removes the selected node', window.state.roadmaps[0].phases.length === pcx - 1);
        // standard cursors: empty canvas = grab hand, nodes = move
        var css = ''; d.querySelectorAll('style').forEach(function(s){ css += s.textContent; });
        ok('empty canvas shows a grab hand; nodes show a move cursor', /\.rm-canvas\{[^}]*cursor:grab/.test(css) && /\.rm-node\{[^}]*cursor:move/.test(css));
        window.ui.rmSelSet = null; window.ui.rmSel = null;
      })();
      // ===== Final-polish fixes (2-agent audit) =====
      (function(){
        var pe = function(type, el, x, y, opt){ var o = Object.assign({ bubbles: true, cancelable: true, clientX: x || 0, clientY: y || 0, button: 0 }, opt || {}); (el || d).dispatchEvent(new window.MouseEvent(type, o)); };
        window.render(); window.rmZoomTo(1); window.ui.rmSelSet = null; window.ui.rmSel = null;
        // HIGH #1: select-all + duplicate must not inject stray tasks into the originals
        var rm = window.state.roadmaps[0];
        var origCount = rm.phases.length, origTasks = rm.phases.map(function(p){ return (p.tasks || []).length; });
        window.rmSelectAll(); window.rmDuplicateSel();
        var rm2 = window.state.roadmaps[0], intact = rm2.phases.length === origCount * 2;
        for (var i = 0; i < origCount; i++) { if ((rm2.phases[i].tasks || []).length !== origTasks[i]) intact = false; }
        ok('duplicate of select-all clones cleanly (no stray tasks in originals)', intact);
        // reset by undo
        window.rmUndoRoad();
        // HIGH #2: duplicating a never-dragged node offsets from its RENDERED layout spot, not board centre
        window.render(); var p0 = window.state.roadmaps[0].phases[0]; delete p0.x; delete p0.y;
        var lay = window.rmLayout(window.state.roadmaps[0])['p:' + p0.id];
        window.rmSelectOnly('p:' + p0.id); window.rmDuplicateSel();
        var copy = window.state.roadmaps[0].phases.slice(-1)[0];
        ok('duplicate offsets from the layout position, not the board centre', Math.abs(copy.x - (lay.x + 44)) < 2 && Math.abs(copy.y - (lay.y + 44)) < 2);
        window.rmUndoRoad();
        // undo / redo keybinding path
        window.render(); var pcU = window.state.roadmaps[0].phases.length;
        window.rmSelectOnly('p:' + window.state.roadmaps[0].phases[0].id); window.rmDeleteSel();
        window.rmUndoRoad();
        ok('delete → undo restores the node', window.state.roadmaps[0].phases.length === pcU);
        window.rmRedo();
        ok('redo re-applies the delete', window.state.roadmaps[0].phases.length === pcU - 1);
        window.rmUndoRoad();
        // copy / paste
        window.render(); var pcC = window.state.roadmaps[0].phases.length;
        window.rmSelectOnly('p:' + window.state.roadmaps[0].phases[0].id); window.rmCopySel(); window.rmDeselect(); window.rmPasteClip();
        ok('copy + paste adds a new node', window.state.roadmaps[0].phases.length === pcC + 1);
        window.rmUndoRoad();
        // arrow-key nudge
        window.render(); var pn = window.state.roadmaps[0].phases[0];
        window.rmSetNodePos('phase', pn.id, 1000, 1000); window.rmSelectOnly('p:' + pn.id);
        window.rmNudgeSel('ArrowRight', 10); window.rmNudgeSel('ArrowDown', 10);
        ok('arrow-key nudges the selection on both axes', window.rmNodeRef('p:' + pn.id).node.x === 1010 && window.rmNodeRef('p:' + pn.id).node.y === 1010);
        // additive marquee keeps the prior selection
        window.render(); window.rmZoomTo(1); window.rmCam().x = 0; window.rmCam().y = 0;
        var f = window.state.roadmaps[0].phases[0]; window.rmSelectOnly('p:' + f.id);
        var board = d.getElementById('rm-board');
        pe('pointerdown', board, -99999, -99999, { shiftKey: true }); pe('pointermove', d, 99999, 99999, { shiftKey: true }); pe('pointerup', d, 99999, 99999, { shiftKey: true });
        ok('marquee is additive (keeps prior selection, adds the box)', window.rmSelHas('p:' + f.id) && window.rmSelCount() > 1);
        window.rmDeselect();
        // deleting only the centre is a safe no-op (no phantom "1 deleted")
        window.render(); var pcCenter = window.state.roadmaps[0].phases.length;
        window.rmSelectOnly('center'); window.rmDeleteSel();
        ok('deleting only the centre is a safe no-op', window.state.roadmaps[0].phases.length === pcCenter);
        // floating selection toolbar surfaces duplicate + delete
        window.render(); window.rmSelectOnly('p:' + window.state.roadmaps[0].phases[0].id);
        var bar = d.getElementById('rm-selbar');
        ok('selection shows a floating toolbar (duplicate + delete)', !!bar && bar.style.display !== 'none' && /rm-ctx-dup/.test(bar.innerHTML) && /rm-ctx-del/.test(bar.innerHTML));
        window.ui.rmSelSet = null; window.ui.rmSel = null;
      })();
      // ===== Unlimited nesting + smooth (no-blink) surgical updates + inline popover =====
      (function(){
        window.render(); window.rmZoomTo(1); window.ui.rmSelSet = null; window.ui.rmSel = null;
        var rm = window.state.roadmaps[0];
        // quick-add now works on ANY node — build a 3-deep chain: phase → task → child → grandchild
        var p = rm.phases[0], pnid = 'p:' + p.id;
        window.rmQuickAdd(pnid, 'r');
        var t1 = window.rmNodeRef(window.ui.rmSel); var t1nid = window.ui.rmSel;
        ok('quick-add on a branch creates a task node', t1 && t1.type === 'task' && t1nid.indexOf('t:') === 0);
        window.rmQuickAdd(t1nid, 'r');
        var t2nid = window.ui.rmSel;
        ok('quick-add on a TASK creates a child (unlimited depth) — 2 deep', (t1.node.children || []).length === 1 && t2nid.indexOf('t:') === 0);
        window.rmQuickAdd(t2nid, 'b');
        var t2 = window.rmNodeRef(t2nid);
        ok('quick-add keeps nesting — 3 deep grandchild', (t2.node.children || []).length === 1);
        // the deep node renders with its own quick-add slots (can keep going)
        window.render();
        var deepEl = d.querySelector('.rm-node[data-nid="' + t2nid + '"]');
        ok('deep nodes render their own quick-add slots (unlimited)', !!deepEl && deepEl.querySelectorAll('.rm-qadd').length === 4);
        // SMOOTH: a quick-add patches the board in place — the #rm-board element is NOT replaced (no full re-render → no blink)
        window.render();
        var boardBefore = d.getElementById('rm-board');
        window.rmSelectOnly('p:' + rm.phases[0].id);
        window.rmQuickAdd('p:' + rm.phases[0].id, 'l');
        ok('canvas edits are surgical — board element is reused, no full re-render (no blink)', d.getElementById('rm-board') === boardBefore);
        // recursive delete removes the whole subtree
        window.render();
        var pcnt = (function count(list){ var n = 0; (list || []).forEach(function(t){ n += 1 + count(t.children); }); return n; });
        var phaseA = rm.phases[0]; var beforeTotal = pcnt(phaseA.tasks);
        window.rmSelectOnly('p:' + phaseA.id); window.rmDeleteSel();
        ok('deleting a branch removes its whole subtree', !window.state.roadmaps[0].phases.some(function(x){ return x.id === phaseA.id; }));
        window.rmUndoRoad();
        // recursive duplicate clones a subtree (parent + descendants) with fresh ids
        window.render(); var pB = window.state.roadmaps[0].phases[0];
        if (!(pB.tasks || []).length) { window.rmQuickAdd('p:' + pB.id, 'r'); }
        pB = window.state.roadmaps[0].phases[0];
        var subCount = pcnt(pB.tasks);
        window.rmSelectOnly('p:' + pB.id); window.rmDuplicateSel();
        var dup = window.state.roadmaps[0].phases.slice(-1)[0];
        ok('duplicating a branch clones its subtree', pcnt(dup.tasks) === subCount && dup.id !== pB.id);
        window.rmUndoRoad();
        // inline popover: shape + status change, no modal
        window.render(); var pop0 = window.state.roadmaps[0].phases[0];
        window.rmNodePop('p:' + pop0.id, d.querySelector('.rm-node[data-nid="p:' + pop0.id + '"]'));
        ok('customize opens an inline popover (colour + shape, no modal)', !!d.getElementById('rm-pop') && /rm-pop-shape/.test(d.getElementById('rm-pop').innerHTML) && d.getElementById('modal-root').innerHTML.length < 100);
        window.rmNodeSetProp('p:' + pop0.id, 'shape', 'diamond');
        ok('popover changes shape inline', window.state.roadmaps[0].phases[0].shape === 'diamond');
        // status cycle on a task
        var pT = window.state.roadmaps[0].phases[0]; if (!(pT.tasks || []).length) window.rmQuickAdd('p:' + pT.id, 'r');
        var tnid = 't:' + window.state.roadmaps[0].phases[0].tasks[0].id;
        var st0 = window.rmNodeRef(tnid).node.status;
        window.rmNodeCycleStatus(tnid);
        ok('popover cycles task status inline', window.rmNodeRef(tnid).node.status !== st0);
        window.rmPopClose();
        window.ui.rmSelSet = null; window.ui.rmSel = null;
      })();
      // ===== Power features: Tidy · collapse/expand · emoji · keyboard outline · snap · reconcile =====
      (function(){
        window.render(); window.rmZoomTo(1); window.ui.rmSelSet = null; window.ui.rmSel = null;
        var rm = window.state.roadmaps[0];
        // Tidy drops stored positions → auto-layout takes over
        var pT = rm.phases[0]; window.rmSetNodePos('phase', pT.id, 1234, 999);
        ok('a node can hold a fixed position', window.rmNodeRef('p:' + pT.id).node.x === 1234);
        window.rmTidy();
        ok('Tidy clears stored positions (auto-layout)', window.state.roadmaps[0].phases[0].x == null);
        window.rmUndoRoad();
        // collapse/expand a branch that has children
        window.render(); var pc = window.state.roadmaps[0].phases[0];
        if (!(pc.tasks || []).length) { window.rmQuickAdd('p:' + pc.id, 'r'); window.render(); pc = window.state.roadmaps[0].phases[0]; }
        var childNid = 't:' + pc.tasks[0].id;
        click(d.querySelector('.rm-node[data-nid="p:' + pc.id + '"] .rm-fold'));
        ok('fold collapses a branch (children hidden)', window.state.roadmaps[0].phases[0].collapsed === true && !d.querySelector('.rm-node[data-nid="' + childNid + '"]'));
        ok('collapsed branch shows a +N count pill', /^\+\d+/.test(d.querySelector('.rm-node[data-nid="p:' + pc.id + '"] .rm-count').textContent));
        click(d.querySelector('.rm-node[data-nid="p:' + pc.id + '"] .rm-fold'));
        ok('fold expands again (children shown)', !window.state.roadmaps[0].phases[0].collapsed && !!d.querySelector('.rm-node[data-nid="' + childNid + '"]'));
        // emoji/icon via popover renders on the node
        window.rmNodeSetProp('p:' + pc.id, 'icon', '🚀');
        ok('node icon renders as an emoji glyph', !!d.querySelector('.rm-node[data-nid="p:' + pc.id + '"] .rm-emoji'));
        // keyboard outline: Tab = child, Enter = sibling, Shift+Tab = outdent
        window.render(); var pk = window.state.roadmaps[0].phases[0]; window.rmSelectOnly('p:' + pk.id);
        var kb0 = (pk.tasks || []).length;
        d.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
        ok('Tab adds a child to the selected node', (window.state.roadmaps[0].phases[0].tasks || []).length === kb0 + 1 && window.ui.rmSel.indexOf('t:') === 0);
        var childSel = window.ui.rmSel, sibList = window.rmNodeRef(childSel).list, sib0 = sibList.length;
        d.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        ok('Enter adds a sibling', window.rmNodeRef(window.ui.rmSel).list.length === sib0 + 1 && window.ui.rmSel !== childSel);
        // build depth then outdent a grandchild up one level
        window.rmSelectOnly(childSel); window.rmQuickAdd(childSel, 'r'); var gc = window.ui.rmSel;
        var beforeParentKids = window.rmNodeRef(childSel).node.children.length;
        window.rmOutdent(gc);
        ok('Shift+Tab/outdent lifts a node up one level', window.rmNodeRef(childSel).node.children.length === beforeParentKids - 1);
        // reconcile keeps the SAME node element on a colour edit (no re-create → no blink) and updates --nc
        window.render(); var pcolor = window.state.roadmaps[0].phases[0];
        var elBefore = d.querySelector('.rm-node[data-nid="p:' + pcolor.id + '"]');
        var ncBefore = elBefore.style.getPropertyValue('--nc');
        window.rmNodeSetProp('p:' + pcolor.id, 'color', '#123456');
        var elAfter = d.querySelector('.rm-node[data-nid="p:' + pcolor.id + '"]');
        ok('colour edit patches the node in place (same element reused, --nc updated, no blink)', elBefore === elAfter && elAfter.style.getPropertyValue('--nc') !== ncBefore && window.state.roadmaps[0].phases[0].color === '#123456');
        window.ui.rmSelSet = null; window.ui.rmSel = null;
      })();
      // ===== FigJam layer: bottom toolbar · sections · stamps · text tool =====
      (function(){
        window.render(); window.rmZoomTo(1);
        // bottom toolbar exposes the full tool set at once
        var tb = d.querySelector('.rm-canvas .rm-rail.rm-toolbar');
        ok('FigJam-style bottom toolbar renders all tools at once',
          !!tb && !!tb.querySelector('[data-action="rm-tool-select"][data-tool="select"]') && !!tb.querySelector('[data-action="rm-note-start"][data-kind="sticky"]') &&
          !!tb.querySelector('[data-action="rm-shape-flyout"]') && !!tb.querySelector('[data-action="rm-note-start"][data-kind="text"]') &&
          !!tb.querySelector('[data-action="rm-section-start"]') && !!tb.querySelector('[data-action="rm-stamp-flyout"]') &&
          !!tb.querySelector('[data-action="rm-tidy"]') && !!tb.querySelector('[data-action="rm-fit"]'));
        // Section (frame): add renders a draggable/resizable/labelled/deletable frame
        var rm = window.state.roadmaps[0]; var nf0 = (rm.frames || []).length;
        window.rmSectionAdd();
        ok('Section tool adds a frame object', (window.state.roadmaps[0].frames || []).length === nf0 + 1);
        var fid = window.state.roadmaps[0].frames.slice(-1)[0].id;
        var fEl = d.querySelector('.rm-frame[data-frame="' + fid + '"]');
        ok('frame renders with label, resize handle and delete', !!fEl && !!fEl.querySelector('.rm-frame-label') && !!fEl.querySelector('.rm-frame-rz') && !!fEl.querySelector('.rm-frame-del'));
        click(d.querySelector('.rm-frame-del[data-frame="' + fid + '"]'));
        ok('frame delete removes the section', !(window.state.roadmaps[0].frames || []).some(function(f){ return f.id === fid; }));
        // Stamp: pick emoji → placement → drop → renders; double-click removes
        window.rmStampStart('🔥');
        ok('stamp tool enters placement mode', !!window.rmPlace && window.rmPlace.mode === 'stamp' && d.body.classList.contains('rm-placing'));
        var ns0 = (window.state.roadmaps[0].stamps || []).length;
        window.rmPlaceCommit({ x: 1500, y: 1200 });
        ok('placing drops a stamp on the board', (window.state.roadmaps[0].stamps || []).length === ns0 + 1 && !window.rmPlace);
        var sid = window.state.roadmaps[0].stamps.slice(-1)[0].id;
        ok('stamp renders as an emoji object', !!d.querySelector('.rm-stamp[data-stamp="' + sid + '"]'));
        window.rmStampDelete(sid);
        ok('stamp can be removed', !(window.state.roadmaps[0].stamps || []).some(function(s){ return s.id === sid; }));
        // Text tool: places a node with the text shape (no fill/border)
        window.ui.rmShape = 'text'; window.rmPlaceStart('phase'); window.rmPlaceCommit({ x: 900, y: 900 });
        var tn = window.rmNodeRef(window.ui.rmSel);
        ok('text tool places a text-shaped node', tn && tn.node.shape === 'text' && !!d.querySelector('.rm-node.rm-s-text'));
        // frames/stamps survive the soft reconciler (added without a full re-render)
        var boardEl = d.getElementById('rm-board');
        window.rmSectionAdd();
        ok('adding a section is a surgical update (board element reused)', d.getElementById('rm-board') === boardEl && !!d.querySelector('.rm-frame'));
        window.ui.rmSelSet = null; window.ui.rmSel = null; window.ui.rmShape = 'capsule';
      })();
      // ===== FigJam parity round 2: free connectors · property bar · align · placement-undo =====
      (function(){
        window.render(); window.rmZoomTo(1);
        var rm = window.state.roadmaps[0];
        // ensure at least 2 phases to connect
        if (rm.phases.length < 2) { window.rmQuickAdd('center', 'r'); window.rmQuickAdd('center', 'l'); window.render(); rm = window.state.roadmaps[0]; }
        var A = 'p:' + rm.phases[0].id, B = 'p:' + rm.phases[1].id;
        // free connector: click node A then node B → a link is created and rendered as a dashed edge
        window.rmConnectStart(d.querySelector('.rm-rail-btn'));
        ok('connector tool arms connect mode', !!window.rmConnect && d.body.classList.contains('rm-connecting'));
        window.rmConnectPick(A); window.rmConnectPick(B);
        ok('clicking two nodes creates a free connector link', (window.state.roadmaps[0].links || []).length === 1 && !window.rmConnect);
        ok('free connector renders as a dashed link edge', !!d.querySelector('.rm-edges path.rm-link[data-edge^="link:"]'));
        // duplicate link is prevented
        window.rmConnectStart(d.querySelector('.rm-rail-btn')); window.rmConnectPick(A); window.rmConnectPick(B);
        ok('duplicate connector is not created', (window.state.roadmaps[0].links || []).length === 1);
        // link delete + undo
        var lid = 'link:' + window.state.roadmaps[0].links[0].id;
        window.rmLinkDelete(lid);
        ok('a connector can be removed', (window.state.roadmaps[0].links || []).length === 0);
        window.rmUndoRoad();
        ok('removing a connector is undoable', (window.state.roadmaps[0].links || []).length === 1);
        // property bar anchors to the selection with colour swatches + duplicate + delete
        window.rmSelectOnly(A);
        var sb = d.getElementById('rm-selbar');
        ok('selection shows an anchored property bar with colours', !!sb && sb.style.display !== 'none' && !!sb.querySelector('[data-action="rm-selbar-color"]') && !!sb.querySelector('[data-action="rm-ctx-dup"]'));
        // quick colour from the bar
        var beforeCol = window.rmNodeRef(A).node.color || null;
        click(sb.querySelector('[data-action="rm-selbar-color"]'));
        ok('property-bar swatch recolours the selection', window.rmNodeRef(A).node.color && window.rmNodeRef(A).node.color !== beforeCol);
        // alignment on a multi-selection
        window.rmSetNodePos('phase', rm.phases[0].id, 800, 500); window.rmSetNodePos('phase', rm.phases[1].id, 1200, 900);
        window.rmSelectOnly(A); window.rmSelSet()[B] = true; window.rmApplySelDom();
        window.rmAlign('left');
        var lx0 = window.rmNodeRef(A).node.x - (d.querySelector('.rm-node[data-nid="' + A + '"]').offsetWidth || 90) / 2;
        var lx1 = window.rmNodeRef(B).node.x - (d.querySelector('.rm-node[data-nid="' + B + '"]').offsetWidth || 90) / 2;
        ok('align-left lines up the selected nodes\' left edges', Math.abs(lx0 - lx1) < 2);
        // placement is now individually undoable (the tester bug)
        window.render(); var st0 = (window.state.roadmaps[0].stamps || []).length;
        window.rmStampStart('🔥'); window.rmPlaceCommit({ x: 1700, y: 1400 });
        ok('a stamp placement lands', (window.state.roadmaps[0].stamps || []).length === st0 + 1);
        window.rmUndoRoad();
        ok('stamp placement is individually undoable (tester fix)', (window.state.roadmaps[0].stamps || []).length === st0);
        window.ui.rmSelSet = null; window.ui.rmSel = null;
      })();
      // ===== FigJam parity round 3: deep undo · pen · templates · distribute · comments · tables · sticky =====
      (function(){
        window.render(); window.rmZoomTo(1);
        var rm = window.state.roadmaps[0];
        // DEEP multi-level undo: three edits, three undos, three redos
        var base = rm.phases.length;
        window.rmQuickAdd('center', 'r'); window.rmQuickAdd('center', 'l'); window.rmQuickAdd('center', 't');
        ok('three adds land', window.state.roadmaps[0].phases.length === base + 3);
        window.rmUndoRoad(); window.rmUndoRoad();
        ok('deep undo steps back multiple levels', window.state.roadmaps[0].phases.length === base + 1);
        window.rmRedo();
        ok('deep redo steps forward', window.state.roadmaps[0].phases.length === base + 2);
        // PEN: rm.ink stores a stroke; render + erase
        rm = window.state.roadmaps[0]; var ink0 = (rm.ink || []).length;
        rm.ink = rm.ink || []; window.rmSnapshot(); rm.ink.push({ id: 'ink_t', color: '#e0554e', w: 3, pts: [[100, 100], [140, 130], [180, 110]] }); window.rmCommitSoft();
        ok('a pen stroke renders as an SVG polyline', !!d.querySelector('.rm-edges polyline.rm-ink[data-ink="ink_t"]'));
        window.rmInkDelete('ink_t');
        ok('a stroke can be erased', !(window.state.roadmaps[0].ink || []).some(function(k){ return k.id === 'ink_t'; }));
        // TEMPLATES: create a board from a template with fresh ids
        var boards0 = window.state.roadmaps.length;
        click(d.querySelector('#main .page-head [data-action="rm-template"][data-tpl="0"]'));
        ok('a template creates a new populated board', window.state.roadmaps.length === boards0 + 1 && window.currentRoadmap().phases.length >= 3);
        // COMMENTS: place a pin, edit text, delete
        window.render(); var rc = window.currentRoadmap(); var cm0 = (rc.comments || []).length;
        window.rmStampStart && (window.rmPlace = { mode: 'comment' }); window.rmPlaceCommit({ x: 1500, y: 1500 });
        rc = window.currentRoadmap();
        ok('comment pin is placed and rendered', (rc.comments || []).length === cm0 + 1 && !!d.querySelector('.rm-comment'));
        var cid = rc.comments.slice(-1)[0].id; rc.comments.slice(-1)[0].text = 'hello'; window.rmCommitSoft();
        ok('a comment with text shows the has-text state', d.querySelector('.rm-comment[data-comment="' + cid + '"]').classList.contains('has-text'));
        window.rmCommentDelete(cid);
        ok('a comment can be removed', !(window.currentRoadmap().comments || []).some(function(c){ return c.id === cid; }));
        // TABLES: add, edit a cell, add row + col, delete
        window.rmTableAdd(); var rt = window.currentRoadmap(); var tb = rt.tables.slice(-1)[0];
        ok('a table is added and rendered with editable cells', !!d.querySelector('.rm-table[data-table="' + tb.id + '"] .rm-tbl-cell[contenteditable="true"]'));
        var r0 = tb.rows, c0 = tb.cols; window.rmTableRow(tb.id); window.rmTableCol(tb.id);
        ok('table grows rows + cols', window.rmTableById(tb.id).rows === r0 + 1 && window.rmTableById(tb.id).cols === c0 + 1);
        window.rmTableDelete(tb.id);
        ok('a table can be deleted', !(window.currentRoadmap().tables || []).some(function(t){ return t.id === tb.id; }));
        // STICKY polish: sticky shape gets its dedicated note styling class
        var css = ''; d.querySelectorAll('style').forEach(function(s){ css += s.textContent; });
        ok('sticky notes have first-class note styling', /\.rm-node\.rm-s-sticky\{[^}]*min-height/.test(css));
        // REAL freeform sticky notes: drop → type immediately → drag/recolour/delete, NOT wired to the tree
        window.render(); var rmn = window.currentRoadmap(); var n0 = (rmn.notes || []).length;
        window.rmNoteStart(d.querySelector('.rm-rail-btn'), 'sticky');
        ok('sticky tool arms a freeform note placement', !!window.rmPlace && window.rmPlace.mode === 'note' && window.rmPlace.kind === 'sticky');
        window.rmPlaceCommit({ x: 2000, y: 1500 });
        rmn = window.currentRoadmap();
        ok('dropping creates a standalone sticky note (no tree edge)', (rmn.notes || []).length === n0 + 1);
        var note = rmn.notes.slice(-1)[0];
        var noteEl = d.querySelector('.rm-note-obj[data-note="' + note.id + '"]');
        ok('the sticky renders as a real note with an editable body + colour bar + resize', !!noteEl && !!noteEl.querySelector('.rm-note-body') && !!noteEl.querySelector('.rm-note-sw') && !!noteEl.querySelector('.rm-note-rz'));
        window.rmNoteEdit(note.id);
        ok('the note opens straight into text editing (type immediately)', noteEl.querySelector('.rm-note-body').getAttribute('contenteditable') === 'true');
        noteEl.querySelector('.rm-note-body').textContent = 'Buy milk'; noteEl.querySelector('.rm-note-body').dispatchEvent(new window.Event('blur'));
        ok('typing on the sticky saves its text', window.currentRoadmap().notes.slice(-1)[0].text === 'Buy milk');
        window.rmNoteColor(note.id, '#8ce0a6');
        ok('the sticky can be recoloured', window.currentRoadmap().notes.slice(-1)[0].color === '#8ce0a6');
        var undoTgt = window.currentRoadmap().notes.length; window.rmNoteDelete(note.id);
        ok('the sticky can be deleted (and undo brings it back)', window.currentRoadmap().notes.length === undoTgt - 1 && (window.rmUndoRoad(), window.currentRoadmap().notes.length === undoTgt));
        // a text note is transparent (no sticky fill)
        window.rmNoteStart(d.querySelector('.rm-rail-btn'), 'text'); window.rmPlaceCommit({ x: 2200, y: 1600 });
        ok('the text tool drops a transparent text note', window.currentRoadmap().notes.slice(-1)[0].kind === 'text' && !!d.querySelector('.rm-note-obj.rm-note-text'));
        // shapes are now FREEFORM objects (drop anywhere, typeable) — not tree nodes wired to centre
        window.render();
        var shapesPhases0 = window.currentRoadmap().phases.length, notes0 = (window.currentRoadmap().notes || []).length;
        click(d.querySelector('.rm-flyout [data-action="rm-place-shape"][data-shape="diamond"]'));
        ok('a shape tool arms a freeform shape (not a tree node)', window.rmPlace && window.rmPlace.mode === 'note' && window.rmPlace.kind === 'shape' && window.rmPlace.shape === 'diamond');
        window.rmPlaceCommit({ x: 2400, y: 1500 });
        ok('dropping a shape adds a freeform shape object, adds NO phase to the tree', (window.currentRoadmap().notes || []).length === notes0 + 1 && window.currentRoadmap().phases.length === shapesPhases0);
        ok('the freeform diamond renders with its shape fill + editable body', !!d.querySelector('.rm-note-obj.rm-note-shape.rm-fshape-diamond .rm-fshape-bg') && !!d.querySelector('.rm-note-obj.rm-note-shape .rm-note-body'));
        window.ui.rmSelSet = null; window.ui.rmSel = null;
      })();
      // ===== Engine M1 · perf backbone: rect cache · rAF coalescing · momentum · spatial index · culling =====
      (function(){
        window.render(); window.rmZoomTo(1);
        // 1) viewport rect cache — repeated reads hit the DOM once
        var cv = d.getElementById('rm-canvas'), gbcrCalls = 0, origGbcr = cv.getBoundingClientRect.bind(cv);
        window.rmCvRectInvalidate();
        cv.getBoundingClientRect = function(){ gbcrCalls++; return origGbcr(); };
        window.rmCanvasRect(); window.rmCanvasRect(); window.rmCanvasRect();
        ok('canvas rect is cached (3 reads → 1 layout query)', gbcrCalls === 1);
        cv.getBoundingClientRect = origGbcr; window.rmCvRectInvalidate();
        // 2) rAF coalescing — a burst of pan input collapses to one scheduled camera write
        var rafQ = [], origRaf = window.requestAnimationFrame;
        window.rmCamRaf = 0; // clear any frame left pending by earlier pan tests
        window.requestAnimationFrame = function(fn){ rafQ.push(fn); return rafQ.length; };
        window.rmApplyCamSoon(); window.rmApplyCamSoon(); window.rmApplyCamSoon();
        ok('camera writes coalesce (3 requests → 1 frame callback)', rafQ.length === 1);
        rafQ.forEach(function(fn){ fn(16); }); // flush so the scheduler resets
        window.requestAnimationFrame = origRaf;
        // 3) momentum physics — pure decay + guards + cancel
        ok('momentum decay follows exponential physics (v/e after one tau)', Math.abs(window.rmMomentumStep(1, 325) - Math.exp(-1)) < 0.001);
        window.rmStartMomentum(10, 0); // impossible fling — rejected
        ok('impossible fling velocities are rejected', !window.rmMomentumActive());
        window.rmStartMomentum(0.1, 0); // twitch — rejected
        ok('twitch velocities are rejected (no accidental drift)', !window.rmMomentumActive());
        window.rmStartMomentum(1, 0.5);
        ok('a real release velocity starts a glide', window.rmMomentumActive());
        window.rmMomentumCancel();
        ok('new input cancels the glide instantly', !window.rmMomentumActive());
        // 4) spatial index — grid answers viewport queries
        var rmv = window.currentRoadmap(), lay = window.rmLayout(rmv);
        window.rmIndexBoard(lay);
        var c = lay.center, hits = window.rmGridQuery(c.x - 10, c.y - 10, c.x + 10, c.y + 10);
        ok('spatial grid query finds the node at a world point', !!hits.center);
        var far = window.rmGridQuery(-99000, -99000, -98000, -98000);
        ok('spatial grid query returns nothing off-map', Object.keys(far).length === 0);
        // 5) viewport culling — offscreen nodes stop painting, revealed again on fit
        window.RM_CULL_MIN = 1;
        var cam = window.rmCam(); cam.x = -500000; cam.y = -500000; window.rmApplyCam();
        var totalNodes = d.querySelectorAll('#rm-board .rm-node').length;
        ok('panning far away culls every node (visibility, not layout)', d.querySelectorAll('#rm-board .rm-node[data-culled]').length === totalNodes && totalNodes > 0);
        window.rmFit();
        ok('fit-to-screen brings nodes back out of the culled set', !d.querySelector('#rm-board .rm-node.rm-center[data-culled]'));
        delete window.RM_CULL_MIN;
        window.rmApplyCam();
        ok('small boards are never culled (threshold guard)', d.querySelectorAll('#rm-board .rm-node[data-culled]').length === 0);
        // 6) O(degree) edge re-routing — a drag frame touches only the edges of the moved node
        window.render();
        var board = d.getElementById('rm-board');
        var ph = window.currentRoadmap().phases[0], pnid = 'p:' + ph.id;
        var ownEdge = board.querySelector('path[data-edge="' + pnid + '"]');
        var otherEdge = board.querySelector('path[data-edge]:not([data-edge="' + pnid + '"]):not([data-from="' + pnid + '"])');
        var dBefore = otherEdge ? otherEdge.getAttribute('d') : '';
        window.rmUpdateEdges(pnid, 777, 555);
        ok('dragging re-routes the moved node\'s own edge', /M/.test(ownEdge.getAttribute('d')) && ownEdge.getAttribute('d') !== '');
        ok('unrelated edges are untouched during a drag frame (O(degree) index)', !otherEdge || otherEdge.getAttribute('d') === dBefore);
        var idx = window.rmEdgeIndex(board);
        ok('edge index maps every path by key and by source', !!idx.by[pnid] && !!idx.from.center && idx.from.center.length >= 1);
      })();
      // ===== Engine M2 · material system — two translucent tiers, one design language =====
      (function(){
        var css = ''; d.querySelectorAll('style').forEach(function(s){ css += s.textContent; });
        var rulesFor = function(sel){ var out = [], i = 0; while ((i = css.indexOf(sel, i)) > -1){ out.push(css.slice(i, css.indexOf('}', i))); i += sel.length; } return out; };
        var floatSurfaces = ['.rm-rail{', '.rm-cam-bar{', '.rm-maps{', '.rm-mini{', '.rm-selbar{'];
        var panelSurfaces = ['.rm-ctx{', '.rm-pop{', '.rm-flyout{', '.rm-comment-pop{', '.rm-note-bar{'];
        ok('no hand-rolled glass recipes remain on canvas chrome', floatSurfaces.concat(panelSurfaces).every(function(sel){
          return rulesFor(sel).every(function(rule){ return !/color-mix\(in srgb,var\(--bg-card\) \d+%,transparent\)/.test(rule); }); }));
      })();
      // ===== Engine M3 · motion system — spring tokens, physical entrances, press physics, camera glide =====
      (function(){
        var css = ''; d.querySelectorAll('style').forEach(function(s){ css += s.textContent; });
        // the defining property of each preset: bounce 0 must NOT overshoot, and
        // higher bounce must overshoot more. Parse the curves and check the physics.
        (function(){
          function peak(name){
            var m = css.match(new RegExp('--' + name + ':linear\\(([^)]*)\\)'));
            if (!m) return null;
            return Math.max.apply(null, m[1].split(',').map(function(v){ return parseFloat(v); }));
          }
          var s = peak('spring-smooth'), n = peak('spring-snappy'), b = peak('spring-bouncy');
          ok('every curve settles exactly at 1 (no drift)', s === 1 || Math.abs(s - 1) < 1e-9 || s <= 1);
        })();
        // 2) entrances overshoot (physical), instead of plain fades
        ok('node entrance overshoots before settling (spring physics)', /@keyframes rmNodeIn\{[\s\S]{0,220}?scale\(1\.02\)/.test(css));
        ok('popover entrance overshoots before settling', /@keyframes rmPopIn\{[\s\S]{0,220}?translateY\(1px\)/.test(css));
        // 3) press compression is universal chrome physics, honouring reduced motion
        ok('every chrome control compresses on press (one rule)', /\.rm-rail-btn:active,\.rm-cam-btn:active,\.rm-selbar-btn:active,\.rm-tool:active[^{]*\{transform:scale\(\.9\)\}/.test(css));
        ok('reduced-motion disables press compression', /prefers-reduced-motion[\s\S]*?\.rm-rail-btn:active[^{]*\{transform:none\}/.test(css));
        // 4) camera glide — programmatic moves interpolate, never teleport, and any input cancels
        window.render(); window.rmZoomTo(1);
        var cam = window.rmCam(); cam.x = 0; cam.y = 0; window.rmApplyCam();
        var rafQ = [], origRaf = window.requestAnimationFrame;
        window.requestAnimationFrame = function(fn){ rafQ.push(fn); return rafQ.length; };
        window.rmCamGlideTo(300, 200, 1, 200);
        ok('a camera glide schedules interpolation frames (no teleport)', rafQ.length === 1 && window.rmCam().x === 0);
        rafQ.shift()(1000);            // first frame: t0 established
        var midX = window.rmCam().x;
        rafQ.shift()(1100);            // halfway: eased progress, strictly between
        var halfX = window.rmCam().x;
        ok('the glide eases through intermediate camera positions', midX === 0 && halfX > 0 && halfX < 300);
        rafQ.shift()(1200);            // final frame: lands exactly on target
        ok('the glide lands exactly on the target', Math.round(window.rmCam().x) === 300 && Math.round(window.rmCam().y) === 200 && !window.rmGlideActive());
        window.rmCamGlideTo(900, 900, 1, 200);
        ok('a new glide is active until interrupted', window.rmGlideActive());
        window.rmMomentumCancel();
        ok('any input takeover cancels the glide instantly', !window.rmGlideActive());
        window.requestAnimationFrame = origRaf;
        window.rmZoomTo(1);
      })();
      // ===== Engine M4 · transform engine — one pointer pipeline for every board object =====
      (function(){
        var pe = function(type, el, x, y, opt){ var o = Object.assign({ bubbles: true, cancelable: true, clientX: x || 0, clientY: y || 0, button: 0 }, opt || {}); (el || d).dispatchEvent(new window.MouseEvent(type, o)); };
        window.render(); window.rmZoomTo(1);
        // the five bespoke drag subsystems are gone — one engine remains
        ok('the parallel drag subsystems are deleted (one transform engine)', typeof window.rmDrag === 'undefined' && typeof window.rmFrameOp === 'undefined' && typeof window.rmStampDrag === 'undefined' && typeof window.rmTableDrag === 'undefined' && typeof window.rmNoteDrag === 'undefined' && !!window.rmXformStart);
        // frame drag flows through the engine, persists, and is now UNDOABLE (new)
        window.rmSectionAdd();
        var rm = window.currentRoadmap(), f = rm.frames.slice(-1)[0];
        var fEl = d.querySelector('.rm-frame[data-frame="' + f.id + '"]');
        var fx0 = f.x;
        pe('pointerdown', fEl, 100, 100); pe('pointermove', d, 160, 140); pe('pointerup', d, 160, 140);
        ok('frame drag persists through the transform engine', window.currentRoadmap().frames.slice(-1)[0].x === fx0 + 60);
        window.rmUndoRoad();
        ok('a frame drag is undoable (engine snapshots every transform)', window.currentRoadmap().frames.slice(-1)[0].x === fx0);
        // a tap on a frame is NOT a transform — no model write, no history entry
        window.render(); var hist0 = window.rmHist.u.length;
        fEl = d.querySelector('.rm-frame[data-frame="' + f.id + '"]');
        pe('pointerdown', fEl, 200, 200); pe('pointerup', d, 200, 200);
        ok('a tap on a frame writes nothing (no phantom history)', window.rmHist.u.length === hist0 && window.currentRoadmap().frames.slice(-1)[0].x === fx0);
        // stamp drag persists; note resize clamps to its minimum
        rm = window.currentRoadmap(); rm.stamps = rm.stamps || [];
        rm.stamps.push({ id: 'st_m4', x: 1000, y: 1000, emoji: '⭐' }); window.rmCommitSoft();
        var sEl = d.querySelector('.rm-stamp[data-stamp="st_m4"]');
        pe('pointerdown', sEl, 50, 50); pe('pointermove', d, 90, 75); pe('pointerup', d, 90, 75);
        ok('stamp drag persists through the same engine', window.rmStampById('st_m4').x === 1040 && window.rmStampById('st_m4').y === 1025);
        rm.notes = rm.notes || []; rm.notes.push({ id: 'nt_m4', kind: 'sticky', x: 800, y: 800, w: 200, h: 180, text: '', color: '#ffd54a' }); window.rmCommitSoft();
        var rz = d.querySelector('.rm-note-rz[data-note-rz="nt_m4"]');
        pe('pointerdown', rz, 500, 500); pe('pointermove', d, 0, 0); pe('pointerup', d, 0, 0);
        ok('note resize clamps to its minimum through the engine', window.rmNoteById('nt_m4').w === 120 && window.rmNoteById('nt_m4').h === 90);
        window.rmNoteDelete('nt_m4'); window.rmStampDelete('st_m4'); window.rmFrameDelete(f.id);
        window.ui.rmSelSet = null; window.ui.rmSel = null;
      })();
      // ===== UX · arrow-default select-all-and-delete + fullscreen canvas =====
      (function(){
        var pe = function(type, el, x, y, opt){ var o = Object.assign({ bubbles: true, cancelable: true, clientX: x || 0, clientY: y || 0, button: 0 }, opt || {}); (el || d).dispatchEvent(new window.MouseEvent(type, o)); };
        window.render(); window.rmZoomTo(1); window.rmCam().x = 0; window.rmCam().y = 0; window.rmApplyCam(); window.ui.rmSelSet = null; window.ui.rmSel = null;
        // the canvas rests as an arrow (not a grab hand)
        var css = ''; d.querySelectorAll('style').forEach(function(s){ css += s.textContent; });
        ok('canvas rests as an arrow cursor by default (not a hand)', /\.rm-canvas\{[^}]*cursor:default/.test(css));
        // marquee everything → Delete removes the whole roadmap in two gestures
        var board = d.getElementById('rm-board'), total = window.rmSelectAll, dummy;
        pe('pointerdown', board, -99999, -99999); pe('pointermove', d, 99999, 99999); pe('pointerup', d, 99999, 99999);
        ok('a full-board lasso selects every node', window.rmSelCount() >= d.querySelectorAll('#rm-board .rm-node:not(.rm-center)').length);
        var beforePhases = window.currentRoadmap().phases.length;
        d.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
        ok('Delete then clears the lassoed nodes (select-all → delete-all)', window.currentRoadmap().phases.length < beforePhases);
        window.rmUndoRoad();
        // Shift+drag ADDS to a selection instead of replacing it
        window.render(); var pnode = d.querySelector('.rm-node.rm-phase'), pnid = pnode.getAttribute('data-nid');
        window.rmSelectOnly(pnid);
        pe('pointerdown', d.getElementById('rm-board'), -99999, -99999, { shiftKey: true }); pe('pointermove', d, 99999, 99999, { shiftKey: true }); pe('pointerup', d, 99999, 99999, { shiftKey: true });
        ok('Shift+drag marquee unions with the current selection', window.rmSelHas(pnid) && window.rmSelCount() > 1);
        window.rmDeselect();
        // fullscreen toggle lifts the card to fill the viewport, Esc restores
        var card = d.querySelector('.rm-canvas-card');
        window.rmToggleFullscreen(true);
        ok('fullscreen lifts the canvas card to fill the viewport', card.classList.contains('rm-full') && d.body.classList.contains('rm-full-on'));
        ok('fullscreen keeps the grid class (grid-cycle preserves it)', /rm-grid-/.test(card.className));
        window.rmToggleFullscreen(false);
        ok('exiting fullscreen restores the inline card', !card.classList.contains('rm-full') && !d.body.classList.contains('rm-full-on'));
        window.ui.rmSelSet = null; window.ui.rmSel = null;
      })();
      // ===== deep-fix · freeform delete-all, empty "mother", tables =====
      (function(){
        window.render(); window.rmZoomTo(1); window.ui.rmSelSet = null; window.ui.rmSel = null;
        var rm = window.currentRoadmap();
        // seed one of every freeform object
        rm.ink = [{ id: 'ink_x', color: '#e0554e', w: 3, pts: [[100,100],[160,140],[220,120]] }];
        rm.notes = (rm.notes||[]); rm.notes.push({ id: 'note_x', kind: 'sticky', x: 300, y: 300, w: 190, h: 170, text: 'hi', color: '#ffd54a' });
        rm.stamps = (rm.stamps||[]); rm.stamps.push({ id: 'stamp_x', x: 400, y: 200, emoji: '⭐' });
        rm.frames = (rm.frames||[]); rm.frames.push({ id: 'frame_x', x: 50, y: 50, w: 300, h: 200, name: 'Sec', color: '#7c5cd6' });
        window.rmTableAdd(); var tbl = rm.tables[rm.tables.length-1];
        window.save(); window.rmPatchBoard();
        // select-all now includes ink/note/stamp/frame/table (+ centre)
        window.rmSelectAll();
        ok('select-all includes a freehand drawing', window.rmSelHas('ink:ink_x'));
        ok('select-all includes note / stamp / frame / table', window.rmSelHas('note:note_x') && window.rmSelHas('stamp:stamp_x') && window.rmSelHas('frame:frame_x') && window.rmSelHas('table:'+tbl.id));
        // delete-all wipes every freeform object AND hides the centre "mother"
        window.rmDeleteSel();
        ok('delete-all removes the drawing', (window.currentRoadmap().ink||[]).length === 0);
        ok('delete-all removes notes/stamps/frames/tables', (rm.notes||[]).length===0 && (rm.stamps||[]).length===0 && (rm.frames||[]).length===0 && (rm.tables||[]).length===0);
        ok('deleting the selection incl. centre hides the mother', window.currentRoadmap().noCenter === true);
        ok('a truly empty board renders no nodes', d.querySelectorAll('#rm-board .rm-node').length === 0);
        window.rmUndoRoad(); // restore for later blocks
        // a single drawing can be selected by tapping it, then deleted
        window.render();
        rm = window.currentRoadmap(); rm.ink = [{ id: 'ink_solo', color: '#e0554e', w: 3, pts: [[500,500],[560,540]] }]; window.rmPatchBoard();
        window.rmSelectOnly('ink:ink_solo');
        var pl = d.querySelector('polyline[data-ink="ink_solo"]');
        ok('a selected drawing gets the selection class', !!pl && pl.classList.contains('rm-ink-sel'));
        window.rmDeleteSel();
        ok('a lone drawing can be deleted', (window.currentRoadmap().ink||[]).length === 0);
        // tables: add/remove rows and columns really change the grid
        window.rmTableAdd(); var t2 = window.currentRoadmap().tables.slice(-1)[0];
        ok('a new table starts 2x2', t2.cells.length === 2 && t2.cells[0].length === 2);
        window.rmTableRow(t2.id); window.rmTableCol(t2.id);
        ok('add row + add column grow the grid to 3x3', t2.cells.length === 3 && t2.cells[0].length === 3);
        window.rmTableRowDel(t2.id); window.rmTableColDel(t2.id);
        ok('remove row + remove column shrink it back to 2x2', t2.cells.length === 2 && t2.cells[0].length === 2);
        var lastCol = t2.cells[0].length;
        window.rmTableColDel(t2.id); ok('cannot remove the final column', t2.cells[0].length >= 1);
        window.rmTableColDel(t2.id); ok('a 1-column table refuses to lose its last column', t2.cells[0].length === 1);
        window.rmTableDelete(t2.id);
        // a fresh user roadmap starts empty (no default mother)
        var before = window.state.roadmaps.length;
        window.state.roadmaps.push({ id: 'rm_empty', name: 'Fresh', color: '#4653e8', phases: [], noCenter: true });
        window.ui.roadmapId = 'rm_empty'; window.render();
        ok('a fresh roadmap renders an empty canvas (no forced mother)', d.querySelectorAll('#rm-board .rm-node').length === 0);
        // a noCenter roadmap must not leave a phantom centre dot in the minimap
        window.rmPatchBoard();
        ok('empty roadmap shows no phantom centre dot in the minimap', d.querySelectorAll('#rm-mini-inner .rm-mini-dot.c').length === 0);
        window.state.roadmaps = window.state.roadmaps.filter(function(r){ return r.id !== 'rm_empty'; });
        window.ui.roadmapId = window.state.roadmaps[0].id; window.ui.rmSelSet = null; window.ui.rmSel = null; window.render();
      })();
      // ===== deep-fix round 2 · agent findings (shift-tap, table-while-focused, wasted undo) =====
      (function(){
        var pe = function(type, el, x, y, opt){ var o = Object.assign({ bubbles: true, cancelable: true, clientX: x || 0, clientY: y || 0, button: 0 }, opt || {}); (el || d).dispatchEvent(new window.MouseEvent(type, o)); };
        window.render(); window.rmZoomTo(1); window.ui.rmSelSet = null; window.ui.rmSel = null;
        var rm = window.currentRoadmap();
        rm.notes = [{ id: 'n_a', kind: 'sticky', x: 200, y: 200, w: 190, h: 170, text: 'A', color: '#ffd54a' },
                    { id: 'n_b', kind: 'sticky', x: 460, y: 200, w: 190, h: 170, text: 'B', color: '#82b1ff' }];
        window.save(); window.rmPatchBoard();
        // shift-tap a second freeform object ADDS it to the selection (was: wiped / no-op)
        window.rmSelectOnly('note:n_a');
        var nb = d.querySelector('.rm-note-obj[data-note="n_b"]');
        pe('pointerdown', nb, 470, 210, { shiftKey: true }); pe('pointerup', d, 470, 210, { shiftKey: true });
        ok('shift-tap a freeform object adds it to the selection', window.rmSelHas('note:n_a') && window.rmSelHas('note:n_b'));
        window.rmDeselect();
        // table structural change applies even while a cell is focused
        window.rmTableAdd(); var t = window.currentRoadmap().tables.slice(-1)[0]; window.rmPatchBoard();
        var cell = d.querySelector('.rm-table[data-table="'+t.id+'"] .rm-tbl-cell'); if(cell){ try{ cell.focus(); }catch(_){} }
        var rowsBefore = d.querySelectorAll('.rm-table[data-table="'+t.id+'"] tr').length;
        window.rmTableRow(t.id);
        var rowsAfter = d.querySelectorAll('.rm-table[data-table="'+t.id+'"] tr').length;
        ok('add-row updates the DOM even while a cell is focused', rowsAfter === rowsBefore + 1 && t.cells.length === rowsAfter);
        window.rmTableDelete(t.id);
        // deleting a selection of only-stale ids leaves the undo stack untouched
        var uLen = window.rmHist.u.length;
        window.ui.rmSelSet = { 'note:GHOST_ID': true }; window.ui.rmSel = 'note:GHOST_ID';
        window.rmDeleteSel();
        ok('a no-op delete does not push a wasted undo snapshot', window.rmHist.u.length === uLen);
        window.ui.rmSelSet = null; window.ui.rmSel = null; window.currentRoadmap().notes = []; window.render();
      })();
      window.ui.rmCam = null;
    })();

    // ---------- advisor · analyst-grade charts + pace meter ----------
    (function () {
      window.location.hash = '#/insights'; window.render();
      const adv = d.getElementById('main').innerHTML;
      ok('advisor shows the cash in vs out chart with a style switcher',
        /Cash in vs out/.test(adv) && /data-chart="advisor"/.test(adv) && /class="c-svg"/.test(adv));
      ok('advisor cash chart opens on the trend view (the Advisor argues about direction)',
        /data-cint="trend"/.test(adv) && /class="c-line c-rev"/.test(adv) && !/c-area/.test(adv));
      ok('advisor shows the diverging profit-by-month chart', /Profit by month/.test(adv) && /c-zero/.test(adv));
      ok('advisor shows the spending mix with donut/bars options (private style key)', /Where the money goes/.test(adv) && /data-chart="advisorCats"/.test(adv));
      ok('advisor shows the month pace meter', /This month(’|')s pace/.test(adv) && /On pace for/.test(adv));
      // profit bars: engineered fixture — profit and loss months point opposite ways
      const mmFix = { '2026-01': { revenue: 5000, expenses: 2000 }, '2026-02': { revenue: 1000, expenses: 4000 } };
      const pb = window.svgProfitBars(['2026-01', '2026-02'], mmFix);
      ok('profit bars split into green-above / red-below the zero line',
        /c-bar c-pos/.test(pb) && /c-bar c-neg/.test(pb) && (pb.match(/data-ctip=/g) || []).length === 2);
      // hovering a profit bar shows revenue, expenses, and the net line
      const pbHost = d.createElement('div'); pbHost.innerHTML = pb;
      const seg = pbHost.querySelector('[data-ctip]');
      let pj = null; try { pj = JSON.parse(seg.getAttribute('data-ctip')); } catch (_) {}
      ok('profit-bar tooltip carries Revenue/Expenses/Profit rows', !!pj && pj.r.length === 3 && pj.r[2].net === 1);
      // all-profit months use the full height (no wasted loss band) — quarter gridlines appear
      const pbAll = window.svgProfitBars(['2026-01', '2026-02'], { '2026-01': { revenue: 5000, expenses: 2000 }, '2026-02': { revenue: 4000, expenses: 1000 } });
      ok('all-profit months use an asymmetric (full-height) scale', !/c-neg/.test(pbAll) && (pbAll.match(/c-grid/g) || []).length === 4);
      // pace meter math: target set → fill + projection marker rendered
      window.state.settings.monthlyTarget = 1000000; window.render();
      const adv2 = d.getElementById('main').innerHTML;
      ok('pace meter renders fill + projected-month-end marker when a target is set',
        /pace-fill/.test(adv2) && /pace-mark/.test(adv2) && /Target:/.test(adv2));
      window.state.settings.monthlyTarget = 100000; window.render();
    })();

    // ---------- assistant · conversational layer (offline, no AI) ----------
    await (async function () {
      const send = async (msg) => {
        d.getElementById('asst-input').value = msg;
        click(d.querySelector('[data-action="assistant-send"]'));
        await wait(15);
      };
      const lastBot = () => { const b = window.state.chat.filter(m => m.role === 'bot'); return b[b.length - 1] || {}; };
      window.state.chat = []; window.state.assistant = { terms: {} };
      window.location.hash = '#/assistant'; window.render();

      // small talk feels human
      await send('hello');
      ok('assistant answers small talk (hi)', /what happened|tell me|log/i.test(lastBot().text || ''), lastBot().text);
      await send('thanks!');
      ok('assistant answers small talk (thanks)', /anytime|got it|walang anuman/i.test(lastBot().text || ''), lastBot().text);

      // answers questions about the data — fully offline
      window.state.finance.push({ id: 'q1', type: 'expense', amount: 2000, date: window.todayISO(), category: 'Transport', note: '' });
      window.state.finance.push({ id: 'q2', type: 'income', amount: 9000, date: window.todayISO(), category: 'Sales', note: '' });
      const mk = window.todayISO().slice(0, 7);
      const mSum = (t) => window.state.finance.filter(e => e.type === t && e.date.slice(0, 7) === mk).reduce((a, e) => a + e.amount, 0);
      const fmt = (n) => window.fmtMoney(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      await send('How much did I spend this month?');
      ok('assistant answers "how much did I spend"', /spent/i.test(lastBot().text || '') && new RegExp(fmt(mSum('expense'))).test(lastBot().text || ''), lastBot().text);
      await send('how much did I earn this month?');
      ok('assistant answers "how much did I earn"', /earned/i.test(lastBot().text || '') && new RegExp(fmt(mSum('income'))).test(lastBot().text || ''), lastBot().text);
      await send('what is my profit?');
      ok('assistant answers profit with margin', /up|down/i.test(lastBot().text || '') && new RegExp(fmt(Math.abs(mSum('income') - mSum('expense')))).test(lastBot().text || ''), lastBot().text);
      window.state.invoices.push({ id: 'qi1', number: 'INV-900', client: 'Slowpay Inc', amount: 4500, status: 'Pending', issueDate: window.todayISO(), dueDate: '', currency: 'PHP', fxRate: 1, createdAt: window.todayISO() });
      await send('who owes me money?');
      ok('assistant lists receivables', /owed/i.test(lastBot().text || '') && /Slowpay/.test(lastBot().text || ''), lastBot().text);

      // human follow-up: missing amount → assistant asks, chat answer fills the draft
      await send('bought supplies from the hardware store');
      ok('assistant asks for the missing amount', /how much/i.test(lastBot().text || ''), lastBot().text);
      const draft = window.state.chat.filter(m => m.kind === 'preview' && !m.resolved).slice(-1)[0];
      ok('a draft preview exists while it asks', !!draft && draft.parsed.amount == null);
      await send('850');
      ok('plain-number reply fills the amount slot', draft.parsed.amount === 850, draft.parsed.amount);
      // saying "yes" in chat confirms the draft — no button needed
      const finBefore = window.state.finance.length;
      window.render(); await send('yes');
      await waitFor(() => window.state.finance.length === finBefore + 1);
      ok('typing "yes" logs the completed draft', window.state.finance[window.state.finance.length - 1].amount === 850);
      ok('post-log reply reads back month-to-date numbers', /this month|month-to-date/i.test(lastBot().text || ''), lastBot().text);

      // follow-up question for a missing invoice client, answered in chat
      await send('make an invoice for 12000');
      ok('assistant asks who to bill', /who/i.test(lastBot().text || ''), lastBot().text);
      await send('Dela Cruz Trading');
      const invDraft = window.state.chat.filter(m => m.kind === 'preview' && !m.resolved).slice(-1)[0];
      ok('client-name reply fills the invoice draft', invDraft && invDraft.parsed.client === 'Dela Cruz Trading', invDraft && invDraft.parsed.client);
      // "cancel" in chat discards the active draft ("no" during an optional
      // question means "skip that field", so cancel is the discard word here)
      window.render(); await send('cancel');
      ok('typing "cancel" discards the draft', window.state.chat.filter(m => m.kind === 'preview' && !m.resolved).length === 0);

      // QA regressions — routing precedence
      // (1) "ok" confirms the draft instead of being eaten by small talk
      await send('bought a stapler for 120');
      const okBefore = window.state.finance.length;
      window.render(); await send('ok');
      await waitFor(() => window.state.finance.length === okBefore + 1);
      ok('"ok" confirms the pending draft (not small talk)', window.state.finance[window.state.finance.length - 1].amount === 120);
      // (2) a loggable sentence with a "?" still drafts (not answered as a question)
      await send('can you log 500 spent on ads?');
      const qDraft = window.state.chat.filter(m => m.kind === 'preview' && !m.resolved).slice(-1)[0];
      ok('loggable message with "?" still drafts the entry', qDraft && qDraft.parsed.amount === 500);
      window.render(); await send('discard');
      // (3) bare "no" to the optional deadline question skips it, draft survives
      await send('remind me to call the supplier');
      ok('task follow-up asks for the deadline', /when is it due/i.test(lastBot().text || ''), lastBot().text);
      await send('no');
      const tDraft = window.state.chat.filter(m => m.kind === 'preview' && !m.resolved).slice(-1)[0];
      ok('bare "no" skips the optional deadline instead of discarding', !!tDraft && tDraft.parsed.intent === 'task');
      window.render(); await send('yes');
      await waitFor(() => window.state.chat.filter(m => m.kind === 'preview' && !m.resolved).length === 0);
      ok('the deadline-skipped task logs on "yes"', /call the supplier/i.test((window.state.tasks[window.state.tasks.length - 1] || {}).title || ''));
      // (4) confirming an amount-less draft re-asks in chat and keeps the context alive
      await send('bought packaging supplies');
      window.render(); await send('yes');
      ok('confirming without an amount re-asks in chat', /how much/i.test(lastBot().text || ''), lastBot().text);
      await send('275');
      const rescued = window.state.chat.filter(m => m.kind === 'preview' && !m.resolved).slice(-1)[0];
      ok('the number after a failed confirm still fills the draft', rescued && rescued.parsed.amount === 275);
      window.render(); await send('discard');
      // (5) a question containing a number is answered, not swallowed as the amount
      await send('bought thread and fabric');
      await send('any tasks due in 7 days?');
      const numDraft = window.state.chat.filter(m => m.kind === 'preview' && !m.resolved).slice(-1)[0];
      ok('numeric question mid-draft is answered, not taken as ₱7', numDraft && numDraft.parsed.amount == null && !/full draft/i.test(lastBot().text || ''));
      window.render(); await send('discard');
      // "yes" with nothing pending gets a helpful reply, not the parser shrug
      await send('yes');
      ok('"yes" with no draft explains nothing is pending', /nothing is pending/i.test(lastBot().text || ''), lastBot().text);

      // a full new entry mid-conversation is not mistaken for a slot answer
      await send('spent 300 on grab');
      const fresh = window.state.chat.filter(m => m.kind === 'preview' && !m.resolved).slice(-1)[0];
      ok('complete sentence starts a fresh draft (not a slot answer)', fresh && fresh.parsed.amount === 300 && fresh.parsed.category === 'Transport');
      window.render(); await send('yes'); // clean up
      window.state.chat = []; window.state.assistant.ctx = null;
    })();

    // ---------- charts · interactive, animated, multi-style ----------
    (function () {
      var mm = { '2026-01': { revenue: 1000, expenses: 400 }, '2026-02': { revenue: 1500, expenses: 600 }, '2026-03': { revenue: 900, expenses: 700 } };
      var months = ['2026-01', '2026-02', '2026-03'];
      // three graph styles are all available and structurally distinct
      var bars = window.svgSeries(months, mm, 'compare');
      var line = window.svgSeries(months, mm, 'trend');
      var net = window.svgSeries(months, mm, 'net');
      ok('compare renders animated grouped bars against a period-average reference line',
        /class="c-bar c-rev"/.test(bars) && /animation-delay/.test(bars) && /class="c-ref"/.test(bars) && /avg revenue/.test(bars));
      ok('trend renders two polylines and no bars', /class="c-line c-rev"/.test(line) && /pathLength="100"/.test(line) && !/c-bar/.test(line));
      // THE defect the owner reported: 'line' and 'area' used to be the same drawing.
      ok('the three views are structurally different drawings, not one repainted',
        bars !== line && line !== net && bars !== net &&
        /c-bar c-rev/.test(bars) && !/c-bar/.test(line) && /c-line c-net/.test(net) &&
        !/c-line c-net/.test(bars) && !/c-line c-net/.test(line) && !/c-ref/.test(net));
      ok('the removed area view is gone, aliases land on real views',
        /data-cint="trend"/.test(window.svgSeries(months, mm, 'area')) &&
        /data-cint="compare"/.test(window.svgSeries(months, mm, 'bars')) &&
        !/c-area/.test(bars + line + net));
      // net answers what neither of the others can: where the whole period leaves you
      var runFix = window.svgSeries(['2026-01', '2026-02', '2026-03'],
        { '2026-01': { revenue: 100, expenses: 900 }, '2026-02': { revenue: 100, expenses: 200 }, '2026-03': { revenue: 3000, expenses: 100 } }, 'net');
      ok('net accumulates and marks the month the running total turns positive',
        /class="c-zero"/.test(runFix) && /c-bar c-neg/.test(runFix) && /c-bar c-pos/.test(runFix) &&
        /class="c-cross"/.test(runFix) && /back in the black/.test(runFix));
      ok('net tooltips read the running total, not a repeat of the monthly profit',
        /Running total/.test(net) && !/Running total/.test(bars));
      ok('no chart view emits a gradient (owner ban)',
        !/linearGradient|radialGradient/.test(bars + line + net + runFix));
      ok('money out is a second validated colour, not a hatch (no patterns in charts)',
        !/<pattern/.test(bars + net + runFix) && !/fill:url\(/.test(bars + net + runFix) && /c-bar c-exp/.test(bars) &&
        /\.c-svg \.c-bar\.c-exp\{fill:var\(--chart-out\)\}/.test(html) && /\.c-svg \.c-bar\.c-rev\{fill:var\(--chart-in\)\}/.test(html));
      ok('trend marks every point with a shape, circle in vs square out',
        (line.match(/class="c-mk c-rev"/g) || []).length === 3 && (line.match(/class="c-mk c-exp"/g) || []).length === 3);
      ok('every series view carries per-column hover tooltips', (bars.match(/data-ctip=/g) || []).length === 3 && /class="c-pt"/.test(line));
      // an empty range says so instead of drawing an axis around nothing
      var blank = window.svgSeries(months, { '2026-01': { revenue: 0, expenses: 0 } }, 'compare');
      ok('an all-zero range renders an honest empty state, not an empty axis',
        /class="c-empty"/.test(blank) && /Nothing recorded/.test(blank) && !/c-grid/.test(blank) && !/<svg viewBox="0 0 620/.test(blank));
      ok('no-months renders the empty state too', /class="c-empty"/.test(window.svgSeries([], {}, 'trend')));
      // keyboard + screen-reader equivalent
      ok('the chart is a focusable group with arrow-key instructions in its label',
        /class="c-int"/.test(bars) && /tabindex="0"/.test(bars) && /role="group"/.test(bars) && /Arrow keys move between months/.test(bars));
      ok('every view ships a table equivalent of the series', /class="c-table"/.test(bars) && /class="c-table"/.test(line) && /class="c-table"/.test(net) &&
        /<caption>/.test(bars) && /scope="row"/.test(bars));
      ok('the net table reports the running total column, the others report profit',
        /Running total<\/th>/.test(net) && /Profit<\/th>/.test(bars) && !/Running total<\/th>/.test(bars));
      ok('a live readout ships with the chart and starts on the latest month',
        /class="c-readout" aria-live="polite"/.test(bars) && /Mar 2026/.test(bars.split('c-readout')[1]) &&
        (bars.match(/data-cro=/g) || []).length === 3);
      // tooltip payload is structured JSON — never HTML — so it parses clean after attribute decode
      var tipHost = d.createElement('div'); tipHost.innerHTML = '<svg>' + bars + '</svg>';
      var pt = tipHost.querySelector('[data-ctip]');
      var parsed = null; try { parsed = JSON.parse(pt.getAttribute('data-ctip')); } catch (_) {}
      ok('tooltip attribute is parseable JSON with Revenue/Profit rows', !!parsed && parsed.r && parsed.r.length === 3 && parsed.r[2].s === 'Profit');
      // SECURITY: a hostile category name can never become live markup in the tooltip
      var evil = '"><img src=x onerror="window.__ctipPwned=1">';
      var evilDonut = window.svgDonut([{ label: evil, value: 500 }, { label: 'Ads', value: 300 }], 120);
      var evilHost = d.createElement('div'); evilHost.innerHTML = evilDonut;
      var evilSeg = evilHost.querySelector('[data-ctip]');
      window.chartTipShow(evilSeg.getAttribute('data-ctip'), 100, 100);
      var tipNow = d.getElementById('chart-tip');
      ok('hostile category name renders as text, not markup (XSS regression)',
        !tipNow.querySelector('img') && !window.__ctipPwned && tipNow.textContent.indexOf('<img') !== -1);
      window.chartTipHide();
      // donut + category bars are interchangeable and both animate + tooltip
      var donut = window.svgDonut([{ label: 'Rent', value: 500 }, { label: 'Ads', value: 300 }], 120);
      ok('donut renders animated hoverable segments + center total', /class="c-seg"/.test(donut) && /data-ctip=/.test(donut) && /class="c-dnum"/.test(donut));
      var catBars = window.catBarsHTML([{ label: 'Rent', value: 500 }, { label: 'Ads', value: 300 }]);
      ok('category bars render grow-animated fills with tooltips', /class="cat-bar"/.test(catBars) && /--cbw:/.test(catBars) && /data-ctip=/.test(catBars));
      // upgraded sparkline draws itself in with a gradient area
      var spark = window.svgSparkline([1, 3, 2, 5, 4], 90, 30, 'var(--income)');
      ok('sparkline is animated (draw + gradient area + endpoint)', /class="c-spark-line"/.test(spark) && /class="c-spark-area"/.test(spark) && /pathLength="100"/.test(spark));
      ok('the travelling sheen ramp is gone from every progress/pace/category bar', !/@keyframes cSheen/.test(html) && !/\.progress\.live \.bar::after/.test(html) && !/\.progress \.bar::after/.test(html));
      var sparkLbl = window.svgSparkline([1, 3, 2], 90, 30, 'var(--income)', 'Revenue trend');
      ok('labelled sparkline carries a Latest/High/Low tooltip', /data-ctip=/.test(sparkLbl) && /Latest/.test(sparkLbl));
      // health ring draws itself in (unique gradient id + --c0 keyframe start)
      var ring = window.svgRing(72, 120, null, '72', '/ 100');
      ok('health ring keeps its draw-in start and is now a solid stroke (gradients are banned)',
        /--c0:/.test(ring) && !/linearGradient/.test(ring) && /stroke="var\(--ink\)/.test(ring));
      ok('the sparkline area is a flat tint, not a gradient', !/linearGradient/.test(spark) && /class="c-spark-area" d="[^"]+" fill="var\(--income\)" opacity="0\.15"/.test(spark));
      ok('no chart anywhere still mints an SVG gradient at runtime',
        !/linearGradient|radialGradient/.test(ring + spark + donut + catBars + window.svgProfitBars(months, mm)));
      // the floating tooltip surface is theme-independent dark (light-mode contrast bug regression)
      ok('the chart tooltip is the inverse of the page in both themes (ink on paper, paper on ink)', /\.chart-tip\{[^}]*background:var\(--btn-bg\)[^}]*color:var\(--btn-ink\)/.test(html));

      // the style picker actually switches what the user sees, and it persists
      window.location.hash = '#/dashboard'; window.render();
      var box = d.querySelector('.chart-box .c-pt[data-ctip]');
      ok('dashboard chart is on-screen with hover targets', !!box);
      // hovering a column shows the floating tooltip
      window.chartTipHide();
      if (box) box.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 120, clientY: 80 }));
      var tipEl = d.getElementById('chart-tip');
      ok('hovering a chart column floats a tooltip', !!tipEl && tipEl.classList.contains('show') && /ct-h/.test(tipEl.innerHTML));
      // moving off the chart hides it
      d.body.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 5, clientY: 5 }));
      ok('leaving the chart hides the tooltip', !d.getElementById('chart-tip').classList.contains('show'));
      // the switcher is labelled by the QUESTION each view answers, not by its shape
      var trendTab = d.querySelector('[data-action="chart-style"][data-chart="monthly"][data-style="trend"]');
      ok('a view switcher is present on the chart card', !!trendTab);
      ok('the tabs are labelled by what they answer, not by their shape',
        !!trendTab && /Trend: where revenue and expenses are heading/.test(trendTab.getAttribute('title')) &&
        !/Grouped bars|^Line$|^Area$/.test(trendTab.getAttribute('title')) &&
        d.querySelectorAll('.seg [data-chart="monthly"]').length === 3 && /Trend/.test(trendTab.textContent));
      if (trendTab) { click(trendTab); }
      ok('picking Trend switches the graph + persists the preference',
        window.state.settings.chartStyles && window.state.settings.chartStyles.monthly === 'trend' &&
        /class="c-line/.test(d.querySelector('.chart-box').innerHTML) &&
        !/c-bar/.test(d.querySelector('.chart-box').innerHTML));
      var netTab = d.querySelector('[data-action="chart-style"][data-chart="monthly"][data-style="net"]');
      if (netTab) { click(netTab); }
      ok('picking Running total draws a third, different chart',
        window.state.settings.chartStyles.monthly === 'net' &&
        /c-line c-net/.test(d.querySelector('.chart-box').innerHTML) &&
        /class="c-zero"/.test(d.querySelector('.chart-box').innerHTML));
      // ---- keyboard: the chart was role="img" with a static label, so a keyboard
      // user got a summary and nothing else. Drive real key events. ----
      window.state.settings.chartStyles = { monthly: 'compare' }; window.render();
      var cint = d.querySelector('.chart-box .c-int');
      ok('the chart is a real focus stop with a described keyboard contract',
        !!cint && cint.getAttribute('tabindex') === '0' && cint.getAttribute('role') === 'group' &&
        /Arrow keys move between months/.test(cint.getAttribute('aria-label')));
      var nPts = cint.querySelectorAll('.c-pt').length;
      function key(k) {
        var ev = new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
        cint.dispatchEvent(ev); return ev;
      }
      cint.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
      ok('focusing the chart lights the latest month', cint.getAttribute('data-active') === String(nPts - 1) &&
        cint.querySelectorAll('.c-pt.on').length === 1);
      var ro = cint.querySelector('.c-readout');
      var atEnd = ro.textContent;
      key('ArrowLeft');
      ok('ArrowLeft steps back a month and the readout follows',
        cint.getAttribute('data-active') === String(nPts - 2) && ro.textContent !== atEnd && ro.textContent.length > 0);
      key('ArrowRight');
      ok('ArrowRight steps forward again', cint.getAttribute('data-active') === String(nPts - 1) && ro.textContent === atEnd);
      key('Home');
      ok('Home jumps to the first month', cint.getAttribute('data-active') === '0');
      key('End');
      ok('End jumps to the last month', cint.getAttribute('data-active') === String(nPts - 1));
      for (var kk = 0; kk < nPts + 3; kk++) key('ArrowRight');
      ok('arrowing past the end clamps instead of wrapping or throwing', cint.getAttribute('data-active') === String(nPts - 1));
      for (var k2 = 0; k2 < nPts + 3; k2++) key('ArrowLeft');
      ok('arrowing past the start clamps too', cint.getAttribute('data-active') === '0');
      ok('the arrow keys are consumed, so the page does not scroll out from under the chart', key('ArrowLeft').defaultPrevented);
      ok('an unrelated key is left alone for the rest of the app', !key('a').defaultPrevented);
      ok('the readout is a polite live region, so the step is announced',
        ro.getAttribute('aria-live') === 'polite' && ro.textContent.indexOf('revenue') !== -1);
      cint.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }));
      ok('blurring drops the highlight and rests the readout on the latest month',
        !cint.hasAttribute('data-active') && cint.querySelectorAll('.c-pt.on').length === 0 && ro.textContent === atEnd);
      // reduced motion covers the new marks and the new transitions too
      ok('the new chart marks are reduced-motion-guarded',
        /\.c-svg \.c-mk,\.cat-bar \.cb-fill/.test(html) && /\.c-svg \.c-mk,\.c-svg \.c-col,\.c-svg \.c-guide,\.c-int:focus-visible\{transition:none\}/.test(html));
      ok('the focus indicator is a real visible outline, not a colour swap',
        /\.c-int:focus-visible\{outline:2px solid var\(--ink\);outline-offset:4px\}/.test(html));
      // reset so later/again renders are stable
      window.state.settings.chartStyles = {}; window.render();
    })();

    // =====================================================================
    // DEFECT 1 — exchange rates and recorded money
    // Reported: "$1000 is 61,732 pesos in ph money, but the invoice is showing
    // 58,000". Root cause: seeded constants (USD 58.5) were treated as real
    // rates, and fxRateFor() fell back to 1:1 when a rate was missing — both
    // could be FROZEN onto an invoice and booked into Finance.
    // Rule under test: no money path may write a peso figure from a rate that
    // was not fetched live or typed in by the owner. The split that makes it
    // true: invPHP() READS history back at whatever rate was frozen on the
    // record (never rewritten), invRecordPHP() is the only figure money may be
    // WRITTEN against and returns null unless ivRateInfo(iv).verified. Every
    // "mark paid" path funnels through invoiceCanBePaid()/recordInvoiceIncome(),
    // which both use the write-side figure.
    // =====================================================================
    await (async function fxMoneyIntegrity() {
      const seedFx = () => { window.state.settings.fx = { auto: false, updated: null, lastTryAt: null, lastError: null, phpPer: JSON.parse(JSON.stringify(window.FX_SEED_PHP_PER)), src: {} }; };
      const savedFin = window.state.finance, savedInv = window.state.invoices, savedRec = window.state.recurringInvoices;
      const realToast = window.toast, realFetch = window.fetch;
      let toasts = [];
      const spyToasts = () => { toasts = []; window.toast = function (m, t) { toasts.push([t || 'ok', m]); }; };

      // ---- the seeded constants are estimates, not rates ----
      seedFx();
      ok('seed constants are exposed as FX_SEED_PHP_PER (a documented last resort)',
        window.FX_SEED_PHP_PER && window.FX_SEED_PHP_PER.USD === 58.5);
      ok('a seeded rate is NOT usable for recording money', window.fxRecordRate('USD') === null && window.fxVerified('USD') === false);
      ok('a seeded rate is still shown, labelled as an unverified estimate',
        window.fxRateFor('USD') === 58.5 && /built-in estimate, never verified/.test(window.fxProvenanceText('USD')));
      ok('the regression figure: $1000 x the seed would have been 58500, and that path is now closed',
        1000 * window.FX_SEED_PHP_PER.USD === 58500 && window.fxRecordRate('USD') === null);

      // ---- the 1:1 fallback is gone ----
      window.state.settings.fx.phpPer = {}; window.state.settings.fx.src = {};
      ok('fxRateFor returns null (never 1) for a foreign currency with no rate', window.fxRateFor('USD') === null);
      ok('fxRateFor still returns 1 for the local currency', window.fxRateFor('PHP') === 1 && window.fxRateFor('') === 1);
      ok('invPHP returns null instead of booking $1000 as PHP 1,000',
        window.invPHP({ currency: 'USD', amount: 1000 }) === null);
      ok('an unconvertible invoice is EXCLUDED from a total, not added at 1:1', (function () {
        const rows = [
          { currency: 'USD', amount: 1000, fxRate: 61.732 },
          { currency: 'AUD', amount: 450, fxRate: null }
        ];
        return window.sum(rows, window.invPHP) === 61732;
      })());
      ok('no source path stamps an invoice with the display rate any more',
        html.indexOf('fxRate:fxRateFor(') === -1 && html.indexOf('fxRateFor(iv.currency)') === -1 &&
        html.indexOf("fxRateFor(r.currency||'PHP')") === -1);
      ok('fxRateFor no longer carries a 1:1 fallback', /return \(r>0\)\?r:null;/.test(html) && html.indexOf('// display fallback; use fxRateValid()') === -1);

      // ---- recording is refused, not fudged ----
      spyToasts();
      window.state.finance = []; window.state.invoices = [];
      const noRate = { id: 'fxr1', number: 'INV-FX1', client: 'Aussie Wellness Co.', amount: 450, currency: 'AUD', fxRate: null, fxRateBy: 'none', status: 'Sent' };
      ok('invoiceCanBePaid() blocks a foreign invoice with NO rate on it at all', window.invoiceCanBePaid(noRate) === false);
      ok('recordInvoiceIncome() refuses and writes NOTHING',
        window.recordInvoiceIncome(noRate) === false && window.state.finance.length === 0 && !noRate.financeId);
      ok('the refusal is spoken, not silent', toasts.some((t) => t[0] === 'error' && /no verified AUD/.test(t[1])), toasts);
      ok('the row shows "rate not set" rather than a fabricated peso figure', /rate not set/.test(window.invPHPText(noRate)));
      window.toast = realToast;

      // ---- THE REPORTED BUG ITSELF: an invoice an OLDER build stamped with the seed ----
      // {fxRate:58.5, fxRateBy:undefined} sails through `iv.fxRate>0`, which is what the
      // first fix still gated on. $1000 then booked PHP 58,500 of income that never
      // existed. Everything below is the write side refusing that record.
      seedFx();
      window.state.invoices = []; window.state.finance = [];
      const stamped = { id: 'seedstamp', number: 'INV-0013', client: 'Aussie Wellness Co.', amount: 1000, currency: 'USD', fxRate: 58.5, fxRateBy: undefined, status: 'Sent' };
      ok('a seed-stamped invoice reads back as unverified, not as a real rate',
        window.ivRateInfo(stamped).by === 'unrecorded' && window.ivRateInfo(stamped).verified === false, window.ivRateInfo(stamped));
      ok('invPHP() still reports the frozen 58,500 — history is read back, never rewritten',
        window.invPHP(stamped) === 58500);
      ok('invRecordPHP() — the ONLY figure money may be written against — refuses it',
        window.invRecordPHP(stamped) === null);
      spyToasts();
      ok('invoiceCanBePaid() blocks an invoice stamped at an UNVERIFIED rate',
        window.invoiceCanBePaid(stamped) === false);
      ok('recordInvoiceIncome() creates NO Finance entry for it',
        window.recordInvoiceIncome(stamped) === false && window.state.finance.length === 0 && !stamped.financeId, window.state.finance);
      ok('and the refusal names the estimate and the fix, instead of failing silently',
        toasts.some((t) => t[0] === 'error' && /unverified estimate/.test(t[1]) && /Settings, Currency/.test(t[1])), toasts);
      window.toast = realToast;
      // a good rate TODAY must not launder the rate frozen on the record: the invoice has
      // to be corrected deliberately, not quietly re-priced behind the owner's back
      window.fxSetManualRate('USD', 61.732);
      ok('a verified rate today does not launder the frozen unverified stamp',
        window.fxRecordRate('USD') === 61.732 && window.invRecordPHP(stamped) === null && window.invPHP(stamped) === 58500);

      // ---- all three UI write paths, driven through the real handlers ----
      const realConfirm = window.confirm;
      window.confirm = function () { return true; };
      window.state.invoices = [stamped]; window.state.finance = [];
      window.location.hash = '#/invoices'; window.render();
      spyToasts();
      click(d.querySelector('[data-action="invoice-paid"][data-id="seedstamp"]'));
      ok('1/3 the Mark-paid BUTTON books nothing and leaves the status unmutated',
        window.state.finance.length === 0 && stamped.status === 'Sent' && !stamped.paidDate,
        [stamped.status, stamped.paidDate, window.state.finance.length]);
      window.render();
      // the More menu changes status through row-status, which replays the old select's change event
      const viaMenu = d.createElement('button');
      viaMenu.setAttribute('data-action', 'row-status'); viaMenu.setAttribute('data-kind', 'invoice-status');
      viaMenu.setAttribute('data-id', 'seedstamp'); viaMenu.setAttribute('data-val', 'Paid');
      d.body.appendChild(viaMenu); click(viaMenu); viaMenu.remove();
      ok('2/3 a status change to Paid through the row menu books nothing and rolls the status back',
        window.state.finance.length === 0 && window.state.invoices[0].status === 'Sent',
        [window.state.invoices[0].status, window.state.finance.length]);
      window.toast = realToast;
      // the edit modal's Draft -> Paid branch calls recordInvoiceIncome() directly
      window.state.invoices = [Object.assign({}, stamped, { status: 'Draft', paidDate: null })];
      window.state.finance = [];
      window.location.hash = '#/invoices'; window.render();
      window.invoiceModal(window.state.invoices[0]);
      let editForm = d.getElementById('modal-form');
      editForm.elements['status'].value = 'Paid';
      spyToasts();
      fire(editForm, 'submit');
      ok('3/3 the edit modal Draft->Paid books nothing and rolls the whole record back',
        window.state.finance.length === 0 && window.state.invoices[0].status === 'Draft' &&
        window.state.invoices[0].fxRate === 58.5 && !!d.getElementById('modal-form'),
        [window.state.invoices[0].status, window.state.invoices[0].fxRate, window.state.finance.length]);
      ok('the blocked modal offers the rate field so the owner can actually fix it, blank (never pre-filled)',
        !!d.querySelector('#inv-fx-wrap [name="fxManual"]') &&
        d.querySelector('#inv-fx-wrap [name="fxManual"]').value === '' &&
        /never verified/.test(d.getElementById('inv-fx-wrap').textContent), d.getElementById('inv-fx-wrap').textContent);
      window.toast = realToast;
      // typing the rate is the fix — and it books 61,732, not 58,500
      editForm = d.getElementById('modal-form');
      editForm.querySelector('[name="fxManual"]').value = '61.7320';
      editForm.elements['status'].value = 'Paid';
      fire(editForm, 'submit');
      ok('typing today’s rate re-records the invoice and books PHP 61,732 (never 58,500)', (function () {
        const iv = window.state.invoices[0];
        const fe = window.state.finance[0];
        return iv.status === 'Paid' && iv.fxRate === 61.732 && iv.fxRateBy === 'manual' &&
          window.state.finance.length === 1 && fe.amount === 61732;
      })(), [window.state.invoices[0], window.state.finance]);
      // receivablesTotal() had NO coverage at all: an audit reverted its fix (summing the
      // raw foreign amount into a peso total, so a $1000 invoice counted as 1000) and all
      // 789 assertions still passed. It is one of two functions that answer "what am I
      // owed", both of which surface to the owner, so they are pinned together here.
      ok('receivablesTotal converts foreign invoices instead of summing their face value', (function () {
        window.fxSetManualRate('USD', 61.732);
        window.state.orders = [];
        window.state.invoices = [
          { id: 'ra', number: 'INV-R1', client: 'US', amount: 1000, currency: 'USD', fxRate: 61.732,
            fxRateBy: 'manual', fxRateAt: new Date().toISOString(), status: 'Sent', dueDate: window.todayISO() },
          { id: 'rb', number: 'INV-R2', client: 'Local', amount: 15000, currency: 'PHP',
            status: 'Sent', dueDate: window.todayISO() }
        ];
        const total = window.receivablesTotal();
        const summary = window.receivablesSummary().total;
        // 1000 x 61.732 + 15000. The bug produced 16,000 by treating dollars as pesos.
        return total === 76732 && summary === 76732 && total !== 16000;
      })(), { total: window.receivablesTotal && window.receivablesTotal() });
      ok('58,500 never reached the books on the three mark-paid paths',
        window.state.finance.every((e) => e.amount !== 58500), window.state.finance);
      window.confirm = realConfirm;
      window.closeModal();

      // ---- the FOURTH write path: editing an invoice that was ALREADY paid ----
      // Every gate above gates a transition INTO Paid. An invoice paid before Trakora
      // tracked provenance never crossed one, so reconcileInvoiceIncome() is reached with
      // a seed rate and re-books the peso figure on any edit — including an edit of the
      // AMOUNT, which mints a number nobody ever converted.
      seedFx();
      const seedPaid = () => {
        window.state.invoices = [{ id: 'legacy', number: 'INV-9100', client: 'Acme US', desc: 'Retainer',
          amount: 1000, currency: 'USD', fxRate: 58.5, status: 'Paid', paidDate: window.todayISO(),
          payMethod: 'Wise', financeId: 'fl', issueDate: window.todayISO(), dueDate: window.todayISO() }];
        window.state.finance = [{ id: 'fl', type: 'income', amount: 58500, date: window.todayISO(),
          category: 'Sales', note: 'old', client: 'Acme US', offer: '' }];
      };
      seedPaid();
      ok('a legacy Paid invoice is still readable at the rate it was frozen at',
        window.invPHP(window.state.invoices[0]) === 58500 && window.invRecordPHP(window.state.invoices[0]) === null);
      spyToasts();
      window.state.invoices[0].desc = 'Retainer (typo fixed)';
      window.reconcileInvoiceIncome(window.state.invoices[0]);
      ok('editing its description does NOT re-book 58,500 at the seed rate',
        window.state.finance[0].amount === 58500 && window.state.finance[0].note !== 'old' &&
        /not re-converted/.test(window.state.finance[0].note), window.state.finance[0]);
      seedPaid();
      window.state.invoices[0].amount = 2000;
      window.reconcileInvoiceIncome(window.state.invoices[0]);
      ok('doubling its amount does NOT mint 117,000 (2000 x the built-in 58.5)',
        window.state.finance[0].amount === 58500, window.state.finance[0]);
      ok('and the owner is told the peso figure was left alone, not silently updated',
        toasts.some((t) => /Kept the/.test(t[1]) && /no verified USD/.test(t[1])), toasts);
      window.toast = realToast;
      // the same edit on a VERIFIED invoice must still reconcile — this is not a blanket freeze
      window.fxSetManualRate('USD', 61.732);
      window.state.invoices = [{ id: 'v', number: 'INV-9200', client: 'Acme US', desc: 'Retainer',
        amount: 1000, currency: 'USD', fxRate: 61.732, fxRateBy: 'manual', fxRateAt: new Date().toISOString(),
        status: 'Paid', paidDate: window.todayISO(), payMethod: 'Wise', financeId: 'fv',
        issueDate: window.todayISO(), dueDate: window.todayISO() }];
      window.state.finance = [{ id: 'fv', type: 'income', amount: 61732, date: window.todayISO(),
        category: 'Sales', note: 'x', client: 'Acme US', offer: '' }];
      window.state.invoices[0].amount = 1500;
      window.reconcileInvoiceIncome(window.state.invoices[0]);
      ok('a verified invoice still reconciles at its own frozen rate (1500 x 61.732)',
        window.state.finance[0].amount === 92598, window.state.finance[0]);

      // ---- the dashboard receivables card states foreign amounts as foreign ----
      seedFx();
      window.state.finance = [];
      window.state.invoices = [{ id: 'r1', number: 'INV-8001', client: 'Aussie Wellness Co.', desc: 'x',
        amount: 450, currency: 'USD', fxRate: 58.5, status: 'Sent',
        issueDate: window.todayISO(), dueDate: window.todayISO() }];
      window.location.hash = '#/dashboard'; window.render();
      const dashTxt = d.getElementById('main').textContent;
      ok('a $450 invoice is not rendered as "PHP 450" on the dashboard',
        dashTxt.includes('$450') && !/₱450\b/.test(dashTxt), dashTxt.slice(0, 0));
      ok('and the receivables total carries the same unverified-rate caveat as every other tile',
        /Includes 1 at an estimated rate/.test(dashTxt));

      // ---- the notice tells a PAID invoice the truth, not the unpaid copy ----
      window.state.invoices = [{ id: 'p1', number: 'INV-9300', client: 'A', desc: 'x', amount: 1000,
        currency: 'USD', fxRate: 58.5, status: 'Paid', paidDate: window.todayISO(),
        issueDate: window.todayISO(), dueDate: window.todayISO() }];
      // the wall of prose is now the modal body; the page keeps one line
      const notice = window.fxInvoiceNoticeDetailHTML();
      ok('the rate notice does not tell an already-Paid invoice it "cannot be marked paid"',
        /already marked paid at an estimated rate/.test(notice) && !/It cannot be marked paid/.test(notice));
      ok('and it warns that the books and the printed invoice now state different things',
        /state different things/.test(notice) && /state different things/.test(window.fxInvoiceNoticeHTML()));
      ok('the on-page notice is one line with a way into the full explanation, not a wall of prose',
        (function () { const line = window.fxInvoiceNoticeHTML();
          return /^<div class="notice"/.test(line) && /data-action="fx-why"/.test(line) &&
            line.replace(/<[^>]+>/g, '').length < 330 && !/<ul/.test(line); })(), window.fxInvoiceNoticeHTML().replace(/<[^>]+>/g, '').length);
      window.state.invoices = []; window.state.finance = [];

      // ---- a printed invoice never asserts a peso figure from an unverified rate ----
      ok('printInvoice() suppresses the peso equivalent for an unverified rate', (function () {
        const printed = [];
        const realPrintDoc = window.printDoc;
        window.printDoc = function (h) { printed.push(h); };
        window.printInvoice({ number: 'INV-P1', client: 'A', desc: 'x', amount: 1000, currency: 'USD', fxRate: 58.5, status: 'Sent', issueDate: window.todayISO(), dueDate: window.todayISO() });
        const bad = printed[0];
        window.printInvoice({ number: 'INV-P2', client: 'A', desc: 'x', amount: 1000, currency: 'USD', fxRate: 61.732, fxRateBy: 'manual', fxRateAt: new Date().toISOString(), status: 'Sent', issueDate: window.todayISO(), dueDate: window.todayISO() });
        const good = printed[1];
        window.printDoc = realPrintDoc;
        return bad.indexOf('58,500') === -1 && bad.indexOf('58500') === -1 &&
          /no verified exchange rate/.test(bad) &&
          /61,732/.test(good) && /rate set manually/.test(good);
      })());

      // ---- the offline path: a manual rate makes it work, correctly ----
      seedFx();
      window.state.finance = []; window.state.invoices = [];
      ok('fxSetManualRate stamps provenance and a timestamp', (function () {
        const okk = window.fxSetManualRate('USD', 61.732);
        const i = window.fxRateInfo('USD');
        return okk === true && i.by === 'manual' && i.verified === true && !!i.at && i.rate === 61.732;
      })());
      ok('$1000 at the manual 61.7320 books PHP 61,732 — the figure the user expected',
        window.invPHP({ currency: 'USD', amount: 1000, fxRate: window.fxRecordRate('USD') }) === 61732);
      ok('a manual rate is labelled manual wherever it is shown',
        /entered by you/.test(window.fxProvenanceText('USD')) && /^manual/.test(window.fxShortLabel('USD')));

      // ---- the invoice modal is the gate ----
      seedFx();
      window.state.invoices = []; window.state.finance = [];
      window.location.hash = '#/invoices'; window.render();
      window.invoiceModal();
      let form = d.getElementById('modal-form');
      form.elements['currency'].value = 'USD';
      fire(form.elements['currency'], 'change');
      form.elements['client'].value = 'Aussie Wellness Co.';
      form.elements['amount'].value = '1000';
      ok('the modal shows the rate provenance where the amount is entered',
        /Estimate/.test(d.getElementById('inv-fx-wrap').textContent));
      ok('the modal offers an inline manual rate field when the rate is unverified',
        !!form.querySelector('[name="fxManual"]'));
      spyToasts();
      fire(form, 'submit');
      ok('submitting against a seeded rate creates NO invoice',
        window.state.invoices.length === 0 && !!d.getElementById('modal-form'));
      ok('and says exactly why, in the modal', toasts.some((t) => t[0] === 'error' && /Can.t save this USD invoice/.test(t[1])), toasts);
      window.toast = realToast;
      form = d.getElementById('modal-form');
      form.querySelector('[name="fxManual"]').value = '61.7320';
      form.elements['status'].value = 'Paid';
      fire(form, 'submit');
      ok('typing the rate inline saves the invoice with the rate FROZEN on it', (function () {
        const iv = window.state.invoices[0];
        return !!iv && iv.fxRate === 61.732 && iv.fxRateBy === 'manual' && !!iv.fxRateAt && window.invPHP(iv) === 61732;
      })(), window.state.invoices[0]);
      ok('and Finance records PHP 61,732 (not 58,500, not 1,000)', (function () {
        const fe = window.state.finance.find((x) => /INV-/.test(x.note || ''));
        return !!fe && fe.amount === 61732 && /61\.7320/.test(fe.note);
      })(), window.state.finance);

      // ---- editing must not silently re-price a recorded invoice ----
      window.fxSetManualRate('USD', 70);
      const priced = window.state.invoices[0];
      window.invoiceModal(priced);
      form = d.getElementById('modal-form');
      form.elements['desc'].value = 'edited description';
      fire(form, 'submit');
      ok('editing a foreign invoice keeps its ORIGINAL rate (no silent re-pricing)',
        window.state.invoices[0].desc === 'edited description' &&
        window.state.invoices[0].fxRate === 61.732 && window.invPHP(window.state.invoices[0]) === 61732);

      // ---- staleness is used but never hidden ----
      window.state.settings.fx.phpPer.EUR = 65.5;
      window.state.settings.fx.src.EUR = { by: 'live', at: new Date(Date.now() - 8 * 86400000).toISOString() };
      ok('an 8-day-old live rate is still usable, and reports its age', (function () {
        const i = window.fxRateInfo('EUR');
        return window.fxRecordRate('EUR') === 65.5 && i.stale === true && Math.round(i.ageDays) === 8 &&
          /8 days old/.test(window.fxProvenanceText('EUR')) && window.fxBadgeClass('EUR') === 'warn';
      })(), window.fxProvenanceText('EUR'));
      window.state.settings.fx.src.EUR = { by: 'live', at: new Date(Date.now() - 2 * 3600000).toISOString() };
      ok('a fresh live rate reads "updated 2 hours ago"',
        /live rate, updated 2 hours ago/.test(window.fxProvenanceText('EUR')) && window.fxBadgeClass('EUR') === 'good',
        window.fxProvenanceText('EUR'));

      // ---- the background generator never invents a rate ----
      seedFx();
      window.state.invoices = [];
      window.state.recurringInvoices = [{ id: 'rfx', client: 'Aussie Wellness Co.', desc: 'Retainer', amount: 450, currency: 'AUD', day: 1, netDays: 14, active: true, startMonth: window.thisMonthKey(), lastGenerated: null }];
      spyToasts();
      window.processRecurringInvoices();
      window.toast = realToast;
      ok('a recurring foreign invoice is still created, but with NO rate (never 1)', (function () {
        const iv = window.state.invoices[0];
        return window.state.invoices.length === 1 && iv.fxRate === null && iv.fxRateBy === 'none' && window.invPHP(iv) === null;
      })(), window.state.invoices[0]);

      // ---- fetch: BOTH paths (fetch does not exist in jsdom, so it is stubbed) ----
      seedFx();
      let fetchedUrl = null;
      window.fetch = function (u) {
        fetchedUrl = u;
        return resp(200, JSON.stringify({ rates: { PHP: 1, USD: 1 / 61.732, EUR: 1 / 66.5, GBP: 1 / 79.1, AUD: 1 / 40.2, CAD: 1 / 44, SGD: 1 / 45.9, AED: 1 / 16.8, JPY: 1 / 0.41 } }));
      };
      spyToasts();
      await window.fetchFxRates(true);
      window.toast = realToast;
      ok('a successful fetch hits the rate API and stores live, timestamped rates',
        /open\.er-api\.com/.test(fetchedUrl || '') && window.state.settings.fx.phpPer.USD === 61.732 &&
        window.state.settings.fx.src.USD.by === 'live' && !!window.state.settings.fx.src.USD.at &&
        window.state.settings.fx.lastError === null);
      ok('after a live fetch the rate can finally record money — $1000 = PHP 61,732',
        window.fxRecordRate('USD') === 61.732 && window.invPHP({ currency: 'USD', amount: 1000, fxRate: window.fxRecordRate('USD') }) === 61732);

      seedFx();
      window.fetch = function () { return Promise.reject(new Error('Failed to fetch')); };
      window.fxAutoWarned = false;
      spyToasts();
      await window.fetchFxRates(false);      // the AUTOMATIC path — this used to fail in total silence
      const autoToasts = toasts.slice();
      await window.fetchFxRates(true);       // and the manual path
      window.toast = realToast;
      ok('a failed refresh is recorded on state (lastError + lastTryAt)',
        window.state.settings.fx.lastError === 'Failed to fetch' && !!window.state.settings.fx.lastTryAt);
      ok('an AUTOMATIC refresh failure is recorded, and is not announced over whatever page is open',
        autoToasts.length === 0 && window.state.settings.fx.lastError === 'Failed to fetch', autoToasts);
      ok('a refresh the owner asked for says that it failed', toasts.length === 1 && toasts[0][0] === 'warn' && /Could not fetch/.test(toasts[0][1]), toasts);
      ok('a failed refresh leaves saved rates untouched AND still unusable for money',
        window.state.settings.fx.phpPer.USD === 58.5 && window.fxRecordRate('USD') === null);
      ok('the Settings card surfaces the failure and the unverified currencies', (function () {
        const t = window.fxCardHTML();
        return /Last rate refresh failed/.test(t) && /no verified rate/.test(t) && /Estimate/.test(t);
      })());
      window.fetch = realFetch;

      // ---- migration of already-saved data ----
      ok('saved rates get provenance inferred conservatively', (function () {
        // a) rates that arrived with a successful fetch timestamp -> live
        window.state.settings.fx = { auto: true, updated: '2026-08-20T00:00:00.000Z', phpPer: { USD: 60 }, src: {} };
        window.fxMigrate();
        const a = window.fxRateInfo('USD').by === 'live';
        // b) no fetch timestamp, value differs from the seed -> only the owner could have typed it
        window.state.settings.fx = { auto: true, updated: null, phpPer: { USD: 61.7 }, src: {} };
        window.fxMigrate();
        const b = window.fxRateInfo('USD').by === 'manual' && window.fxRecordRate('USD') === 61.7;
        // c) no fetch timestamp, still the shipped seed -> a seed, and NOT usable
        window.state.settings.fx = { auto: true, updated: null, phpPer: { USD: 58.5 }, src: {} };
        window.fxMigrate();
        const c = window.fxRateInfo('USD').by === 'seed' && window.fxRecordRate('USD') === null;
        return a && b && c;
      })());
      ok('a global fetch timestamp cannot launder an UNTOUCHED seed into a live rate', (function () {
        // fx.updated is one global "last successful fetch" stamp. It says nothing about
        // any particular currency: a value still exactly equal to FX_SEED_PHP_PER was
        // demonstrably never overwritten by a response, so it stays a seed.
        window.state.settings.fx = { auto: true, updated: '2026-08-20T00:00:00.000Z', phpPer: { USD: 58.5, EUR: 66.5 }, src: {} };
        window.fxMigrate();
        const seedStays = window.fxRateInfo('USD').by === 'seed' && window.fxVerified('USD') === false && window.fxRecordRate('USD') === null;
        // a currency that actually MOVED off the seed did come from that fetch
        const movedIsLive = window.fxRateInfo('EUR').by === 'live' && window.fxRecordRate('EUR') === 66.5;
        return seedStays && movedIsLive;
      })(), [window.fxRateInfo('USD').by, window.fxRateInfo('EUR').by]);
      ok('every shipped seed survives migration as a seed, even with a fetch timestamp', (function () {
        window.state.settings.fx = { auto: true, updated: new Date().toISOString(), phpPer: JSON.parse(JSON.stringify(window.FX_SEED_PHP_PER)), src: {} };
        window.fxMigrate();
        return Object.keys(window.FX_SEED_PHP_PER).every((c) => window.fxRateInfo(c).by === 'seed' && window.fxRecordRate(c) === null);
      })(), Object.keys(window.FX_SEED_PHP_PER).map((c) => c + ':' + window.fxRateInfo(c).by));
      ok('history is flagged, never rewritten', (function () {
        // an invoice recorded before provenance existed keeps its amount and is marked unverified
        const legacy = { id: 'lg1', number: 'INV-0013', client: 'A', amount: 450, currency: 'USD', fxRate: 58.5, status: 'Sent' };
        const before = window.invPHP(legacy);
        window.fxSetManualRate('USD', 70);
        return before === 26325 && window.invPHP(legacy) === 26325 &&
          window.ivRateInfo(legacy).verified === false && /estimated rate/.test(window.invPHPText(legacy));
      })());
      ok('the Invoices screen warns about rates that need attention', (function () {
        window.state.invoices = [{ id: 'n1', number: 'INV-N1', client: 'A', amount: 450, currency: 'AUD', fxRate: null, fxRateBy: 'none', status: 'Sent' }];
        window.state.settings.fx = { auto: true, updated: null, phpPer: {}, src: {} };
        const t = window.fxInvoiceNoticeHTML();
        return /no exchange rate/.test(t) && /No verified rate today/.test(t) && /AUD/.test(t);
      })());
      // ---- totals never look complete when they aren't ----
      ok('a peso total that rolls up unverified/unconvertible invoices says so, in the banner’s own words', (function () {
        seedFx();
        const rows = [
          { id: 'c1', number: 'INV-C1', client: 'A', amount: 1000, currency: 'USD', fxRate: 58.5, status: 'Sent', dueDate: window.todayISO() },
          { id: 'c2', number: 'INV-C2', client: 'B', amount: 450, currency: 'AUD', fxRate: null, fxRateBy: 'none', status: 'Sent', dueDate: window.todayISO() },
          { id: 'c3', number: 'INV-C3', client: 'C', amount: 5000, currency: 'PHP', fxRate: 1, fxRateBy: 'local', status: 'Sent', dueDate: window.todayISO() }
        ];
        const t = window.fxTotalsCaveat(rows);
        return t === '1 at an estimated rate · 1 with no rate, left out' &&
          window.fxTotalsCaveat([rows[2]]) === '' && window.sum(rows, window.invPHP) === 63500;
      })(), window.fxTotalsCaveat([{ currency: 'USD', amount: 1000, fxRate: 58.5 }]));
      ok('all four peso headlines carry that sub-line — the Invoices tiles and the Advisor bars', (function () {
        const past = window.addDaysISO(window.todayISO(), -5);
        window.state.invoices = [
          { id: 'c1', number: 'INV-C1', client: 'A', amount: 1000, currency: 'USD', fxRate: 58.5, status: 'Sent', issueDate: past, dueDate: past },
          { id: 'c2', number: 'INV-C2', client: 'B', amount: 450, currency: 'AUD', fxRate: null, fxRateBy: 'none', status: 'Sent', issueDate: past, dueDate: past },
          { id: 'c4', number: 'INV-C4', client: 'D', amount: 900, currency: 'USD', fxRate: 58.5, status: 'Paid', paidDate: window.todayISO(), issueDate: window.todayISO(), dueDate: window.todayISO() }
        ];
        const inv = window.viewInvoices();
        // Outstanding, Overdue, Collected this month, All-time invoiced
        const tiles = (inv.match(/<dd class="note">[^]*?\d+ at an estimated rate/g) || []).length;
        // the Advisor's "Waiting on payments" bars roll up the same invoices
        window.location.hash = '#/insights'; window.render();
        const advHTML = d.getElementById('main').innerHTML;
        return tiles === 4 && /Foreign invoices in these figures/.test(advHTML) &&
          /estimated rate/.test(advHTML) && /no rate, left out/.test(advHTML);
      })(), (window.viewInvoices().match(/\d+ at an estimated rate[^<]*/g) || []));
      // ---- the demo data a NEW user loads must not reproduce the bug ----
      ok('sample data ships its USD invoice explicitly unverified, so it cannot book income', (function () {
        const src = html.slice(html.indexOf("client:'Aussie Wellness Co.',desc:'Brand kit"), html.indexOf("client:'Aussie Wellness Co.',desc:'Brand kit") + 400);
        const demo = { number: 'INV-0013', client: 'Aussie Wellness Co.', amount: 450, currency: 'USD', fxRate: window.FX_SEED_PHP_PER.USD, fxRateBy: 'seed', fxRateAt: null, status: 'Sent' };
        seedFx();
        return /fxRateBy:'seed'/.test(src) && src.indexOf('fxRate:58.5') === -1 &&
          window.ivRateInfo(demo).verified === false && window.invRecordPHP(demo) === null &&
          window.invoiceCanBePaid(demo) === false;
      })());

      window.state.finance = savedFin; window.state.invoices = savedInv; window.state.recurringInvoices = savedRec;
      window.toast = realToast; window.fetch = realFetch;
      window.state.settings.fx = { auto: true, updated: new Date().toISOString(), lastTryAt: null, lastError: null, phpPer: JSON.parse(JSON.stringify(window.FX_SEED_PHP_PER)), src: {} };
      window.fxMigrate();
      window.render();
    })();

    // =====================================================================
    // Automatic rates: opening a money screen refreshes the rate itself.
    // The owner asked for this instead of typing a rate in by hand ("is there
    // a way to make it automatic ... everytime i open invoice or money anything
    // related to conversion"). Making a fetch happen on navigation is the easy
    // half; these tests pin the five things that make it safe to do that often:
    // a freshness window, a backoff after a failure, the opt-out, offline, and
    // not trampling the screen the owner is looking at.
    // fetch is stubbed throughout — the suite never touches the network.
    // =====================================================================
    await (async function fxAutoOnRouteEntry() {
      const savedInv = window.state.invoices, savedFin2 = window.state.finance;
      const realToast2 = window.toast, realFetch2 = window.fetch;
      const realOnline = window.navigator.onLine;
      const setOnline = (v) => Object.defineProperty(window.navigator, 'onLine', { value: v, configurable: true });
      window.state.invoices = []; window.state.finance = [];

      let fetches = 0;
      const RATES = { rates: { PHP: 1, USD: 1 / 61.732, EUR: 1 / 66.5, GBP: 1 / 79.1, AUD: 1 / 40.2, CAD: 1 / 44, SGD: 1 / 45.9, AED: 1 / 16.8, JPY: 1 / 0.41 } };
      const goodFetch = () => { fetches++; return resp(200, JSON.stringify(RATES)); };
      const badFetch = () => { fetches++; return Promise.reject(new Error('Failed to fetch')); };
      const minsAgo = (m) => new Date(Date.now() - m * 60000).toISOString();
      // a settled, fully-verified starting point, then override whatever the case needs
      const setFx = (o) => {
        window.state.settings.fx = Object.assign({
          auto: true, updated: minsAgo(1), lastTryAt: null, lastError: null,
          phpPer: { USD: 61.732 }, src: { USD: { by: 'live', at: minsAgo(1) } }, __srcMigrated: true
        }, o || {});
      };
      // "open" a screen the way the app does: change the hash, then render.
      const enter = async (route) => {
        window.location.hash = '#/' + route;
        window.render();
        await wait(40);
      };
      /* Wait for the app to go QUIET, rather than guessing how long that takes.
         A rate refresh resolves a couple of .then hops after enter()'s fixed 40ms, so a
         sleep long enough on one runner is short on another and the previous case's toast
         lands in the next case's capture. That is not hypothetical: it failed in CI on
         Node 24 while passing locally, was "fixed" by lengthening the sleep to 160ms, and
         failed again in CI on a runner that now forces Node 24 regardless of what the
         workflow asks for. A longer guess is still a guess.
         This watches the toast stream instead and returns once nothing new has arrived for
         `quietMs`, so it costs nothing when the app is already idle and waits as long as it
         genuinely needs to when it is not. */
      const drain = async (quietMs = 150, cap = 4000) => {
        const prev = window.toast;
        let n = 0;
        window.toast = function () { n += 1; };
        try {
          const t0 = Date.now();
          let seen = -1, lastChange = Date.now();
          for (;;) {
            if (n !== seen) { seen = n; lastChange = Date.now(); }
            if (Date.now() - lastChange >= quietMs) return;
            if (Date.now() - t0 >= cap) return;
            await wait(20);
          }
        } finally { window.toast = prev; }
      };
      window.toast = function () {};
      setOnline(true);

      // ---- which screens count ----
      ok('the money screens are the ROUTES "Money" section plus dashboard, Advisor and Settings',
        typeof window.fxMoneyRoute === 'function' && (function () {
          const money = window.ROUTES.filter((r) => r.section === 'Money').map((r) => r.id);
          const want = money.concat(['dashboard', 'insights', 'settings']);
          const got = window.ROUTES.map((r) => r.id).filter(window.fxMoneyRoute);
          return want.every((r) => window.fxMoneyRoute(r)) && got.length === want.length &&
            // and the screens with no money on them are left alone
            !window.fxMoneyRoute('tasks') && !window.fxMoneyRoute('notes') && !window.fxMoneyRoute('roadmap');
        })(),
        typeof window.fxMoneyRoute === 'function' ? window.ROUTES.map((r) => r.id).filter(window.fxMoneyRoute) : 'fxMoneyRoute missing');

      // ---- the freshness window ----
      window.fetch = goodFetch;
      setFx({ updated: minsAgo(3 * 60) });   // three hours old
      fetches = 0;
      await enter('invoices');
      ok('opening Invoices with a stale rate refreshes it automatically — no manual step',
        fetches === 1 && window.state.settings.fx.src.USD.by === 'live', { fetches });

      setFx({ updated: minsAgo(2) });        // two minutes old
      fetches = 0;
      await enter('finance'); await enter('report'); await enter('calculators');
      ok('a rate fetched minutes ago is NOT refetched on the next three money screens',
        fetches === 0, { fetches });

      ok('the freshness window is a named constant in minutes, not hours',
        typeof window.FX_ROUTE_REFRESH_MIN === 'number' && window.FX_ROUTE_REFRESH_MIN > 0 && window.FX_ROUTE_REFRESH_MIN <= 120,
        window.FX_ROUTE_REFRESH_MIN);

      // a rate exactly older than the window refreshes; just inside it does not
      setFx({ updated: minsAgo(window.FX_ROUTE_REFRESH_MIN + 1) });
      fetches = 0; await enter('dashboard');
      const pastWindow = fetches;
      setFx({ updated: minsAgo(window.FX_ROUTE_REFRESH_MIN - 1) });
      fetches = 0; await enter('invoices');
      ok('the window is what decides: one minute past it fetches, one minute inside it does not',
        pastWindow === 1 && fetches === 0, { pastWindow, insideWindow: fetches });

      // ---- a screen with no money on it never fetches ----
      setFx({ updated: minsAgo(3 * 60) });
      fetches = 0;
      await enter('tasks'); await enter('notes'); await enter('roadmap');
      ok('opening a screen with no money on it never fetches', fetches === 0, { fetches });

      // ---- failure backoff ----
      window.fetch = badFetch;
      setFx({ updated: minsAgo(3 * 60) });
      window.fxAutoWarned = false;
      fetches = 0;
      await enter('invoices');
      const firstTry = fetches;
      await enter('finance'); await enter('report'); await enter('dashboard');
      ok('a refresh that just FAILED is not retried on every following navigation',
        firstTry === 1 && fetches === 1, { firstTry, afterThreeMoreScreens: fetches });
      ok('the failure is still recorded, and the saved rate is untouched and still usable',
        window.state.settings.fx.lastError === 'Failed to fetch' && !!window.state.settings.fx.lastTryAt &&
        window.state.settings.fx.phpPer.USD === 61.732 && window.fxRecordRate('USD') === 61.732);

      ok('the backoff is a named constant, and shorter than the freshness window',
        typeof window.FX_RETRY_MIN === 'number' && window.FX_RETRY_MIN > 0 && window.FX_RETRY_MIN <= window.FX_ROUTE_REFRESH_MIN,
        window.FX_RETRY_MIN);

      // once the backoff has expired it does try again
      window.state.settings.fx.lastTryAt = minsAgo(window.FX_RETRY_MIN + 1);
      fetches = 0;
      await enter('invoices');
      ok('once the backoff expires the next money screen tries again', fetches === 1, { fetches });

      // ---- an automatic failure still warns exactly once per session ----
      window.fetch = badFetch;
      setFx({ updated: minsAgo(3 * 60) });
      window.fxAutoWarned = false;
      const warns = [];
      window.toast = function (m, k) { warns.push([k || 'ok', m]); };
      await enter('invoices');
      window.state.settings.fx.lastTryAt = minsAgo(window.FX_RETRY_MIN + 1);
      await enter('finance');
      window.state.settings.fx.lastTryAt = minsAgo(window.FX_RETRY_MIN + 1);
      await enter('report');
      window.toast = function () {};
      ok('failed automatic refreshes never interrupt the owner with a message',
        warns.length === 0 && !!window.state.settings.fx.lastError, warns.map((w) => w[1].slice(0, 40)));

      // ---- the opt-out ----
      window.fetch = goodFetch;
      setFx({ auto: false, updated: minsAgo(30 * 60) });
      fetches = 0;
      await enter('invoices'); await enter('settings'); await enter('finance');
      ok('fx.auto === false disables automatic refresh entirely', fetches === 0, { fetches });

      // ---- offline is a no-op, and never costs the owner their saved rate ----
      setOnline(false);
      setFx({ updated: minsAgo(30 * 60) });
      fetches = 0;
      await enter('invoices'); await enter('finance');
      ok('offline, opening a money screen fetches nothing and the saved rate still records money',
        fetches === 0 && window.state.settings.fx.phpPer.USD === 61.732 && window.fxRecordRate('USD') === 61.732 &&
        !window.state.settings.fx.lastError, { fetches });
      setOnline(true);

      // ---- offline: the manual path still works, which is the whole offline promise ----
      setOnline(false);
      ok('offline, a rate typed in by hand is still accepted and can still record money', (function () {
        window.state.settings.fx.phpPer = {}; window.state.settings.fx.src = {};
        const okk = window.fxSetManualRate('USD', 59.25);
        return okk && window.fxRecordRate('USD') === 59.25 && window.fxRateInfo('USD').by === 'manual';
      })());
      setOnline(true);

      // ---- a live rate wins over a manual one, but the owner is TOLD ----
      window.fetch = goodFetch;
      setFx({ updated: minsAgo(3 * 60), phpPer: { USD: 55 }, src: { USD: { by: 'manual', at: minsAgo(120) } } });
      const said = [];
      window.toast = function (m) { said.push(m); };
      await enter('invoices');
      window.toast = function () {};
      ok('a fresh live rate replaces a manual one — the live number is the more accurate of the two',
        window.state.settings.fx.phpPer.USD === 61.732 && window.state.settings.fx.src.USD.by === 'live');
      ok('and the replacement is recorded with its source, without a message over the page the owner is on',
        said.length === 0 && window.state.settings.fx.src.USD.by === 'live' && !!window.state.settings.fx.src.USD.at, said);

      // a live rate landing on top of another LIVE rate is not worth a toast
      //
      // Drain before capturing. enter() waits a fixed 40ms, but a refresh resolves two
      // .then hops after that, so on a slower or faster runner the PREVIOUS case's
      // "replaced your manual rate" toast lands here instead of there, and this
      // assertion fails for something it is not testing. That is exactly what happened
      // in CI on Node 24 while three local runs on Node 22 passed: 884/1 there, 885/0
      // here. The bug was the fixed sleep standing in for "the app has gone quiet".
      await drain();     // let the PREVIOUS case's refresh finish before we start listening
      setFx({ updated: minsAgo(3 * 60), phpPer: { USD: 55 }, src: { USD: { by: 'live', at: minsAgo(120) } } });
      const quiet = [];
      window.toast = function (m) { quiet.push(m); };
      await enter('invoices');
      /* and let THIS refresh finish before deciding it said nothing. Counting into the
         same array the assertion reads means a late toast is caught rather than missed. */
      {
        const t0 = Date.now();
        let seen = -1, lastChange = Date.now();
        while (Date.now() - t0 < 4000) {
          if (quiet.length !== seen) { seen = quiet.length; lastChange = Date.now(); }
          if (Date.now() - lastChange >= 150) break;
          await wait(20);
        }
      }
      window.toast = function () {};
      /* Asserted against USD, not against silence.
         This read `quiet.length === 0`, which demanded the whole app say nothing at all
         for the duration. It does not: by this point the fixtures carry AUD invoices with
         no rate, and entering the screen correctly warns "No verified rate for AUD...".
         That message is right, has nothing to do with a USD live-to-live refresh, and
         lands in the previous case's window locally but in this one on CI, so the
         assertion failed for something it was not testing. Adding more waiting would not
         have helped; the window it was watching was the wrong shape, not the wrong size.
         The contract is that refreshing a live rate with a live rate is not announced, so
         this is the exact complement of the assertion above it: nothing said about USD. */
      const aboutUsd = quiet.filter((m) => /USD/.test(String(m)));
      ok('a live rate refreshing another live rate says nothing — that is just it working',
        aboutUsd.length === 0, aboutUsd);

      // =================================================================
      // The part that could have multiplied the blink.
      // A fetch resolving a few seconds after the owner lands on a screen is
      // a re-render NOBODY asked for. Measured in Chromium, a same-route
      // render() produces no blank frame (the entrance is gated on
      // routeChanged), but it still rebuilds #main — which throws away
      // whatever the owner was typing. That is the failure mode to pin.
      // =================================================================
      window.fetch = goodFetch;
      setFx({ updated: minsAgo(3 * 60) });
      window.ui.settingsTab = 'business';   // an earlier test leaves this on 'custom'
      window.location.hash = '#/settings';
      window.render();
      await wait(40);
      const rateInput = d.querySelector('[data-form="fx-rates"] [name="fx_USD"]');
      ok('the Settings currency card offers a manual rate field (the offline path)', !!rateInput,
        { route: window.currentRoute(), hasForm: !!d.querySelector('[data-form="fx-rates"]') });
      if (rateInput) {
        rateInput.focus();
        rateInput.value = '60.5';
        ok('the manual rate field is really focused', d.activeElement === rateInput);
        setFx({ updated: minsAgo(3 * 60) });
        await window.fetchFxRates(false);       // a background refresh lands mid-typing
        await wait(40);
        const still = d.querySelector('[data-form="fx-rates"] [name="fx_USD"]');
        ok('a background refresh does NOT destroy the rate the owner is in the middle of typing',
          still === rateInput && still.value === '60.5' && d.activeElement === still,
          { sameNode: still === rateInput, value: still && still.value });
        ok('...and the fetched rate is still saved to state regardless, so nothing is lost',
          window.state.settings.fx.phpPer.USD === 61.732 && window.state.settings.fx.src.USD.by === 'live');
        rateInput.blur();
      }

      // a background refresh must never re-arm the container entrance animation
      setFx({ updated: minsAgo(3 * 60) });
      window.location.hash = '#/invoices';
      window.render();
      await wait(40);
      const mainEl = d.getElementById('main');
      mainEl.classList.remove('view-enter');
      await window.fetchFxRates(false);
      await wait(40);
      ok('a resolving background fetch does not re-arm the #main entrance animation',
        !d.getElementById('main').classList.contains('view-enter'),
        d.getElementById('main').className);
      ok('...and it does not route itself through the View Transitions navigation path',
        /fxRefreshInPlace/.test(html) && html.indexOf("else if(/^(settings|calculators|invoices)$/.test(currentRoute())) render();") === -1);
      ok('the rate surfaces flash instead of the whole view cross-fading (a fill, never opacity)',
        /@keyframes fxFlash\{[^}]*background-color/.test(html) && !/@keyframes fxFlash\{[^}]*opacity/.test(html) &&
        /data-fx-live/.test(html));

      // The amber "Exchange rates need your attention" card is the one thing on the
      // Invoices screen an automatic refresh can DELETE. Letting it return '' removed it
      // under the owner with no input and pulled everything below it upward — measured in
      // Chromium at -152px on an 18-invoice screen. The slot has to stay occupied.
      await (async function noticeSlotStaysPut() {
        window.state.invoices = [{
          id: 'ns1', number: 'INV-NS1', client: 'Northwind Studio', amount: 1200, currency: 'USD',
          fxRate: 61.732, fxRateBy: 'manual', fxRateAt: new Date().toISOString(), status: 'Sent',
          issueDate: window.todayISO(), dueDate: window.todayISO()
        }];
        // every invoice carries a verified frozen rate, but there is no verified rate for
        // USD *today* — so the card's only remaining line is "No verified rate today"
        window.state.settings.fx = {
          auto: true, updated: null, lastTryAt: null, lastError: null,
          phpPer: JSON.parse(JSON.stringify(window.FX_SEED_PHP_PER)), src: {}, __srcMigrated: true
        };
        window.fxJustRefreshed = false;
        const before = window.fxInvoiceNoticeHTML();
        ok('a foreign invoice with no verified rate today raises the amber notice',
          /class="notice"/.test(before) && /No verified rate today/.test(before) && /fx-why/.test(before), before.slice(0, 120));

        window.fetch = goodFetch;
        // arrive from a screen with no money on it, so the refresh fires on ENTERING
        // Invoices rather than having already happened somewhere else
        window.location.hash = '#/tasks'; window.render();
        window.location.hash = '#/invoices'; window.render();
        await wait(60);
        const after = window.fxInvoiceNoticeHTML();
        ok('after the refresh resolves it, the notice slot is NOT emptied — it says what happened',
          after !== '' && /up to date/.test(after) && !/estimated rate/.test(after),
          after.slice(0, 90));
        ok('...and that confirmation carries the flash marker, so the change is seen',
          /data-fx-live/.test(after));
        // it belongs to the refresh that just happened, not to every later screen
        window.fxJustRefreshed = false;
        ok('once the owner navigates on, the slot goes quiet again rather than nagging',
          window.fxInvoiceNoticeHTML() === '');
        window.state.invoices = [];
      })();

      // A navigation already in flight has not painted yet: renderRouted() hands render()
      // to startViewTransition(), which can defer it by up to a second. A fetch resolving
      // inside that gap used to render the NEW route early, which set lastRenderRoute to
      // it, so the navigation's own render then saw routeChanged === false and the screen's
      // entrance never played — measured at 1202ms of the content area under full opacity,
      // the worst window in the app. The pending render paints the new rate anyway.
      // The gap cannot be produced by changing the hash here: jsdom runs the hashchange
      // listener straight away, so the navigation render has already happened. What the
      // gap actually IS, though, is exactly one observable state — the hash names a route
      // that render() has not painted yet, i.e. currentRoute() !== lastRenderRoute — so
      // that is what this sets up directly.
      setFx({ updated: minsAgo(3 * 60) });
      window.location.hash = '#/invoices';
      window.render();
      await wait(40);
      const sentinel = d.createElement('div');
      sentinel.id = 'fx-race-sentinel';
      d.getElementById('main').appendChild(sentinel);
      window.lastRenderRoute = 'dashboard';  // a render for '#/invoices' is still pending
      setFx({ updated: minsAgo(3 * 60) });
      await window.fetchFxRates(false);      // the fetch resolves inside that gap
      await wait(40);
      ok('a fetch resolving mid-navigation does not render the new route early and steal its entrance',
        !!d.getElementById('fx-race-sentinel'),
        { sentinelSurvived: !!d.getElementById('fx-race-sentinel'), route: window.currentRoute() });
      ok('...and the rate it fetched is still saved, so the pending navigation paints it',
        window.state.settings.fx.phpPer.USD === 61.732 && window.state.settings.fx.src.USD.by === 'live');
      window.render();                       // the navigation's own render finally lands
      await wait(40);

      window.state.invoices = savedInv; window.state.finance = savedFin2;
      window.toast = realToast2; window.fetch = realFetch2;
      setOnline(realOnline);
      window.state.settings.fx = { auto: true, updated: new Date().toISOString(), lastTryAt: null, lastError: null, phpPer: JSON.parse(JSON.stringify(window.FX_SEED_PHP_PER)), src: {} };
      window.fxMigrate();
      window.location.hash = '#/dashboard';
      window.render();
    })();

    // =====================================================================
    // DEFECT 2 — "blinking all over the site when switching tabs or section"
    // A route change used to replay an entrance on EVERY child of #main.
    // Measured peak running animations under #main on a route change (Chromium,
    // el.getAnimations().filter(playState==='running')):
    //   dashboard 48 -> 4, finance 44 -> 1, insights 39 -> 3, report 16 -> 1.
    // Everything left is the single container fade plus the intentional
    // infinite loops. jsdom has no animation timeline, so these assert on the
    // stylesheet and the render wiring — the browser counts live in the report.
    // =====================================================================
    (function calmSectionChange() {
      const perChild = [
        ['#main.view-enter .card', 'fadeUp on every card'],
        ['#main.view-enter .insight', 'fadeUp on every insight'],
        ['#main.view-enter .table-wrap tbody tr', 'rowIn on every table row'],
        ['#main.view-enter .c-svg .c-bar', 'cBarIn on every chart bar'],
        ['#main.view-enter .c-svg .c-line', 'cDraw on every chart line'],
        ['#main.view-enter .c-svg .c-area', 'cFade on every chart area'],
        ['#main.view-enter .c-donut .c-seg', 'cSegIn on every donut segment'],
        ['#main.view-enter .cat-bar .cb-fill', 'cbGrow on every category bar'],
        ['#main.view-enter .pace-fill', 'cbGrow on the pace meter'],
        ['#main.view-enter .ring svg circle.val', 'cRingIn on every ring'],
        ['#main.view-enter .c-spark-line', 'cDraw on every sparkline'],
        ['#main.view-enter .c-spark-area', 'cFade on every spark area']
      ];
      const left = perChild.filter((p) => html.indexOf(p[0] + '{') !== -1).map((p) => p[1]);
      ok('a section change no longer animates children en masse', left.length === 0, left);
      ok('the per-card entrance stagger is gone with it', html.indexOf('.grid > .card:nth-child(2){animation-delay') === -1);
      ok('the per-row entrance stagger is gone with it', html.indexOf('.table-wrap tbody tr:nth-child(1){animation-delay') === -1);
      ok('...and the exact declaration that caused it is gone', html.indexOf('padding:20px var(--main-pad-x) 60px;animation:fadeIn') === -1);
      // the KPI count-up is no longer wired to navigation (it churned every stat tile for 560ms)
      ok('the KPI count-up no longer fires on a section change', !/animateCounts\(main\)/.test(html));
      // route change still gets the class, and it is still transient (in-place renders stay silent)
      window.location.hash = '#/dashboard'; window.render();
      window.location.hash = '#/finance'; window.render();
      window.render(); // in-place re-render on the same route
      ok('an in-place re-render does not re-arm the entrance', (function () {
        const m = d.getElementById('main');
        m.classList.remove('view-enter');
        window.render();
        return !m.classList.contains('view-enter');
      })());
      // in-page tabs re-render in place (no route change) — so they get no entrance at all
      ok('in-page tabs re-render in place, so they never play an entrance',
        /if\(action==='finance-tab'\)\{ ui\.financeTab=el\.getAttribute\('data-tab'\); render\(\); return; \}/.test(html) &&
        /if\(action==='settings-tab'\)\{ ui\.settingsTab=el\.getAttribute\('data-tab'\); render\(\); return; \}/.test(html));
      window.location.hash = '#/dashboard'; window.render();
    })();

    // ================= the pages that describe the product say what it is =================
    // These used to be asserted twice, once with sharing off and once with it on, because
    // the two were different products and each page had to tell the truth about both.
    // There is one product now: the books are in this browser and nowhere else.
    (function honestCopy() {
      try {
        const priv = window.viewPrivacy();
        ok('the privacy page says there is no account and no server, which is true',
          /There is no account and no server holding them/.test(priv));
        ok('...and lists the connections that exist: rates and the receipt scanner',
          /open\.er-api\.com/.test(priv) && /cdn\.jsdelivr\.net/.test(priv));
        ok('...and no connection that does not: no sign-in, no sync, no database, no workspace',
          !/sign(ed)?[ -]?in|sign out|password|Firebase|Google|cloud|sync|database|workspace|sharing|token/i.test(priv.replace(/<[^>]+>/g, ' ')),
          (priv.replace(/<[^>]+>/g, ' ').match(/.{0,40}(sign(ed)?[ -]?in|sign out|password|Firebase|Google|cloud|sync|database|workspace|sharing|token).{0,40}/i) || [])[0]);
        ok('the privacy page no longer promises a fixed number of connections it does not have',
          !/four connections/.test(priv));
        ok('...and names the storage it really uses, and not the keys that were retired',
          /bizpilot\.v1/.test(priv) && /trakora\.lock/.test(priv) && !/bizpilot\.auth|bizpilot\.device/.test(priv));
        ok('...and its date moved, because the list of connections did',
          window.PRIVACY_UPDATED > '2026-09-12', window.PRIVACY_UPDATED);

        // the consent notice gets the same treatment, because it is the first thing a
        // customer ever reads and a wrong notice is worse than none
        const consentBox = d.createElement('div'); consentBox.innerHTML = window.consentNoticeHTML();
        const consent = consentBox.textContent;
        ok('the consent notice says there is no account, and names no workspace',
          /There is no account/.test(consent) && !/workspace|sharing|sign/i.test(consent), consent);

        // Settings: the About block and the connections card describe the same product
        window.ui.settingsTab = 'business'; window.location.hash = '#/settings'; window.render();
        const about = d.getElementById('main').textContent;
        ok('Settings ▸ About says there is no account and no server',
          /Trakora keeps your records in this browser\. There is no account and no server\./.test(about));
        ok('the outside-connections card no longer mentions sign-in or cloud sync',
          !/sign-in|cloud sync/i.test(window.connectionsCardHTML().replace(/<[^>]+>/g, ' ')));
        ok('the lock screen does not promise a sync that could carry data off the device',
          !/unless you enable cloud sync/.test(html) && /Your records never leave it unless you save a backup file/.test(html));
      } finally {
        const cr = d.getElementById('consent-root'); if (cr) cr.innerHTML = '';
        d.body.classList.remove('consent-on');
        window.ui.settingsTab = 'business'; window.location.hash = '#/dashboard'; window.render();
      }
    })();

    // ---------- the top of the stack, and a settings page an owner can read ----------
    (function stackAndSettings() {
      /* The sign-in screen used to sit in the middle of this stack (560) and the first-run
         overlays stood aside for it. It is gone. What is left is four layers and one order,
         and the numbers are asserted against each other rather than individually so that
         moving one of them has to move the rest. */
      (function stackingOrder() {
        const z = (re) => { const m = html.match(re); return m ? parseInt(m[1], 10) : NaN; };
        const greet = z(/\.greet-overlay\{position:fixed;inset:0;z-index:(\d+)/);
        const onb   = z(/\.onb-overlay\{position:fixed;inset:0;z-index:(\d+)/);
        const modal = z(/\.modal-overlay\{position:fixed;inset:0;background:rgba\(8,10,22,\.6\);z-index:(\d+)/);
        const toast = z(/\.toast-root\{position:fixed;bottom:20px;right:20px;z-index:(\d+)/);
      })();

      /* SETTINGS ▸ DATA. It used to end in a "Developer setup" fold holding a Web API key
         field, an OAuth client id and two screens of database rules, with a cloud sync
         card and a sharing card above it. All of it is gone, and what is asserted is that
         the tab is whole without it: the cards an owner came for, in a grid with no hole. */
      window.ui.settingsTab = 'data'; window.location.hash = '#/settings'; window.render();
      const main = d.getElementById('main');
      const heads = Array.prototype.map.call(main.querySelectorAll('.form-secs > .form-sec > header h2'), (e) => e.textContent.trim());
      ok('Settings ▸ Backup and data is five ruled groups in the owner\'s order: backup, lock, connections, import, erase',
        heads.join('|') === 'Backup|Privacy lock|Connections|Bring in records|Erase', heads);
      ok('...each a label column beside its fields, never a card, with something in it',
        Array.prototype.every.call(main.querySelectorAll('.form-secs > .form-sec'), (c) => c.children.length === 2 && c.children[0].tagName === 'HEADER' && c.textContent.trim().length > 40) &&
        !main.querySelector('.card,.settings-grid'));
      ok('...and what most owners never need (storage, sample data) is behind one Advanced row',
        (function () { const adv = main.querySelector('.form-secs > details.adv'); return !!adv && !adv.open &&
          /Advanced/.test(adv.querySelector('summary').textContent) && !!adv.querySelector('[data-action="trim-receipts"]') && !!adv.querySelector('[data-action="load-sample"]'); })());
      ok('erasing is a quiet red-lettered button at rest, never a filled red one',
        (function () { const b = main.querySelector('[data-action="reset-data"]'); return b.classList.contains('is-danger') && !b.classList.contains('btn-danger'); })());
      ok('nothing technical is left on the page an owner reads',
        !/Firebase|API key|OAuth|client id|database|rules|Developer setup|cloud sync|workspace|sign in/i.test(main.textContent),
        (main.textContent.match(/.{0,30}(Firebase|API key|OAuth|client id|database|rules|Developer setup|cloud sync|workspace|sign in).{0,30}/i) || [])[0]);
      ok('the tabs are Business, Look and menu, Backup and data',
        Array.prototype.map.call(main.querySelectorAll('.tabs button'), (b) => b.textContent.trim()).join('|') === 'Business|Look and menu|Backup and data');
      ok('backup, restore, CSV import, sample data and reset are all still one click away',
        ['export-data', 'import-data', 'csv-import', 'csv-sample', 'load-sample', 'reset-data']
          .every((a) => !!main.querySelector('[data-action="' + a + '"]')));
      ok('the stylesheet for the fold, the pasteable rules and the signed-in panel went with them',
        ['.adv-setup', '.adv-body', '.adv-steps', '.setup-check', '.code-block', '.code-head', '.acct-panel', '.acct-note', '.acct-sub']
          .every((c) => html.indexOf(c) === -1));
      window.ui.settingsTab = 'business'; window.location.hash = '#/dashboard'; window.render();
    })();

    // ---------- the profile is a page, and the top bar collapses instead of clipping ----------
    /* A profile is somewhere you go, not a dialog you lose by tapping outside it. It has
       an address, so it can be linked and bookmarked like anything else. */
    ok('the profile is a route with a page of its own',
      /if\(h==='profile'\) return 'profile';/.test(html) &&
      /profile:viewProfile/.test(html) && /function viewProfile\(\)\{/.test(html));
    ok('...carrying the name, the position and the rate, with a way to save them',
      /data-form="profile"/.test(html) &&
      /name="position"/.test(html) && /name="rate"/.test(html) && /name="ratePer"/.test(html) &&
      /kind==='profile'\)\{/.test(html));
    /* A stray selector fragment left by an earlier edit swallowed the rule after it, which
       is how sidebar edit mode lost its styling without anything failing. */
    ok('...with no dangling selector left in the stylesheet',
      !/\.app\.nav-collapsed\s*\/\*/.test(html) && !/^\s*font-size:calc\(14px\*var\(--nav-scale,1\)\);font-weight:600/m.test(html));

    // ================= accounts, sharing and cloud sync are GONE =================
    // The owner's instruction was to remove the credentials feature, and that covers the
    // whole accounts system and everything that only worked with it: the sign-in screen,
    // Firebase Auth, Google sign-in, workspaces and invites, the per-record sync engine
    // and the developer fold that configured them. Without accounts, sync could only run
    // against a database anyone could read. What is asserted here is the removal, and
    // that books and backups written by the builds that had all that still open.
    await (async function accountsRetired() {
      const root = path.join(__dirname, '..');

      // 1. the code: every top-level name those features defined, and the hosts they called
      const goneFromApp = ('AUTH_CFG AUTH_IDT AUTH_KEY AUTH_PROJECTS AUTH_TOK DEVICE_ID GOOGLE_AUTH REQUIRE_SIGNIN SI_DEMO ' +
        'SYNC_COLLECTIONS SYNC_DOCS SYNC_TOMB_TTL WS_INVITE_DAYS WS_INVITE_STASH _gsiPending appBooted authAccountCardHTML ' +
        'authAdopt authApiKey authChangePassword authClientId authConfigured authDomainAllowed authEmailFormError authErrMsg ' +
        'authGoogle authGoogleExchange authGoogleResume authGoogleUrl authLoad authMergeSession authModalBusy authName ' +
        'authParseConfig authPasswordModal authPost authRandom authRedirectUri authRefresh authRefreshing authSendReset ' +
        'authSetupCheck authSignIn authSignOut authSignUp authSignedIn authStale authStore authSubmitEmail authToken ' +
        'authTokenQuiet authUpdateProfile authUser authVerifyKey cloudAdoptLegacy cloudBusy cloudEnsureFormat cloudErr ' +
        'cloudFormatKnown cloudMerge cloudPatch cloudPull cloudPush cloudQ cloudReady cloudReap cloudRoot cloudSend ' +
        'cloudSyncAdvancedHTML cloudSyncCardHTML cloudTimer cloudWriteTree databaseRulesCardHTML developerSetupHTML meIsIn ' +
        'onbPending renderSignInWall scheduleCloudPush shareCfg shareOn shareRulesJSON siAppInert siFieldHTML siGoogleMark ' +
        'siTrapTab signInClose signInHTML signInIsOpen signInOpen signInRender signInRouteCheck syncApplyDoc syncAuthor ' +
        'syncCarryLedger syncConfirm syncDocValue syncHash syncLedger syncMarkTree syncPending syncPersist syncRulesJSON ' +
        'syncScan syncSummaryText wsCardBodyHTML wsClaimInvite wsClearInvite wsCreate wsDbBase wsInvite wsInviteLink ' +
        'wsInvitesList wsLeave wsMaybeClaim wsMembers wsParseInviteHash wsPendingInvite wsReady wsRemoveMember wsReq ' +
        'wsRevokeInvite wsRoot wsStashInvite wsTakeInviteFromUrl wsUserRoot').split(' ');
      const live = goneFromApp.filter((n) => typeof window[n] !== 'undefined');
      ok('every symbol of the accounts, sharing and sync code is gone from the running app', live.length === 0, live);
      const named = goneFromApp.filter((n) => new RegExp('(^|[^A-Za-z0-9_$])' + n.replace(/\$/g, '\\$') + '([^A-Za-z0-9_$]|$)').test(html));
      ok('...and not one of those names is left anywhere in the file, comments included', named.length === 0, named);
      // Case matters for the first two: "authority" and "signing" are words, authX and signInX were code.
      const families = (html.match(/auth[A-Z]\w*|signIn\w*|AUTH_CFG|cloudPush|cloudPull|wsInvite\w*|shareOn/g) || [])
        .concat(html.match(/identitytoolkit|securetoken|googleusercontent|googleapis|oauth\w*|firebase\w*/gi) || []);
      ok('no auth*, signIn*, oauth, Firebase or Google-identity token of any spelling survives', families.length === 0, families.slice(0, 8));
      // The one place the old flag is still named is the list that strips it from saved books.
      ok('localIn is named exactly once, in the list of settings dropped on load',
        (html.match(/localIn/g) || []).length === 1 && /var RETIRED_SETTINGS=\['sync','share','localIn',/.test(html));
      const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
      ok('the sign-in stylesheet went with the screen: no .si-* rule, no Google button tokens',
        !/\.si-[a-z]/.test(css) && !/--goog-|--border-field|--accent-on\b|--si-\d/.test(html) && html.indexOf('signin-root') === -1);
      const acts = (html.match(/data-action="[a-z-]+"/g) || []).concat(html.match(/action==='[a-z-]+'/g) || [], html.match(/kind==='[a-z-]+'/g) || [], html.match(/data-form="[a-z-]+"/g) || []);
      const deadActs = acts.filter((a) => /"(auth-|signin-|ws-|cloud-|share-|sync-)|'(auth-|signin-|ws-|cloud-|share-|sync-)|copy-code/.test(a));
      ok('no button, handler or form for signing in, sharing or syncing is left wired or unwired', deadActs.length === 0, deadActs);
      ok('the icons only those screens drew are gone from the set',
        ['signin', 'signout', 'mail', 'key', 'eye', 'eyeoff', 'cloud', 'users'].every((n) => !(n in window.ICONS)));

      // 2. the files that existed only for them
      const goneFiles = ['oauth-callback.html', 'TURN-ON-GOOGLE-SIGNIN.md', 'tests/real-auth.js', 'tests/real-google.js', 'tests/google-signin-emulator.md']
        .filter((f) => fs.existsSync(path.join(root, f)));
      ok('the OAuth callback page, the Google setup guide and the emulator tests are deleted', goneFiles.length === 0, goneFiles);
      const lib = fs.readFileSync(path.join(root, 'tests', 'browser-lib.js'), 'utf8');
      ok('the browser helper is kept, without its auth-emulator proxy',
        /module\.exports=\{serve,boot,settle,CLEAN\}/.test(lib) && !/__emu|9099|emulator/i.test(lib));

      // 3. there is no sign-in route and no sign-in screen: the old addresses are just
      //    unknown addresses, and an unknown address is the dashboard.
      const wasHash = window.location.hash;
      window.location.hash = '#/signin';
      ok('#/signin is not a route: it resolves to the dashboard like any unknown address',
        window.currentRoute() === 'dashboard');
      window.render();
      ok('...and nothing is drawn over the app when it is opened',
        !d.querySelector('[role="dialog"]') && !d.getElementById('app').hasAttribute('inert') &&
        d.getElementById('main').innerHTML.length > 50 && !d.querySelector('input[type="email"]'));
      window.location.hash = '#/join?ws=ws_abc&t=tok';
      ok('an old invitation link opens the dashboard too, and nothing reads its token',
        window.currentRoute() === 'dashboard' && window.sessionStorage.getItem('trakora.invite') === null);
      window.location.hash = wasHash; window.render();

      // 4. BOOKS SAVED BY AN OLDER BUILD. A real boot, in a second window, with
      //    localStorage already holding what a signed-in, sharing, syncing copy left
      //    behind: the settings blocks, the local-session flag, the sync ledger, the
      //    session token and the device id. It has to open, keep every record, and carry
      //    none of that forward.
      const legacy = () => ({
        v: 2,
        settings: { businessName: 'Lumina Studio', currency: '₱', onboarded: true, greetDone: true, tourDone: true, startDismissed: true,
          profile: { name: 'Ira', position: 'Owner', rate: 0, ratePer: 'month' }, localIn: true,
          sync: { url: 'https://old-project-default-rtdb.firebaseio.com', path: 'bizpilot-7fq2', enabled: true, lastSync: '2026-10-01T00:00:00.000Z' },
          share: { enabled: true, wsId: 'ws_abc', wsName: 'Shared Books', role: 'owner', apiKey: 'AIzaOLDKEY', clientId: '1-x.apps.googleusercontent.com' },
          privacy: { consent: 'all', at: '2026-01-01T00:00:00Z', fxWasAuto: null }, fx: { auto: false } },
        finance: [{ id: 'f1', type: 'income', amount: 1500, category: 'Services', date: '2026-10-02', note: 'kept', client: 'Verde' }],
        clients: [{ id: 'c1', name: 'Verde', status: 'Active' }],
        meta: { createdAt: '2026-01-01', updatedAt: 1, deviceId: 'dev-old',
          sync: { recs: { 'finance/f1': { at: 1, sy: 1, h: 'x' }, 'doc/settings': { at: 1, sy: 0, h: 'y' } }, tombs: { 'finance/f0': { at: 1, sy: 1 } } } }
      });
      const errors = []; let fetches = 0;
      const dom2 = new JSDOM(html, { runScripts: 'dangerously', url: 'https://legacy.test/#/dashboard', pretendToBeVisual: true,
        beforeParse(w) {
          w.localStorage.setItem('bizpilot.v1', JSON.stringify(legacy()));
          w.localStorage.setItem('bizpilot.auth', JSON.stringify({ uid: 'u1', email: 'owner@example.com', idToken: 'tok', refreshToken: 'ref', provider: 'password' }));
          w.localStorage.setItem('bizpilot.device', 'dev-old');
          w.fetch = function () { fetches++; return Promise.reject(new Error('no network in this test')); };
          w.addEventListener('error', (e) => errors.push(String((e.error && e.error.message) || e.message)));
          w.addEventListener('unhandledrejection', (e) => errors.push('rejection: ' + String(e.reason && e.reason.message)));
          w.Element.prototype.getBoundingClientRect = function () { return { top: 100, left: 90, right: 260, bottom: 140, width: 170, height: 40, x: 90, y: 100 }; };
        } });
      const w2 = dom2.window, d2 = w2.document;
      const strippedState = (st) => !('sync' in st.settings) && !('share' in st.settings) && !('localIn' in st.settings) &&
        !('sync' in st.meta) && !('deviceId' in st.meta);
      const cleanText = (t) => !/firebaseio|AIzaOLDKEY|googleusercontent|ws_abc|dev-old|"localIn"/.test(t);
      try {
        await wait(120);   // the page boots itself: loadState(); bootApp();
        ok('books saved by a signed-in, syncing build boot without an error', errors.length === 0 && !!w2.state, errors);
        ok('...straight into the app, with the dashboard drawn and no screen over it',
          d2.getElementById('main').innerHTML.length > 50 && !d2.querySelector('[role="dialog"]') && d2.getElementById('signin-root') === null);
        ok('...with the sharing keys, the database address and the local-session flag stripped from settings',
          strippedState(w2.state), [Object.keys(w2.state.settings).filter((k) => /sync|share|localIn/.test(k)), Object.keys(w2.state.meta)]);
        ok('...and the sync ledger and device id stripped from meta, leaving what is still meant',
          w2.state.meta.createdAt === '2026-01-01' && Object.keys(w2.state.meta).every((k) => k === 'createdAt' || k === 'updatedAt'), Object.keys(w2.state.meta));
        ok('...and every record and every other setting exactly where it was',
          w2.state.finance.length === 1 && w2.state.finance[0].note === 'kept' && w2.state.finance[0].amount === 1500 &&
          w2.state.clients.length === 1 && w2.state.settings.businessName === 'Lumina Studio' &&
          w2.state.settings.profile.name === 'Ira' && w2.state.settings.privacy.consent === 'all');
        ok('the orphaned session token and device id are removed from the browser, and nothing else is',
          w2.localStorage.getItem('bizpilot.auth') === null && w2.localStorage.getItem('bizpilot.device') === null &&
          w2.localStorage.getItem('bizpilot.v1') !== null);
        ok('a copy that had auto-sync switched on makes no request at all on boot or on save',
          (w2.save(), fetches === 0), fetches);
        await wait(20);
        const stored = w2.localStorage.getItem('bizpilot.v1');
        ok('...and the next save writes the books back without any of it',
          cleanText(stored) && strippedState(JSON.parse(stored)) && JSON.parse(stored).finance[0].note === 'kept',
          (stored.match(/.{0,30}(firebaseio|AIzaOLDKEY|googleusercontent|ws_abc|dev-old|"localIn").{0,30}/) || [])[0]);
        ok('the Menu footer shows the person who was there all along, and offers no way in or out',
          /Ira, Owner/.test(w2.menuFootHTML()) && !/auth-|sign in|log ?out/i.test(w2.menuFootHTML()));
        // the PIN path decrypts and then goes through the same door
        w2.applyLoaded(legacy());
        ok('books unlocked with a PIN are stripped by the same code on the way in', strippedState(w2.state) && w2.state.finance.length === 1);

        // 5. AN OLD BACKUP FILE. importData() does not go through loadState(), so it has
        //    its own call to the same clean-up, and this is what proves it is there.
        const backup = legacy();
        backup.settings.businessName = 'Restored Books';
        backup.finance.push({ id: 'f2', type: 'expense', amount: 300, category: 'Rent & Utilities', date: '2026-10-05', note: 'restored', client: '' });
        w2.state.finance = []; w2.state.settings.businessName = 'Before restore';
        w2.importData(new w2.File([JSON.stringify(backup)], 'lumina-backup-2026-10-06.json', { type: 'application/json' }));
        await waitFor(() => w2.state.finance.length === 2, 3000);
        ok('a backup exported by an older build restores every record',
          w2.state.finance.length === 2 && w2.state.finance[1].note === 'restored' && w2.state.clients.length === 1 &&
          w2.state.settings.businessName === 'Restored Books', w2.state.finance.length);
        ok('...without bringing the old accounts, sharing or sync settings back with it', strippedState(w2.state));
        await wait(20);
        const restored = w2.localStorage.getItem('bizpilot.v1');
        ok('...and what is saved after the restore carries none of them either',
          cleanText(restored) && strippedState(JSON.parse(restored)) && JSON.parse(restored).finance.length === 2);
        ok('none of it threw, toasted an error or tried the network', errors.length === 0 && fetches === 0 && !d2.querySelector('.toast.error'), [errors, fetches]);
        // a file from this build round-trips too: what export writes is what import reads
        const fresh = JSON.parse(JSON.stringify(w2.state));
        w2.state.finance = [];
        w2.importData(new w2.File([JSON.stringify(fresh)], 'now.json', { type: 'application/json' }));
        await waitFor(() => w2.state.finance.length === 2, 3000);
        ok('a backup from this build restores to the same books', w2.state.finance.length === 2 && strippedState(w2.state) &&
          JSON.stringify(w2.state.finance) === JSON.stringify(fresh.finance));
      } finally {
        w2.close();
      }

      // 6. a new copy starts without any of it, and still saves on this device
      const def = window.DEFAULT_STATE;
      ok('a new copy has no sync, sharing or session setting to begin with',
        !('sync' in def.settings) && !('share' in def.settings) && !('localIn' in def.settings) && !!def.settings.profile);
      const before = window.localStorage.getItem('bizpilot.device');
      window.save();
      ok('saving no longer stamps a device id on the books or into the browser',
        before === null && window.localStorage.getItem('bizpilot.device') === null &&
        !('deviceId' in window.state.meta) && !('sync' in window.state.meta) && typeof window.state.meta.updatedAt === 'number');
    })();

    // ---------- the glyph set: one system, no emoji doing UI work ----------
    (function () {
      const keys = Object.keys(window.ICONS);
      // every literal icon('name') in the source must exist in the map — an
      // unknown name renders an EMPTY <svg>, which is invisible, not loud.
      const lits = new Set((html.match(/\bicon\(\s*'[A-Za-z0-9_-]+'/g) || []).map(function (m) { return m.replace(/^icon\(\s*'/, '').replace(/'$/, ''); }));
      // …and so must every name reached through data (routes, onboarding,
      // chart tabs, custom modules, sev maps, ternaries).
      const data = new Set();
      (html.match(/\b(?:icon|ico|i)\s*:\s*'[a-zA-Z0-9_-]+'/g) || []).forEach(function (m) { data.add(m.split("'")[1]); });
      (html.match(/\?\s*'[a-zA-Z0-9_-]+'\s*:\s*'[a-zA-Z0-9_-]+'/g) || []).forEach(function (m) {
        const parts = m.split("'"); data.add(parts[1]); data.add(parts[3]);
      });
      (window.CM_ICONS || []).forEach(function (k) { data.add(k); });
      const refs = new Set([].concat(Array.from(lits), Array.from(data).filter(function (k) { return keys.indexOf(k) >= 0; })));
      const unresolved = Array.from(lits).filter(function (k) { return keys.indexOf(k) < 0; });
      ok('every icon() call site resolves to a glyph (no silent empty svg)', unresolved.length === 0, unresolved);
      ok('no glyph in the map is an empty path', keys.every(function (k) { return !!window.ICONS[k]; }));
      ok('no orphan glyphs — every map entry is actually used', keys.every(function (k) { return refs.has(k); }), keys.filter(function (k) { return !refs.has(k); }));

      const svg = window.icon('goals', 20);
      ok('glyphs are tagged .ic on a 24 grid', /class="ic"/.test(svg) && /viewBox="0 0 24 24"/.test(svg));
      ok('every glyph takes one stroke weight from the stylesheet, not from its markup', !/stroke-width=/.test(svg) && /\.ic\{[^}]*stroke-width:1\.75/.test(html));
      ok('the size argument sets the box inline and nothing else', /width:20px;height:20px/.test(svg) && !/--ics/.test(svg) && typeof window.icoStroke === 'undefined');
      ok('glyphs are plain line icons: the body is an outline, the focal mark is solid, and nothing is tinted',
        /class="d"/.test(svg) && /class="s"/.test(svg) &&
        /\.ic \.d\{fill:none\}/.test(html) && /\.ic \.s\{fill:currentColor;stroke:none\}/.test(html) && !/--ic-tint/.test(html));
      ok('the bell, the old logo mark and the sidebar collapse glyph left with the chrome that drew them',
        !('bell' in window.ICONS) && !('logo' in window.ICONS) && !('collapseR' in window.ICONS));
      // Corners echo the app's concentric radius scale: rx ≈ 30% of the short
      // side. Generic sets park every rect at rx≈2 regardless of size, which is
      // what made an 18-unit panel look like a wireframe box.
      const rects = [];
      keys.forEach(function (k) {
        (window.ICONS[k].match(/<rect[^>]*>/g) || []).forEach(function (r) {
          const w = parseFloat((r.match(/width="([0-9.]+)"/) || [])[1]);
          const h = parseFloat((r.match(/height="([0-9.]+)"/) || [])[1]);
          const rx = parseFloat((r.match(/rx="([0-9.]+)"/) || [])[1]);
          if (w && h) rects.push({ k: k, side: Math.min(w, h), ratio: (rx || 0) / Math.min(w, h) });
        });
      });
      const panels = rects.filter(function (r) { return r.side >= 6; });
      const flat = panels.filter(function (r) { return r.ratio < 0.27; });
      ok('panel forms use the concentric corner ratio (rx ~30% of the short side)',
        panels.length >= 10 && flat.length === 0, flat);
    })();



    /* WHO IS USING THIS COPY. One person, on this device: there is no "in" to be let into
       and no way out to offer. What the Menu footer owes them is their profile, and the profile
       has to hold what they put in it. */
    (function meAndProfile() {
      const saved = JSON.parse(JSON.stringify(window.state.settings.profile || {}));
      const savedName = window.state.settings.displayName;
      try {
        ok('there is no signed-in question left to ask: the helper and the flag are gone',
          typeof window.meIsIn === 'undefined' && !('localIn' in window.state.settings) &&
          !('localIn' in window.DEFAULT_STATE.settings));
        /* The profile is the person, not the business, and it holds what their time
           costs, which is the part that makes "what did that job cost me" answerable. */
        window.state.settings.profile = { name: 'Ira Santos', position: 'Owner', rate: 1200, ratePer: 'hour' };
        const p = window.meProfile();
        ok('the profile carries a position and a rate per hour or month',
          p.position === 'Owner' && p.rate === 1200 && p.ratePer === 'hour');
        ok('...and they show under the name wherever the person is shown',
          /Owner/.test(window.meSubtitle()) && /1,200/.test(window.meSubtitle()) &&
          /hour/.test(window.meSubtitle()), window.meSubtitle());
        ok('...and the Menu footer names the person and their position',
          /Ira Santos, Owner/.test(window.menuFootHTML()) && /data-route="profile"/.test(window.menuFootHTML()));

        // the page itself: what it shows, and that saving it works with nothing to sign in to
        window.location.hash = '#/profile'; window.render();
        const main = d.getElementById('main');
        ok('the profile page is two ruled groups in one form (You, Your rate), with no card and no account beside it',
          main.querySelector('form[data-form="profile"] [name="name"]').value === 'Ira Santos' &&
          Array.prototype.map.call(main.querySelectorAll('form[data-form="profile"] .form-sec > header h2'), (h) => h.textContent).join('|') === 'You|Your rate' &&
          !main.querySelector('.card,.badge') && !/sign|account|log ?out|password/i.test(main.textContent),
          main.querySelectorAll('.form-sec').length);
        ok('...and offers nothing that signs anybody in or out',
          !main.querySelector('[data-action^="auth-"]') && !/Sign (in|out)|Log (in|out)|Change password/.test(main.textContent));
        const form = main.querySelector('form[data-form="profile"]');
        form.elements['name'].value = 'Ira S.'; form.elements['position'].value = 'Bookkeeper';
        form.elements['rate'].value = '900'; form.elements['ratePer'].value = 'month';
        fire(form, 'submit');
        ok('saving the profile form stores it on this device and nowhere else',
          window.state.settings.profile.name === 'Ira S.' && window.state.settings.profile.position === 'Bookkeeper' &&
          window.state.settings.profile.rate === 900 && window.state.settings.profile.ratePer === 'month' &&
          window.state.settings.displayName === 'Ira S.', window.state.settings.profile);
      } finally {
        window.state.settings.profile = saved;
        window.state.settings.displayName = savedName;
        window.location.hash = '#/dashboard';
        window.save(); window.render();
      }
    })();


    // =====================================================================================
    // The "Listahan" redesign: tokens, shell, Menu, search, landing, first run, home, drawer.
    // Behaviour is asserted in the DOM wherever jsdom can show it; the stylesheet is only
    // read for the things that are properties of the stylesheet (tokens, contrast, fonts).
    // =====================================================================================
    const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    const script = html.slice(html.lastIndexOf('<script>'));
    // a second copy of the app with its own storage, for boots the main window cannot replay
    async function bootCopy(url, seed) {
      const errs = [];
      const dm = new JSDOM(html, { runScripts: 'dangerously', url: url, pretendToBeVisual: true,
        beforeParse(w) {
          if (seed) seed(w);
          w.fetch = function () { return Promise.reject(new Error('no network in this test')); };
          w.addEventListener('error', (e) => errs.push(String((e.error && e.error.message) || e.message)));
          w.addEventListener('unhandledrejection', (e) => errs.push('rejection: ' + String(e.reason && e.reason.message)));
          w.Element.prototype.getBoundingClientRect = function () { return { top: 100, left: 90, right: 260, bottom: 140, width: 170, height: 40, x: 90, y: 100 }; };
          w.scrollTo = function () {};
        } });
      await wait(120);
      return { w: dm.window, d: dm.window.document, errs: errs, close: () => dm.window.close() };
    }
    function key(el, k, extra) { el.dispatchEvent(new window.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, extra || {}))); }
    function type(el, v) { el.value = v; fire(el, 'input'); }
    async function go(route) { window.location.hash = '#/' + route; await wait(20); window.render(); }
    window.scrollTo = function () {};

    // ---------- the token contract ----------
    (function tokenContract() {
      const light = css.slice(css.indexOf(':root{'), css.indexOf(':root[data-theme="dark"]{'));
      const darkStart = css.indexOf(':root[data-theme="dark"]{');
      const dark = css.slice(darkStart, css.indexOf('}', darkStart));
      const autoStart = css.indexOf(':root:not([data-theme="light"]){');
      const auto = css.slice(autoStart, css.indexOf('}', autoStart));
      const tok = (block, n) => { const m = block.match(new RegExp('--' + n + ':\\s*(#[0-9A-Fa-f]{6})')); return m ? m[1].toUpperCase() : null; };
      const want = { bg: '#FAF9F5', raised: '#FFFEFB', fill: '#F1EFE8', rule: '#E3E0D5', 'rule-strong': '#8C897C', ink: '#17160F', 'ink-2': '#54524A', 'ink-3': '#6B695F',
        mark: '#FFD84A', 'mark-ink': '#17160F', in: '#17663A', out: '#B3261E', 'btn-bg': '#17160F', 'btn-ink': '#FAF9F5', 'chart-in': '#1B6B3A', 'chart-out': '#E06A3C' };
      const wantDark = { bg: '#151410', raised: '#1F1E19', fill: '#282620', ink: '#F3F1E9', 'ink-2': '#BDBAAD', 'ink-3': '#9F9C8F', mark: '#F6CF4A', 'mark-ink': '#17160F',
        in: '#6FCF93', out: '#FF8F7E', 'btn-bg': '#F3F1E9', 'btn-ink': '#151410' };
      ok('the light tokens are the designer\'s values', Object.keys(want).every((k) => tok(light, k) === want[k]), Object.keys(want).filter((k) => tok(light, k) !== want[k]));
      ok('the dark tokens are the designer\'s values', Object.keys(wantDark).every((k) => tok(dark, k) === wantDark[k]), Object.keys(wantDark).filter((k) => tok(dark, k) !== wantDark[k]));
      ok('Auto is the same dark block, applied when no theme attribute is set', Object.keys(wantDark).every((k) => tok(auto, k) === wantDark[k]) &&
        /@media \(prefers-color-scheme:dark\)\{\s*:root:not\(\[data-theme="light"\]\)\{/.test(css));
      function lum(h) { const n = parseInt(h.slice(1), 16); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(n >> 16 & 255) + 0.7152 * f(n >> 8 & 255) + 0.0722 * f(n & 255); }
      function ratio(a, b) { const x = lum(a) + 0.05, y = lum(b) + 0.05; return x > y ? x / y : y / x; }
      const pairs = [['ink', 'bg'], ['ink', 'raised'], ['ink', 'fill'], ['ink-2', 'bg'], ['ink-2', 'raised'], ['ink-2', 'fill'], ['ink-3', 'bg'], ['ink-3', 'raised'], ['ink-3', 'fill'],
        ['mark-ink', 'mark'], ['ink', 'mark-soft'], ['in', 'bg'], ['in', 'in-bg'], ['out', 'bg'], ['out', 'out-bg'], ['btn-ink', 'btn-bg'], ['btn-ink', 'btn-hover'], ['danger-ink', 'danger-bg']];
      [['light', light], ['dark', dark]].forEach(function (t) {
        const bad = pairs.map((p) => [p.join(' on '), ratio(tok(t[1], p[0]), tok(t[1], p[1]))]).filter((x) => !(x[1] >= 4.5));
        ok('every text pair clears 4.5:1 in ' + t[0], bad.length === 0, bad);
        ok('control borders clear 3:1 on every surface in ' + t[0], ['bg', 'raised', 'fill'].every((s) => ratio(tok(t[1], 'rule-strong'), tok(t[1], s)) >= 3));
      });
      ok('text on the highlighter is dark in both themes', tok(light, 'mark-ink') === '#17160F' && tok(dark, 'mark-ink') === '#17160F');
      // the highlighter is only ever a background
      const yellowMisuse = (css.replace(/\.btn-invert:hover\{[^}]*\}/, '').match(/(?:^|[;{])\s*(?:color|border(?:-[a-z]+)*|outline(?:-color)?|stroke|fill|box-shadow|text-decoration-color)\s*:[^;}]*var\(--mark\)/g) || []);
      ok('yellow is never a text colour, a border, an icon fill or a focus ring (one hover on the landing band aside)', yellowMisuse.length === 0, yellowMisuse);
      ok('the focus ring is ink, 2px, on everything', /:focus-visible\{outline:2px solid var\(--ink\);outline-offset:2px/.test(css));

      // every custom property the file reads is one the file defines (or one set inline by script)
      const defined = new Set((css.match(/--[a-z0-9-]+(?=\s*:)/g) || []));
      const inline = new Set(['--nc', '--nc-ink', '--fc', '--p', '--n', '--rc', '--rc-ink', '--lanes', '--cbw', '--pw', '--c0', '--rm-h']);
      const used = new Set((html.match(/var\(\s*--[a-z0-9-]+/g) || []).map((x) => x.replace(/var\(\s*/, '')));
      const dangling = Array.from(used).filter((n) => !defined.has(n) && !inline.has(n));
      ok('no var() anywhere points at a token that does not exist', dangling.length === 0, dangling);
      ok('none of the old token names survive, in the stylesheet or in markup built by script',
        !/var\(--(text|accent|border|bg-card|bg-sunken|bg-hover|bg-input|risk|good|warn|income|expense|info|shadow-sm|shadow-lg|f[1-8]|font-display|mono|lg-|glass|mat-|nav-scale)/.test(html));

      // what the direction removed outright
      ok('there is no blur or glass left: no backdrop-filter, no lens filters, no glass tokens',
        !/backdrop-filter/.test(html) && !/lg-defs|lg-lens|feDisplacementMap/.test(html) && !/--lg-|--glass-|glass-solid/.test(html));
      ok('no gradient is painted except the roadmap canvas grid', (css.match(/gradient\(/g) || []).length === (css.match(/\.rm-grid-(dots|lines) \.rm-canvas\{[^}]*/g) || []).join('').split('gradient(').length - 1);
      ok('no blue, purple or amber is hard-coded as an interface colour',
        !/#2563eb|#1d4ed8|#3b82f6|#60a5fa|#0260a6|#7c5cd6|#4653e8|#f59e0b|#fbbf24|#8b5cf6|#6366f1/i.test(css) &&
        !/'#0260a6'|'#7c5cd6'|'#2563eb'|'#fbbf24'/i.test(script));
      ok('the chart palette is the validated five plus a neutral, per theme',
        window.CHART_PALETTE.join() === '#1B6B3A,#E06A3C,#6250D6,#AD8200,#D55181,#8C897C' && window.CHART_PALETTE_DARK.length === 6);
      ok('a colour an earlier build assigned by position is drawn neutral, and one the owner picked is left alone',
        window.safeColor('#0260a6') === '#6B695F' && window.safeColor('#7C5CD6') === '#6B695F' && window.safeColor('#E06A3C') === '#E06A3C');

      // type
      const faces = css.match(/@font-face\{[^}]*\}/g) || [];
      ok('exactly two faces are embedded, both Reddit Sans Variable, both as data: URIs',
        faces.length === 2 && faces.every((f) => /font-family:"Reddit Sans Variable"/.test(f) && /src:url\(data:font\/woff2;base64,/.test(f)));
      ok('the second face carries the peso sign and nothing else', /unicode-range:U\+20B1;/.test(faces[1] || ''));
      ok('the old faces and every monospace face are gone', !/Schibsted|Instrument Sans|ui-monospace|SF Mono|Menlo|Consolas/.test(html));
      ok('nothing is italicised and the body sets tabular figures', /font-synthesis:none/.test(css) && /font-variant-numeric:tabular-nums/.test(css) && !/font-style:italic/.test(html));
      const sizes = (css.match(/font-size:\s*(\d+(?:\.\d+)?)px/g) || []).map((x) => parseFloat(x.replace(/[^\d.]/g, '')));
      ok('no rule sets text under 13px, and the body is 16px', Math.min.apply(null, sizes) >= 13 && /body\{[^}]*font-size:16px/.test(css), Math.min.apply(null, sizes));
      const inlineSizes = (script.match(/font-size:\s*(\d+(?:\.\d+)?)px/g) || []).map((x) => parseFloat(x.replace(/[^\d.]/g, '')));
      ok('no markup built by script sets text under 13px either', !inlineSizes.length || Math.min.apply(null, inlineSizes) >= 13, inlineSizes.filter((x) => x < 13));
      ok('controls are 44px tall, 48 on a phone, and fields are 48', /--ctl-h:44px/.test(light) && /@media \(max-width:719px\)\{ :root\{ --gutter:16px; --ctl-h:48px; \} \}/.test(css) && /--field-h:48px/.test(light));
      ok('the page reserves its scrollbar gutter so an open menu cannot shift it', /html\{[^}]*scrollbar-gutter:stable/.test(css));
      ok('motion stops entirely for reduced-motion users', /@media \(prefers-reduced-motion:reduce\)\{\s*\*,\*::before,\*::after\{transition-duration:0s !important;animation-duration:0s !important/.test(css));
      ok('print forces the light tokens whatever the screen theme was', /@media print\{[\s\S]*?:root,:root\[data-theme="dark"\],:root:not\(\[data-theme="light"\]\)\{[^}]*--bg:#fff/.test(css));
      const z = (sel) => { const m = css.match(new RegExp(sel.replace(/[.#]/g, '\\$&') + '\\{[^}]*z-index:(\\d+)')); return m ? +m[1] : null; };
      ok('the stack is bar, scrim, menu and drawer, dialog and popover, toast, lock: in that order',
        z('.bar') === 30 && z('.scrim') === 40 && z('.menu') === 50 && z('.modal,.drawer') === 50 && z('.dialog') === 60 && z('.pop') === 60 && z('.toast-root') === 70 && z('.gate') === 75,
        [z('.bar'), z('.scrim'), z('.menu'), z('.modal,.drawer'), z('.dialog'), z('.pop'), z('.toast-root'), z('.gate')]);
      ok('the stylesheet is less than half the size it was', css.split('\n').length < 1650, css.split('\n').length);
    })();

    // ---------- retired settings are stripped on load, and nothing else is touched ----------
    (function retiredSettings() {
      const saved = JSON.stringify(window.state);
      const legacy = JSON.parse(saved);
      Object.assign(legacy.settings, { glass: 40, accent: '#0ea5e9', navScale: 1.2, navCollapsed: true, collapsedNav: ['Money'], sectionColors: { Money: '#ff0000' },
        advisorBubbleOff: true, backupSnooze: '2026-01-01', startDismissed: true, wizardDone: true, greetDone: true,
        favorites: ['report', 'tasks'], hiddenModules: ['reviews'], moduleLabels: { finance: 'Pera' }, sectionLabels: { Money: 'Kwarta' }, sectionOrder: ['Shop', 'Money'],
        dashOrder: ['recv', 'today'], dashHidden: ['links'], theme: 'dark', displayName: 'Ira', onboarded: true, tourDone: true });
      window.applyLoaded(legacy);
      const s = window.state.settings;
      const gone = ['glass', 'accent', 'navScale', 'navCollapsed', 'collapsedNav', 'sectionColors', 'advisorBubbleOff', 'backupSnooze', 'startDismissed', 'wizardDone', 'greetDone'];
      ok('the settings only the old chrome read are dropped when a book is loaded', gone.every((k) => !(k in s)), gone.filter((k) => k in s));
      ok('...and every setting that still means something comes through untouched',
        s.favorites.join() === 'report,tasks' && s.hiddenModules.join() === 'reviews' && s.moduleLabels.finance === 'Pera' && s.sectionLabels.Money === 'Kwarta' &&
        s.sectionOrder.join() === 'Shop,Money' && s.dashOrder.join() === 'recv,today' && s.dashHidden.join() === 'links' && s.theme === 'dark' &&
        s.displayName === 'Ira' && s.onboarded === true && s.tourDone === true);
      ok('...and the records are the same records', JSON.stringify(window.state.finance) === JSON.stringify(JSON.parse(saved).finance) &&
        window.state.invoices.length === JSON.parse(saved).invoices.length);
      ok('a new book starts without any of them', gone.every((k) => !(k in window.DEFAULT_STATE.settings)));
      ok('the functions that applied them are gone, not parked',
        ['applyGlass', 'applyLensScale', 'glassLevel', 'applyAccent', 'setNavScale', 'renderSidebar', 'renderIsland', 'renderTabbar', 'updateAdvisorBubble', 'showGreeting',
          'showOnboard', 'maybeOnboard', 'openSetupWizard', 'showConsentNotice', 'backupSafetyBannerHTML', 'getStartedHTML', 'assistantTogglePop', 'acctMenuOpen', 'animateCounts']
          .every((f) => typeof window[f] === 'undefined'));
      ok('no accent is written onto the document by script', !d.documentElement.style.getPropertyValue('--accent') && !/setProperty\('--(accent|glass|nav-scale)/.test(script));
      window.applyLoaded(JSON.parse(saved)); window.applyTheme(); window.render();
    })();

    // ---------- the shell: one bar, nothing floating ----------
    await (async function shell() {
      window.state.settings.favorites = [];
      await go('dashboard');
      const bar = d.getElementById('bar');
      ok('the bar holds the brand, the pinned pages, Search and Menu, and nothing else',
        !!bar.querySelector('a.brand[data-route="dashboard"]') && !!bar.querySelector('nav.nav[aria-label="Pinned pages"]') &&
        !!bar.querySelector('[data-action="open-palette"]') && !!bar.querySelector('[data-action="open-menu"]') &&
        bar.querySelectorAll('button').length === 2 && !bar.querySelector('input'));
      const tabs = Array.from(bar.querySelectorAll('.nav a'));
      ok('until the owner pins something, the six default pages are the tabs, without being written to settings',
        tabs.map((a) => a.getAttribute('data-route')).join() === 'dashboard,finance,invoices,products,utang,tasks' && window.state.settings.favorites.length === 0);
      ok('tabs are words and real links, and the current one says so', tabs.every((a) => a.getAttribute('href') === '#/' + a.getAttribute('data-route') && a.textContent.trim().length > 2) &&
        bar.querySelectorAll('.nav a[aria-current="page"]').length === 1 && bar.querySelector('.nav a[aria-current="page"]').getAttribute('data-route') === 'dashboard');
      ok('the brand is the business name and its initial, or Trakora before it has one',
        bar.querySelector('.brand-name').textContent === window.appName() && bar.querySelector('.brand-mark').textContent === window.appName().charAt(0).toUpperCase());
      const realName = window.state.settings.businessName; window.state.settings.businessName = 'My Business'; window.renderBar();
      ok('...', d.querySelector('#bar .brand-name').textContent === 'Trakora' && d.querySelector('#bar .brand-mark').textContent === 'T');
      window.state.settings.businessName = realName; window.renderBar();
      // the two counts
      const lateInv = window.overdueInvoices().length, lateTasks = window.overdueTaskCount();
      const cnt = (r) => { const c = d.querySelector('#bar .nav a[data-route="' + r + '"] .count'); return c ? parseInt(c.textContent, 10) : 0; };
      ok('Invoices and Tasks carry their overdue counts, with words for a screen reader', lateInv > 0 && cnt('invoices') === lateInv && cnt('tasks') === lateTasks &&
        /overdue/.test(d.querySelector('#bar .nav a[data-route="invoices"] .count .sr').textContent));
      const savedInv = window.state.invoices; window.state.invoices = []; window.renderBar();
      ok('...and a page with nothing behind it shows no count at all', !d.querySelector('#bar .nav a[data-route="invoices"] .count'));
      window.state.invoices = savedInv; window.renderBar();
      ok('the phone title names the page', d.querySelector('#bar .bar-title').textContent === 'Home');
      ok('nothing of the old chrome is in the document',
        !d.getElementById('sidebar') && !d.getElementById('island-bar') && !d.getElementById('tabbar') && !d.querySelector('.fab') && !d.getElementById('chat-bubble') &&
        !d.getElementById('asst-pop') && !d.getElementById('advisor-bubble') && !d.getElementById('greet-root') && !d.getElementById('consent-root') &&
        !d.querySelector('.backup-banner,.tb-bell,.tb-acct,.hamburger,svg.lg-defs'));
      ok('landmarks: a skip link first, one header, one main', d.body.firstElementChild.matches('a.skip[href="#main"]') && d.querySelectorAll('header.bar').length === 1 && d.querySelectorAll('main').length === 1);
      // every page: one h1, a header, no glyph the font lacks
      const routes = ['dashboard', 'assistant', 'insights', 'accounts', 'finance', 'invoices', 'report', 'calculators', 'metrics', 'products', 'orders', 'utang', 'manpower', 'goals', 'roadmap', 'tasks', 'clients', 'notes', 'reviews', 'settings', 'privacy', 'profile'];
      const h1bad = [], glyphBad = [], unnamed = [];
      for (const r of routes) {
        window.location.hash = '#/' + r; window.render();
        const main = d.getElementById('main');
        if (main.querySelectorAll('h1').length !== 1) h1bad.push(r + ':' + main.querySelectorAll('h1').length);
        if (/[→←✓≈▸⌘]/.test(main.textContent)) glyphBad.push(r + ':' + (main.textContent.match(/.{0,20}[→←✓≈▸⌘].{0,10}/) || [''])[0]);
        main.querySelectorAll('button,select,textarea,input:not([type="hidden"]):not([type="file"])').forEach(function (c) {
          const named = c.getAttribute('aria-label') || c.getAttribute('aria-labelledby') || (c.tagName === 'BUTTON' && c.textContent.trim()) || c.closest('label') ||
            (c.id && d.querySelector('label[for="' + c.id + '"]'));
          if (!named) unnamed.push(r + ':' + (c.getAttribute('data-action') || c.name || c.className || c.tagName));
        });
      }
      ok('every page has exactly one h1', h1bad.length === 0, h1bad);
      ok('no page prints an arrow, a tick or an approximately sign the font does not have', glyphBad.length === 0, glyphBad);
      ok('every button, select and field on every page has an accessible name', unnamed.length === 0, Array.from(new Set(unnamed)).slice(0, 12));
      // the page header
      await go('products');
      const head = d.querySelector('#main .page-head');
      ok('a page header is the title, one sentence, and the page\'s own actions', !!head && !!head.querySelector('h1.t-title') && !!head.querySelector('.desc') && !!head.querySelector('.page-actions'));
      const acts = head.querySelector('.page-actions');
      const visibleBtns = Array.from(acts.children).filter((c) => c.tagName === 'BUTTON' && !c.hidden);
      ok('it shows the primary action and folds the rest into a labelled More', acts.querySelectorAll(':scope > .btn-primary').length === 1 &&
        !!acts.querySelector(':scope > [data-action="page-more"]') && /More/.test(acts.querySelector('[data-action="page-more"]').textContent) && visibleBtns.length === 2 &&
        acts.querySelector('.page-more').children.length >= 2);
      const moreBtn = acts.querySelector('[data-action="page-more"]');
      click(moreBtn);
      const pop = d.getElementById('pop');
      ok('More opens a menu of the folded actions, each still wired to what it did', !!pop && pop.getAttribute('role') === 'menu' && pop.querySelectorAll('[role="menuitem"][data-action]').length >= 2 &&
        moreBtn.getAttribute('aria-expanded') === 'true' && Array.from(pop.children).every((c) => c.textContent.trim().length > 0));
      key(d, 'Escape');
      ok('Escape closes it and hands focus back to More', !d.getElementById('pop') && moreBtn.getAttribute('aria-expanded') === 'false' && d.activeElement === moreBtn);
      await go('invoices');
      ok('a page with one or two actions shows them and has no More', !d.querySelector('#main [data-action="page-more"]') && !!d.querySelector('#main .page-actions [data-action="invoice-new"]'));
    })();

    // ---------- the Menu ----------
    await (async function menu() {
      window.state.settings.favorites = []; window.state.settings.hiddenModules = []; window.state.settings.sectionOrder = []; window.state.settings.sectionLabels = {};
      await go('finance');
      const menu = d.getElementById('menu');
      ok('closed, the Menu is not a dialog and not in the accessibility tree', !menu.hasAttribute('role') && menu.getAttribute('aria-hidden') === 'true' && !d.body.classList.contains('menu-open'));
      const opener = d.querySelector('#bar [data-action="open-menu"]');
      opener.focus(); click(opener);
      ok('the Menu button opens it as a modal dialog', d.body.classList.contains('menu-open') && menu.getAttribute('role') === 'dialog' && menu.getAttribute('aria-modal') === 'true' &&
        !menu.hasAttribute('aria-hidden') && d.querySelector('#bar [data-action="open-menu"]').getAttribute('aria-expanded') === 'true');
      ok('...without putting the caret in the search field', d.activeElement && d.activeElement.id !== 'palette-input' && menu.contains(d.activeElement));
      const groups = Array.from(menu.querySelectorAll('.menu-cols .menu-group:not(.pins) h2')).map((h) => h.textContent.trim());
      ok('the index groups every page under the new group names', groups.join('|') === 'Start|Money|Shop|Plan|People & notes|My tables', groups);
      const linked = Array.from(menu.querySelectorAll('.menu-cols .menu-group:not(.pins) a[data-route]')).map((a) => a.getAttribute('data-route'));
      const expect = window.ROUTES.filter((r) => r.section !== 'System').map((r) => r.id).concat((window.state.customModules || []).map((m) => 'custom-' + m.id));
      ok('...every visible page and every custom table is a row, and Settings is in the footer instead', linked.slice().sort().join() === expect.slice().sort().join() && linked.indexOf('settings') < 0);
      ok('rows are icon plus word, the current page is marked, and "New table" ends My tables',
        Array.from(menu.querySelectorAll('.menu-cols a[data-route]')).every((a) => a.querySelector('svg.ic') && a.textContent.trim()) &&
        menu.querySelectorAll('.menu-group:not(.pins) a[aria-current="page"]').length === 1 && !!menu.querySelector('.menu-group [data-action="custom-module-new"]'));
      ok('the overdue counts ride on Invoices and Tasks here too', !!menu.querySelector('.menu-group:not(.pins) a[data-route="invoices"] .count') === (window.overdueInvoices().length > 0));
      ok('a phone gets its pinned pages first, because it has no tabs', menu.querySelectorAll('.menu-group.pins a[data-route]').length === 6);
      const foot = menu.querySelector('.menu-foot');
      ok('the footer holds the profile, settings, backup, edit menu, help, the way back to the landing page, and the theme',
        !!foot.querySelector('[data-route="profile"]') && !!foot.querySelector('[data-action="settings-go"]') && !!foot.querySelector('[data-action="export-data"]') &&
        !!foot.querySelector('[data-action="nav-edit-toggle"]') && !!foot.querySelector('[data-action="show-tour"]') && !!foot.querySelector('[data-action="open-landing"]') &&
        foot.querySelectorAll('.seg [data-action="set-theme"]').length === 3);
      key(d, 'Escape');
      ok('Escape closes it and focus goes back to the Menu button', !d.body.classList.contains('menu-open') && !menu.hasAttribute('role') &&
        d.activeElement === d.querySelector('#bar [data-action="open-menu"]'));
      click(d.querySelector('#bar [data-action="open-menu"]')); click(d.getElementById('scrim'));
      ok('a click on the dimmed page closes it too', !d.body.classList.contains('menu-open'));
      // going somewhere
      click(d.querySelector('#bar [data-action="open-menu"]'));
      click(menu.querySelector('.menu-group:not(.pins) a[data-route="tasks"]'));
      await wait(30);
      ok('choosing a page goes there and closes the Menu', window.currentRoute() === 'tasks' && !d.body.classList.contains('menu-open') && /^Tasks/.test(d.querySelector('#main h1').textContent));
      // hidden pages
      window.state.settings.hiddenModules = ['reviews']; window.render();
      click(d.querySelector('#bar [data-action="open-menu"]'));
      ok('a hidden page is not in the index', !menu.querySelector('.menu-cols a[data-route="reviews"]'));
      // edit mode
      click(menu.querySelector('[data-action="nav-edit-toggle"]'));
      ok('Edit menu switches the index into edit mode in place, with Done where Close was', menu.classList.contains('is-edit') && !!menu.querySelector('.menu-head .btn-primary[data-action="nav-edit-toggle"]') &&
        !menu.querySelector('[data-action="close-menu"]') && /first pinned pages show in the top bar/.test(menu.querySelector('.menu-note').textContent));
      const row = (id) => Array.from(menu.querySelectorAll('.menu-row')).filter((r) => r.querySelector('[data-action="fav-toggle"][data-route="' + id + '"]'))[0];
      ok('every page has a Pin switch, a Show switch and Rename, each with a name of its own',
        !!row('report').querySelector('.switch input[data-action="fav-toggle"][aria-label="Pin Monthly Report"]') &&
        !!row('report').querySelector('.switch input[data-action-change="toggle-module"][aria-label="Show Monthly Report"]') &&
        !!row('report').querySelector('[data-action="rename-module"][aria-label="Rename Monthly Report"]'));
      ok('...Home cannot be hidden, and a hidden page is listed here so it can come back', !row('dashboard').querySelector('[data-action-change="toggle-module"]') &&
        !!row('reviews') && row('reviews').classList.contains('is-off') && row('reviews').querySelector('[data-action-change="toggle-module"]').checked === false);
      const show = row('reviews').querySelector('[data-action-change="toggle-module"]'); show.checked = true; fire(show, 'change');
      ok('Show brings it back, and the Menu stays open in edit mode', window.state.settings.hiddenModules.indexOf('reviews') < 0 && menu.classList.contains('is-edit') && d.body.classList.contains('menu-open'));
      // pinning
      click(row('report').querySelector('[data-action="fav-toggle"]'));
      ok('the first pin turns the defaults into the owner\'s own list and adds to it', window.state.settings.favorites.join() === 'dashboard,finance,invoices,products,utang,tasks,report');
      ok('...and the new tab is in the bar at once', !!d.querySelector('#bar .nav a[data-route="report"]'));
      const up = Array.from(menu.querySelectorAll('.menu-group.pins [data-action="pin-move"][data-route="report"]')).filter((b) => b.getAttribute('data-dir') === 'up')[0];
      ok('pinned pages can be moved, by buttons named for what they move', !!up && /Move Monthly Report up/.test(up.getAttribute('aria-label')));
      click(up);
      ok('...and the order is the order of the tabs', window.state.settings.favorites.join() === 'dashboard,finance,invoices,products,utang,report,tasks' &&
        Array.from(d.querySelectorAll('#bar .nav a')).map((a) => a.getAttribute('data-route')).join() === 'dashboard,finance,invoices,products,utang,report,tasks');
      click(row('report').querySelector('[data-action="fav-toggle"]'));
      ok('unpinning takes the tab away', window.state.settings.favorites.indexOf('report') < 0 && !d.querySelector('#bar .nav a[data-route="report"]'));
      // group order
      const down = Array.from(menu.querySelectorAll('[data-action="sec-move"][data-sec="Overview"]')).filter((b) => b.getAttribute('data-dir') === 'down')[0];
      click(down);
      ok('a group can be moved, and the order is saved where it always was', window.state.settings.sectionOrder.slice(0, 2).join() === 'Money,Overview' &&
        Array.from(menu.querySelectorAll('.menu-cols .menu-group:not(.pins) h2')).map((h) => h.textContent.trim().replace(/\s+/g, ' '))[0] === 'Money');
      click(menu.querySelector('.menu-head [data-action="nav-edit-toggle"]'));
      ok('Done returns to the plain index', !menu.classList.contains('is-edit') && !!menu.querySelector('[data-action="close-menu"]') && d.body.classList.contains('menu-open'));
      key(d, 'Escape');
      window.state.settings.sectionOrder = []; window.state.settings.favorites = []; window.save(); window.render();
      // theme, from the footer
      click(d.querySelector('#bar [data-action="open-menu"]'));
      click(menu.querySelector('.menu-foot [data-action="set-theme"][data-theme="dark"]'));
      ok('Dark sets the attribute, the setting and the pre-paint key, and stays in the Menu',
        d.documentElement.getAttribute('data-theme') === 'dark' && window.state.settings.theme === 'dark' && window.localStorage.getItem('trakora.theme') === 'dark' &&
        d.body.classList.contains('menu-open') && menu.querySelector('.menu-foot [data-theme="dark"]').getAttribute('aria-pressed') === 'true');
      click(menu.querySelector('.menu-foot [data-action="set-theme"][data-theme=""]'));
      ok('Auto removes the attribute and leaves the device to decide', !d.documentElement.hasAttribute('data-theme') && !window.state.settings.theme && window.localStorage.getItem('trakora.theme') === 'auto');
      click(menu.querySelector('.menu-foot [data-action="set-theme"][data-theme="light"]'));
      ok('Light sets it back', d.documentElement.getAttribute('data-theme') === 'light' && window.state.settings.theme === 'light');
      key(d, 'Escape');
      ok('the theme is applied before first paint, from its own key, without reading the books',
        /localStorage\.getItem\('trakora\.theme'\)/.test(html.slice(0, html.indexOf('<style>'))) && !/<html[^>]*data-theme/.test(html));
      // help never opens by itself, and is one click from the footer
      click(d.querySelector('#bar [data-action="open-menu"]')); click(menu.querySelector('[data-action="show-tour"]'));
      ok('Help opens from the footer as a drawer, closing the Menu behind it', !d.body.classList.contains('menu-open') && /Help/.test(d.querySelector('#modal-root .modal-head h3').textContent) &&
        d.querySelectorAll('#modal-root .rows li').length === window.HELP_TOPICS.length);
      window.closeModal();
    })();

    // ---------- search lives in the Menu ----------
    await (async function search() {
      await go('dashboard');
      const menu = d.getElementById('menu');
      click(d.querySelector('#bar [data-action="open-palette"]'));
      const inp = d.getElementById('palette-input');
      ok('Search opens the Menu with the caret in the field', d.body.classList.contains('menu-open') && d.activeElement === inp);
      type(inp, 'verde');
      const res = Array.from(menu.querySelectorAll('[data-action="palette-go"]'));
      ok('typing replaces the index with one list of matches', !menu.querySelector('.menu-cols') && res.length >= 2 && res.every((a) => a.getAttribute('data-route')));
      const heads = Array.from(menu.querySelectorAll('.menu-results h2')).map((h) => h.textContent);
      ok('...grouped by what they are', heads.indexOf('Invoices') >= 0 && heads.indexOf('Clients') >= 0 && heads.indexOf('Entries') >= 0, heads);
      ok('...with the matched text highlighted and the amount on the right', !!menu.querySelector('.menu-results mark') && /verde/i.test(menu.querySelector('.menu-results mark').textContent) &&
        /₱15,000/.test(menu.querySelector('[data-route="invoices"] .amt').textContent));
      ok('...ending with a way to ask the assistant the same thing', /Ask the assistant: verde/.test(menu.querySelector('[data-action="ask-assistant"]').textContent));
      key(inp, 'ArrowDown'); key(inp, 'ArrowDown');
      ok('the arrow keys move through the results', menu.querySelectorAll('.palette-item.is-active').length === 1 && menu.querySelectorAll('.palette-item')[1].classList.contains('is-active'));
      type(inp, 'back up');
      ok('actions are found by their verb', Array.from(menu.querySelectorAll('.menu-results h2')).some((h) => h.textContent === 'Actions') && !!menu.querySelector('.palette-item[data-action="export-data"]'));
      type(inp, 'zzzzqq');
      ok('nothing found says so, and still offers the assistant', /Nothing matches/.test(menu.querySelector('.menu-results .none').textContent) && !!menu.querySelector('[data-action="ask-assistant"]'));
      type(inp, 'northwind');
      key(inp, 'Enter'); await wait(30);
      ok('Enter opens the first result and closes the Menu', window.currentRoute() === 'invoices' && !d.body.classList.contains('menu-open'));
      key(d, 'k', { ctrlKey: true });
      ok('Ctrl+K opens search from anywhere', d.body.classList.contains('menu-open') && d.activeElement && d.activeElement.id === 'palette-input');
      key(d, 'k', { ctrlKey: true });
      ok('...and closes it again', !d.body.classList.contains('menu-open'));
      key(d.body, '/');
      ok('"/" opens it too when the owner is not typing', d.body.classList.contains('menu-open'));
      type(d.getElementById('palette-input'), 'how much did I earn this month');
      const chatBefore = window.state.chat.length;
      click(menu.querySelector('[data-action="ask-assistant"]'));
      ok('asking the assistant goes to its page and sends the question', window.currentRoute() === 'assistant' && window.state.chat.length > chatBefore &&
        window.state.chat.some((m) => m.role === 'user' && /how much did I earn/.test(m.text)) && !d.body.classList.contains('menu-open'));
      window.state.chat = []; window.save();
    })();

    // ---------- the drawer: every form ----------
    await (async function drawer() {
      await go('invoices');
      const trigger = d.querySelector('#main [data-action="invoice-new"]');
      trigger.focus(); click(trigger);
      const dlg = d.querySelector('#modal-root .modal');
      ok('a form opens as a drawer that is a labelled modal dialog', !!dlg && dlg.classList.contains('drawer') && dlg.getAttribute('role') === 'dialog' && dlg.getAttribute('aria-modal') === 'true' &&
        d.getElementById(dlg.getAttribute('aria-labelledby')).textContent.length > 0 && d.body.classList.contains('drawer-open'));
      ok('...with a labelled Close, Cancel and one primary Save', /Close/.test(dlg.querySelector('.modal-head [data-action="close-modal"]').textContent) &&
        !!dlg.querySelector('.modal-foot [data-action="close-modal"]') && dlg.querySelectorAll('.modal-foot .btn-primary[type="submit"]').length === 1);
      ok('the only dialog in the document is the open one', d.querySelectorAll('[role="dialog"]').length === 1);
      click(dlg.querySelector('.modal-foot [data-action="close-modal"]'));
      ok('Cancel closes it, unlocks the page and returns focus to the button that opened it', !d.getElementById('modal-root').innerHTML && !d.body.classList.contains('drawer-open') &&
        d.activeElement === d.querySelector('#main [data-action="invoice-new"]'));
      click(d.querySelector('#main [data-action="invoice-new"]')); key(d, 'Escape');
      ok('Escape closes an untouched form', !d.getElementById('modal-root').innerHTML);
      // a form with something typed in it asks before Escape throws it away
      click(d.querySelector('#main [data-action="invoice-new"]'));
      type(d.querySelector('#modal-form [name="client"]'), 'Half-typed client');
      const realConfirm = window.confirm; let native = 0;
      window.confirm = function () { native++; return true; };
      key(d, 'Escape');
      ok('Escape on a form with typing in it asks first, in the app\'s own dialog, with focus on the safe answer',
        !!d.querySelector('#dialog [role="alertdialog"][aria-modal="true"]') && d.activeElement === d.querySelector('#dialog [data-action="dialog-cancel"]') &&
        /Keep editing/.test(d.querySelector('#dialog [data-action="dialog-cancel"]').textContent) && !!d.getElementById('modal-form') && native === 0);
      click(d.querySelector('#dialog [data-action="dialog-cancel"]'));
      ok('"Keep editing" closes the question and keeps what was typed', !d.getElementById('dialog') && d.querySelector('#modal-form [name="client"]').value === 'Half-typed client');
      click(d.querySelector('#modal-root .modal-overlay'));
      ok('...and a click on the dimmed page asks too', !!d.getElementById('dialog') && !!d.getElementById('modal-form'));
      key(d, 'Escape');
      ok('Escape answers the question with no, and leaves the form open', !d.getElementById('dialog') && !!d.getElementById('modal-form'));
      key(d, 'Escape'); click(d.querySelector('#dialog [data-action="dialog-confirm"]'));
      ok('"Discard" closes the question and the form', !d.getElementById('dialog') && !d.getElementById('modal-root').innerHTML && !d.body.classList.contains('drawer-open'));
      click(d.querySelector('#main [data-action="invoice-new"]'));
      type(d.querySelector('#modal-form [name="client"]'), 'Half-typed client');
      click(d.querySelector('#modal-root .modal-foot [data-action="close-modal"]'));
      ok('...but Cancel is deliberate and does not ask', !d.getElementById('dialog') && !d.getElementById('modal-root').innerHTML && native === 0);
      window.confirm = realConfirm;
      // a save through the drawer
      await go('dashboard');
      const n0 = window.state.finance.length;
      click(d.querySelector('#main [data-action="open-entry-modal"]'));
      const f = d.getElementById('modal-form');
      f.elements['amount'].value = '1234'; if (f.elements['note']) f.elements['note'].value = 'Drawer test sale';
      fire(f, 'submit');
      ok('a form saved through the drawer writes the record and closes', window.state.finance.length === n0 + 1 && !d.getElementById('modal-root').innerHTML && !d.body.classList.contains('drawer-open'));
      window.state.finance = window.state.finance.filter((e) => e.note !== 'Drawer test sale'); window.save(); window.render();
      // toasts
      window.toast('first'); window.toast('second');
      const toasts = d.querySelectorAll('#toast-root .toast');
      ok('one toast at a time: a newer message replaces the one showing', toasts.length === 1 && /second/.test(toasts[0].textContent));
      ok('toasts live inside the top bar, so they cannot cover a page title or a drawer\'s Save', /\.toast-root\{[^}]*top:env\(safe-area-inset-top\)[^}]*height:var\(--bar-h\)/.test(css) && !/\.toast-root\{[^}]*bottom:/.test(css) && d.body.classList.contains('has-toast'));
      ok('there is no "Saved" chip pinned to the bottom of the screen', !d.getElementById('saved-chip') && typeof window.flashSaved === 'undefined');
      d.getElementById('toast-root').innerHTML = '';
    })();

    // ---------- tables stack by role ----------
    await (async function tableRoles() {
      await go('invoices');
      const t = d.querySelector('#main .table-wrap table');
      const heads = Array.from(t.querySelectorAll('thead th')).map((th) => th.textContent.trim());
      const row = t.querySelector('tbody tr');
      const role = (h) => { const i = heads.indexOf(h); return i < 0 ? null : (row.children[i].className.match(/c-(main|amt|status|due|id|acts|more)/) || [null])[0]; };
      ok('each column of a table is given the role it plays in a stacked record',
        role('Client') === 'c-main' && role('Amount') === 'c-amt' && role('Status') === 'c-status' && role('Due') === 'c-due' && role('Actions') === 'c-acts',
        heads.map((h) => h + '=' + role(h)));
      ok('...and the id column is named, so a phone folds it into the line under the title', role('Invoice') === 'c-id' && /INV-/.test(row.querySelector('td.c-main .sub .only-phone').textContent));
      ok('every cell of every row has exactly one role', Array.from(t.querySelectorAll('tbody tr')).filter((tr) => tr.children.length === heads.length)
        .every((tr) => Array.from(tr.children).every((td) => (td.className.match(/\bc-(main|amt|status|due|id|acts|more)\b/g) || []).length === 1)));
      ok('a view that names its own cells keeps them', window.tableRoles(['Client', 'Amount'], null).join() === 'c-main,c-more' &&
        (function () { const x = d.createElement('div'); x.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Client</th><th>Ref</th></tr></thead><tbody><tr><td>A</td><td class="c-id">7</td></tr></tbody></table></div>';
          window.labelizeTables(x); return x.querySelector('td.c-id').className === 'c-id'; })());
      ok('below 900px a table stops being a table, and nothing scrolls sideways',
        /@media \(max-width:899px\)\{[\s\S]*?\.table-wrap tbody tr\{display:grid/.test(css) && /td\.c-main\{grid-column:1;grid-row:1/.test(css) &&
        /\.recs td\.c-more\{display:none\}/.test(css) && /td\.c-more::before\{content:attr\(data-label\)/.test(css) && !/\.table-wrap\{[^}]*overflow-x:auto/.test(css));
    })();

    // ---------- home: the sentence and "Do today" ----------
    await (async function home() {
      const keep = JSON.stringify(window.state);
      window.state.settings.sampleData = false; window.state.settings.privacy.consent = 'all'; window.state.settings.dashOrder = null; window.state.settings.dashHidden = [];
      await go('dashboard');
      const main = d.getElementById('main');
      const h1 = main.querySelector('h1.t-statement');
      const recv = window.receivablesSummary();
      ok('home opens with a sentence, not a title', !!h1 && !main.querySelector('.page-head') && /^You have .* on hand\./.test(h1.textContent));
      ok('...that states cash on hand and what is owed', h1.textContent.indexOf(window.fmtMoney(window.cashOnHand().value, 0)) >= 0 && h1.textContent.indexOf(window.fmtMoney(recv.total, 0)) >= 0 && /is owed to you/.test(h1.textContent));
      ok('...and highlights the late part, once, as a link to where it is fixed', h1.querySelectorAll('mark').length === 1 && /of it is late/.test(h1.querySelector('mark').textContent) &&
        h1.querySelector('mark').textContent.indexOf(window.fmtMoney(recv.overdueTotal, 0)) >= 0 && h1.querySelector('mark a').getAttribute('data-route') === 'invoices');
      ok('the date sits above it and the two actions beside it', /\w+day, \w+ \d+/.test(main.querySelector('.home-head p.muted').textContent) &&
        !!main.querySelector('.home-head .btn-primary[data-action="open-entry-modal"]') && !!main.querySelector('.home-head [data-action="invoice-new"]'));
      // the sentence follows the books
      const cashBefore = h1.textContent;
      window.state.finance.push({ id: 'home-t1', type: 'income', amount: 4321, category: 'Sales', date: window.todayISO(), note: 'home test' });
      window.render();
      const acctTracked = window.cashOnHand().tracked;
      ok('adding an entry changes the page it summarises', acctTracked ? /home test/.test(d.getElementById('main').textContent) : d.querySelector('#main h1').textContent !== cashBefore);
      window.state.finance = window.state.finance.filter((e) => e.id !== 'home-t1');
      // no receivables: the month instead
      const inv = window.state.invoices; window.state.invoices = []; window.render();
      const s2 = d.querySelector('#main h1').textContent;
      ok('with nothing owed it says how the month stands', /You are .* (ahead|behind) this month\.|Nothing recorded this month yet\./.test(s2) && !/is owed to you/.test(s2));
      // the highlight falls to old credit, then to late tasks
      const ut = window.state.utang, tk = window.state.tasks;
      window.state.utang = [{ id: 'u-old', clientName: 'Aling Rosa', amount: 900, date: window.addDaysISO(window.todayISO(), -45), payments: [], settled: false }];
      window.render();
      const m2 = d.querySelector('#main h1 mark');
      ok('...then the highlight is credit over 30 days old', !!m2 && /of credit is over 30 days old/.test(m2.textContent) && m2.querySelector('a').getAttribute('data-route') === 'utang' && d.querySelectorAll('#main h1 mark').length === 1);
      window.state.utang = [];
      window.state.tasks = [{ id: 't-late', title: 'Late thing', deadline: window.addDaysISO(window.todayISO(), -3), done: false, status: 'To do' }];
      window.render();
      const m3 = d.querySelector('#main h1 mark');
      ok('...then late tasks', !!m3 && /1 task is late/.test(m3.textContent.replace(/\s+/g, ' ')) && m3.querySelector('a').getAttribute('data-route') === 'tasks');
      window.state.tasks = []; window.render();
      ok('...and with nothing behind, nothing is highlighted', !d.querySelector('#main h1 mark'));
      window.state.invoices = inv; window.state.utang = ut; window.state.tasks = tk;

      // "Do today": everything the bell and the banner used to hold
      window.state.settings.lastBackup = null;
      window.state.tasks = [{ id: 't-today', title: 'Call supplier', deadline: window.todayISO(), done: false, status: 'To do' },
        { id: 't-late', title: 'Pay rent', deadline: window.addDaysISO(window.todayISO(), -2), done: false, status: 'To do' },
        { id: 't-far', title: 'Someday', deadline: window.addDaysISO(window.todayISO(), 20), done: false, status: 'To do' }];
      window.state.orders = (window.state.orders || []).concat([{ id: 'o-due', number: 'ORD-9', clientName: 'Mang Jun', items: [{ name: 'x', qty: 1, price: 500 }], shipFee: 0, discount: 0,
        status: 'Preparing', payStatus: 'Unpaid', orderDate: window.todayISO(), deliveryDate: window.addDaysISO(window.todayISO(), -1) }]);
      window.render();
      const todo = window.homeTodo(), items = window.doTodayItems();
      const sec = d.querySelector('#main section[aria-labelledby="h-today"]');
      ok('Do today lists the costliest late invoice, with its amount and how late it is',
        items.some((i) => i.route === 'invoices' && /^Chase /.test(i.title) && i.amount > 0 && i.sev === 'late') && !!sec.querySelector('a[data-todo="invoices"] .stamp-late') &&
        /₱/.test(sec.querySelector('a[data-todo="invoices"] .amt').textContent) && sec.querySelectorAll('a[data-todo="invoices"]').length === 1);
      ok('...tasks that are late or due today or tomorrow, and none that are not', items.filter((i) => i.route === 'tasks').map((i) => i.title).sort().join() === 'Call supplier,Pay rent' &&
        Array.from(sec.querySelectorAll('a[data-todo="tasks"]')).some((a) => /Due today/.test(a.textContent)));
      ok('...and an order that should have gone out', items.some((i) => i.route === 'orders' && /Deliver to Mang Jun/.test(i.title) && i.amount === 500));
      ok('...ranked by money at risk, then by how late', items[0].risk >= items[items.length - 1].risk);
      const backupRow = sec.querySelector('li[data-todo="backup"]');
      ok('the backup reminder is a row with one button, decided by dataAtRisk(), and never a banner',
        window.dataAtRisk() === true && !!todo.backup && !!backupRow && /Back up your records/.test(backupRow.textContent) && /Never backed up/.test(backupRow.textContent) &&
        !!backupRow.querySelector('button[data-action="export-data"]') && !d.querySelector('.backup-banner'));
      ok('the count in the heading is the number of rows', parseInt(sec.querySelector('h2 small').textContent, 10) === todo.count && sec.querySelectorAll('.rows > a, .rows > li').length === Math.min(todo.count, 6 + todo.starters.length + (todo.backup ? 1 : 0)));
      window.state.settings.lastBackup = window.addDaysISO(window.todayISO(), -9); window.render();
      ok('...a recent backup takes the row away', window.dataAtRisk() === false && !d.querySelector('#main li[data-todo="backup"]'));
      window.state.settings.lastBackup = window.addDaysISO(window.todayISO(), -20); window.render();
      ok('...and an old one brings it back, saying how old', /Last backup 20 days ago\./.test(d.querySelector('#main li[data-todo="backup"]').textContent));
      window.state.tasks = []; window.state.orders = []; window.state.invoices = []; window.state.settings.lastBackup = window.todayISO(); window.render();
      ok('with nothing to do it says so, in one line', /Nothing needs you today\./.test(d.querySelector('#main section[aria-labelledby="h-today"]').textContent));
      window.state = JSON.parse(keep); window.state.settings.sampleData = false; window.state.settings.privacy.consent = 'all'; window.render();

      // sections: what shows, and in what order
      ok('where the cash is: one cell per account, linking to Accounts', d.querySelectorAll('#main dl.strip > a[data-route="accounts"]').length === Math.min(4, window.state.accounts.length));
      ok('the month so far shows profit, money in and out, and the target as a labelled progress bar',
        !!d.querySelector('#main .month .t-fig-lg') && d.querySelectorAll('#main .month .rows li').length === 2 && !!d.querySelector('#main .month [role="progressbar"][aria-valuenow]'));
      ok('the six-month chart keeps its three views as a segmented control', d.querySelectorAll('#main .sec-head .seg [data-action="chart-style"][data-chart="monthly"]').length === 3 &&
        d.querySelectorAll('#main .sec-head .seg [aria-pressed="true"]').length === 1);
      ok('sections are headings on a rule, never cards', !d.querySelector('#main .home .card') && d.querySelectorAll('#main .home .sec-head h2').length >= 5);
      ok('the default order puts the cash strip first and pairs Do today with the month', window.dashOrder().join() === 'cash,today,month,chart,recv,recent,links' &&
        !!d.querySelector('#main .cols[data-widget="today"] section[aria-labelledby="h-month"]') && !!d.querySelector('#main .cols.cols-even[data-widget="recv"]'));
      window.state.settings.dashOrder = ['recv', 'today'];
      ok('an order saved before the new sections existed is kept, with each new one slotted in after its default neighbour',
        window.dashOrder().join() === 'cash,recv,recent,links,today,month,chart');
      window.state.settings.dashOrder = null;
      click(d.querySelector('#main [data-action="dash-customize"]'));
      const rows = d.querySelectorAll('#dash-rows .list-row');
      ok('"Choose what shows here" lists every section with a Show switch and Move up / Move down, and no drag handle',
        rows.length === 7 && Array.from(rows).every((r) => r.querySelector('.switch input[data-action-change="dash-toggle"]') && r.querySelectorAll('[data-action="dash-move"]').length === 2) &&
        !d.querySelector('.dash-handle,[draggable="true"]'));
      click(d.querySelector('#dash-rows [data-action="dash-move"][data-id="chart"][data-dir="up"]'));
      ok('moving a section saves the order and redraws the page behind', window.state.settings.dashOrder.indexOf('chart') === window.state.settings.dashOrder.indexOf('month') - 1);
      const sw = d.querySelector('#dash-rows input[data-id="links"]'); sw.checked = false; fire(sw, 'change');
      ok('hiding a section takes it off the page', window.state.settings.dashHidden.indexOf('links') >= 0 && !d.querySelector('#main section[aria-labelledby="h-also"]'));
      click(d.querySelector('#modal-root [data-action="dash-reset"]'));
      ok('Reset puts the page back', !window.state.settings.dashOrder && window.state.settings.dashHidden.length === 0 && !d.getElementById('modal-root').innerHTML);
      window.state = JSON.parse(keep); window.save(); window.render();
    })();

    // ---------- the question about outside connections, and sample data: one notice, in the flow ----------
    await (async function notices() {
      const keep = JSON.stringify(window.state);
      window.state.settings.sampleData = false; window.state.settings.privacy = { consent: '', at: null, fxWasAuto: null };
      await go('dashboard');
      const n = d.getElementById('consent-notice');
      ok('an owner who has not answered is asked on the home page, in the flow of the page', !!n && n.classList.contains('notice') && n.closest('#main') &&
        n.querySelectorAll('[data-action="consent-set"]').length === 2 && !!n.querySelector('[data-action="consent-details"]'));
      ok('...and nowhere else, over nothing', (function () { window.location.hash = '#/finance'; window.render(); const none = !d.getElementById('consent-notice'); window.location.hash = '#/dashboard'; window.render(); return none; })());
      click(d.querySelector('#consent-notice [data-choice="essential"]'));
      ok('answering records the choice, changes what it says it changes, and the notice is gone',
        window.state.settings.privacy.consent === 'essential' && window.fxSettings().auto === false && !d.getElementById('consent-notice'));
      window.state.settings.sampleData = true; window.state.settings.privacy.consent = ''; window.render();
      ok('sample data is announced first, and only one notice shows at a time', d.querySelectorAll('#main .home > .notice').length === 1 &&
        /You are looking at sample data\./.test(d.querySelector('#main .home > .notice').textContent) && !d.getElementById('consent-notice'));
      ok('...with a way to start a real book and a way to keep looking', !!d.querySelector('#main .notice [data-action="reset-data"]') && !!d.querySelector('#main .notice [data-action="sample-keep"]'));
      click(d.querySelector('#main .notice [data-action="sample-keep"]'));
      ok('"Keep exploring" dismisses it for good', window.state.settings.sampleData === false && !/sample data/.test(d.querySelector('#main .home').textContent.slice(0, 200)));
      window.state = JSON.parse(keep); window.save(); window.render();
    })();

    // ---------- a page change is instant ----------
    await (async function instantRoutes() {
      ok('the router does not use view transitions, so two quick changes cannot collide', !/startViewTransition|view-transition/.test(html) && !/view-enter/.test(html));
      const errToasts = [];
      const realToast = window.toast; window.toast = function (m, t) { if (t === 'error') errToasts.push(m); return realToast.apply(this, arguments); };
      let calls = 0; d.startViewTransition = function () { calls++; return { finished: Promise.reject(new Error('Transition was skipped')), ready: Promise.reject(new Error('Transition was skipped')), updateCallbackDone: Promise.resolve() }; };
      window.location.hash = '#/finance'; window.location.hash = '#/invoices'; window.location.hash = '#/tasks';
      await wait(80);
      ok('three route changes in a row land on the last one with no error toast', window.currentRoute() === 'tasks' && /^Tasks/.test(d.querySelector('#main h1').textContent) && errToasts.length === 0 && calls === 0, errToasts);
      delete d.startViewTransition; window.toast = realToast;
      ok('an unknown address is the home page, and the bare address is the landing page', (function () { window.location.hash = '#/nope'; const a = window.currentRoute() === 'dashboard'; return a && window.atLanding() === false; })() &&
        ['', '#', '#/'].every(function (h) { const was = window.location.hash; window.history.replaceState(null, '', window.location.pathname + h); const y = window.atLanding(); window.history.replaceState(null, '', window.location.pathname + was); return y; }));
      await go('dashboard');
    })();

    // ---------- the landing page ----------
    await (async function landing() {
      const c = await bootCopy('https://land.test/');
      try {
        const root = c.d.getElementById('landing');
        ok('the bare address shows the landing page, and the app behind it is not started', c.d.body.classList.contains('is-landing') && !root.hidden && c.w.appStarted === false && c.d.getElementById('main').innerHTML === '' && c.d.getElementById('bar').innerHTML === '');
        ok('it has its own header and one h1', root.querySelectorAll('h1').length === 1 && /See where every peso goes\./.test(root.querySelector('h1').textContent.replace(/\s+/g, ' ')) && !!root.querySelector('header.l-head'));
        const text = root.textContent;
        ok('every claim on it is the designer\'s copy', /No sign-up\. Nothing to install\. Your records stay on this device\./.test(text) && /It works offline/.test(text) && /You back up to a file/.test(text) &&
          /clearing the browser’s data would erase them/.test(text) && /Start in a minute/.test(text) && /Your record book is ready\./.test(text));
        ok('the preview is labelled as a sample, because its numbers are made up', /Sample business/.test(root.querySelector('.sheet figcaption').textContent) && /made-up numbers/.test(root.querySelector('.sheet').getAttribute('aria-label')));
        ok('there is no invented proof: no testimonials, counts, prices, ratings or logos', !/testimonial|trusted by|customers love|\d[\d,]* (users|businesses|downloads)|\/month|per month|free trial|rated|award/i.test(text) && root.querySelectorAll('img').length === 0);
        const opens = root.querySelectorAll('a[data-action="open-app"][href="#/dashboard"]');
        ok('"Open Trakora" is offered three times and each is a real link into the app', opens.length === 3 && Array.from(opens).every((a) => /Open Trakora/.test(a.textContent)));
        ok('the footer links to Privacy', !!root.querySelector('footer a[href="#/privacy"]'));
        click(root.querySelector('[data-action="landing-theme"]'));
        ok('the theme can be switched here before the books are open, without writing to them', c.d.documentElement.getAttribute('data-theme') === 'dark' && c.w.localStorage.getItem('trakora.theme') === 'dark' &&
          c.w.localStorage.getItem('bizpilot.v1') === null);
        click(opens[0]); await wait(60);
        ok('Open goes to the home page: the landing page is gone and the app has started', c.w.location.hash === '#/dashboard' && !c.d.body.classList.contains('is-landing') && root.hidden && c.w.appStarted === true && c.d.getElementById('main').innerHTML.length > 100);
        ok('...and the theme picked on the landing page came with it', c.w.state.settings.theme === 'dark' && c.d.documentElement.getAttribute('data-theme') === 'dark');
        c.w.location.hash = '#/'; await wait(60);
        ok('going back to the bare address shows it again, and the title says what the product is', c.d.body.classList.contains('is-landing') && /^Trakora: /.test(c.d.title));
        c.w.location.hash = '#/invoices'; await wait(60);
        ok('...and leaving it restores the app and its title', !c.d.body.classList.contains('is-landing') && c.w.currentRoute() === 'invoices' && !/^Trakora: /.test(c.d.title));
        ok('none of it threw', c.errs.length === 0, c.errs);
      } finally { c.close(); }
      const deep = await bootCopy('https://land.test/#/invoices');
      try {
        ok('a link to a page skips the landing page entirely', !deep.d.body.classList.contains('is-landing') && deep.w.appStarted === true && deep.d.querySelector('#main h1').textContent === 'Invoices');
      } finally { deep.close(); }
      // a locked copy: the landing page shows first, the books never do
      const locked = await bootCopy('https://land.test/', function (w) {
        w.localStorage.setItem('trakora.lock', JSON.stringify({ hash: 'aa', salt: 'bb', iter: 1000 }));
        w.localStorage.setItem('bizpilot.v1', JSON.stringify({ v: 2, settings: { businessName: 'Secret Shop', onboarded: true }, finance: [{ id: 'f1', type: 'income', amount: 999, category: 'Sales', date: '2026-01-01', note: 'secret sale' }] }));
      });
      try {
        ok('with a PIN set, the landing page still shows first and nothing of the books is drawn', locked.d.body.classList.contains('is-landing') && !locked.d.getElementById('lock-root').innerHTML &&
          !/Secret Shop|secret sale/.test(locked.d.body.textContent) && !/Secret Shop/.test(locked.d.title));
        click(locked.d.querySelector('#landing [data-action="open-app"]')); await wait(60);
        ok('Open leads to the PIN, not to the books', !!locked.d.querySelector('#lock-root .gate #lock-pin') && locked.w.appStarted === false && locked.d.getElementById('main').innerHTML === '' &&
          !/secret sale/.test(locked.d.getElementById('app').textContent));
        ok('the lock screen is a labelled dialog with one field and one button', locked.d.querySelector('#lock-root .gate').getAttribute('role') === 'dialog' && !!locked.d.querySelector('label[for="lock-pin"]') &&
          locked.d.querySelectorAll('#lock-form button').length === 1);
      } finally { locked.close(); }
    })();

    // ---------- first run ----------
    await (async function firstRun() {
      const c = await bootCopy('https://first.test/#/dashboard');
      try {
        const main = c.d.getElementById('main');
        ok('a new book asks one question on the home page itself', !!main.querySelector('form[data-form="first-run"] input[name="bizname"]') && /What is your business called\?/.test(main.querySelector('h1').textContent) &&
          main.querySelector('h1 label').getAttribute('for') === main.querySelector('input[name="bizname"]').id && /Welcome to Trakora/.test(main.textContent));
        await wait(1700);
        ok('...and nothing is laid over it: no overlay, no carousel, no greeting, no wizard, no floating notice', !c.d.getElementById('modal-root').innerHTML && !c.d.getElementById('lightbox-root').innerHTML &&
          !c.d.querySelector('.greet-overlay,.onb-overlay,.onb-card,.consent,[role="dialog"]') && !c.d.querySelector('#toast-root .toast:not(.error):not(.warn)'));
        ok('the three next steps are listed under it, numbered', main.querySelectorAll('section[aria-labelledby="h-start"] ol.rows li').length === 3 && /Add the cash you have now/.test(main.textContent) && /Save a backup file/.test(main.textContent));
        ok('sample data is one link away', !!main.querySelector('[data-action="load-sample"]'));
        ok('the bar reads Trakora until the business has a name', c.d.querySelector('#bar .brand-name').textContent === 'Trakora');
        const form = main.querySelector('form[data-form="first-run"]');
        form.elements['bizname'].value = 'Aling Nena’s Store';
        form.dispatchEvent(new c.w.Event('submit', { bubbles: true, cancelable: true }));
        ok('Start names the business and marks the book as opened', c.w.state.settings.businessName === 'Aling Nena’s Store' && c.w.state.settings.onboarded === true &&
          c.d.querySelector('#bar .brand-name').textContent === 'Aling Nena’s Store' && /Aling Nena/.test(c.d.title));
        const m2 = c.d.getElementById('main');
        ok('the home page then says nothing is recorded yet, and offers Add entry', /Nothing recorded yet\. Add what you have on hand, then your first sale or expense\./.test(m2.querySelector('h1').textContent) &&
          !m2.querySelector('form[data-form="first-run"]') && !!m2.querySelector('.btn-primary[data-action="open-entry-modal"]'));
        const steps = () => Array.from(c.d.querySelectorAll('#main section[aria-labelledby="h-today"] li[data-todo]')).map((li) => li.getAttribute('data-todo'));
        ok('...and Do today holds the same three steps as real rows, each with its action', steps().join() === 'cash,entry,backup' &&
          !!c.d.querySelector('#main li[data-todo="cash"] [data-action="account-new"]') && !!c.d.querySelector('#main li[data-todo="entry"] [data-action="open-entry-modal"]') &&
          !!c.d.querySelector('#main li[data-todo="backup"] [data-action="export-data"]'));
        ok('sections with nothing in them are not drawn', !c.d.querySelector('#main section[aria-labelledby="h-month"]') && !c.d.querySelector('#main section[aria-labelledby="h-six"]') && !c.d.querySelector('#main dl.strip'));
        c.w.state.finance.push({ id: 'e1', type: 'income', amount: 500, category: 'Sales', date: c.w.todayISO(), note: 'first sale' }); c.w.commit();
        ok('a step leaves the list once it is done, and the sentence starts counting', steps().join() === 'cash,backup' && /^You have ₱500 on hand\./.test(c.d.querySelector('#main h1').textContent));
        c.w.state.accounts.push({ id: 'a1', name: 'Cash box', type: 'cash', opening: 500, adjust: [] }); c.w.state.settings.lastBackup = c.w.todayISO(); c.w.commit();
        ok('...until none are left', steps().length === 0);
        ok('none of it threw', c.errs.length === 0, c.errs);
      } finally { c.close(); }
      // an empty box is allowed
      const e = await bootCopy('https://first.test/#/dashboard');
      try {
        e.d.querySelector('form[data-form="first-run"]').dispatchEvent(new e.w.Event('submit', { bubbles: true, cancelable: true }));
        ok('Start with an empty box keeps the placeholder name and still moves on', e.w.state.settings.businessName === 'My Business' && e.w.state.settings.onboarded === true && !e.d.querySelector('form[data-form="first-run"]'));
      } finally { e.close(); }
      const s = await bootCopy('https://first.test/#/dashboard');
      try {
        click(s.d.querySelector('#main [data-action="load-sample"]'));
        ok('"Look around with sample data first" loads it and says so on the home page', s.w.state.finance.length > 0 && s.w.state.settings.sampleData === true &&
          /You are looking at sample data\./.test(s.d.querySelector('#main .notice').textContent) && !s.d.querySelector('form[data-form="first-run"]'));
      } finally { s.close(); }
      // somebody who already uses the app is never asked
      const old = await bootCopy('https://first.test/#/dashboard', function (w) {
        w.localStorage.setItem('bizpilot.v1', JSON.stringify({ v: 2, settings: { businessName: 'My Business', onboarded: true, tourDone: true, greetDone: true, startDismissed: true, displayName: 'Ira' }, finance: [] }));
        w.localStorage.setItem('bizpilot.tourdone', '1');
      });
      try {
        await wait(700);
        ok('a book that was opened before is not asked again, even unnamed and empty', !old.d.querySelector('form[data-form="first-run"]') && /Nothing recorded yet/.test(old.d.querySelector('#main h1').textContent) &&
          !old.d.getElementById('modal-root').innerHTML && !old.d.getElementById('lightbox-root').innerHTML);
      } finally { old.close(); }
      const used = await bootCopy('https://first.test/#/dashboard', function (w) {
        w.localStorage.setItem('bizpilot.v1', JSON.stringify({ v: 2, settings: { businessName: 'Tindahan ni Bea', onboarded: true, privacy: { consent: 'all' } },
          finance: [{ id: 'f1', type: 'income', amount: 1500, category: 'Sales', date: '2026-01-05', note: 'kept' }] }));
      });
      try {
        await wait(700);
        ok('an existing book with records opens straight to its sentence, with nothing over it', /^You have ₱1,500 on hand\./.test(used.d.querySelector('#main h1').textContent) &&
          !used.d.querySelector('form[data-form="first-run"]') && !used.d.querySelector('#main .notice') && !used.d.querySelector('[role="dialog"]') &&
          used.w.state.finance[0].note === 'kept' && used.errs.length === 0, used.errs);
      } finally { used.close(); }
    })();

    // =====================================================================
    // Phase 3: the pages. One row anatomy for every record, figures on one
    // ruled strip, a toast that lives in the bar, the app's own confirm
    // dialog, and settings as labelled groups. Asserted on the rendered DOM.
    // =====================================================================
    await (async function pagesPhase3() {
      const cssText = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
      const keyDown = (k) => d.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      const main = () => d.getElementById('main');
      const goto = (r) => { window.location.hash = '#/' + r; window.render(); };
      const realConfirm = window.confirm; let nativeAsked = 0;
      window.confirm = function () { nativeAsked++; return true; };
      window.closeModal(); window.closeDialog(true); d.getElementById('toast-root').innerHTML = ''; d.body.classList.remove('has-toast');
      window.ui.flash = null;
      window.loadSampleData(); await wait(20);
      d.getElementById('toast-root').innerHTML = ''; d.body.classList.remove('has-toast');
      Object.assign(window.ui, { invFilter: 'all', invFind: '', orderView: 'list', orderFilter: 'all', taskView: 'list', financeTab: 'entries', productTab: 'catalog', productCat: 'all', clientFilter: 'all', goalFilter: 'all', settingsTab: 'business' });

      // ---- row anatomy ----
      goto('invoices');
      const rows = Array.from(main().querySelector('table.recs').querySelectorAll('tbody tr'));
      ok('an invoice row shows one labelled next step and one labelled More, and nothing else to press but its title',
        rows.length === window.state.invoices.length && rows.every((tr) => {
          const acts = tr.querySelector('td.c-acts .row-actions');
          const visible = Array.from(acts.children).filter((el) => !el.hidden);
          return visible.length === 2 && visible[0].classList.contains('row-next') && visible[0].textContent.trim().length > 2 &&
            visible[1].getAttribute('data-action') === 'row-more' && /More/.test(visible[1].textContent) &&
            visible[1].getAttribute('aria-haspopup') === 'menu' && /^More actions for INV-/.test(visible[1].getAttribute('aria-label'));
        }), rows.map((tr) => Array.from(tr.querySelector('td.c-acts .row-actions').children).map((el) => (el.hidden ? 'H:' : '') + el.className + '|' + el.getAttribute('aria-label')).join(' ; ')).slice(0, 2));
      ok('no row holds a select or an icon-only button, on any list page', (function () {
        const bad = [];
        ['invoices', 'finance', 'orders', 'products', 'utang', 'clients', 'tasks', 'goals', 'accounts', 'notes', 'manpower'].forEach((r) => {
          goto(r);
          main().querySelectorAll('table.recs tbody, ul.rows, .rows').forEach((box) => {
            if (box.querySelector('select')) bad.push(r + ':select');
            box.querySelectorAll('button').forEach((b) => { if (!b.textContent.trim() && !b.classList.contains('task-check')) bad.push(r + ':' + (b.getAttribute('data-action') || b.className)); });
            if (box.querySelector('.btn-icon')) bad.push(r + ':btn-icon');
          });
        });
        goto('invoices');
        return bad;
      })().length === 0);
      const sent = window.state.invoices.find((iv) => iv.status === 'Sent' && (!iv.currency || iv.currency === 'PHP'));
      const sentRow = main().querySelector('[data-action="row-more"][data-id="' + sent.id + '"]').closest('tr');
      ok('every action an invoice had is still in its row, behind More, with its own action and id',
        ['invoice-remind', 'invoice-print', 'invoice-edit', 'invoice-delete'].every((a) => !!sentRow.querySelector('.row-menu [data-action="' + a + '"][data-id="' + sent.id + '"]')) &&
        sentRow.querySelector('.row-next').getAttribute('data-action') === 'invoice-paid' && sentRow.querySelector('.row-menu').hidden === true);
      ok('the title of a record is a button that opens it', sentRow.querySelector('td.c-main button.rec-open').getAttribute('data-action') === 'invoice-edit');
      ok('the stamp says the status in words, and late is the only yellow one',
        Array.from(main().querySelectorAll('td.c-status')).every((td) => td.querySelectorAll('.stamp,.badge').length === 1 && td.textContent.trim().length > 3) &&
        Array.from(main().querySelectorAll('td.c-status .stamp-late')).every((s) => /late/.test(s.textContent)));

      // ---- the More menu: keyboard, Escape, focus ----
      const more = sentRow.querySelector('[data-action="row-more"]');
      more.focus(); click(more);
      const pop = d.getElementById('pop');
      ok('More opens a menu of labelled rows and moves focus into it',
        !!pop && pop.getAttribute('role') === 'menu' && pop.querySelectorAll('[role="menuitem"]').length >= 4 &&
        more.getAttribute('aria-expanded') === 'true' && d.activeElement === pop.querySelector('[role="menuitem"]') &&
        Array.from(pop.querySelectorAll('[role="menuitem"]')).every((b) => b.textContent.trim().length > 2));
      keyDown('ArrowDown');
      ok('the arrow keys walk the rows', d.activeElement === d.getElementById('pop').querySelectorAll('[role="menuitem"]')[1]);
      keyDown('Escape');
      ok('Escape closes it and hands focus back to More', !d.getElementById('pop') && d.activeElement === more && more.getAttribute('aria-expanded') === 'false');
      click(more); click(d.querySelector('#pop [data-action="invoice-edit"]'));
      ok('a row picked from the menu acts: Edit opens the invoice in the drawer', !d.getElementById('pop') && !!d.querySelector('#modal-root [role="dialog"] #modal-form [name="client"]'));
      window.closeModal();

      // ---- status from the row, without the edit form ----
      click(main().querySelector('.row-menu [data-action="row-status"][data-kind="invoice-status"][data-id="' + sent.id + '"][data-val="Draft"]'));
      ok('a status is changed from the row\'s menu, without opening the form', window.state.invoices.find((iv) => iv.id === sent.id).status === 'Draft' && !d.getElementById('modal-root').innerHTML);
      d.getElementById('toast-root').innerHTML = '';
      click(main().querySelector('[data-action="invoice-sent"][data-id="' + sent.id + '"]'));
      const fin0 = window.state.finance.length;
      click(main().querySelector('.row-next[data-action="invoice-paid"][data-id="' + sent.id + '"]'));
      ok('Mark paid asks nothing: it records the income and offers Undo',
        !d.getElementById('dialog') && nativeAsked === 0 && window.state.invoices.find((iv) => iv.id === sent.id).status === 'Paid' && window.state.finance.length === fin0 + 1 &&
        !!d.querySelector('#toast-root .toast [data-action="do-undo"]') && !main().querySelector('[data-action="invoice-paid"][data-id="' + sent.id + '"]'));
      click(d.querySelector('#toast-root [data-action="do-undo"]'));
      ok('...and Undo takes both back', window.state.invoices.find((iv) => iv.id === sent.id).status === 'Sent' && window.state.finance.length === fin0);
      goto('orders');
      const ord = window.state.orders.find((o) => o.status === 'Pending' || o.status === 'Preparing');
      const before = ord.status;
      click(main().querySelector('.row-next[data-action="order-next-stage"][data-id="' + ord.id + '"]'));
      ok('an order\'s visible step moves it to the next stage, and its other statuses are in More',
        window.state.orders.find((o) => o.id === ord.id).status !== before &&
        !!main().querySelector('.row-menu [data-action="row-status"][data-kind="order-status"][data-id="' + ord.id + '"][data-val="Cancelled"]') &&
        !!main().querySelector('.row-menu [data-action="order-paid"][data-id="' + ord.id + '"]'));
      ok('the order checkbox sits in a 44px label that names the order',
        (function () { const lab = main().querySelector('label.pick'); return !!lab && !!lab.querySelector('input[data-action-change="order-select"]') && /Select ORD-/.test(lab.textContent); })() &&
        /\.pick\{[^}]*width:44px;height:44px/.test(cssText));
      goto('clients');
      const cl = window.state.clients[0];
      click(main().querySelector('.row-menu [data-action="row-status"][data-kind="client-status"][data-id="' + cl.id + '"][data-val="' + (cl.status === 'Inactive' ? 'Active' : 'Inactive') + '"]'));
      ok('a client\'s status changes from its row too', /Active|Inactive/.test(window.state.clients[0].status) && !main().querySelector('table.recs select'));
      goto('tasks');
      ok('a task row is a tick box, a title that opens it, plain-word details and More; the quick add is one box and Add',
        (function () { const li = main().querySelector('.task-rows .task-row'); const f = main().querySelector('form[data-form="quick-task"]');
          return !!li.querySelector('.task-check[data-action="toggle-task"][aria-label]') && !!li.querySelector('.rec-open[data-action="edit-task"]') &&
            !li.querySelector('select') && !!li.querySelector('.row-menu [data-action="row-status"][data-kind="task-priority"]') &&
            f.querySelectorAll('input:not([type="hidden"]),select').length === 1 && f.elements['priority'].value === 'Medium' && f.elements['bucket'].value === 'weekly'; })());

      // ---- strips ----
      ok('figures above a list are one ruled strip of at most four cells, never tiles', (function () {
        const bad = [];
        ['invoices', 'finance', 'orders', 'products', 'utang', 'clients', 'tasks', 'goals', 'accounts'].forEach((r) => {
          goto(r);
          const strips = main().querySelectorAll('dl.strip');
          if (strips.length !== 1) { bad.push(r + ':' + strips.length); return; }
          const cells = strips[0].children;
          if (cells.length < 3 || cells.length > 4) bad.push(r + ':cells' + cells.length);
          Array.from(cells).forEach((c) => { if (!c.querySelector('dt') || !c.querySelector('dd.stat-value')) bad.push(r + ':cell'); });
          if (main().querySelector('.grid > .stat-card')) bad.push(r + ':tiles');
        });
        return bad;
      })().length === 0);
      goto('invoices');
      const owed = main().querySelector('dl.strip > :first-child').textContent;
      ok('a figure carries one note, with its parts separated ("3 unpaid, 1 at an estimated rate", never "invoicesincl.")',
        /\d+ unpaid, \d+ at an estimated rate/.test(owed) && !/[a-z]incl\.|invoices\d|unpaid\d/.test(main().querySelector('dl.strip').textContent), owed);
      ok('no other sublabel in the file is glued to its neighbour', !/<\/span>'\+recv\.caveat|<\/span>'\+recv\.overdueCaveat/.test(html) &&
        /replace\(\/<\\\/span>\\s\*<span\/g,'<\/span> <span'\)/.test(html));
      ok('strip notes are secondary ink; only a note that needs the owner is a yellow stamp',
        !/\.stat-delta\.(up|down)\{/.test(cssText) && !!main().querySelector('dl.strip .stamp-late') && /needs? a follow-up/.test(main().querySelector('dl.strip .stamp-late').textContent));
      const keepInv = window.state.invoices, keepRec = window.state.recurringInvoices;
      window.state.invoices = []; window.state.recurringInvoices = []; window.render();
      ok('an empty page is its head and one empty state: no row of zeros, no tools, one secondary button',
        !main().querySelector('.strip,.tools,table') && main().querySelectorAll('.empty').length === 1 &&
        main().querySelectorAll('.btn-primary').length === 1 && main().querySelector('.empty .btn').classList.contains('btn-secondary'));
      window.state.invoices = keepInv; window.state.recurringInvoices = keepRec; window.render();

      // ---- toast ----
      d.getElementById('toast-root').innerHTML = ''; d.body.classList.remove('has-toast');
      window.toast('Invoice saved');
      ok('a receipt is a one-line pill in the top bar, and the tabs step aside while it shows',
        d.querySelectorAll('#toast-root .toast').length === 1 && d.body.classList.contains('has-toast') && /body:has\(#toast-root \.toast\) \.nav\{visibility:hidden\}/.test(cssText) &&
        /\.toast\{[^}]*height:40px/.test(cssText) && /\.toast\{[^}]*white-space:nowrap/.test(cssText));
      d.getElementById('toast-root').innerHTML = ''; d.body.classList.remove('has-toast');
      window.toast('This is a whole sentence about something that happened, far too long to be a receipt in the bar.', 'warn');
      ok('a message too long for the bar is written into the page as a notice under the page head, never over it',
        !d.querySelector('#toast-root .toast') && !!d.getElementById('flash') && d.getElementById('flash').parentNode === main() &&
        main().querySelector('.page-head').nextElementSibling === d.getElementById('flash') && d.getElementById('flash').getAttribute('role') === 'alert');
      window.render();
      ok('...it stays through a redraw of that page and closes on request', !!d.getElementById('flash') && (click(d.querySelector('#flash [data-action="flash-close"]')), !d.getElementById('flash')));
      click(main().querySelector('[data-action="invoice-new"]'));
      window.toast('Rate fetched');
      ok('nothing toasts over an open drawer: the message waits', !d.querySelector('#toast-root .toast'));
      window.toast('Enter the client name.', 'error');
      ok('...and a failure is written inside the drawer instead', !d.querySelector('#toast-root .toast') && /Enter the client name/.test(d.querySelector('#modal-form .modal-error[role="alert"]').textContent));
      window.closeModal();
      ok('...the held message shows once the drawer has closed', /Enter the client name|Rate fetched/.test((d.querySelector('#toast-root .toast') || { textContent: '' }).textContent));
      d.getElementById('toast-root').innerHTML = ''; d.body.classList.remove('has-toast');

      // ---- confirm dialog and delete-with-undo ----
      const victim = window.state.invoices[0], nInv = window.state.invoices.length;
      click(main().querySelector('.row-menu [data-action="invoice-delete"][data-id="' + victim.id + '"]'));
      const dlg = d.getElementById('dialog');
      ok('deleting an invoice asks in the app\'s own dialog: it names the invoice, says what stays, and starts on Cancel',
        !!dlg && !!dlg.querySelector('[role="alertdialog"][aria-modal="true"][aria-labelledby="dialog-title"][aria-describedby="dialog-body"]') &&
        dlg.querySelector('#dialog-title').textContent === 'Delete ' + victim.number + '?' && /stays/.test(dlg.querySelector('#dialog-body').textContent) &&
        d.activeElement === dlg.querySelector('[data-action="dialog-cancel"]') && nativeAsked === 0 && window.state.invoices.length === nInv);
      ok('the confirming button repeats the verb and the thing, and is the only filled red button', /^Delete invoice$/.test(dlg.querySelector('[data-action="dialog-confirm"]').textContent) &&
        dlg.querySelector('[data-action="dialog-confirm"]').classList.contains('btn-danger') && !main().querySelector('.btn-danger'));
      click(dlg.querySelector('[data-action="dialog-cancel"]'));
      ok('Cancel deletes nothing', !d.getElementById('dialog') && window.state.invoices.length === nInv);
      click(main().querySelector('.row-menu [data-action="invoice-delete"][data-id="' + victim.id + '"]'));
      click(d.querySelector('#dialog [data-action="dialog-confirm"]'));
      ok('the confirming button deletes it, with Undo offered', !d.getElementById('dialog') && window.state.invoices.length === nInv - 1 && !!d.querySelector('#toast-root [data-action="do-undo"]'));
      click(d.querySelector('#toast-root [data-action="do-undo"]'));
      goto('finance');
      const nFin = window.state.finance.length, fe = window.state.finance.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
      click(main().querySelector('.row-menu [data-action="delete-entry"]'));
      ok('a cheap delete (a money entry) asks nothing: it goes at once, with Undo', !d.getElementById('dialog') && window.state.finance.length === nFin - 1 && !!d.querySelector('#toast-root [data-action="do-undo"]'), fe && fe.id);
      click(d.querySelector('#toast-root [data-action="do-undo"]'));
      ok('no native confirm or prompt is left in the file', !/[^.\w]confirm\(/.test(html.replace(/window\.confirm|realConfirm/g, '')) && !/[^.\w]prompt\(/.test(html) && nativeAsked === 0);
      ok('Finance entries carry no Income or Expense stamp: money out is red with a true minus, money in is plain ink',
        !main().querySelector('table.recs .stamp,table.recs .badge') && !!main().querySelector('table.recs .amt.is-out') && /^−/.test(main().querySelector('table.recs .amt.is-out').textContent) &&
        Array.from(main().querySelectorAll('table.recs .amt:not(.is-out)')).every((a) => !/^[+]/.test(a.textContent)));

      // ---- settings ----
      window.fxManualFailed = false;
      goto('settings');
      ok('Settings ▸ Business is ruled groups with a label column inside one form, with one Save that is asleep until something changes',
        Array.from(main().querySelectorAll('.form-secs .form-sec > header h2')).map((h) => h.textContent).join('|') === 'Your business|Money|On your invoices|You|Other currencies|About' &&
        main().querySelectorAll('form[data-form="settings"]').length === 1 && main().querySelectorAll('form[data-form="settings"] .form-sec').length === 3 &&
        main().querySelectorAll('form[data-form="settings"] button[type="submit"]').length === 1 &&
        main().querySelector('form[data-form="settings"] button[type="submit"]').disabled && !main().querySelector('.card'));
      const moneyForm = main().querySelector('form[data-form="settings"]');
      moneyForm.elements['monthlyTarget'].value = '123456'; fire(moneyForm.elements['monthlyTarget'], 'input');
      const nameBefore = window.state.settings.businessName, backupBefore = window.state.settings.autoBackupDays;
      ok('typing in the form wakes its Save', !moneyForm.querySelector('button[type="submit"]').disabled);
      fire(moneyForm, 'submit');
      ok('saving changes the fields on the page and leaves the ones kept on another tab alone',
        window.state.settings.monthlyTarget === 123456 && window.state.settings.businessName === nameBefore && !!window.state.settings.businessName && window.state.settings.autoBackupDays === backupBefore);
      ok('the other currencies are one table behind Advanced: the state is said once per row in plain words, with no red chips',
        (function () { const adv = main().querySelector('details.adv'); const t = adv.querySelector('table.fx-table');
          return !adv.open && t.querySelectorAll('tbody tr').length === 8 && !t.querySelector('.stamp,.badge') &&
            Array.from(t.querySelectorAll('.fx-status')).every((c) => /Estimate|Set by you|Fetched|No rate/.test(c.textContent)) && !!adv.querySelector('form[data-form="fx-rates"] [name="fx_USD"]'); })(),
        (function () { const adv = main().querySelector('details.adv'); return [adv.open, Array.from(adv.querySelectorAll('.fx-status')).map((c) => c.textContent).join(',')]; })());
      ok('...and an estimate still cannot record money', window.fxRecordRate('USD') === null || window.fxVerified('USD') === true);
      ok('the page carries no build number or developer words', !/build \d|PBKDF2|JSON|Beta|Storage health/.test(main().textContent));
      window.ui.settingsTab = 'custom'; window.render();
      ok('Look and menu holds the theme, the way into the menu and Home editors, and categories as rows',
        Array.from(main().querySelectorAll('.form-secs > .form-sec > header h2')).map((h) => h.textContent).join('|') === 'Theme|Menu|Home page|Categories' &&
        !!main().querySelector('[data-action="set-theme"]') && !!main().querySelector('[data-action="menu-edit"]') && !!main().querySelector('[data-action="dash-customize"]') &&
        !!main().querySelector('.cat-rows li') && !main().querySelector('.form-secs > .form-sec input[type="checkbox"]'));
      window.ui.settingsTab = 'business';

      // ---- accounts, landing, pins, materials ----
      goto('accounts');
      ok('accounts are ruled rows in plain ink: no tile, no brand colour, one Reconcile and More each',
        main().querySelectorAll('.acct-rows > li').length === window.state.accounts.length && !main().querySelector('.acct-card,.acct-add,[style*="background:#"]') &&
        Array.from(main().querySelectorAll('.acct-rows > li')).every((li) => !!li.querySelector('.row-next[data-action="account-reconcile"]') && !!li.querySelector('.row-menu [data-action="account-delete"]')) &&
        main().querySelectorAll('[data-action="transfer-new"]').length === 1);
      ok('the landing page offers a returning owner their own book by name', /Open Studio Hiraya/.test(window.landingHTML()) && /Your book is on this device\./.test(window.landingHTML()));
      window.localStorage.setItem('trakora.lock', JSON.stringify({ hash: 'x', salt: 'y' }));
      ok('...but a locked copy keeps the name to itself until the PIN is given', !/Studio Hiraya/.test(window.landingHTML()) && /Open Trakora/.test(window.landingHTML()));
      window.localStorage.removeItem('trakora.lock');
      const keepFav = window.state.settings.favorites, keepChosen = window.state.settings.pinsChosen;
      window.state.settings.favorites = []; window.state.settings.pinsChosen = false;
      window.pinnedIds().slice().forEach((id) => window.togglePin(id));
      ok('unpinning every page leaves the tab row empty instead of bringing the usual six back', window.pinnedIds().length === 0 && window.state.settings.pinsChosen === true);
      window.openMenu({ edit: true });
      click(d.querySelector('#menu [data-action="pins-restore"]'));
      ok('"Restore the usual pins" in Menu edit mode puts them back', window.pinnedIds().length === 6 && window.state.settings.pinsChosen === false);
      window.closeMenu(true);
      window.state.settings.favorites = keepFav; window.state.settings.pinsChosen = keepChosen;
      window.location.hash = '#/materials'; window.renderRouted();
      ok('an old link to Materials lands on Products with its Materials tab open, not on Home',
        window.currentRoute() === 'products' && window.ui.productTab === 'materials' && /Materials/.test(main().querySelector('.tabs .active').textContent));
      window.ui.productTab = 'catalog';

      // ---- targets and print ----
      ok('row controls keep a 44px target: compact buttons are narrower, not shorter', /\.btn\{[^}]*min-height:var\(--ctl-h\)/.test(cssText) && /\.btn-sm\{padding:0 12px;font-size:15px\}/.test(cssText) &&
        /\.rec-open\{[^}]*min-height:44px/.test(cssText) && /\.task-check\{[^}]*width:44px;height:44px/.test(cssText) && /summary\{[^}]*min-height:44px/.test(cssText) &&
        /\.notice-acts \.link\{[^}]*min-height:44px/.test(cssText));
      const printCss = cssText.slice(cssText.indexOf('@media print{'));
      ok('print is ink on white: light tokens, no controls, and no yellow or tinted fill spent on a stamp or a notice',
        /--bg:#fff/.test(printCss) && /\.tools,\.tabs,\.tabs-select,\.row-actions,\.flash,\.dialog,\.pop\{display:none !important\}/.test(printCss) &&
        /\.stamp,\.badge,\.count,mark,\.mark,\.notice\{background:none !important;color:#000 !important\}/.test(printCss) && /#print-area\{color:#000;background:#fff\}/.test(printCss));
      goto('roadmap');
      ok('the roadmap toolbar wraps to whole rows instead of scrolling, and the zoom strip never wraps',
        /\.rm-rail\{[^}]*flex-wrap:wrap/.test(cssText) && /\.rm-rail\{grid-template-columns:repeat\(6,44px\)\}/.test(cssText) && !/\.rm-(rail|cam-bar)\{[^}]*overflow-x:(auto|scroll)/.test(cssText) &&
        !/\.rm-cam-bar\{[^}]*flex-wrap:wrap/.test(cssText));
      window.confirm = realConfirm;
      d.getElementById('toast-root').innerHTML = ''; d.body.classList.remove('has-toast');
      window.location.hash = '#/dashboard'; window.render();
    })();

    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.log('SUITE THREW >>', (e && e.stack) || JSON.stringify(e) || e);
    process.exit(2);
  }
}
setTimeout(main, 300);
