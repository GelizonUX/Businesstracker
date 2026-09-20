/* Drives the GOOGLE sign-in flow against a REAL Firebase Authentication server, after
   the sign-in screen was refactored.

   Everything here is our code except Google's own consent screen, which needs a real
   OAuth client id and is therefore the one step no test can reach. What this covers is
   both sides of it: the URL Google is asked for, the three guards on the reply, and the
   exchange of a Google credential for a real Firebase session with provider google.com.

   Three traps, all of which cost real time before they were written down:
     - MessageEvent.source must be a real Window. A plain object throws, and stubbing it
       away would bypass the very guard being tested. An iframe's contentWindow is a real
       Window, so window.open returns that and the iframe posts the reply.
     - The reply must be SENT from the popup's realm, not merely addressed through it.
       See the note on __reply below; getting this wrong makes every guard here pass for
       the wrong reason, which is worse than failing.
     - The message type is 'trakora-oauth'. Getting it wrong produces a promise that never
       settles and looks exactly like a hang.

   Needs the emulator running: see google-signin-emulator.md. */
const { chromium } = require('playwright');
const { serve } = require('./browser-lib.js');

const R = [];
const ok = (n, c, got) => { R.push({ n, pass: !!c }); console.log((c ? 'PASS' : 'FAIL') + ' — ' + n + (got !== undefined ? '   [' + JSON.stringify(got) + ']' : '')); };

const CLIENT_ID = '1234-abc.apps.googleusercontent.com';

(async () => {
  const { server, port } = await serve();
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));

  await p.addInitScript(() => { try { localStorage.setItem('bizpilot.tourdone', '1'); } catch (_) {} });
  await p.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'load' });
  await p.waitForFunction(() => typeof window.state === 'object' && window.state && window.state.settings, null, { timeout: 30000 });

  // Configure, point at the emulator through this origin, and install the fake popup.
  await p.evaluate(cid => {
    AUTH_IDT = '/__emu/identitytoolkit.googleapis.com/v1/accounts:';
    AUTH_TOK = '/__emu/securetoken.googleapis.com/v1/token';
    AUTH_PROJECTS = '/__emu/identitytoolkit.googleapis.com/v1/projects';
    state.settings.share = Object.assign({}, state.settings.share, { apiKey: 'fake-api-key', clientId: cid });
    state.settings.onboarded = true; state.settings.startDismissed = true;
    state.settings.privacy = Object.assign({}, state.settings.privacy, { consent: 'all' });
    save();

    // A real Window to stand in for the popup.
    const f = document.createElement('iframe');
    f.style.display = 'none'; f.src = 'about:blank';
    document.body.appendChild(f);
    window.__popup = f.contentWindow;
    window.__openedWith = null;
    window.__realOpen = window.open;
    window.open = function (url) { window.__openedWith = url; return window.__popup; };

    // An unsigned, Google-shaped credential. The emulator does not verify signatures;
    // this is the documented way to exercise a federated sign-in locally.
    window.__mkToken = function (email) {
      const b64 = o => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      return b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({
        iss: 'https://accounts.google.com', aud: '1234-abc.apps.googleusercontent.com',
        sub: '1087654321098765432', email: email, email_verified: true,
        name: 'Test Owner', picture: 'https://example.com/a.png'
      }) + '.';
    };
    /* Reply from inside the popup's own realm. Calling
       window.__popup.parent.postMessage(...) from here does NOT work: the call is still
       executed by the main window, so e.source is the main window and the handler's
       second guard drops it. That failure is indistinguishable from a hang, and it makes
       every other guard appear to pass for the wrong reason.

       eval in the iframe would run in the right realm but is not an option: the app ships
       script-src 'self' 'unsafe-inline' with no unsafe-eval, and an about:blank iframe
       inherits that policy. Appending a script element runs in the iframe's realm and is
       allowed by 'unsafe-inline'. Both constraints are the real page's, not the
       harness's, which is the point: the reply arrives the way a real one would. */
    window.__reply = function (msg) {
      const d = window.__popup.document;
      const s = d.createElement('script');
      s.textContent = 'parent.postMessage(' + JSON.stringify(msg) + ',' + JSON.stringify(location.origin) + ')';
      (d.body || d.documentElement).appendChild(s);
      s.remove();
    };
  }, CLIENT_ID);

  await p.evaluate(() => { location.hash = '#/signin'; });
  await p.waitForTimeout(1100);

  // ---- 1. the button is real, and asks Google for the right thing ----
  const btn = await p.evaluate(() => {
    const g = document.querySelector('.si-oauth');
    return { disabled: g ? g.disabled : null, action: g ? g.getAttribute('data-action') : null };
  });
  ok('the Google button is live once a client id exists', btn.disabled === false && btn.action === 'auth-google', btn);

  const started = await p.evaluate(() => {
    window.__p = authGoogle();
    window.__p.catch(() => {});
    const u = window.__openedWith || '';
    const q = new URLSearchParams(u.split('?')[1] || '');
    return {
      host: u.split('?')[0],
      client_id: q.get('client_id'),
      response_type: q.get('response_type'),
      scope: q.get('scope'),
      prompt: q.get('prompt'),
      state: q.get('state'),
      nonce: q.get('nonce'),
      redirect_uri: q.get('redirect_uri')
    };
  });
  ok('it opens Google, not something else', started.host === 'https://accounts.google.com/o/oauth2/v2/auth', started.host);
  ok('...with our client id, an id_token request and openid scope',
    started.client_id === CLIENT_ID && started.response_type === 'id_token' && /openid/.test(started.scope || ''), started);
  ok('...and a fresh state and nonce on every attempt',
    !!started.state && !!started.nonce && started.state !== started.nonce && started.state.length >= 8, { s: started.state, n: started.nonce });

  // ---- 2. the three guards each refuse on their own ----
  const guards = await p.evaluate(async () => {
    const tok = window.__mkToken('guard@example.com');
    /* The real state, so each guard below varies exactly ONE thing. Reading it from the
       URL the app actually opened is the only honest source; a guess would make these
       tests pass because the state was wrong rather than because the guard worked. */
    const real = decodeURIComponent((window.__openedWith.match(/[?&]state=([^&]+)/) || [])[1]);
    const settled = () => Promise.race([window.__p.then(() => 'resolved', () => 'rejected'),
      new Promise(r => setTimeout(() => r('pending'), 350))]);
    const out = {};
    // wrong state, from the right window
    window.__reply({ type: 'trakora-oauth', state: 'not-our-state', idToken: tok });
    out.wrongState = await settled();
    // wrong message type
    window.__reply({ type: 'some-other-thing', state: real, idToken: tok });
    out.wrongType = await settled();
    // right shape but posted by the main window, so e.source is not the popup
    window.postMessage({ type: 'trakora-oauth', state: real, idToken: tok }, location.origin);
    out.wrongSource = await settled();
    return out;
  });
  ok('a reply carrying the wrong state is ignored', guards.wrongState === 'pending', guards.wrongState);
  ok('a reply of the wrong type is ignored', guards.wrongType === 'pending', guards.wrongType);
  ok('a reply from a window we did not open is ignored', guards.wrongSource === 'pending', guards.wrongSource);

  // ---- 3. the real exchange ----
  const EMAIL = 'google.owner+' + Date.now() + '@example.com';
  const done = await p.evaluate(async email => {
    const st = (window.__openedWith.match(/[?&]state=([^&]+)/) || [])[1];
    window.__reply({ type: 'trakora-oauth', state: decodeURIComponent(st), idToken: window.__mkToken(email) });
    const r = await Promise.race([
      window.__p.then(s => ({ k: 'ok', s }), e => ({ k: 'err', e: e && (e.msg || e.code) })),
      new Promise(r => setTimeout(() => r({ k: 'timeout' }), 12000))
    ]);
    let a = null; try { a = JSON.parse(localStorage.getItem('bizpilot.auth') || 'null'); } catch (_) {}
    const u = typeof authUser === 'function' ? authUser() : null;
    return {
      kind: r.k, err: r.e,
      signedIn: typeof authSignedIn === 'function' ? authSignedIn() : null,
      email: u ? u.email : null,
      provider: u ? (u.provider || u.providerId) : null,
      jwt: !!(a && a.idToken && a.idToken.split('.').length === 3),
      refresh: !!(a && a.refreshToken)
    };
  }, EMAIL);
  ok('a genuine Google credential is exchanged at Firebase for a session', done.kind === 'ok' && done.signedIn === true, done);
  ok('...under the Google account email', done.email === EMAIL, { got: done.email, want: EMAIL });
  ok('...recorded as a Google sign-in, not a password one', String(done.provider || '').indexOf('google') > -1, done.provider);
  ok('...with a real Firebase token and a refresh token', done.jwt && done.refresh, { jwt: done.jwt, r: done.refresh });

  // ---- 4. a declined consent is a cancellation, not an error to shout about ----
  await p.evaluate(() => { if (typeof authSignOut === 'function') authSignOut(); });
  await p.waitForTimeout(1200);
  const declined = await p.evaluate(async () => {
    window.__openedWith = null;
    const pr = authGoogle(); pr.catch(() => {});
    await new Promise(r => setTimeout(r, 250));
    const st = decodeURIComponent((window.__openedWith.match(/[?&]state=([^&]+)/) || [])[1]);
    window.__reply({ type: 'trakora-oauth', state: st, error: 'access_denied' });
    const r = await Promise.race([
      pr.then(() => ({ k: 'ok' }), e => ({ k: 'err', code: e && e.code })),
      new Promise(r => setTimeout(() => r({ k: 'timeout' }), 8000))
    ]);
    return { r, signedIn: typeof authSignedIn === 'function' ? authSignedIn() : null };
  });
  ok('a declined consent is reported as a refusal and signs nobody in',
    declined.r.k === 'err' && declined.r.code === 'access_denied' && declined.signedIn === false, declined);

  console.log('\nconsole errors: ' + JSON.stringify(errs.filter(e => !/frame-ancestors|ERR_TUNNEL|open\.er-api/.test(e))));
  const fail = R.filter(r => !r.pass);
  console.log('\n' + R.filter(r => r.pass).length + ' passed, ' + fail.length + ' failed');
  await b.close(); server.close();
  process.exit(fail.length ? 1 : 0);
})();
