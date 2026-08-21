// Write a prescription. This is the screen that has to be fast and unambiguous.

import { html, mount, toast, confirmDialog, formatDate, ageFrom, isoDate, initials } from "../ui.js";
import { icon } from "../icons.js";
import * as store from "../store.js";
import { pickPatient, pickMedicine, pickPastMedicines, sheet } from "../components.js";
import { itemLine } from "../script.js";
import { actionButtons, isDocAction, runDocAction } from "../docactions.js";
import * as router from "../router.js";

export async function view(ctx) {
  const existingId = ctx.params.id || null;
  let prescription;
  let patient = null;

  if (existingId) {
    prescription = await store.prescriptions.get(existingId);
    if (!prescription) {
      return { title: "Prescription", back: "/history", largeTitle: true,
        content: html`<p class="muted">This prescription no longer exists.</p>` };
    }
  } else {
    prescription = store.newPrescription();
    if (ctx.query.patient) prescription.patientId = ctx.query.patient;

    // Arriving from "write a script with this" in the formulary.
    const seedId = sessionStorage.getItem("rx:seed-drug");
    if (seedId) {
      sessionStorage.removeItem("rx:seed-drug");
      const { catalogue, toPrescriptionItem } = await import("../formulary.js");
      const { drugs } = await catalogue();
      const drug = drugs.find((d) => d.id === seedId);
      if (drug) prescription.items.push(store.newPrescriptionItem(toPrescriptionItem(drug)));
    }
  }

  if (prescription.patientId) patient = await store.patients.get(prescription.patientId);

  // The working copy. Nothing is written until the prescriber saves or issues.
  const draft = structuredClone(prescription);
  let dirty = false;
  const issued = draft.status === "issued";

  // What this patient has had before: drives the "repeat last script" action and
  // the per-drug dose hints. Reloaded whenever the patient changes.
  let context = await patientContext(draft.patientId, draft.id);

  return {
    title: existingId ? "Prescription" : "New prescription",
    back: existingId ? "/history" : null,
    largeTitle: !existingId,
    content: html`<div id="rx-root">${renderBody({ draft, patient, issued, context })}</div>`,
    mount(root) {
      let patientRef = patient;
      // Redraws replace only the composer, so the shell's large title survives.
      const canvas = root.querySelector("#rx-root");

      const markDirty = () => {
        dirty = true;
        const btn = canvas.querySelector("[data-act='save']");
        if (btn) btn.disabled = false;
      };

      function redraw() {
        // `dirty` has to be rendered, not just toggled on the live node: a
        // redraw would otherwise reset "Save draft" to disabled while there
        // are still unsaved changes.
        mount(canvas, renderBody({ draft, patient: patientRef, issued, context, dirty }));
        bind();
      }

      function bind() {
        // Inputs write straight into the draft, keyed by data-field.
        canvas.querySelectorAll("[data-field]").forEach((el) => {
          el.addEventListener("input", () => {
            const { field, itemId } = el.dataset;
            if (itemId) {
              const item = draft.items.find((i) => i.id === itemId);
              if (item) {
                item[field] = el.value;
                // Keep the line-as-it-will-print in step with the fields above it.
                const preview = canvas.querySelector(`[data-preview="${itemId}"]`);
                if (preview) preview.textContent = itemLine(item);
              }
            } else {
              draft[field] = el.value;
            }
            markDirty();
          });
        });
      }

      async function save({ status = null, silent = false } = {}) {
        if (!draft.patientId) {
          toast("Choose a patient first", "error");
          return null;
        }
        if (!draft.items.length) {
          toast("Add at least one medicine", "error");
          return null;
        }
        if (status) draft.status = status;
        const saved = await store.prescriptions.save(draft);
        draft.id = saved.id;
        draft.rev = saved.rev;
        dirty = false;
        // Learn the names and doses actually written, so the next script for the
        // same thing is a couple of taps.
        await store.recordMedicineUsage(draft.items);
        if (!silent) toast(status === "issued" ? "Prescription issued" : "Saved", "ok");
        return saved;
      }

      root.addEventListener("action", async ({ detail: { act, el } }) => {
        if (act === "pick-patient") {
          const chosen = await pickPatient();
          if (chosen) {
            draft.patientId = chosen.id;
            patientRef = chosen;
            context = await patientContext(draft.patientId, draft.id);
            markDirty();
            redraw();
          }
        } else if (act === "add-medicine") {
          const { toPrescriptionItem } = await import("../formulary.js");
          let count = 0;
          // The sheet stays open, so several medicines are one visit. Items are
          // appended as they are chosen rather than collected and applied at the
          // end, so dismissing the sheet never loses what was already picked.
          await pickMedicine({
            onPick: (drug) => {
              draft.items.push(store.newPrescriptionItem(toPrescriptionItem(drug)));
              count += 1;
              markDirty();
            },
          });
          if (count) {
            redraw();
            // Put the cursor where the prescriber will type next.
            canvas.querySelector(".rx-item:last-of-type [data-field='dose']")?.focus();
          }
        } else if (act === "past-medicines") {
          const chosen = await pickPastMedicines({
            patientId: draft.patientId,
            alreadyOn: draft.items.map((i) => i.name),
          });
          if (chosen.length) {
            draft.items.push(...chosen.map((entry) => store.newPrescriptionItem({
              name: entry.name,
              drugId: entry.drugId || null,
              strength: entry.strength,
              dose: entry.dose,
              frequency: entry.frequency,
            })));
            markDirty();
            redraw();
            toast(`Added ${chosen.length === 1 ? chosen[0].name : `${chosen.length} medicines`}`, "ok");
          }
        } else if (act === "repeat-last") {
          if (!context.lastScript) return;
          draft.items.push(
            ...context.lastScript.items.map(({ id, ...rest }) => store.newPrescriptionItem(rest))
          );
          if (!draft.diagnosis && context.lastScript.diagnosis) {
            draft.diagnosis = context.lastScript.diagnosis;
            draft.icd10 = context.lastScript.icd10 || draft.icd10;
          }
          markDirty();
          redraw();
          toast("Loaded — check it before issuing", "ok");
        } else if (act === "move-up" || act === "move-down") {
          const index = draft.items.findIndex((i) => i.id === el.dataset.itemId);
          const target = act === "move-up" ? index - 1 : index + 1;
          if (index >= 0 && target >= 0 && target < draft.items.length) {
            const [moved] = draft.items.splice(index, 1);
            draft.items.splice(target, 0, moved);
            markDirty();
            redraw();
          }
        } else if (act === "remove-item") {
          draft.items = draft.items.filter((i) => i.id !== el.dataset.itemId);
          markDirty();
          redraw();
        } else if (act === "repeat-minus" || act === "repeat-plus") {
          const item = draft.items.find((i) => i.id === el.dataset.itemId);
          if (item) {
            const step = act === "repeat-plus" ? 1 : -1;
            item.repeats = Math.max(0, Math.min(11, (Number(item.repeats) || 0) + step));
            markDirty();
            redraw();
          }
        } else if (act === "show-reference") {
          const item = draft.items.find((i) => i.id === el.dataset.itemId);
          if (item?.reference) {
            await sheet({ title: item.name, body: html`
              <p class="small muted" style="margin-bottom:8px">Formulary guidance</p>
              <p>${item.reference}</p>
              <p class="small muted" style="margin-top:16px">
                Reference only. Confirm the dose against the current package insert and the patient's renal and hepatic function.
              </p>
            ` });
          }
        } else if (act === "save") {
          await save();
          redraw();
        } else if (act === "issue") {
          const saved = await save({ status: "issued" });
          if (saved) router.go(`/prescribe/${saved.id}`, { replace: true });
        } else if (isDocAction(act)) {
          // Anything leaving the app is saved first, so what was sent is what
          // the record shows.
          if (act !== "doc-copy" && (dirty || !draft.id)) await save({ silent: true });
          if (!draft.patientId || !draft.items.length) {
            toast(draft.patientId ? "Add at least one medicine" : "Choose a patient first", "error");
            return;
          }
          await runDocAction(act, { kind: "prescription", patient: patientRef, record: draft });
        } else if (act === "duplicate") {
          const copy = store.newPrescription({
            patientId: draft.patientId,
            diagnosis: draft.diagnosis,
            icd10: draft.icd10,
            notes: draft.notes,
            items: draft.items.map(({ id, ...rest }) => store.newPrescriptionItem(rest)),
          });
          const saved = await store.prescriptions.save(copy);
          toast("Copied to a new prescription", "ok");
          router.go(`/prescribe/${saved.id}`);
        } else if (act === "delete") {
          const ok = await confirmDialog({
            title: "Delete this prescription?",
            message: "It will be removed from the patient's record.",
            confirmLabel: "Delete",
            danger: true,
          });
          if (ok && draft.id) {
            await store.prescriptions.remove(draft.id);
            toast("Deleted");
            router.go("/history");
          }
        }
      });

      bind();

      const warn = (event) => {
        if (!dirty) return;
        event.preventDefault();
        event.returnValue = "";
      };
      window.addEventListener("beforeunload", warn);
      return () => window.removeEventListener("beforeunload", warn);
    },
  };
}

// ---------------------------------------------------------------------------

/**
 * This patient's prescribing history: the most recent issued script (to repeat)
 * and per-drug dosing (to hint). Excludes the script being edited, so opening
 * an old one does not offer to repeat itself.
 */
async function patientContext(patientId, currentId) {
  if (!patientId) return { lastScript: null, drugHistory: new Map() };
  const [scripts, drugHistory] = await Promise.all([
    store.prescriptions.byPatient(patientId),
    store.patientDrugHistory(patientId),
  ]);
  const lastScript = scripts.find(
    (s) => s.id !== currentId && s.status === "issued" && (s.items || []).length
  ) || null;
  return { lastScript, drugHistory };
}

/**
 * "You usually write …" only when it is this patient's own pattern. One prior
 * script is reported as a fact rather than a habit.
 */
function doseHint(item, drugHistory) {
  const prior = drugHistory.get(String(item.name || "").trim().toLowerCase());
  if (!prior) return null;
  const written = [prior.strength, prior.dose, prior.frequency].filter(Boolean).join(" ");
  if (!written) return null;

  // Nothing to suggest if the line already says exactly that.
  const current = [item.strength, item.dose, item.frequency].filter(Boolean).join(" ");
  if (current === written) return null;

  return prior.count > 1
    ? `You usually write ${written} for this patient`
    : `Last time: ${written}`;
}

function renderBody({ draft, patient, issued, context, dirty = false }) {
  return html`
    ${issued ? html`
      <div class="alert alert--info">
        ${icon("check")}
        <div>Issued ${formatDate(draft.issuedAt)}. Editing it will change the record you already handed out.</div>
      </div>` : ""}

    ${patientCard(patient)}

    <div class="card card--pad section">
      <div class="field-grid">
        <label class="field">
          <span class="field__label">Date</span>
          <input class="input" type="date" data-field="issuedAt" value="${draft.issuedAt || isoDate()}">
        </label>
        <label class="field">
          <span class="field__label">ICD-10 <span class="muted">optional</span></span>
          <input class="input" data-field="icd10" value="${draft.icd10 || ""}" placeholder="E11.9">
        </label>
      </div>
      <label class="field" style="margin-bottom:0">
        <span class="field__label">Diagnosis <span class="muted">optional</span></span>
        <input class="input" data-field="diagnosis" value="${draft.diagnosis || ""}" placeholder="Type 2 diabetes mellitus">
      </label>
    </div>

    <div class="section">
      <div class="section__head">
        <span class="section__title">Medicines</span>
        <span class="small muted">${draft.items.length || "none"}</span>
      </div>

      ${draft.items.length
        ? draft.items.map((item, index) =>
            itemCard(item, index, draft.items.length, context.drugHistory))
        : html`<div class="card card--pad" style="text-align:center">
            <p class="muted small">No medicines on this script yet.</p>
          </div>`}

      <button class="btn btn--secondary btn--block" data-act="add-medicine" style="margin-top:12px">
        ${icon("plus", { size: 18 })} Add medicine
      </button>

      ${context.drugHistory.size
        ? html`
          <button class="btn btn--outline btn--block" data-act="past-medicines" style="margin-top:8px">
            ${icon("book", { size: 18 })} Past medicines
            <span class="muted small" style="font-weight:400">· ${context.drugHistory.size}</span>
          </button>`
        : ""}

      ${context.lastScript && !draft.items.length
        ? html`
          <button class="btn btn--outline btn--block" data-act="repeat-last" style="margin-top:8px">
            ${icon("copy", { size: 18 })} Repeat last script
            <span class="muted small" style="font-weight:400">
              · ${formatDate(context.lastScript.issuedAt, { month: "short", day: "numeric" })}
            </span>
          </button>
          <p class="small muted" style="margin-top:6px;text-align:center">
            ${context.lastScript.items.map((i) => i.name).join(", ")}
          </p>`
        : ""}

      ${!draft.items.length && !draft.id
        ? html`<button class="btn btn--ghost btn--block" data-nav="/import" style="margin-top:8px">
            ${icon("camera", { size: 18 })} Import from a photo or PDF
          </button>`
        : ""}
    </div>

    <div class="section">
      <label class="field">
        <span class="field__label">Notes to the pharmacist <span class="muted">optional</span></span>
        <textarea class="textarea" data-field="notes" placeholder="e.g. Please dispense generic where available"
          >${draft.notes || ""}</textarea>
      </label>
    </div>

    <div class="section stack">
      ${draft.status === "issued"
        ? ""
        : html`<button class="btn btn--primary btn--block" data-act="issue">
            ${icon("check")} Issue prescription
          </button>`}

      <div class="section__head" style="margin:8px 0 0">
        <span class="section__title">Send it</span>
      </div>
      ${actionButtons()}

      ${draft.status === "issued"
        ? html`<button class="btn btn--secondary btn--block" data-act="duplicate" style="margin-top:8px">
            ${icon("copy")} Use as template for a new script
          </button>`
        : html`<button class="btn btn--ghost btn--block" data-act="save" ${dirty ? "" : "disabled"}>
            Save draft
          </button>`}

      ${draft.id
        ? html`<button class="btn btn--ghost" data-act="delete" style="color:var(--danger-500)">
            ${icon("trash")} Delete prescription
          </button>`
        : ""}
    </div>

    <p class="small muted" style="margin-top:24px;text-align:center">
      Formulary doses are reference guidance. You remain responsible for the prescription you sign.
    </p>
  `;
}

function patientCard(patient) {
  if (!patient) {
    return html`
      <button class="card list__item" data-act="pick-patient" style="width:100%">
        <div class="avatar">${icon("people", { size: 20 })}</div>
        <div class="list__body">
          <div class="list__title">Choose patient</div>
          <div class="list__meta">Required before the script can be issued</div>
        </div>
        <span class="list__chevron">${icon("chevronRight", { size: 18 })}</span>
      </button>
    `;
  }
  const age = ageFrom(patient.dob);
  const meta = [
    age != null ? `${age} yrs` : null,
    patient.dob || null,
    (patient.allergies || []).length ? `Allergies: ${patient.allergies.join(", ")}` : null,
  ].filter(Boolean).join(" · ");

  return html`
    <button class="card list__item" data-act="pick-patient" style="width:100%">
      <div class="avatar">${initials(store.patientName(patient))}</div>
      <div class="list__body">
        <div class="list__title">${store.patientName(patient)}</div>
        <div class="list__meta">${meta}</div>
      </div>
      <span class="list__chevron">${icon("chevronRight", { size: 18 })}</span>
    </button>
    ${(patient.allergies || []).length
      ? html`<div class="alert alert--warn" style="margin-top:12px">
          ${icon("warning")}<div><b>Allergies:</b> ${patient.allergies.join(", ")}</div>
        </div>`
      : ""}
  `;
}

function itemCard(item, index, count, drugHistory) {
  const hint = doseHint(item, drugHistory);
  return html`
    <div class="rx-item">
      <div class="rx-item__head">
        <div class="grow">
          <input class="input" data-field="name" data-item-id="${item.id}" value="${item.name}"
            aria-label="Medicine name" style="font-weight:600">
          ${item.reference
            ? html`<button class="rx-item__ref" data-act="show-reference" data-item-id="${item.id}"
                style="background:none;border:0;padding:4px 0 0;text-align:left;color:var(--brand-600);cursor:pointer">
                Formulary guidance
              </button>`
            : ""}
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex-shrink:0">
          ${count > 1
            ? html`
              <button class="rx-item__remove" data-act="move-up" data-item-id="${item.id}"
                aria-label="Move ${item.name} up" ${index === 0 ? "disabled" : ""}
                style="${index === 0 ? "opacity:.25" : ""}">${icon("chevronUp", { size: 16 })}</button>`
            : ""}
          <button class="rx-item__remove" data-act="remove-item" data-item-id="${item.id}"
            aria-label="Remove ${item.name}">${icon("close", { size: 18 })}</button>
          ${count > 1
            ? html`
              <button class="rx-item__remove" data-act="move-down" data-item-id="${item.id}"
                aria-label="Move ${item.name} down" ${index === count - 1 ? "disabled" : ""}
                style="${index === count - 1 ? "opacity:.25" : ""}">${icon("chevronDown", { size: 16 })}</button>`
            : ""}
        </div>
      </div>

      <div class="field-grid">
        <label class="field">
          <span class="field__label">Strength</span>
          <input class="input" data-field="strength" data-item-id="${item.id}" value="${item.strength || ""}" placeholder="500 mg">
        </label>
        <label class="field">
          <span class="field__label">Dose</span>
          <input class="input" data-field="dose" data-item-id="${item.id}" value="${item.dose || ""}" placeholder="1 tablet">
          ${hint ? html`<span class="field__hint">${hint}</span>` : ""}
        </label>
        <label class="field">
          <span class="field__label">Frequency</span>
          <input class="input" data-field="frequency" data-item-id="${item.id}" value="${item.frequency || ""}" placeholder="b.d.">
        </label>
        <label class="field">
          <span class="field__label">Duration</span>
          <input class="input" data-field="duration" data-item-id="${item.id}" value="${item.duration || ""}" placeholder="7 days">
        </label>
        <label class="field">
          <span class="field__label">Quantity</span>
          <input class="input" data-field="quantity" data-item-id="${item.id}" value="${item.quantity || ""}" placeholder="30">
        </label>
        <div class="field">
          <span class="field__label">Repeats</span>
          <div class="row" style="gap:8px">
            <button class="btn btn--outline btn--sm" data-act="repeat-minus" data-item-id="${item.id}" aria-label="Fewer repeats">−</button>
            <span class="grow tabular" style="text-align:center;font-weight:600">${Number(item.repeats) || 0}</span>
            <button class="btn btn--outline btn--sm" data-act="repeat-plus" data-item-id="${item.id}" aria-label="More repeats">+</button>
          </div>
        </div>
      </div>

      <label class="field" style="margin-bottom:0">
        <span class="field__label">Instructions</span>
        <input class="input" data-field="instructions" data-item-id="${item.id}"
          value="${item.instructions || ""}" placeholder="Take with food">
      </label>

      <p class="small muted" style="margin-top:10px" data-preview="${item.id}">${itemLine(item)}</p>
    </div>
  `;
}
