# Proving Google sign-in against a real Firebase Auth server

The unit suite covers the Google flow with the transport mocked: 37 assertions over the
URL Google is asked for, the three postMessage checks, the exchange, and every failure
branch. Mocks prove our code calls what we think it calls. They cannot prove Firebase
agrees.

This is how the flow was driven against an actual Firebase Auth implementation, with no
mock in the exchange at all. It is written down because the emulator is not in CI and the
next person will otherwise have only mocked evidence.

## Result, on the branch that introduced this file

    asked Google for a credential     yes, accounts.google.com
    client_id sent                    x.apps.googleusercontent.com
    response_type                     id_token
    popup replied via postMessage     accepted: origin, source window and state all checked
    exchanged at Firebase Auth        the emulator, not a mock
    result                            signed in, provider google, email verified

The only step not exercised is Google's own consent screen, which needs a real OAuth
client id and a registered redirect URI. Everything after it is proven.

## Running it

    npm install firebase-tools
    firebase emulators:start --only auth --project google-auth-demo

The emulator serves the identitytoolkit API at 127.0.0.1:9099. Two things matter:

1. **Proxy it through the page's own origin.** The app ships
   `connect-src 'self'`, and a different PORT is a different origin, so the browser
   refuses a direct call to :9099. The test server proxies `/__emu/*` to the emulator,
   which makes it same-origin and lets the real page talk to the real server.

2. **MessageEvent.source must be a real Window.** A plain object throws. Use an iframe's
   contentWindow as the stand-in popup, and have `window.open` return that same window, so
   the handler's `e.source === win` check is genuinely exercised rather than bypassed.

The message the callback posts is `{type:'trakora-oauth', state, idToken, error}`. Getting
that name wrong produces a promise that never settles and looks exactly like a hang, so
put a timeout on it or you will spend a while wondering.
