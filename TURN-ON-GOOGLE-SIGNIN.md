# Turning on Google sign-in

Everything is built and tested. Two values are missing, and only you can get them
because they live inside your own Firebase project. This is the whole job: copy two
strings, paste them into one place, add one domain.

Budget about five minutes.

---

## Before you start

Open <https://console.firebase.google.com> and click into the project you made. You
said it is called **Google auth**.

Everything below happens in that one console. You do **not** need Google Cloud, and you
do **not** need to install anything. (If you read an earlier note from me that said to
go to Google Cloud → Credentials, ignore it — Firebase shows you the same value in an
easier place, and that is the path below.)

---

## Step 1 — Turn Google on as a sign-in method

1. In the left sidebar, click **Authentication**.
   - If you see a **Get started** button, click it first.
2. Click the **Sign-in method** tab.
3. In the list of providers, click **Google**.
4. Turn the **Enable** switch on.
5. Pick a support email (your own address is fine).
6. Click **Save**.

Leave this panel open. Step 3 comes back to it.

---

## Step 2 — Get the first value: the Web API key

1. Click the **gear icon** next to *Project Overview* (top left) → **Project settings**.
2. Stay on the **General** tab and scroll down to **Your apps**.
3. If there is no web app listed yet, click the **`</>`** icon to add one. Give it any
   nickname. You do **not** need Firebase Hosting — leave that box unticked.
4. You will now see a block of code that looks like this:

   ```js
   const firebaseConfig = {
     apiKey: "AIzaSyClQ0vT...",
     authDomain: "google-auth-xxxxx.firebaseapp.com",
     projectId: "google-auth-xxxxx",
     ...
   };
   ```

5. Copy the value of **`apiKey`** — the part in quotes starting with `AIzaSy`.

That is value 1 of 2.

---

## Step 3 — Get the second value: the Web client ID

1. Go back to **Authentication** → **Sign-in method** → click **Google** again.
2. Expand the small section called **Web SDK configuration**.
3. Copy the **Web client ID**. It ends in `.apps.googleusercontent.com`.

That is value 2 of 2.

---

## Step 4 — Paste them in

Open `index.html`, find `var AUTH_CFG` (search for `AUTH_CFG={`, it is around line 3976),
and paste each value between the quotes:

```js
var AUTH_CFG={
  apiKey:   'AIzaSyClQ0vT...',                        // value from step 2
  clientId: '1234-abc.apps.googleusercontent.com'     // value from step 3
};
```

Save. That is the switch. The moment `apiKey` is non-empty the demo behaviour stops
applying everywhere at once: the prefilled email and password disappear, the demo banner
disappears, the Google button un-disables and points at the real Google flow, and Log in
and Create account start checking against your project instead of just opening the app.
Nothing else in the file needs to change.

---

## Step 5 — Let your own site sign people in

Google refuses sign-in from any domain you have not listed. This is the single most
common reason a correct key still does not work.

1. **Authentication** → **Settings** tab → **Authorized domains**.
2. Click **Add domain** and add the domain the app is actually served from — for the
   preview that is `businesstracker.pages.dev`; add your custom domain too if you have one.
3. `localhost` is usually already in the list. Leave it.

---

## Is it safe to have those two strings in the file?

Yes. Both are public by design — the Firebase web SDK ships them to every visitor's
browser, and Google's own documentation says so. They identify your project; they do not
grant access to it. What actually protects your data is your **database rules**.

The thing to take seriously is the opposite one: a project with rules left in test mode
is open whether or not anyone has your key. Before you put real customer data in, check
**Realtime Database → Rules** (or **Firestore → Rules**) and make sure they are not
`".read": true, ".write": true`.

---

## If it does not work

- **"This domain is not authorized"** → Step 5. Check you added the exact domain shown
  in the browser's address bar, with no `https://` and no trailing slash.
- **The Google button is still greyed out** → `apiKey` is still empty, or the paste landed
  outside the quotes. The button reads the key, not the client ID.
- **The popup opens and closes immediately** → the client ID in step 3 does not match the
  project the key in step 2 came from. Both must come from the same Firebase project.
- **Nothing happens at all and the demo banner is still showing** → the file did not save,
  or the browser is serving a cached copy. Hard-refresh.

---

## What is already proven

The code path these two values switch on is not untested. It was driven end to end
against a real Firebase Authentication server (the official local emulator, which
implements the same `identitytoolkit` API that production does): account creation,
sign-in, token refresh and sign-out all verified, plus the popup flow driven as a real
popup through `oauth-callback.html`. See `tests/google-signin-emulator.md` for what was
run and two traps that cost real time.

The only part that has never been exercised is Google's own consent screen, because
reaching it requires exactly the client ID above.
