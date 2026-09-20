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

The callback page was then driven separately as a real popup, opened by a real opener,
with a Google-shaped fragment. It parsed the credential and posted it back to the exact
origin, and did the same for a declined consent (`#error=access_denied`).

That closes every line of OUR code in this chain:

| Step | Whose code | Verified |
|---|---|---|
| Build the Google URL | ours | client_id, response_type=id_token, state, nonce |
| Consent screen | **Google's** | needs a real client id |
| Callback parses the fragment | ours | real popup, success and declined |
| postMessage back to the opener | ours | exact origin, never `*` |
| Three guards on receipt | ours | each refuses on its own, zero requests leak |
| Exchange for a session | ours | real Firebase Auth server |
| Session adopted | ours | signed in, provider google, verified |

The only step not exercised is Google's own consent screen, which needs a real OAuth
client id and a registered redirect URI. It is Google's page, not ours: there is no code
of ours left between the popup opening and the session existing.

## Re-run after any change to the sign-in screen

`real-auth.js` in this folder is the same idea made repeatable, and it exists because the
sign-in screen was heavily refactored after the run above: the z-order, the Google
button's rendering, the submit path and the validation check all moved. Mocked assertions
and the demo path both stayed green through that, and neither would have noticed if the
configured path had broken, because neither one talks to a server.

It drives the REAL path against the REAL emulator, with `AUTH_CFG` populated at runtime:
the demo banner and prefilled values disappear, the Google button un-disables and carries
`auth-google`, an account is created, a genuine three-part JWT lands in `bizpilot.auth`,
sign-out clears it and its toast is hit-tested as actually visible over the re-raised
screen, the same credentials sign back in, and a wrong password is refused by the server
and reported in the live region. 15 checks, all passing as of the refactor.

    cd tests && node real-auth.js      # needs the emulator below already running

One trap worth keeping: drive sign-out through the real delegated handler, not by calling
`authSignOut()`. The toast and the re-raised screen live in the handler, so the bare
function clears the session and proves nothing about what a person sees. Appending a real
element carrying `data-action="auth-signout"` and clicking it exercises the delegate.

## Running the emulator

    npm install firebase-tools
    firebase emulators:start --only auth --project google-auth-demo

It needs Java. It may log a failure reaching `firebase-public.firebaseio.com` (a version
check) and still start the auth emulator on 9099 perfectly well, so check the port before
believing the error: `curl 127.0.0.1:9099` answers with `"authEmulator":{"ready":true}`.

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
