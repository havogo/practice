# Deploying Practice

From this folder to the app on your phone. About fifteen minutes the first time,
about thirty seconds every time after that.

There is **no build step**. The files in this folder are the files the browser
runs, so deploying is only ever "copy these files somewhere they can be reached".

---

## Before you start

- A GitHub account.
- This folder, which is already a git repository with everything committed.

Nothing else. No Node, no npm, no build tools.

**One thing to check first.** `Practice Script & Certificate Manager.pdf` in this
folder contains a real patient's name and date of birth. It is listed in
`.gitignore`, so git will not publish it — confirm that with:

```bash
cd "/Users/michaelsmit/cl code" && git status --porcelain --ignored | grep -i "\.pdf"
```

It should print the file with `!!` in front of it, meaning ignored. If it ever
shows `??` or `A `, stop and say so before pushing.

---

## Step 1 — Create an empty repository on GitHub

1. Go to <https://github.com/new>.
2. **Repository name:** `practice` (anything works; it becomes part of the web
   address).
3. **Public** or **Private** — see the note below.
4. Leave *Add a README*, *Add .gitignore* and *Choose a licence* all **unticked**.
   This folder already has those files, and pre-filling them creates a conflict
   you would then have to untangle.
5. **Create repository**.

GitHub will show you a page of setup commands. Ignore it; the next step covers it.

### Public or private?

GitHub Pages only publishes from a **private** repository on a paid plan
(GitHub Pro, about $4/month). On the free plan the repository has to be
**public** for the site to work.

Public means the *code* is readable by anyone. It does **not** mean your patient
records are: those live in the browser's database on your own devices, and never
go into the repository. Nothing patient-identifying is in these files.

If you would rather keep the code private without paying, use Cloudflare Pages
instead — see "Alternative host" at the end.

---

## Step 2 — Push this folder to it

Pushing needs GitHub to know it is you. Pick whichever of these you prefer.

### Option A — GitHub Desktop (easiest, no terminal)

1. Install it from <https://desktop.github.com> and sign in to your GitHub
   account.
2. **File → Add Local Repository…** and choose `/Users/michaelsmit/cl code`.
   It will recognise the existing repository and its four commits.
3. Click **Publish repository** in the top bar.
4. Untick **Keep this code private** if you are on the free plan.
5. **Publish repository**.

Done — skip to Step 3.

### Option B — the terminal

GitHub stopped accepting account passwords for pushing, so you need either an
SSH key or a personal access token. SSH is less hassle long term:

```bash
ssh-keygen -t ed25519 -C "michaelsmit@outlook.com" -f ~/.ssh/id_ed25519 -N ""
```

Then copy the public key to your clipboard:

```bash
pbcopy < ~/.ssh/id_ed25519.pub
```

Paste it into <https://github.com/settings/ssh/new> (any title), and **Add SSH
key**. Now connect this folder to the repository and push — replace
`YOUR-USERNAME` and, if you named it differently, `practice`:

```bash
cd "/Users/michaelsmit/cl code" && git remote add origin git@github.com:YOUR-USERNAME/practice.git && git push -u origin main
```

The first push uploads about 20 MB and takes a minute or so — most of that is
the PDF reader and text recogniser in `vendor/`.

---

## Step 3 — Turn on GitHub Pages

1. In the repository on GitHub: **Settings** (top row) → **Pages** (left menu).
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. **Branch:** `main`, folder: `/ (root)`. **Save**.
4. Wait one to two minutes. Reload the page and it will show
   *"Your site is live at …"*.

Your address will be:

```
https://YOUR-USERNAME.github.io/practice/
```

Open it in Safari. You should see **Good morning, Dr Michael** and the tab bar
along the bottom. If you get a 404, give it another minute — the first publish
is the slow one.

---

## Step 4 — Install it on your iPhone

**This step is not optional.** Run from a Safari tab, iOS is entitled to clear
the app's storage after a stretch of disuse, and your records go with it.
Installed to the Home Screen, it is not.

1. Open the address above **in Safari** (not Chrome — only Safari can install to
   the Home Screen on iOS).
2. Tap **Share** (the square with the arrow).
3. Scroll down and tap **Add to Home Screen**.
4. Name it **Practice**. **Add**.

Open it from the Home Screen icon. It should fill the screen with no Safari
address bar. Go to **Settings** inside the app: the amber "Add this app to your
Home Screen" warning should be gone, replaced by
*"Installed to the Home Screen with durable storage granted."*

That sentence is the one that matters. It means iOS has agreed not to evict
your data.

Do the same on any other device you want it on — an iPad, or **Add to Dock** in
Safari on the Mac.

---

## Step 5 — Fill in your details

In the app: **Settings → Prescriber**.

Your name, qualifications, HPCSA number and practice number are already filled
in from the prescription you gave me. Check them, and add a **signature image**
if you want one printed: photograph your signature on plain white paper, and
upload it there. It prints above the signature line on scripts and certificates.

---

## Step 6 — Sync between devices (optional)

Skip this if you only use one phone. The app is complete without it, and
**Settings → Export a backup** covers you either way.

1. Create a free project at <https://supabase.com>. Pick a region near you.
2. In the project: **SQL Editor → New query**. Paste the contents of
   `setup.sql` (also in the app under **Settings → Set up sync → Show the SQL**)
   and press **Run**. It should say *Success. No rows returned.*
3. **Authentication → Users → Add user → Create new user.** Use your email,
   choose a password, and tick **Auto Confirm User**.
4. **Project Settings → API.** You need two things from here:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **anon public** key — a long string starting `eyJ…`
5. In the app: **Settings → Set up sync**. Paste both, then the email and
   password from step 3. **Connect and sync**.

Repeat step 5 only on your other devices — same URL, key, email and password.
They will pull down everything within a few seconds.

> The anon key is designed to be public. Row-level security is what protects the
> data: the SQL restricts every row to the account that owns it.

**Test it before trusting it.** Add a patient called "Test Test" on one device,
tap **Sync now**, then **Sync now** on the other. If they appear, it works.
Delete the test patient afterwards.

---

## Publishing a change later

Whenever you or I change anything under `app/`, `styles/` or `data/`, bump the
version number at the top of `sw.js` — `const VERSION = "v4";` becomes `"v5"`.
That is what tells already-installed phones to throw away the old cached copy.

Then, in GitHub Desktop: write a short summary, **Commit to main**, **Push
origin**. Or in the terminal:

```bash
cd "/Users/michaelsmit/cl code" && git add -A && git commit -m "what changed" && git push
```

GitHub Pages republishes within a minute or two. On the phone, the update
arrives the *next* time you open the app — the first launch after a change
fetches it, the one after that runs it. Force-quitting and reopening twice makes
it immediate.

---

## If something goes wrong

**The site shows 404 after a few minutes.**
Settings → Pages, confirm the branch is `main` and the folder is `/ (root)`.
Check the **Actions** tab for a failed deployment.

**The page loads but is blank or unstyled.**
Almost always a path problem. Confirm your address ends with a slash —
`…github.io/practice/` and not `…github.io/practice`.

**"Add to Home Screen" is missing.**
You are not in Safari. Chrome and Firefox on iOS cannot install web apps.

**Settings still says storage is not durable after installing.**
Open the app from the Home Screen icon rather than the Safari tab, and give it
one launch. If it persists it is harmless — it only means iOS has not committed;
keep exporting backups.

**Importing a photo does nothing, or the spinner sticks.**
The text recogniser is about 12 MB and is fetched the first time you use it.
On a slow connection give it a minute. It is cached afterwards. If it fails on
the deployed site but works locally, tell me — it is likely how GitHub serves
`vendor/tesseract/eng.traineddata.gz`, which I can work around.

**A change is not showing up on the phone.**
You forgot to bump `VERSION` in `sw.js`, or you have only opened the app once
since. In Safari on the phone you can also go to Settings → Safari → Advanced →
Website Data and remove the site, then reopen from the Home Screen icon.

**Sync says "permission denied for table records".**
The SQL in step 6.2 did not run completely. Run it again — it is safe to run
more than once.

---

## Alternative host — Cloudflare Pages

Use this if you want the code private without paying GitHub.

1. Push to a **private** GitHub repository (Step 2, choosing private).
2. At <https://dash.cloudflare.com> → **Workers & Pages → Create → Pages →
   Connect to Git**, authorise GitHub and pick the repository.
3. **Framework preset:** None. **Build command:** leave empty. **Build output
   directory:** `/`.
4. **Save and Deploy.**

You get an address like `https://practice-x7y.pages.dev`. Everything else —
installing, sync, updating — works the same. Pushing to `main` redeploys.

---

## What is where, once deployed

| | |
|---|---|
| The code | GitHub, public or private as you chose |
| Patient records | The browser database on each of your devices |
| Records, if sync is on | Also your own Supabase project, one row per record |
| Backups | Wherever you exported them — iCloud Drive is the sensible place |

Nothing patient-identifying is ever in the repository, whichever host you use.
