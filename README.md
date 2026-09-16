# Project Task Tracker — Firebase setup

This app now syncs to your Firebase project (`task-tracker-25da0`), so the same account shows
the same tasks whether you're on your phone or a laptop. Do these five steps once, in order —
none of them can be done from outside your Firebase console, so they're on you.

## 1. Turn on Email/Password sign-in

Firebase console → **Authentication** → **Sign-in method** → enable **Email/Password**.

## 2. Fill in the missing config values

Firebase console → gear icon → **Project settings** → **General** → scroll to **Your apps**.
If there's no web app yet, click **Add app → Web** and register one (no hosting needed).
Copy the `firebaseConfig` object it shows you, and in `index.html` replace the three
`PASTE_YOUR_...` placeholders — `apiKey`, `messagingSenderId`, `appId` — with the real values.
The other four fields are already filled in from your database URL.

This config is not a secret — it's meant to sit in public client code. Real security comes
from the database rules in step 4, not from hiding this object.

## 3. Create your own account

Firebase console → **Authentication** → **Users** → **Add user**.
- Email: `suyash@tasktracker.local`
- Password: `suyashga`

That email is a made-up address — the app maps your username to it internally so you can sign
in with just "suyash" and never see the `@tasktracker.local` part. Nothing gets sent there.

I didn't put this password anywhere in the app's code. The page is going to be public on GitHub,
and a password sitting in public JavaScript isn't a password — anyone could view-source it. This
way it only ever exists inside Firebase's own login check.

## 4. Paste in the database rules

Firebase console → **Realtime Database** → **Rules** tab → replace everything with the contents
of `database.rules.json` (included here) → **Publish**.

What these rules actually do:
- Each account's tasks live at `/users/<their-id>/tasks`, and only that account can read or write
  them. This is enforced by Firebase itself, not by the app — so even someone who bypassed the
  app entirely and called the database directly couldn't see another user's tasks.
- An **admin** account can read every user's tasks (for oversight) but still can't write to
  someone else's tasks — each person owns their own data.
- Only an admin can change someone's `role`. A regular member can rename themselves but can't
  promote themselves to admin.

## 5. Make yourself admin

Firebase console → **Realtime Database** → **Data** tab. After you sign into the app once as
`suyash`, a node appears at `users/<a long random id>/profile` with your username. Click into it,
add a field: `role` = `admin` (as a string). This is the one bootstrap step that has to be done
by hand, since nobody is an admin yet for the app to promote you from inside itself. Once it's
set, use the app's **Team** tab to add and manage everyone else.

## Sign-in behaviour

"Keep me logged in always" is the default: the app uses Firebase's local persistence, so a
session only ends when someone taps the account chip and confirms sign-out. There's no
expiry — Firebase silently refreshes the login in the background as long as the device is online.

## Adding users later

Only the Team tab does this (admin-only). It creates the new account through a second, separate
connection to Firebase, purely so the admin isn't accidentally signed out or switched to the new
account mid-creation — your own session is untouched. Removing someone's access (rather than
just demoting them) is a console action: Authentication → find them → **Disable user**, or
**Delete**. That's deliberate — it's the one action serious enough that I didn't want a stray tap
in the app to lock someone out.

## Excel

Cloud sync solves the cross-device problem the exports were originally standing in for, so the
Excel tab now works the same as before as a one-off in/out bridge: **Export to Excel** builds a
workbook matching the Task Log sheet's columns exactly; **Import from Excel** reads one back in
and updates matching rows instead of duplicating them.

A live, always-on link between the Excel file itself and Firebase (so editing a cell in Excel
pushes to the cloud instantly) needs either a scripted layer in Excel (Office Script / Power
Query hitting the database's REST endpoint) or a small scheduled sync job — both add real
complexity and a point of failure. I kept this out for now since the app itself already gives you
live sync across every device you use it on. Ask if you want that Excel-side link built too —
it's a distinct, sizeable piece of work.

## Files

| File | Purpose |
|---|---|
| `index.html` | The app |
| `manifest.json`, `sw.js`, `icon-*.png` | Installable, offline-capable PWA shell |
| `database.rules.json` | Paste into Firebase console → Realtime Database → Rules |

Hosting on GitHub Pages is unchanged from before: push these files to a repo, enable Pages on
the root of `main`, done.
