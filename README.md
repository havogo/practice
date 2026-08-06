# Practice

Prescriptions, patient notes and billing for a single-practitioner practice.
Runs on the phone, installs to the Home Screen, works with no signal.

---

## What it is, and why it is built this way

A **static, zero-build progressive web app**. Plain ES modules, no framework, no
bundler, no `npm install`. Every file in this repository is the file the browser
runs.

That choice is deliberate:

| Concern | How this handles it |
|---|---|
| Data lost when Safari clears its cache | IndexedDB, not `localStorage`; installing to the Home Screen makes it durable |
| Moving to a new phone | One-file JSON export, plus optional sync |
| Working between phone and laptop | Optional Supabase sync, off by default |
| Being able to change it later | No toolchain to rot — edit a file, push, done |
| Working in a consulting room with no signal | Service worker caches the whole app and formulary |

There is no build step, so there is no version of this that stops working
because a dependency changed.

---

## Running it

**Locally**

```bash
cd "path/to/this/folder" && python3 -m http.server 8765
```

Then open <http://localhost:8765/>. It needs to be served over `http://`, not
opened as a `file://` path, because ES modules and service workers require an
origin.

**Publishing to GitHub Pages**

```bash
git remote add origin git@github.com:YOUR-USERNAME/practice.git && git push -u origin main
```

Then in the repository: **Settings → Pages → Source: Deploy from a branch →
`main` / `(root)`**. A minute later it is live at
`https://YOUR-USERNAME.github.io/practice/`.

A public repository means the *code* is public. It does **not** publish any
patient data — records never leave the device unless you switch sync on. If you
would rather the code were private too, GitHub Pages works from private
repositories on a paid plan; otherwise Cloudflare Pages hosts private repos free.

**Installing on the iPhone**

Open the published URL in Safari → Share → **Add to Home Screen**.

This matters more than it sounds. In a Safari tab, iOS may evict the app's
storage after roughly seven days of disuse. Installed to the Home Screen, the
app requests persistent storage and iOS stops treating it as disposable. The
Settings screen tells you which state you are in.

---

## Layout

```
index.html               shell
manifest.webmanifest     install metadata
sw.js                    offline cache
styles/app.css           design system (light + dark, iOS safe areas)
data/formulary.json      generated — do not edit by hand
icons/                   generated — see tools/make_icons.py
vendor/                  third-party libraries, loaded only when importing
app/
  main.js                routing, chrome, boot
  router.js              hash router
  ui.js                  escaping templates, formatting, toasts, dialogs
  db.js                  IndexedDB
  store.js               records and repositories
  formulary.js           reference + personal medicines, search
  script.js              the printed/shared prescription
  extract.js             photo/PDF -> text
  rx-parse.js            text -> structured prescription
  backup.js              export, restore, merge
  sync.js                optional Supabase sync
  components.js          sheets, pickers
  views/                 one file per screen
tools/
  parse_formulary.py     text formulary  -> data/formulary.json
  make_icons.py          -> icons/
```

### How records are shaped

Every record carries `{ id, createdAt, updatedAt, deletedAt, rev }`. Deletes are
tombstones, never hard removals, so a device that has been offline still learns
that something was deleted when it next syncs. Conflicts resolve last-write-wins
on `updatedAt`.

---

## The formulary

`data/formulary.json` is generated from a text export — 610 medicines and 586
indications, searchable by drug name or by condition.

To regenerate it from a new source file:

```bash
python3 tools/parse_formulary.py "path/to/formulary.txt"
```

The parser expects `### Drug name`, `**Indication:**`, `**Dosage:**` blocks.

It infers a default strength and frequency for each drug to prefill a script.
Where the reference gives a *range* ("250–500 mg"), the range is shown but the
field is left blank — the app will not put a number on a script that you did not
choose. Anything you add yourself under **Formulary → Add** is stored in
IndexedDB, searched alongside the reference list, and overrides a reference
entry of the same name.

---

## Importing an old prescription

**Prescribe → Import from a photo or PDF**, or the button on Today.

Three routes in, in descending order of accuracy:

| Source | How it is read | Accuracy |
|---|---|---|
| A PDF with a text layer (anything you printed to PDF yourself) | read straight out of the file | exact |
| Text pasted in | as given | exact |
| A photograph, or a scanned PDF | optical character recognition | good, not perfect |

Whatever comes out is matched against the formulary, which is what repairs a
misread name: `Metfomin` scores 0.86 against *Metformin hydrochloride* and is
corrected, while `5OOmg` becomes `500 mg`. A name the matcher cannot place is
flagged rather than guessed, and can be added to your own formulary in one tap —
which is how trade names like *Glucophage XR* get into your list.

The result is always a **draft**. Nothing is issued from a machine reading of a
script.

> On an iPhone the phone's own text recognition beats the one in the app. Open
> the photo, press and hold the text, **Copy**, then use **Paste text**.

The libraries that do this — a PDF reader and a text recogniser — live in
`vendor/` and total about 12 MB. They are fetched only the first time you import
something, then cached, so they cost nothing to open the app or write a script.

---

## Sync (optional)

The app is complete without it. Turn it on when you want the same records on
more than one device.

It uses **your own Supabase project**, so the data sits in an account you
control rather than one belonging to this app.

1. Create a free project at supabase.com.
2. Open the SQL editor and run the statement in **Settings → Set up sync → Show
   the SQL** (also in `app/sync.js` as `SETUP_SQL`). It creates one table with
   row-level security so an account can only ever read its own rows.
3. Create yourself a user under **Authentication → Users**.
4. In the app: **Settings → Set up sync**, paste the project URL and the *anon
   public* key, sign in.

The anon key is designed to be public — row-level security is what protects the
data, not the key.

> Sync is written against Supabase's REST and auth endpoints and is wired up but
> has **not** been run against a live project. Test it with a throwaway patient
> before trusting it, and keep exporting backups either way.

---

## Backups

**Settings → Export a backup** writes one JSON file containing everything. On
the phone this opens the share sheet — save it to iCloud Drive and it survives a
lost handset.

Restore merges rather than overwrites: for each record the newer copy wins, so
restoring an old backup onto a device you have kept using will not undo recent
work.

---

## Releasing a change

The service worker serves the app cache-first, so an update reaches the phone on
the *next* launch after it is fetched. Bump `VERSION` in `sw.js` whenever you
change any file under `app/`, `styles/` or `data/` — the old cache is then
discarded on activation.

---

## Scope and responsibility

- The formulary is **reference guidance**, not a decision-support system. There
  is no interaction checking, no renal or hepatic dose adjustment, no allergy
  cross-checking beyond displaying the allergies you recorded. Every dose
  printed is the one you signed for.
- Patient records here are personal health information. Under POPIA you are the
  responsible party for them: keep the device locked, keep backups somewhere
  encrypted, and think before making the hosting repository public with sync
  credentials in it (it does not store them in the repo — they live in the
  browser — but the habit matters).
- Prescribing for family and friends sits under HPCSA guidance on treating
  people close to you, particularly for scheduled substances. The app does not
  police this and does not track schedules.
