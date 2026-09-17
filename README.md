# Project Task Tracker — Firebase setup

This app now syncs to your Firebase project (`task-tracker-25da0`), so the same account shows
the same tasks whether you're on your phone or a laptop. Do these five steps once, in order —
none of them can be done from outside your Firebase console, so they're on you.

## What's new

- **Projects tab** — a second tracker alongside your daily tasks, for the stage-by-stage life of
  a project: L1 → TEC → Awarded → Procurement → Inventory → Production → QC → Testing → Dispatch
  → Delivered → Payment → Documentation → Failed. Enter the project name, a short requirements
  line, and start/end dates once; tick which of those 13 stages actually apply to that project;
  then tap each stage chip as it's finished. % complete is done stages ÷ the stages you picked —
  it's out of what you selected, not out of all 13.
- **Excel now has a matching `Projects` sheet**, with the same stage columns, a live `% Complete`
  formula, and an `Overall Status` formula (Failed / Completed / In Progress). See "Projects" in
  the workbook's Instructions sheet.
- **A path to automatic Excel ⇄ app sync**, via Google Sheets — see that section below.

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
workbook with a `Task Log` sheet and a `Projects` sheet, matching the app's fields exactly;
**Import from Excel** reads both sheets back in and updates matching rows instead of duplicating
them (a task matches by task + vertical + due date; a project matches by name + start date).

A genuinely live, always-on link straight to a local `.xlsx` file isn't something any app can do
from outside — Excel on your desktop has no background connection to anything, so nothing can
push a change into it the moment it happens on your phone. The realistic version of "automatic
both ways" is the Google Sheets setup below, which is also exactly the "upload the final Excel
to Google Sheets" step you asked about, so it does both jobs in one move.

## Google Sheets live sync

This replaces the desktop `.xlsx` with a Google Sheet that keeps itself in step with the app —
not instantly in both directions, but automatically, with no manual export/import once it's set
up:

- **App → Sheet**: a script pulls every task and project from Firebase and rewrites the sheet.
  You turn this into an automatic background job that runs every 5 minutes.
- **Sheet → App**: editing a cell in the sheet pushes that one change to Firebase immediately
  (it fires the moment you edit).

**Setup (one time):**

1. **Get the Excel file into Google Sheets.** In the app's Excel tab, tap **Export to Excel**.
   Then in [Google Sheets](https://sheets.google.com), **File → Import → Upload**, choose that
   file, and pick "Insert new sheet(s)". This gives you `Task Log` and `Projects` tabs with the
   right headers — you can delete the sample rows.
2. **Add the sync script.** In the Sheet, go to **Extensions → Apps Script**, delete the
   placeholder code, and paste in the contents of `google-sheets-sync.gs` (included here). Click
   **Save**.
3. **Store your Firebase login — not in the code.** Still in Apps Script, go to
   **Project Settings (gear icon) → Script Properties → Add script property**, and add three:
   - `FIREBASE_DB_URL` → `https://task-tracker-25da0-default-rtdb.europe-west1.firebasedatabase.app`
   - `FIREBASE_EMAIL` → your admin sign-in, e.g. `suyash@tasktracker.local`
   - `FIREBASE_PASSWORD` → that account's password
   - `FIREBASE_API_KEY` → the `apiKey` value from `index.html` (the same one you pasted in
     during setup step 2 above)

   Only an **admin** account can pull everyone's data this way — a regular member's login would
   only see their own tasks, per the database rules.
4. **Run it once and approve access.** Back in the Apps Script editor, pick `pullFromFirebase`
   from the function dropdown at the top and click **Run**. Google will ask you to authorize the
   script (it needs permission to make web requests) — approve it. Your sheet should populate.
5. **Turn on auto-pull.** Reload the Google Sheet. A new **Task Tracker** menu appears — open it
   and click **Set up auto-pull every 5 minutes**. From here on, changes made in the app show up
   in the sheet within 5 minutes on their own, and any cell you edit in the sheet is sent to the
   app right away.
6. **Get the shareable link.** Click **Share** (top right) → **Copy link**. That's the Google
   Sheets link you'll use going forward instead of the local Excel file.

A few things worth knowing about this setup:
- Editing the hidden `Key` column, or typing a brand-new row by hand, won't create a task —
  add new tasks/projects from the app, and they'll appear in the sheet on the next pull.
- If a formula-style cell looks off after a pull, that's expected — the sync sheet is plain data
  (like Export/Import), not the formula-driven master workbook described above. Keep this Google
  Sheet as your live, cross-device copy, and treat the `.xlsx` as an occasional offline snapshot
  if you still want one (Export to Excel any time).
- Everything above runs under your own Google account; nobody at Google or Anthropic sees your
  Firebase password — it's stored in that Apps Script project's private Script Properties, not in
  the script's visible code.

## Files

| File | Purpose |
|---|---|
| `index.html` | The app |
| `manifest.json`, `sw.js`, `icon-*.png` | Installable, offline-capable PWA shell |
| `database.rules.json` | Paste into Firebase console → Realtime Database → Rules |
| `Project_Task_Tracker.xlsx` | Master workbook — Task Log + Projects sheets, formulas included |
| `google-sheets-sync.gs` | Paste into Google Sheets → Extensions → Apps Script for live sync |

Hosting on GitHub Pages is unchanged from before: push these files to a repo, enable Pages on
the root of `main`, done.
