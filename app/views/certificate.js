// Write a medical certificate.

import { html, mount, toast, confirmDialog, isoDate, plural, debounce } from "../ui.js";
import { icon } from "../icons.js";
import * as store from "../store.js";
import * as router from "../router.js";
import { statement, printCertificate, shareCertificate } from "../certificate.js";

export async function view(ctx) {
  const certificate = await store.certificates.get(ctx.params.id);
  if (!certificate) {
    return { title: "Certificate", back: "/patients", largeTitle: true,
      content: html`<p class="muted">This certificate no longer exists.</p>` };
  }
  const patient = certificate.patientId ? await store.patients.get(certificate.patientId) : null;
  const draft = structuredClone(certificate);

  return {
    title: "Certificate",
    back: patient ? `/patients/${patient.id}` : "/patients",
    action: { label: "Done", act: "done" },
    content: html`<div id="ct-root">${body(draft, patient)}</div>`,
    mount(root) {
      const canvas = root.querySelector("#ct-root");

      const persist = async () => {
        const saved = await store.certificates.save(draft);
        draft.rev = saved.rev;
        return saved;
      };
      const autosave = debounce(persist, 700);

      function redraw() {
        mount(canvas, body(draft, patient));
        bind();
      }

      function bind() {
        canvas.querySelectorAll("[data-f]").forEach((el) => {
          el.addEventListener("input", () => {
            const field = el.dataset.f;
            draft[field] = el.type === "checkbox" ? el.checked : el.value;

            // The wording depends on nearly every field, so keep it live.
            const preview = canvas.querySelector("#ct-preview");
            if (preview) preview.textContent = statement(draft, patient);
            const days = canvas.querySelector("#ct-days");
            const count = store.certificateDays(draft);
            if (days) days.textContent = count ? plural(count, "day") : "check the dates";

            // Fields that change which inputs are shown need a full redraw.
            if (["type", "capacity", "disclose"].includes(field)) redraw();
            else autosave();
          });
        });
      }

      root.addEventListener("action", async ({ detail: { act } }) => {
        if (act === "done") {
          await persist();
          toast("Certificate saved", "ok");
          router.go(patient ? `/patients/${patient.id}` : "/patients");
        } else if (act === "print") {
          await persist();
          await printCertificate({ patient, certificate: draft });
        } else if (act === "share") {
          await persist();
          const result = await shareCertificate({ patient, certificate: draft });
          if (result.downloaded) toast("Saved as an image — attach it to your message", "ok");
        } else if (act === "issue") {
          draft.status = "issued";
          await persist();
          redraw();
          toast("Certificate issued", "ok");
        } else if (act === "delete") {
          const ok = await confirmDialog({
            title: "Delete this certificate?", confirmLabel: "Delete", danger: true,
          });
          if (ok) {
            await store.certificates.remove(draft.id);
            toast("Certificate deleted");
            router.go(patient ? `/patients/${patient.id}` : "/patients");
          }
        }
      });

      bind();
      return () => persist();
    },
  };
}

function body(draft, patient) {
  const days = store.certificateDays(draft);
  const showPeriod = draft.type !== "attendance" && draft.capacity !== "fit";

  return html`
    <div class="card card--pad">
      <label class="field">
        <span class="field__label">Type</span>
        <select class="select" data-f="type">
          ${Object.entries(store.CERTIFICATE_TYPES).map(
            ([value, label]) => html`
              <option value="${value}" ${value === draft.type ? "selected" : ""}>${label}</option>
            `
          )}
        </select>
      </label>
      <div class="field-grid" style="margin-bottom:0">
        <label class="field" style="margin-bottom:0">
          <span class="field__label">Examined on</span>
          <input class="input" type="date" data-f="examinedOn" value="${draft.examinedOn}" max="${isoDate()}">
        </label>
        <label class="field" style="margin-bottom:0">
          <span class="field__label">Time <span class="muted">optional</span></span>
          <input class="input" type="time" data-f="examinedAt" value="${draft.examinedAt || ""}">
        </label>
      </div>
    </div>

    <div class="section">
      <div class="section__head"><span class="section__title">Basis</span></div>
      <div class="card card--pad">
        <label class="field" style="margin-bottom:0">
          <span class="field__label">This certificate is based on</span>
          <select class="select" data-f="basis">
            <option value="examination" ${draft.basis === "examination" ? "selected" : ""}>
              My own examination and observation
            </option>
            <option value="reported" ${draft.basis === "reported" ? "selected" : ""}>
              What the patient reported to me
            </option>
          </select>
          <span class="field__hint">
            A certificate must say which of these it rests on. Choosing the second prints that
            plainly, rather than implying you observed something you did not.
          </span>
        </label>
      </div>
    </div>

    ${draft.type !== "attendance"
      ? html`
        <div class="section">
          <div class="section__head"><span class="section__title">Condition</span></div>
          <div class="card card--pad">
            <label class="field">
              <span class="field__label">Nature of the condition</span>
              <input class="input" data-f="condition" value="${draft.condition || ""}"
                placeholder="Acute gastroenteritis">
            </label>
            <label class="switch-row" style="cursor:pointer;padding-inline:0;border:0">
              <div>
                <div class="switch-row__label">Print the condition on the certificate</div>
                <div class="switch-row__hint">
                  Only with the patient's consent. Left off, it reads “a medical condition”.
                </div>
              </div>
              <input type="checkbox" data-f="disclose" ${draft.disclose ? "checked" : ""}
                style="width:22px;height:22px">
            </label>
            <label class="field" style="margin-bottom:0">
              <span class="field__label">The patient is</span>
              <select class="select" data-f="capacity">
                <option value="unfit" ${draft.capacity === "unfit" ? "selected" : ""}>
                  Unfit to attend work or school
                </option>
                <option value="light-duties" ${draft.capacity === "light-duties" ? "selected" : ""}>
                  Able to perform lighter duties only
                </option>
                <option value="fit" ${draft.capacity === "fit" ? "selected" : ""}>
                  Fit to resume normal duties
                </option>
              </select>
            </label>
          </div>
        </div>`
      : ""}

    ${showPeriod
      ? html`
        <div class="section">
          <div class="section__head">
            <span class="section__title">Period</span>
            <span class="small muted" id="ct-days">${days ? plural(days, "day") : "check the dates"}</span>
          </div>
          <div class="card card--pad">
            <div class="field-grid" style="margin-bottom:0">
              <label class="field" style="margin-bottom:0">
                <span class="field__label">From</span>
                <input class="input" type="date" data-f="fromDate" value="${draft.fromDate}">
              </label>
              <label class="field" style="margin-bottom:0">
                <span class="field__label">To</span>
                <input class="input" type="date" data-f="toDate" value="${draft.toDate}">
              </label>
            </div>
          </div>
        </div>`
      : ""}

    <div class="section">
      <div class="section__head"><span class="section__title">Also on the certificate</span></div>
      <div class="card card--pad">
        <label class="field">
          <span class="field__label">Employee number <span class="muted">optional</span></span>
          <input class="input" data-f="employerRef" value="${draft.employerRef || ""}">
        </label>
        <label class="field" style="margin-bottom:0">
          <span class="field__label">Remarks <span class="muted">optional</span></span>
          <textarea class="textarea" data-f="remarks" style="min-height:70px"
            placeholder="To be reviewed if not improving">${draft.remarks || ""}</textarea>
        </label>
      </div>
    </div>

    <div class="section">
      <div class="section__head"><span class="section__title">How it will read</span></div>
      <div class="card card--pad">
        <p id="ct-preview" style="font-family:var(--font-serif);line-height:1.6">
          ${statement(draft, patient)}
        </p>
      </div>
    </div>

    <div class="section stack">
      <div class="btn-row btn-row--split">
        <button class="btn btn--outline" data-act="print">${icon("print")} Print / PDF</button>
        <button class="btn btn--outline" data-act="share">${icon("share")} Share</button>
      </div>
      ${draft.status === "issued"
        ? html`<p class="small muted" style="text-align:center">
            ${icon("check", { size: 14 })} Issued
          </p>`
        : html`<button class="btn btn--primary btn--block" data-act="issue">
            ${icon("check")} Mark as issued
          </button>`}
      <button class="btn btn--ghost btn--block" data-act="delete" style="color:var(--danger-500)">
        ${icon("trash")} Delete certificate
      </button>
    </div>
  `;
}
