# Putting Practice on your phone

Follow this top to bottom. Every step says what to do, and what you should see
when it worked.

**Time:** about 20 minutes the first time.
**You need:** your Mac, your iPhone, and your GitHub login.

You will not have to type a single command. There is a terminal version at the
very bottom if you ever want it, but ignore it for now.

---

# Part 1 — Put the code on GitHub

GitHub is where the app's files will live. Think of it as Dropbox for code, and
it can also serve those files as a website — which is how the app gets onto your
phone.

### Step 1.1 — Install GitHub Desktop

1. Go to **<https://desktop.github.com>**
2. Click the big **Download for macOS** button.
3. Open the file that lands in your Downloads folder.
4. Drag the **GitHub Desktop** icon into your **Applications** folder.
5. Open **GitHub Desktop** from Applications.

> If macOS says *"GitHub Desktop can't be opened because it is from an
> unidentified developer"* — right-click the app icon, choose **Open**, then
> **Open** again. That only happens once.

### Step 1.2 — Sign in

1. GitHub Desktop will ask you to sign in. Click **Sign in to GitHub.com**.
2. Your browser opens. Enter your GitHub username and password.
3. Click **Authorize desktop**.
4. Back in GitHub Desktop, it asks for your name and email. Whatever is filled
   in is fine. Click **Finish**.

✅ **You should see:** a mostly empty GitHub Desktop window saying *"Let's get
started!"*

### Step 1.3 — Tell it about the app's folder

1. In the menu bar at the very top of the screen: **File → Add Local
   Repository…**
2. A file picker opens. Click **Choose…**
3. Navigate to your home folder and select the folder called **`cl code`**.
   (It is at `/Users/michaelsmit/cl code`.)
4. Click **Open**, then click **Add Repository**.

✅ **You should see:** the window now says **cl code** in the top-left, and
*"No local changes"* in the middle. That is correct — everything is already
saved.

❌ **If it says** *"This directory does not appear to be a Git repository"* —
you picked the wrong folder. Go back to step 2 and make sure you selected
`cl code` itself, not a folder inside it and not your whole home folder.

### Step 1.4 — Publish it

1. Click the **Publish repository** button in the top bar.
2. A box appears. Change **Name** from `cl-code` to **`practice`**.
   (This becomes part of your web address, so a tidy name helps.)
3. **Untick the box that says "Keep this code private."**

   > This feels wrong, so here is why. GitHub only publishes websites from
   > private folders if you pay them about $4 a month. Leaving it public means
   > people can read the app's *code* — the buttons and layout. It does **not**
   > share any patient information. Patient records are saved inside the app on
   > your phone and never go to GitHub. I have double-checked that nothing with
   > a patient's name in it is included.
   >
   > If you would rather not have the code public, skip to **Appendix B** at the
   > bottom for a free alternative.

4. Click **Publish repository**.
5. Wait. A blue bar creeps across the top. It is uploading about 20 MB, so give
   it one or two minutes.

✅ **You should see:** the blue bar finishes and the button now reads **Fetch
origin** instead of Publish repository.

---

# Part 2 — Turn it into a website

The files are on GitHub now, but not yet being served as a website. Two clicks.

### Step 2.1 — Open your repository in a browser

1. In GitHub Desktop's menu bar: **Repository → View on GitHub**.
2. Your browser opens a page listing all the app's files.

### Step 2.2 — Switch the website on

1. Near the top of that page, in the row that says
   *Code · Issues · Pull requests …*, click **⚙ Settings** (far right).
2. Down the **left-hand menu**, click **Pages**.
3. Under **Build and deployment**, find **Source**. Click the dropdown and
   choose **Deploy from a branch**.
4. Just below, a **Branch** section appears with two dropdowns.
   - Set the first to **main**
   - Leave the second as **/ (root)**
5. Click **Save**.

✅ **You should see:** a message appears saying *"GitHub Pages source saved."*

### Step 2.3 — Wait, then get your address

1. Wait **two minutes**. Genuinely — the first publish is slow.
2. Reload the page (Cmd-R).
3. At the top you should now see a green tick and:
   *"Your site is live at https://…"*

Your address will look like this, with your own GitHub username:

```
https://YOUR-USERNAME.github.io/practice/
```

4. Click **Visit site** to check it.

✅ **You should see:** the app, greeting you by name — **Good morning, Dr
Michael** or afternoon or evening, depending on the time — with a row of icons
along the bottom: Today, Prescribe, Patients, Formulary, Settings.

❌ **If you get a 404 "File not found"** — wait another two minutes and reload.
If it is still 404 after five minutes, go back to Step 2.2 and check the branch
says `main` and the folder says `/ (root)`.

**Write that address down.** You need it in the next part.

---

# Part 3 — Put it on your iPhone

This is the most important part. Do not skip it.

> **Why it matters.** If you just bookmark the app in Safari, iPhone treats it
> like any other website and is allowed to delete its saved data when it needs
> space — taking your patient records with it. Adding it to the Home Screen
> makes iPhone treat it as a real app and stop doing that. This is exactly the
> problem you had before.

### Step 3.1 — Open it in Safari

1. On your iPhone, open **Safari**. It must be Safari — Chrome cannot do this.
2. Type in your address from Part 2:
   `YOUR-USERNAME.github.io/practice/`
3. Wait for the app to load.

### Step 3.2 — Add it to the Home Screen

1. Tap the **Share** button — the square with an arrow pointing up, at the
   bottom middle of the screen.
2. Scroll down the list of options.
3. Tap **Add to Home Screen**.
4. The name box will say *Practice*. Leave it.
5. Tap **Add** in the top-right.

✅ **You should see:** a new **Practice** icon on your Home Screen — a teal
square with a white ℞ on it.

### Step 3.3 — Check it worked

1. **Close Safari completely.**
2. Tap the new **Practice** icon on your Home Screen.
3. The app should fill the whole screen, with **no Safari address bar** at the
   top.
4. Tap **Settings** (the cog, bottom-right).
5. Look at the very top of that screen.

✅ **You should see** a blue box saying:
*"Installed to the Home Screen with durable storage granted."*

That sentence is the whole point. It means iPhone has agreed not to delete your
records.

❌ **If you still see an amber warning** saying *"Add this app to your Home
Screen"* — you opened it from Safari, not from the new icon. Close everything
and tap the Home Screen icon instead.

---

# Part 4 — Fill in your details

1. In the app, tap **Settings**.
2. Tap your name at the top, under **PRESCRIBER**.
3. Check everything. Your name, qualifications, HPCSA number, practice number,
   address and phone are already filled in from the prescription you sent me.
   Correct anything that is wrong.
4. **Optional but worth doing:** add your signature.
   - Sign your name on a plain white piece of paper.
   - Photograph it with your phone, straight on, in good light.
   - In the app, scroll to **Signature image** and tap **Choose File**, then
     **Photo Library**, and pick it.
   - It will be printed above the signature line on every script and
     certificate.
5. Tap **Save**.

### Try it out

1. Tap **Patients** → **Add** (top right). Put in a fake patient — "Test Test",
   any date of birth. Tap **Add patient**.
2. Tap **Script**.
3. Tap **Add medicine**, type a medicine you actually use — try `Adco-Dol` —
   and tap the blue **Prescribe "Adco-Dol"** button.
4. Fill in the strength and how often, then tap **Issue prescription**.
5. Tap **Print / PDF** and check it looks right.

Delete the test patient afterwards: open them, tap **Edit**, scroll down,
**Delete patient**.

---

# Part 5 — Same records on more than one device (optional)

**Skip this entirely if you only use your phone.** The app is complete without
it. Come back later if you want it.

If you want your iPad or Mac to show the same patients, you need somewhere for
the devices to meet. That is Supabase — a free service where the data sits in an
account only you can open.

### Step 5.1 — Make a Supabase account

1. Go to **<https://supabase.com>** and click **Start your project**.
2. Sign in with GitHub (easiest, you already have it).
3. Click **New project**.
4. **Name:** `practice`. **Database Password:** click **Generate a password**
   and then **copy it somewhere safe** — you will not need it often, but you
   cannot get it back.
5. **Region:** pick the one closest to you.
6. Click **Create new project** and wait about two minutes while it sets up.

### Step 5.2 — Set up the table

1. In the left-hand menu, click the **SQL Editor** icon.
2. Click **New query**.
3. Open the file **`setup.sql`** in your `cl code` folder (double-click it —
   it opens in TextEdit). Select all of it (Cmd-A), copy (Cmd-C).
4. Paste it into the big empty box in Supabase.
5. Click the green **Run** button, bottom right.

✅ **You should see:** *"Success. No rows returned."* at the bottom.

### Step 5.3 — Make yourself a login

1. Left-hand menu → **Authentication**.
2. Click **Add user** → **Create new user**.
3. **Email:** your email. **Password:** make one up and write it down.
4. **Tick "Auto Confirm User".**
5. Click **Create user**.

### Step 5.4 — Get the two keys

1. Left-hand menu → **Project Settings** (the cog at the bottom) → **API**.
2. You need two things off this page. Keep it open.
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **anon public** — a very long string starting `eyJ…`

### Step 5.5 — Connect the app

1. In the app: **Settings** → **Set up sync**.
2. Paste the **Project URL** into the first box.
3. Paste the **anon public** key into the second.
4. Enter the **email and password** you made in Step 5.3.
5. Tap **Connect and sync**.

✅ **You should see:** the sheet closes and a message says **Sync connected**.

### Step 5.6 — Do the same on your other device

Install the app there first (Part 3), then repeat Step 5.5 with the same four
details. Everything appears within a few seconds.

### Step 5.7 — Test it before you trust it

1. On your phone, add a patient called **Test Sync**.
2. Go to **Settings** → **Sync now**.
3. On the other device: **Settings** → **Sync now**.
4. Check that Test Sync appears there.
5. Delete the test patient.

❌ **If you see "permission denied for table records"** — the SQL in Step 5.2
did not finish. Run it again; running it twice is harmless.

---

# Part 6 — Backups

Do this once a month, and before you ever change phones. It takes ten seconds.

1. **Settings** → **Export a backup**.
2. The iPhone share sheet opens. Tap **Save to Files**.
3. Choose **iCloud Drive**. Tap **Save**.

That one file contains every patient, script, note, certificate and invoice. To
put it back on a new phone: install the app there, then **Settings → Restore
from a backup**, and pick the file.

Restoring is safe — it keeps whichever copy of each record is newer, so
restoring an old backup will not wipe out recent work.

---

# Part 7 — Getting changes onto your phone later

When I change something, or you do, here is how it reaches your phone.

1. Open **GitHub Desktop**.
2. On the left you will see a list of what changed.
3. In the bottom-left box, type a few words about what changed — anything, it is
   just a note to yourself.
4. Click **Commit to main**.
5. Click **Push origin** in the top bar.
6. Wait about two minutes for GitHub to republish.
7. On your phone: **close the app completely** (swipe up from the bottom and
   flick it away), then open it twice.

> Why twice? The first opening quietly downloads the update in the background.
> The second one runs it. This is deliberate — it means the app always opens
> instantly, even with no signal.

**Important:** if I have changed anything, I will also have bumped a version
number in the file `sw.js`. If you change something yourself and it does not
show up on the phone, that is why — tell me and I will sort it.

---

# When something is not right

**The app looks plain and unstyled, or completely blank.**
Check your address ends with a **slash**: `…github.io/practice/` not
`…github.io/practice`.

**"Add to Home Screen" is not in the share menu.**
You are in Chrome, not Safari. Only Safari can do this on iPhone.

**The app icon is there but it opens in Safari with an address bar.**
You added a bookmark instead. Delete the icon (press and hold → Remove) and do
Part 3 again, making sure you tap *Add to Home Screen*.

**Importing a photo of a script spins forever the first time.**
It is downloading the text-recognition engine, about 12 MB. Let it finish once
on wifi and it never downloads again.

**I changed something and the phone still shows the old version.**
Close the app fully and open it twice. If still nothing, tell me.

**Anything else.**
Tell me what you did, what you expected, and what happened instead. A screenshot
helps.

---

# Your checklist

- [ ] GitHub Desktop installed and signed in
- [ ] Repository published (named `practice`, not private)
- [ ] Pages turned on — branch `main`, folder `/ (root)`
- [ ] Site opens in a browser
- [ ] Added to iPhone Home Screen
- [ ] Settings shows **"durable storage granted"**
- [ ] Prescriber details checked, signature added
- [ ] Test script written and printed
- [ ] First backup exported to iCloud Drive
- [ ] Sync set up *(only if you use more than one device)*

---
---

# Appendix A — the terminal version

Only if you would rather not use GitHub Desktop.

Set up an SSH key once:

```bash
ssh-keygen -t ed25519 -C "michaelsmit@outlook.com" -f ~/.ssh/id_ed25519 -N "" && pbcopy < ~/.ssh/id_ed25519.pub
```

Paste the clipboard into <https://github.com/settings/ssh/new> and save. Then,
after creating an empty repository named `practice` on GitHub:

```bash
cd "/Users/michaelsmit/cl code" && git remote add origin git@github.com:YOUR-USERNAME/practice.git && git push -u origin main
```

Publishing a change later:

```bash
cd "/Users/michaelsmit/cl code" && git add -A && git commit -m "what changed" && git push
```

To run the app on your Mac without deploying at all:

```bash
python3 tools/serve.py
```

Then open <http://localhost:8765/>.

---

# Appendix B — keeping the code private, free

GitHub only serves websites from private repositories on a paid plan.
Cloudflare does it free.

1. Do Part 1, but **leave "Keep this code private" ticked**.
2. Go to **<https://dash.cloudflare.com>** and make a free account.
3. **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
4. Authorise GitHub and pick your `practice` repository.
5. **Framework preset:** None. **Build command:** leave empty.
   **Build output directory:** `/`
6. **Save and Deploy.**

You get an address like `https://practice-x7y.pages.dev`. Everything else in
this guide works exactly the same — use that address instead in Part 3.

---

# Where everything lives, once you are done

| Thing | Where it is |
|---|---|
| The app's code | GitHub |
| Your patient records | Inside the app, on your own phone |
| Records, if you set up sync | Also your own Supabase account |
| Backups | Wherever you saved them — iCloud Drive |

Nothing with a patient's name in it is ever on GitHub.
