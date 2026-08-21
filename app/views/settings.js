// Settings: who signs the scripts, where the data lives, and how to move it.

import { html, mount, toast, confirmDialog, formatDate, plural } from "../ui.js";
import { icon } from "../icons.js";
import * as store from "../store.js";
import * as db from "../db.js";
import * as backup from "../backup.js";
import * as sync from "../sync.js";
import { sheet, readForm } from "../components.js";

const MB = 1024 * 1024;

export async function view(ctx) {
  const [prescriber, prefs, storageState, syncState] = await Promise.all([
    store.getPrescriber(),
    store.getPreferences(),
    Promise.all([db.requestPersistence(), db.estimate()]).then(([p, e]) => ({ ...p, ...e })),
    sync.init(),
  ]);

  const counts = await Promise.all([
    store.patients.all(), store.prescriptions.all(), store.encounters.all(), store.invoices.all(),
  ]).then(([a, b, c, d]) => ({ patients: a.length, prescriptions: b.length, notes: c.length, invoices: d.length }));

  const installed = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

  return {
    title: "Settings",
    largeTitle: true,
    content: html`
      ${!installed
        ? html`
          <div class="alert alert--warn">
            ${icon("warning")}
            <div>
              <b>Add this app to your Home Screen.</b> Running it from a Safari tab means
              iOS can clear its data after a period of disuse. Installed, it cannot.
              <br><br>
              Share ${icon("share", { size: 14 })} → <b>Add to Home Screen</b>.
            </div>
          </div>`
        : html`
          <div class="alert alert--info">
            ${icon("check")}
            <div>Installed to the Home Screen${storageState.persisted ? " with durable storage granted" : ""}.</div>
          </div>`}

      <div class="section">
        <div class="section__head"><span class="section__title">Prescriber</span></div>
        <button class="card list__item" data-act="edit-prescriber" style="width:100%">
          <div class="list__body">
            <div class="list__title">${prescriber.name}</div>
            <div class="list__meta">${prescriber.hpcsa ? `HPCSA ${prescriber.hpcsa}` : "Tap to complete your details"}</div>
          </div>
          <span class="list__chevron">${icon("chevronRight", { size: 18 })}</span>
        </button>
      </div>

      <div class="section">
        <div class="section__head"><span class="section__title">Your data</span></div>
        <div class="card">
          <div class="switch-row">
            <div>
              <div class="switch-row__label">
                ${plural(counts.patients, "patient")} · ${plural(counts.prescriptions, "prescription")}
              </div>
              <div class="switch-row__hint">
                ${plural(counts.notes, "note")} · ${plural(counts.invoices, "invoice")}
              </div>
            </div>
          </div>
          ${storageRow({ installed, storageState })}
        </div>

        <div class="stack" style="margin-top:12px">
          <button class="btn btn--outline btn--block" data-act="export">
            ${icon("download")} Export a backup
          </button>
          <button class="btn btn--outline btn--block" data-act="import">
            ${icon("upload")} Restore from a backup
          </button>
          <input type="file" id="restore-file" accept="application/json,.json" class="hidden">
        </div>
        <p class="small muted" style="margin-top:8px">
          Export writes one JSON file with everything. Save it to iCloud Drive and it survives a lost phone.
        </p>
      </div>

      <div class="section">
        <div class="section__head"><span class="section__title">Sync across devices</span></div>
        <div class="card">
          <div class="switch-row">
            <div>
              <div class="switch-row__label">
                ${syncState.signedIn
                  ? syncState.email
                  : syncState.configured ? "Configured — not signed in" : "Not set up"}
              </div>
              <div class="switch-row__hint">
                ${syncState.lastSyncAt
                  ? `Last synced ${formatDate(syncState.lastSyncAt)} ${new Date(syncState.lastSyncAt)
                      .toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}`
                  : "Optional — the app works fully without it"}
              </div>
            </div>
          </div>
        </div>
        <div class="stack" style="margin-top:12px">
          ${syncState.signedIn
            ? html`
              <button class="btn btn--primary btn--block" data-act="sync-now">${icon("cloud")} Sync now</button>
              <button class="btn btn--ghost btn--block" data-act="sync-signout">Sign out of sync</button>`
            : html`
              <button class="btn btn--outline btn--block" data-act="sync-setup">
                ${icon("cloud")} ${syncState.configured ? "Sign in" : "Set up sync"}
              </button>`}
        </div>
        ${syncState.lastError
          ? html`<p class="field__error">${syncState.lastError}</p>`
          : ""}
      </div>

      <div class="section">
        <div class="section__head"><span class="section__title">Preferences</span></div>
        <div class="card">
          <label class="switch-row" style="cursor:pointer">
            <div>
              <div class="switch-row__label">Show formulary dosing</div>
              <div class="switch-row__hint">Reference guidance on each prescription line</div>
            </div>
            <input type="checkbox" data-pref="showFormularyDose" ${prefs.showFormularyDose ? "checked" : ""}
              style="width:22px;height:22px">
          </label>
        </div>
      </div>

      <div class="section">
        <button class="btn btn--ghost btn--block" data-act="wipe" style="color:var(--danger-500)">
          Erase everything on this device
        </button>
      </div>

      <p class="small muted" style="text-align:center;margin-top:24px">
        Practice · records are held on this device unless you switch on sync
      </p>
    `,
    mount(root) {
      const fileInput = root.querySelector("#restore-file");

      fileInput.addEventListener("change", async () => {
        const file = fileInput.files?.[0];
        fileInput.value = "";
        if (!file) return;
        try {
          const parsed = backup.parseBackup(await backup.readFile(file));
          const totals = Object.entries(parsed.counts || {})
            .filter(([, n]) => n)
            .map(([k, n]) => `${n} ${k}`)
            .join(", ");
          const ok = await confirmDialog({
            title: "Restore this backup?",
            message: `From ${formatDate(parsed.exportedAt)} — ${totals || "no records"}. ` +
              "Records already on this device are kept; the newer copy of each wins.",
            confirmLabel: "Restore",
          });
          if (!ok) return;
          const result = await backup.restoreBackup(parsed, { mode: "merge" });
          const applied = Object.values(result.counts).reduce((a, b) => a + b, 0);
          toast(`Restored ${applied} record${applied === 1 ? "" : "s"}`, "ok");
          ctx.refresh();
        } catch (err) {
          toast(String(err.message || err), "error");
        }
      });

      root.addEventListener("change", async (event) => {
        const el = event.target.closest("[data-pref]");
        if (!el) return;
        await store.setSetting("preferences", { ...prefs, [el.dataset.pref]: el.checked });
        toast("Saved", "ok");
      });

      root.addEventListener("action", async ({ detail: { act } }) => {
        if (act === "edit-prescriber") {
          const saved = await editPrescriber(prescriber);
          if (saved) {
            toast("Details saved", "ok");
            ctx.refresh();
          }
        } else if (act === "export") {
          try {
            const result = await backup.exportBackup();
            if (result.method === "download") toast("Backup downloaded", "ok");
            else if (result.method === "share") toast("Backup exported", "ok");
          } catch (err) {
            toast(String(err.message || err), "error");
          }
        } else if (act === "import") {
          fileInput.click();
        } else if (act === "sync-setup") {
          const done = await setupSync(syncState);
          if (done) {
            toast("Sync connected", "ok");
            ctx.refresh();
          }
        } else if (act === "sync-now") {
          try {
            toast("Syncing…");
            const result = await sync.run();
            toast(`Synced — ${result.applied} in, ${result.pushed} out`, "ok");
            ctx.refresh();
          } catch (err) {
            toast(String(err.message || err), "error");
          }
        } else if (act === "sync-signout") {
          await sync.signOut();
          toast("Signed out");
          ctx.refresh();
        } else if (act === "wipe") {
          const ok = await confirmDialog({
            title: "Erase everything?",
            message: "Every patient, prescription, note and invoice on this device will be deleted. " +
              "Export a backup first if you have not already.",
            confirmLabel: "Erase",
            danger: true,
          });
          if (!ok) return;
          const reallyOk = await confirmDialog({
            title: "This cannot be undone",
            message: "Erase all local records?",
            confirmLabel: "Erase everything",
            danger: true,
          });
          if (!reallyOk) return;
          for (const name of ["patients", "prescriptions", "encounters", "invoices",
                              "certificates", "medicines", "attachments"]) {
            await db.clear(name);
          }
          toast("All local records erased");
          ctx.refresh();
        }
      });
    },
  };
}

/**
 * Where the records are and how safe they are.
 *
 * Two separate facts that are easy to conflate: whether the app is installed,
 * and whether the browser has actually granted durable storage. Installing is
 * what usually earns the grant, but they are not the same thing, so both are
 * stated rather than one being inferred from the other.
 */
function storageRow({ installed, storageState }) {
  const { usage = 0, quota = 0, persisted } = storageState;
  const usedMb = usage / MB;
  const quotaMb = quota / MB;
  const pct = quota ? Math.min(100, (usage / quota) * 100) : 0;

  // The badge carries where the app is running; the label carries what that
  // means for the records. Saying both in both places just reads as a stutter.
  const state = persisted
    ? { label: "Records are safe here", tone: "ok",
        hint: "The browser has granted durable storage — it will not clear these records to reclaim space." }
    : installed
      ? { label: "Awaiting durable storage", tone: "warn",
          hint: "Usually granted after a launch or two. Keep exporting backups until it is." }
      : { label: "Records are not yet protected", tone: "danger",
          hint: "iOS may clear them after a stretch of disuse. Add the app to your Home Screen — Share, then Add to Home Screen." };

  return html`
    <div class="switch-row">
      <div class="grow">
        <div class="switch-row__label">
          ${state.label}
          <span class="badge badge--${state.tone}" style="margin-left:6px">
            ${installed ? "Installed" : "Browser tab"}
          </span>
        </div>
        <div class="switch-row__hint">${state.hint}</div>
      </div>
    </div>

    ${quota
      ? html`
        <div class="switch-row">
          <div class="grow">
            <div class="switch-row__label tabular">
              ${usedMb < 1 ? `${Math.round(usage / 1024)} KB` : `${usedMb.toFixed(1)} MB`} used
              <span class="muted" style="font-weight:400">
                of ${quotaMb > 1024 ? `${(quotaMb / 1024).toFixed(1)} GB` : `${Math.round(quotaMb)} MB`} available
              </span>
            </div>
            <div style="height:6px;border-radius:999px;background:var(--surface-sunk);margin-top:8px;overflow:hidden">
              <div style="height:100%;width:${Math.max(pct, usage ? 1.5 : 0)}%;
                background:${pct > 85 ? "var(--danger-500)" : "var(--brand-500)"}"></div>
            </div>
            <div class="switch-row__hint" style="margin-top:6px">
              ${pct < 1
                ? "Nowhere near the limit — a decade of records is a few megabytes."
                : `${pct.toFixed(1)}% of what this browser will give the app.`}
            </div>
          </div>
        </div>`
      : ""}
  `;
}

function editPrescriber(prescriber) {
  const field = (name, label, value, extra = "") => html`
    <label class="field">
      <span class="field__label">${label}</span>
      <input class="input" name="${name}" value="${value || ""}" ${extra ? html`placeholder="${extra}"` : ""}>
    </label>
  `;

  return sheet({
    title: "Prescriber details",
    body: html`
      <form id="pr">
        <p class="small muted" style="margin-bottom:16px">These appear on every script and invoice you print.</p>
        ${field("name", "Name", prescriber.name)}
        ${field("qualifications", "Qualifications", prescriber.qualifications)}
        ${field("title", "Title", prescriber.title)}
        <div class="field-grid">
          ${field("hpcsa", "HPCSA registration", prescriber.hpcsa)}
          ${field("practiceNumber", "Practice number", prescriber.practiceNumber)}
        </div>
        ${field("addressLine", "Address", prescriber.addressLine)}
        ${field("postalLine", "Postal address", prescriber.postalLine)}
        <div class="field-grid">
          ${field("email", "Email", prescriber.email)}
          ${field("phone", "Phone", prescriber.phone)}
        </div>

        <div class="field">
          <span class="field__label">Signature image <span class="muted">optional</span></span>
          ${prescriber.signatureImage
            ? html`<img src="${prescriber.signatureImage}" alt="Current signature"
                style="max-height:60px;margin-bottom:8px;background:#fff;border-radius:6px;padding:4px">`
            : ""}
          <input class="input" type="file" name="signature" accept="image/*">
          <span class="field__hint">A photo of your signature on white paper prints onto the script.</span>
        </div>

        <button class="btn btn--primary btn--block" type="submit">Save</button>
        ${prescriber.signatureImage
          ? html`<button class="btn btn--ghost btn--block" type="button" data-clear-sig style="margin-top:8px">
              Remove signature image
            </button>`
          : ""}
      </form>
    `,
    onMount(root, close) {
      const form = root.querySelector("#pr");
      let signature = prescriber.signatureImage || "";

      root.querySelector("[data-clear-sig]")?.addEventListener("click", () => {
        signature = "";
        toast("Signature will be removed when you save");
      });

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const file = form.querySelector("[name='signature']").files?.[0];
        if (file) {
          if (file.size > 2 * MB) {
            toast("Signature image must be under 2 MB", "error");
            return;
          }
          signature = await fileToDataUrl(file);
        }
        const data = readForm(form);
        delete data.signature;
        const saved = await store.setSetting("prescriber", { ...prescriber, ...data, signatureImage: signature });
        close(saved);
      });
    },
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function setupSync(syncState) {
  return sheet({
    title: "Sync across devices",
    body: html`
      <p class="small muted" style="margin-bottom:16px">
        Sync uses your own Supabase project, so the records stay in an account you control.
        Create a free project, run the SQL below in its SQL editor, then paste the project
        URL and anon key here.
      </p>

      <details style="margin-bottom:16px">
        <summary class="small" style="cursor:pointer;color:var(--brand-600)">Show the SQL to run once</summary>
        <pre style="white-space:pre-wrap;font-size:11px;background:var(--surface-sunk);padding:12px;
          border-radius:8px;margin-top:8px;overflow-x:auto">${sync.SETUP_SQL}</pre>
        <button class="btn btn--ghost btn--sm" type="button" data-copy-sql style="margin-top:6px">Copy SQL</button>
      </details>

      <form id="sy">
        ${syncState.configured
          ? ""
          : html`
            <label class="field">
              <span class="field__label">Project URL</span>
              <input class="input" name="url" placeholder="https://abcdefgh.supabase.co" required>
            </label>
            <label class="field">
              <span class="field__label">Anon public key</span>
              <input class="input" name="anonKey" placeholder="eyJhbGciOi..." required>
            </label>`}

        <label class="field">
          <span class="field__label">Email</span>
          <input class="input" name="email" type="email" inputmode="email" autocomplete="username" required>
        </label>
        <label class="field">
          <span class="field__label">Password</span>
          <input class="input" name="password" type="password" autocomplete="current-password" required>
          <span class="field__hint">The Supabase account you created for yourself, not your Apple or Google password.</span>
        </label>

        <p class="field__error hidden" id="sy-error"></p>
        <button class="btn btn--primary btn--block" type="submit">Connect and sync</button>
      </form>
    `,
    onMount(root, close) {
      const form = root.querySelector("#sy");
      const error = root.querySelector("#sy-error");

      root.querySelector("[data-copy-sql]")?.addEventListener("click", async () => {
        await navigator.clipboard.writeText(sync.SETUP_SQL);
        toast("SQL copied", "ok");
      });

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        error.classList.add("hidden");
        const data = readForm(form);
        const button = form.querySelector("button[type='submit']");
        button.disabled = true;
        button.textContent = "Connecting…";
        try {
          if (data.url) await sync.configure({ url: data.url, anonKey: data.anonKey });
          await sync.signIn(data.email, data.password);
          await sync.run({ full: true });
          close(true);
        } catch (err) {
          error.textContent = String(err.message || err);
          error.classList.remove("hidden");
          button.disabled = false;
          button.textContent = "Connect and sync";
        }
      });
    },
  });
}
