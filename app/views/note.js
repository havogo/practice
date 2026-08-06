// A clinical note, structured as SOAP with vitals.

import { html, toast, confirmDialog, formatDate, isoDate, debounce } from "../ui.js";
import { icon } from "../icons.js";
import * as store from "../store.js";
import { readForm } from "../components.js";
import * as router from "../router.js";

const NOTE_TYPES = ["consultation", "follow-up", "telephonic", "procedure", "referral", "certificate"];

export async function view(ctx) {
  const note = await store.encounters.get(ctx.params.id);
  if (!note) {
    return { title: "Note", back: "/patients", largeTitle: true,
      content: html`<p class="muted">This note no longer exists.</p>` };
  }
  const patient = note.patientId ? await store.patients.get(note.patientId) : null;

  let saved = true;

  return {
    title: store.patientName(patient),
    back: patient ? `/patients/${patient.id}` : "/patients",
    action: { label: "Done", act: "done" },
    content: html`
      <form id="nf">
        <div class="card card--pad">
          <div class="field-grid">
            <label class="field">
              <span class="field__label">Date</span>
              <input class="input" name="date" type="date" value="${note.date || isoDate()}">
            </label>
            <label class="field">
              <span class="field__label">Type</span>
              <select class="select" name="type">
                ${NOTE_TYPES.map((t) => html`
                  <option value="${t}" ${t === note.type ? "selected" : ""}>${t}</option>
                `)}
              </select>
            </label>
          </div>
        </div>

        <div class="section">
          <div class="section__head"><span class="section__title">Vitals</span></div>
          <div class="card card--pad">
            <div class="field-grid field-grid--3">
              ${[
                ["bp", "BP", "120/80"],
                ["pulse", "Pulse", "72"],
                ["temp", "Temp °C", "36.8"],
                ["spo2", "SpO₂ %", "98"],
                ["weight", "Weight kg", "78"],
                ["height", "Height cm", "175"],
              ].map(([key, label, placeholder]) => html`
                <label class="field">
                  <span class="field__label">${label}</span>
                  <input class="input" name="v_${key}" value="${note.vitals?.[key] || ""}"
                    placeholder="${placeholder}" inputmode="decimal">
                </label>
              `)}
            </div>
          </div>
        </div>

        <div class="section">
          <div class="section__head"><span class="section__title">Note</span></div>
          <div class="card card--pad">
            ${[
              ["subjective", "Subjective", "Presenting complaint, history"],
              ["objective", "Objective", "Examination findings"],
              ["assessment", "Assessment", "Diagnosis or impression"],
              ["plan", "Plan", "Management, follow-up"],
            ].map(([key, label, placeholder]) => html`
              <label class="field">
                <span class="field__label">${label}</span>
                <textarea class="textarea" name="${key}" placeholder="${placeholder}">${note[key] || ""}</textarea>
              </label>
            `)}
            <label class="field" style="margin-bottom:0">
              <span class="field__label">ICD-10 <span class="muted">optional</span></span>
              <input class="input" name="icd10" value="${note.icd10 || ""}" placeholder="J06.9">
            </label>
          </div>
        </div>

        <div class="section stack">
          <button class="btn btn--outline btn--block" type="button"
            data-nav="/prescribe?patient=${note.patientId}">
            ${icon("script")} Write a script from this consultation
          </button>
          <button class="btn btn--ghost btn--block" type="button" data-act="delete" style="color:var(--danger-500)">
            ${icon("trash")} Delete note
          </button>
        </div>

        <p class="small muted" style="text-align:center;margin-top:16px" id="nf-status">
          Saved ${formatDate(note.updatedAt)}
        </p>
      </form>
    `,
    mount(root) {
      const form = root.querySelector("#nf");
      const status = root.querySelector("#nf-status");

      const persist = async () => {
        const data = readForm(form);
        await store.encounters.save({
          ...note,
          date: data.date || note.date,
          type: data.type,
          subjective: data.subjective || "",
          objective: data.objective || "",
          assessment: data.assessment || "",
          plan: data.plan || "",
          icd10: data.icd10 || "",
          vitals: {
            bp: data.v_bp || "", pulse: data.v_pulse || "", temp: data.v_temp || "",
            spo2: data.v_spo2 || "", weight: data.v_weight || "", height: data.v_height || "",
          },
        });
        saved = true;
        status.textContent = `Saved ${new Date().toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}`;
      };

      // A consultation note should never be lost to a mis-tap, so it autosaves.
      const autosave = debounce(persist, 900);
      form.addEventListener("input", () => {
        saved = false;
        status.textContent = "Saving…";
        autosave();
      });

      root.addEventListener("action", async ({ detail: { act } }) => {
        if (act === "done") {
          await persist();
          toast("Note saved", "ok");
          router.go(patient ? `/patients/${patient.id}` : "/patients");
        } else if (act === "delete") {
          const ok = await confirmDialog({
            title: "Delete this note?",
            confirmLabel: "Delete",
            danger: true,
          });
          if (ok) {
            await store.encounters.remove(note.id);
            toast("Note deleted");
            router.go(patient ? `/patients/${patient.id}` : "/patients");
          }
        }
      });

      const warn = (event) => {
        if (saved) return;
        event.preventDefault();
        event.returnValue = "";
      };
      window.addEventListener("beforeunload", warn);
      return () => {
        window.removeEventListener("beforeunload", warn);
        if (!saved) persist();
      };
    },
  };
}
