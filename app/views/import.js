// Import a previous prescription from a photo, a PDF, or pasted text.
//
// Nothing read here becomes a prescription on its own. The screen ends with a
// draft the prescriber has looked at line by line — a machine reading of a
// medicine name is a suggestion, never an instruction.

import { html, mount, toast, formatDate, isoDate, initials, ageFrom, plural } from "../ui.js";
import { icon } from "../icons.js";
import * as store from "../store.js";
import * as router from "../router.js";
import { sheet, pickPatient, readForm } from "../components.js";

export async function view(ctx) {
  let stage = "choose";   // choose | working | review
  let progress = { fraction: null, label: "" };
  let result = null;      // { text, method, previews }
  let parsed = null;
  let patient = null;
  let drugs = [];
  let error = null;

  return {
    title: "Import a prescription",
    back: "/prescribe",
    largeTitle: true,
    content: html`<div id="im-root">${chooser()}</div>`,
    mount(root) {
      const canvas = root.querySelector("#im-root");
      const redraw = () => {
        mount(canvas, screen());
        bindFields();
      };

      function screen() {
        if (error) return errorScreen(error);
        if (stage === "working") return working(progress);
        if (stage === "review") return review({ parsed, patient, result });
        return chooser();
      }

      function bindFields() {
        canvas.querySelectorAll("[data-f]").forEach((el) => {
          el.addEventListener("input", () => {
            const { f, i } = el.dataset;
            if (i === undefined) {
              parsed[f] = el.value;
            } else {
              parsed.items[Number(i)][f] = el.value;
            }
          });
        });
      }

      async function run(work) {
        stage = "working";
        error = null;
        progress = { fraction: null, label: "Starting" };
        redraw();
        try {
          const extract = await import("../extract.js");
          const rxParse = await import("../rx-parse.js");
          const formulary = await import("../formulary.js");
          drugs = (await formulary.catalogue()).drugs;

          result = await work(extract, (fraction, label) => {
            progress = { fraction, label };
            const bar = canvas.querySelector("#im-bar");
            const text = canvas.querySelector("#im-label");
            if (bar) bar.style.width = `${Math.round((fraction ?? 0) * 100)}%`;
            if (text) text.textContent = label;
          });

          parsed = rxParse.parsePrescription(result.text, drugs, {
            exactText: result.method === "pdf-text",
          });
          patient = await guessPatient(parsed.patient);
          stage = "review";
        } catch (err) {
          console.error("[import]", err);
          error = String(err?.message || err);
          stage = "choose";
        }
        redraw();
        // The recogniser holds several megabytes; let it go once it is idle.
        import("../extract.js").then((m) => m.releaseOcr()).catch(() => {});
      }

      root.addEventListener("action", async ({ detail: { act, el } }) => {
        if (act === "pick-file" || act === "take-photo") {
          canvas.querySelector(act === "take-photo" ? "#im-camera" : "#im-file").click();
        } else if (act === "paste-text") {
          const text = await pasteSheet();
          if (text) await run(async () => ({ text, method: "paste", previews: [] }));
        } else if (act === "retry") {
          error = null;
          stage = "choose";
          redraw();
        } else if (act === "change-patient") {
          const chosen = await pickPatient();
          if (chosen) {
            patient = chosen;
            redraw();
          }
        } else if (act === "create-patient") {
          patient = await store.patients.save(
            store.newPatient({
              firstName: splitName(parsed.patient.name).first,
              surname: splitName(parsed.patient.name).last,
              dob: parsed.patient.dob || "",
              idNumber: parsed.patient.idNumber || "",
            })
          );
          toast("Patient added", "ok");
          redraw();
        } else if (act === "drop-item") {
          parsed.items.splice(Number(el.dataset.i), 1);
          redraw();
        } else if (act === "use-suggestion") {
          const item = parsed.items[Number(el.dataset.i)];
          item.name = item.suggestion;
          item.drugId = null;
          item.suggestion = null;
          redraw();
        } else if (act === "add-to-formulary") {
          const item = parsed.items[Number(el.dataset.i)];
          await store.medicines.save({
            name: item.name,
            strength: item.strength || "",
            frequency: item.frequency || "",
            indications: parsed.diagnosis ? [parsed.diagnosis] : [],
            dose: item.source || "",
          });
          toast(`${item.name} added to your formulary`, "ok");
          item.addedToFormulary = true;
          redraw();
        } else if (act === "show-text") {
          await sheet({
            title: "Text that was read",
            body: html`<pre style="white-space:pre-wrap;font-size:12px;line-height:1.5;margin:0">${result.text}</pre>`,
          });
        } else if (act === "create-draft") {
          await createDraft();
        }
      });

      async function createDraft() {
        if (!patient) {
          toast("Choose a patient first", "error");
          return;
        }
        if (!parsed.items.length) {
          toast("There are no medicines to import", "error");
          return;
        }
        const draft = store.newPrescription({
          patientId: patient.id,
          issuedAt: parsed.issuedAt || isoDate(),
          status: "draft",
          diagnosis: parsed.diagnosis || "",
          icd10: parsed.icd10 || "",
          notes: "",
          items: parsed.items.map((i) =>
            store.newPrescriptionItem({
              name: i.name,
              drugId: i.drugId,
              strength: i.strength,
              dose: i.dose,
              frequency: i.frequency,
              duration: i.duration,
              quantity: i.quantity,
              repeats: Number(i.repeats) || 0,
              instructions: i.instructions,
            })
          ),
        });
        const saved = await store.prescriptions.save(draft);
        toast("Imported as a draft — check it before issuing", "ok");
        router.go(`/prescribe/${saved.id}`, { replace: true });
      }

      // Delegated so it keeps working across redraws, which replace the inputs.
      canvas.addEventListener("change", async (event) => {
        const input = event.target.closest("input[type='file']");
        if (!input) return;
        const file = input.files?.[0];
        input.value = "";
        if (!file) return;
        await run(async (extract, onProgress) => extract.extractText(file, { onProgress }));
      });

      bindFields();
    },
  };
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

function chooser() {
  return html`
    <p class="view__subtitle">
      Read an old script back in from a photo or a PDF. Everything is checked by you
      before it becomes a prescription.
    </p>

    <div class="stack">
      <button class="btn btn--primary btn--block" data-act="take-photo">
        ${icon("camera")} Take a photo
      </button>
      <button class="btn btn--outline btn--block" data-act="pick-file">
        ${icon("upload")} Choose a photo or PDF
      </button>
      <button class="btn btn--ghost btn--block" data-act="paste-text">
        ${icon("copy")} Paste text
      </button>
    </div>

    <input type="file" id="im-camera" accept="image/*" capture="environment" class="hidden">
    <input type="file" id="im-file" accept="image/*,application/pdf" class="hidden">

    <div class="alert alert--info" style="margin-top:24px">
      ${icon("check")}
      <div>
        A PDF you produced yourself reads back exactly — no recognition involved.
        A photo is put through text recognition, which is good but not perfect.
        <br><br>
        On an iPhone the sharpest results come from the built-in text tool: open the
        photo, press and hold the text, <b>Copy</b>, then use <b>Paste text</b> above.
      </div>
    </div>
  `;
}

function working({ fraction, label }) {
  return html`
    <div style="padding:48px 0;text-align:center">
      <div class="spinner" style="margin:0 auto 20px"></div>
      <p id="im-label" style="font-weight:550">${label || "Working"}</p>
      <div style="max-width:260px;margin:16px auto 0;height:6px;border-radius:999px;
        background:var(--surface-sunk);overflow:hidden">
        <div id="im-bar" style="height:100%;width:${Math.round((fraction ?? 0) * 100)}%;
          background:var(--brand-500);transition:width .3s"></div>
      </div>
      <p class="small muted" style="margin-top:16px">
        Reading a photo can take a few seconds. Keep this screen open.
      </p>
    </div>
  `;
}

function errorScreen(message) {
  return html`
    <div class="alert alert--danger">${icon("warning")}<div>${message}</div></div>
    <button class="btn btn--outline btn--block" data-act="retry">Try again</button>
  `;
}

function review({ parsed, patient, result }) {
  const methodLabel = {
    "pdf-text": "Read directly from the PDF",
    ocr: "Read with text recognition",
    paste: "From pasted text",
  }[result.method] || "Imported";

  return html`
    <div class="row row--between" style="margin-bottom:12px">
      <span class="badge ${result.method === "pdf-text" ? "badge--ok" : "badge--muted"}">${methodLabel}</span>
      <button class="section__link" data-act="show-text">See the text</button>
    </div>

    ${parsed.warnings.map(
      (w) => html`<div class="alert alert--warn">${icon("warning")}<div>${w}</div></div>`
    )}

    ${result.previews.length
      ? html`<div class="card" style="margin-bottom:16px;padding:8px">
          <img src="${result.previews[0]}" alt="The document that was imported"
            style="width:100%;border-radius:8px;display:block">
        </div>`
      : ""}

    <div class="section" style="margin-top:0">
      <div class="section__head"><span class="section__title">Patient</span></div>
      ${patient
        ? html`
          <button class="card list__item" data-act="change-patient" style="width:100%">
            <div class="avatar">${initials(store.patientName(patient))}</div>
            <div class="list__body">
              <div class="list__title">${store.patientName(patient)}</div>
              <div class="list__meta">
                ${ageFrom(patient.dob) != null ? `${ageFrom(patient.dob)} yrs · ` : ""}on file
              </div>
            </div>
            <span class="list__chevron">${icon("chevronRight", { size: 18 })}</span>
          </button>`
        : html`
          <div class="card card--pad">
            <p style="font-weight:550">${parsed.patient.name || "No name was read"}</p>
            ${parsed.patient.dob ? html`<p class="small muted">DOB ${parsed.patient.dob}</p>` : ""}
            <p class="small muted" style="margin:8px 0 12px">
              ${parsed.patient.name
                ? "This patient is not on file yet."
                : "Choose who this prescription is for."}
            </p>
            <div class="btn-row btn-row--split">
              ${parsed.patient.name
                ? html`<button class="btn btn--primary btn--sm" data-act="create-patient">Add as new patient</button>`
                : ""}
              <button class="btn btn--outline btn--sm" data-act="change-patient">Choose existing</button>
            </div>
          </div>`}
    </div>

    <div class="section">
      <div class="section__head">
        <span class="section__title">Details</span>
      </div>
      <div class="card card--pad">
        <div class="field-grid">
          <label class="field">
            <span class="field__label">Date</span>
            <input class="input" type="date" data-f="issuedAt" value="${parsed.issuedAt || isoDate()}">
          </label>
          <label class="field">
            <span class="field__label">ICD-10</span>
            <input class="input" data-f="icd10" value="${parsed.icd10 || ""}">
          </label>
        </div>
        <label class="field" style="margin-bottom:0">
          <span class="field__label">Diagnosis</span>
          <input class="input" data-f="diagnosis" value="${parsed.diagnosis || ""}">
        </label>
      </div>
    </div>

    <div class="section">
      <div class="section__head">
        <span class="section__title">Medicines</span>
        <span class="small muted">${plural(parsed.items.length, "line")}</span>
      </div>
      ${parsed.items.length
        ? parsed.items.map(itemCard)
        : html`<div class="card card--pad" style="text-align:center">
            <p class="muted small">No medicines were recognised. Use “See the text” to check what was read.</p>
          </div>`}
    </div>

    <div class="section stack">
      <button class="btn btn--primary btn--block" data-act="create-draft">
        ${icon("check")} Create a draft prescription
      </button>
      <p class="small muted" style="text-align:center">
        It is saved as a draft. Nothing is issued until you review and issue it yourself.
      </p>
    </div>
  `;
}

function itemCard(item, index) {
  const confident = item.drugId && item.matchScore >= 0.9;
  return html`
    <div class="rx-item">
      <div class="rx-item__head">
        <div class="grow">
          <input class="input" data-f="name" data-i="${index}" value="${item.name}"
            style="font-weight:600;border-color:${item.drugId ? "var(--line)" : "var(--warn-600)"}">
          <div class="rx-item__ref" style="margin-top:6px">
            ${confident
              ? html`<span class="badge badge--ok">${icon("check", { size: 12 })} matched</span>`
              : item.drugId
                ? html`<span class="badge badge--muted">matched · ${Math.round(item.matchScore * 100)}%</span>`
                : html`<span class="badge badge--warn">not in formulary</span>`}
            ${item.rawName !== item.name
              ? html` <span class="small muted">read as “${item.rawName}”</span>`
              : ""}
          </div>
        </div>
        <button class="rx-item__remove" data-act="drop-item" data-i="${index}" aria-label="Remove this line">
          ${icon("close", { size: 18 })}
        </button>
      </div>

      ${item.suggestion
        ? html`<button class="btn btn--secondary btn--sm btn--block" data-act="use-suggestion" data-i="${index}"
            style="margin-bottom:10px">Did you mean ${item.suggestion}?</button>`
        : ""}

      <div class="field-grid">
        <label class="field">
          <span class="field__label">Strength</span>
          <input class="input" data-f="strength" data-i="${index}" value="${item.strength}">
        </label>
        <label class="field">
          <span class="field__label">Dose</span>
          <input class="input" data-f="dose" data-i="${index}" value="${item.dose}">
        </label>
        <label class="field">
          <span class="field__label">Frequency</span>
          <input class="input" data-f="frequency" data-i="${index}" value="${item.frequency}">
        </label>
        <label class="field">
          <span class="field__label">Duration</span>
          <input class="input" data-f="duration" data-i="${index}" value="${item.duration}">
        </label>
        <label class="field">
          <span class="field__label">Quantity</span>
          <input class="input" data-f="quantity" data-i="${index}" value="${item.quantity}">
        </label>
        <label class="field">
          <span class="field__label">Repeats</span>
          <input class="input tabular" data-f="repeats" data-i="${index}" value="${item.repeats}" inputmode="numeric">
        </label>
      </div>

      <label class="field" style="margin-bottom:8px">
        <span class="field__label">Instructions</span>
        <input class="input" data-f="instructions" data-i="${index}" value="${item.instructions}">
      </label>

      <details>
        <summary class="small muted" style="cursor:pointer">Original line</summary>
        <p class="small muted" style="margin-top:6px">${item.source}</p>
      </details>

      ${!item.drugId && !item.addedToFormulary
        ? html`<button class="btn btn--ghost btn--sm btn--block" data-act="add-to-formulary" data-i="${index}"
            style="margin-top:8px">${icon("plus", { size: 14 })} Add to my formulary</button>`
        : ""}
      ${item.addedToFormulary
        ? html`<p class="small" style="color:var(--ok-600);margin-top:8px">Added to your formulary</p>`
        : ""}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function splitName(full) {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

/** Find the patient this script was written for, if they are already on file. */
async function guessPatient({ name, dob, idNumber }) {
  const all = await store.patients.all();
  if (idNumber) {
    const byId = all.find((p) => p.idNumber && p.idNumber === idNumber);
    if (byId) return byId;
  }
  if (!name) return null;
  const target = name.toLowerCase().replace(/[^a-z ]/g, "").trim();
  const scored = all
    .map((p) => {
      const full = store.patientName(p).toLowerCase().replace(/[^a-z ]/g, "").trim();
      let score = full === target ? 1 : 0;
      if (!score && full && target) {
        const a = new Set(full.split(" "));
        const b = target.split(" ").filter(Boolean);
        const hits = b.filter((w) => a.has(w)).length;
        score = hits / Math.max(b.length, a.size);
      }
      if (dob && p.dob === dob) score += 0.3;
      return { p, score };
    })
    .sort((x, y) => y.score - x.score);
  return scored[0] && scored[0].score >= 0.75 ? scored[0].p : null;
}

function pasteSheet() {
  return sheet({
    title: "Paste the prescription",
    body: html`
      <p class="small muted" style="margin-bottom:12px">
        On an iPhone: open the photo, press and hold the text, choose <b>Copy</b>, then paste here.
        That uses the phone's own text recognition, which is usually sharper than doing it in the app.
      </p>
      <form id="ps">
        <label class="field">
          <textarea class="textarea" name="text" style="min-height:180px"
            placeholder="Re: ...&#10;Rx&#10;Amoxicillin 500mg t.d.s. for 7 days"></textarea>
        </label>
        <button class="btn btn--primary btn--block" type="submit">Read this</button>
      </form>
    `,
    onMount(root, close) {
      const form = root.querySelector("#ps");
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const { text } = readForm(form);
        if (text) close(text);
      });
      setTimeout(() => form.querySelector("textarea")?.focus(), 120);
    },
  });
}
