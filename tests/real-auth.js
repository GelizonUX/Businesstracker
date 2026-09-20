/* Drives the REAL configured sign-in path against a REAL Firebase Auth server,
   after today's refactor. The emulator implements identitytoolkit for real; it is
   proxied through the page's own origin because the app ships connect-src 'self'
   and a different port is a different origin. */
const { chromium } = require('playwright');
const { serve } = require('./browser-lib.js');

const R = [];
const ok = (n, c, got) => { R.push({ n, pass: !!c, got }); console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (got !== undefined ? '   [' + JSON.stringify(got) + ']' : '')); };

(async () => {
  const { server, port } = await serve();
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));

  // Point the app at the emulator THROUGH ITS OWN ORIGIN, and configure it.
  await p.addInitScript(() => {
    try { localStorage.setItem('bizpilot.tourdone', '1'); } catch (_) {}
    window.__wireEmu = true;
  });
  await p.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'load' });
  await p.waitForFunction(() => typeof window.state === 'object' && window.state && window.state.settings, null, { timeout: 30000 });

  const wired = await p.evaluate(() => {
    AUTH_IDT = '/__emu/identitytoolkit.googleapis.com/v1/accounts:';
    AUTH_TOK = '/__emu/securetoken.googleapis.com/v1/token';
    AUTH_PROJECTS = '/__emu/identitytoolkit.googleapis.com/v1/projects';
    state.settings.share = Object.assign({}, state.settings.share, {
      apiKey: 'fake-api-key', clientId: '1234-abc.apps.googleusercontent.com'
    });
    state.settings.onboarded = true; state.settings.startDismissed = true;
    state.settings.privacy = Object.assign({}, state.settings.privacy, { consent: 'all' });
    save();
    return { configured: authConfigured(), key: authApiKey(), cid: authClientId() };
  });
  ok('the app reports itself configured once a key is present', wired.configured === true, wired);

  // ---- the screen in CONFIGURED mode ----
  await p.evaluate(() => { location.hash = '#/signin'; });
  await p.waitForTimeout(1200);
  const screen = await p.evaluate(() => {
    const g = document.querySelector('.si-oauth');
    const e = document.getElementById('si-email'), pw = document.getElementById('si-pass');
    const f = document.getElementById('si-form');
    return {
      demoBanner: !!document.querySelector('.si-demo'),
      emailVal: e ? e.value : null,
      passVal: pw ? pw.value : null,
      gDisabled: g ? g.disabled : null,
      gAction: g ? g.getAttribute('data-action') : null,
      formAutocomplete: f ? f.getAttribute('autocomplete') : null,
      emailAutocomplete: e ? e.getAttribute('autocomplete') : null,
      msgRole: (document.getElementById('si-msg') || {}).getAttribute
        ? document.getElementById('si-msg').getAttribute('role') : null,
      wrapRole: (document.querySelector('.si-wrap') || {}).getAttribute
        ? document.querySelector('.si-wrap').getAttribute('role') : null
    };
  });
  ok('the demo banner is gone when a project is connected', screen.demoBanner === false, screen.demoBanner);
  ok('...and the prefilled credentials are gone with it', screen.emailVal === '' && screen.passVal === '', { e: screen.emailVal, p: screen.passVal });
  ok('the Google button is enabled and wired to the real action', screen.gDisabled === false && screen.gAction === 'auth-google', { d: screen.gDisabled, a: screen.gAction });
  ok('autocomplete is restored on the configured path', screen.formAutocomplete === 'on' && screen.emailAutocomplete === 'username', screen);
  ok('the live region and dialog role survived the refactor', screen.msgRole === 'status' && screen.wrapRole === 'dialog', screen);

  // ---- validation still fires on the configured path ----
  await p.evaluate(() => { document.getElementById('si-email').value = ''; document.getElementById('si-pass').value = ''; });
  await p.click('#si-go');
  await p.waitForTimeout(700);
  const blank = await p.evaluate(() => {
    const m = document.getElementById('si-msg');
    return { cls: m ? m.className : null, txt: m ? m.textContent.trim() : null, still: !!document.querySelector('.si-wrap') };
  });
  ok('empty submit is refused on the configured path too', /err/.test(blank.cls || '') && /Enter an email address and a password/i.test(blank.txt || '') && blank.still, blank);

  // ---- CREATE A REAL ACCOUNT against the real server ----
  const EMAIL = 'owner+' + Date.now() + '@example.com', PASS = 'realpass1234';
  await p.evaluate(() => { const b = document.querySelector('[data-action="signin-mode"][data-mode="up"]'); if (b) b.click(); });
  await p.waitForTimeout(500);
  await p.evaluate(o => { document.getElementById('si-email').value = o.e; document.getElementById('si-pass').value = o.p; }, { e: EMAIL, p: PASS });
  await p.click('#si-go');
  await p.waitForTimeout(3500);

  const afterUp = await p.evaluate(() => {
    let a = null; try { a = JSON.parse(localStorage.getItem('bizpilot.auth') || 'null'); } catch (_) {}
    const u = typeof authUser === 'function' ? authUser() : null;
    return {
      signedIn: typeof authSignedIn === 'function' ? authSignedIn() : null,
      hasToken: !!(a && (a.idToken || a.refreshToken)),
      tokenLooksJWT: !!(a && a.idToken && a.idToken.split('.').length === 3),
      email: u ? u.email : null,
      screenGone: !document.querySelector('.si-wrap'),
      appInert: document.getElementById('app') ? document.getElementById('app').hasAttribute('inert') : null
    };
  });
  ok('creating an account against a real Firebase server signs the person in', afterUp.signedIn === true && afterUp.screenGone, afterUp);
  ok('...and a real session token is stored, not a forged flag', afterUp.hasToken && afterUp.tokenLooksJWT, { t: afterUp.hasToken, jwt: afterUp.tokenLooksJWT });
  ok('...under the email that was actually registered', afterUp.email === EMAIL, { got: afterUp.email, want: EMAIL });
  ok('the app is no longer inert once the screen closes', afterUp.appInert === false, afterUp.appInert);

  // ---- SIGN OUT ----
  /* Go through the REAL delegated handler, not authSignOut() directly: the toast and the
     re-raised screen live in the handler, so calling the bare function proves nothing
     about what a person actually sees. A real element carrying the real data-action is
     what the delegate listens for. */
  await p.evaluate(() => {
    const b = document.createElement('button');
    b.setAttribute('data-action', 'auth-signout');
    document.body.appendChild(b);
    b.click();
    b.remove();
  });
  await p.waitForTimeout(2000);
  const afterOut = await p.evaluate(() => {
    let a = null; try { a = JSON.parse(localStorage.getItem('bizpilot.auth') || 'null'); } catch (_) {}
    const t = document.querySelector('.toast');
    const wrap = document.querySelector('.si-wrap');
    let toastVisible = false;
    if (t) {
      const r = t.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      toastVisible = !!(hit && (hit === t || t.contains(hit)));
    }
    return { auth: a, signedIn: typeof authSignedIn === 'function' ? authSignedIn() : null, screenBack: !!wrap, toastText: t ? t.textContent.trim().slice(0, 60) : null, toastVisible };
  });
  ok('signing out clears the real session', !afterOut.auth && afterOut.signedIn === false, afterOut);
  ok('...and its confirmation is actually visible over the sign-in screen', afterOut.toastVisible === true, { v: afterOut.toastVisible, t: afterOut.toastText });

  // ---- SIGN BACK IN with the same real credentials ----
  await p.waitForTimeout(400);
  await p.evaluate(o => {
    const m = document.querySelector('[data-action="signin-mode"][data-mode="in"]'); if (m) m.click();
  }, {});
  await p.waitForTimeout(500);
  await p.evaluate(o => { document.getElementById('si-email').value = o.e; document.getElementById('si-pass').value = o.p; }, { e: EMAIL, p: PASS });
  await p.click('#si-go');
  await p.waitForTimeout(3500);
  const afterIn = await p.evaluate(() => {
    let a = null; try { a = JSON.parse(localStorage.getItem('bizpilot.auth') || 'null'); } catch (_) {}
    const u = typeof authUser === 'function' ? authUser() : null;
    return { signedIn: typeof authSignedIn === 'function' ? authSignedIn() : null, email: u ? u.email : null, jwt: !!(a && a.idToken && a.idToken.split('.').length === 3), screenGone: !document.querySelector('.si-wrap') };
  });
  ok('signing back in with the same real credentials works', afterIn.signedIn === true && afterIn.email === EMAIL && afterIn.jwt && afterIn.screenGone, afterIn);

  // ---- a WRONG password must be refused by the real server ----
  await p.evaluate(() => {
    const b = document.createElement('button');
    b.setAttribute('data-action', 'auth-signout');
    document.body.appendChild(b); b.click(); b.remove();
  });
  await p.waitForTimeout(2200);
  await p.evaluate(o => {
    const m = document.querySelector('[data-action="signin-mode"][data-mode="in"]'); if (m) m.click();
  }, {});
  await p.waitForTimeout(400);
  await p.evaluate(o => { const e = document.getElementById('si-email'), w = document.getElementById('si-pass'); if (e) e.value = o.e; if (w) w.value = 'totallyWrong999'; }, { e: EMAIL });
  await p.click('#si-go');
  await p.waitForTimeout(3500);
  const bad = await p.evaluate(() => {
    const m = document.getElementById('si-msg');
    return { cls: m ? m.className : null, txt: m ? m.textContent.trim().slice(0, 90) : null, signedIn: typeof authSignedIn === 'function' ? authSignedIn() : null, still: !!document.querySelector('.si-wrap') };
  });
  ok('a wrong password is refused by the real server and reported in the live region', /err/.test(bad.cls || '') && bad.signedIn === false && bad.still && !!bad.txt, bad);

  console.log('\nconsole errors: ' + JSON.stringify(errs.filter(e => !/frame-ancestors|ERR_TUNNEL|open\.er-api/.test(e))));
  const fail = R.filter(r => !r.pass);
  console.log('\n' + R.filter(r => r.pass).length + ' passed, ' + fail.length + ' failed');
  await b.close(); server.close();
  process.exit(fail.length ? 1 : 0);
})();
