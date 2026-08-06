// One patient: their details and everything filed against them.

import { html, formatDate, ageFrom, initials, money } from "../ui.js";
import { icon } from "../icons.js";
import * as store from "../store.js";
import * as router from "../router.js";

export async function view(ctx) {
  const patient = await store.patients.get(ctx.params.id);
  if (!patient) {
    return { title: "Patient", back: "/patients", largeTitle: true,
      content: html`<p class="muted">This patient no longer exists.</p>` };
  }

  const [scripts, notes, bills, prefs] = await Promise.all([
    store.prescriptions.byPatient(patient.id),
    store.encounters.byPatient(patient.id),
    store.invoices.byPatient(patient.id),
    store.getPreferences(),
  ]);

  const age = ageFrom(patient.dob);
  const detail = (label, value) =>
    value ? html`<div class="switch-row"><div><div class="switch-row__label">${value}</div>
      <div class="switch-row__hint">${label}</div></div></div>` : "";

  return {
    title: store.patientName(patient),
    back: "/patients",
    action: { label: "Edit", act: "edit" },
    content: html`
      <div class="card card--pad" style="text-align:center;margin-top:8px">
        <div class="avatar" style="width:64px;height:64px;font-size:22px;margin:0 auto 12px">
          ${initials(store.patientName(patient))}
        </div>
        <h2 style="font-size:22px">${store.patientName(patient)}</h2>
        <p class="muted small" style="margin-top:4px">
          ${[age != null ? `${age} years` : null, patient.gender, patient.dob ? formatDate(patient.dob) : null]
            .filter(Boolean).join(" · ")}
        </p>
        <div class="btn-row btn-row--split" style="margin-top:16px">
          <button class="btn btn--primary btn--sm" data-nav="/prescribe?patient=${patient.id}">
            ${icon("script", { size: 16 })} Script
          </button>
          <button class="btn btn--outline btn--sm" data-act="new-note">
            ${icon("note", { size: 16 })} Note
          </button>
          <button class="btn btn--outline btn--sm" data-act="new-invoice">
            ${icon("receipt", { size: 16 })} Invoice
          </button>
        </div>
      </div>

      ${(patient.allergies || []).length
        ? html`<div class="alert alert--warn" style="margin-top:16px">
            ${icon("warning")}<div><b>Allergies:</b> ${patient.allergies.join(", ")}</div>
          </div>`
        : ""}

      ${(patient.chronicConditions || []).length
        ? html`<div class="section">
            <div class="section__head"><span class="section__title">Chronic conditions</span></div>
            <div class="chips">
              ${patient.chronicConditions.map((c) => html`<span class="chip chip--static">${c}</span>`)}
            </div>
          </div>`
        : ""}

      <div class="section">
        <div class="section__head">
          <span class="section__title">Prescriptions</span>
          <span class="small muted">${scripts.length || "none"}</span>
        </div>
        ${scripts.length
          ? html`<div class="card"><ul class="list">
              ${scripts.slice(0, 8).map((s) => html`
                <li><button class="list__item" data-nav="/prescribe/${s.id}">
                  <div class="list__body">
                    <div class="list__title">${s.items.map((i) => i.name).join(", ") || "Empty script"}</div>
                    <div class="list__meta">${s.diagnosis || `${s.items.length} item${s.items.length === 1 ? "" : "s"}`}</div>
                  </div>
                  <div class="list__trail">
                    ${s.status === "issued"
                      ? formatDate(s.issuedAt, { month: "short", day: "numeric" })
                      : html`<span class="badge badge--warn">Draft</span>`}
                  </div>
                  <span class="list__chevron">${icon("chevronRight", { size: 18 })}</span>
                </button></li>
              `)}
            </ul></div>`
          : html`<p class="muted small" style="padding:4px">No prescriptions yet.</p>`}
      </div>

      <div class="section">
        <div class="section__head">
          <span class="section__title">Clinical notes</span>
          <span class="small muted">${notes.length || "none"}</span>
        </div>
        ${notes.length
          ? html`<div class="card"><ul class="list">
              ${notes.slice(0, 8).map((n) => html`
                <li><button class="list__item" data-nav="/notes/${n.id}">
                  <div class="list__body">
                    <div class="list__title">${n.assessment || n.subjective || "Consultation"}</div>
                    <div class="list__meta">${n.type}</div>
                  </div>
                  <div class="list__trail">${formatDate(n.date, { month: "short", day: "numeric" })}</div>
                  <span class="list__chevron">${icon("chevronRight", { size: 18 })}</span>
                </button></li>
              `)}
            </ul></div>`
          : html`<p class="muted small" style="padding:4px">No notes yet.</p>`}
      </div>

      ${bills.length
        ? html`<div class="section">
            <div class="section__head"><span class="section__title">Invoices</span></div>
            <div class="card"><ul class="list">
              ${bills.slice(0, 6).map((b) => html`
                <li><button class="list__item" data-nav="/invoices/${b.id}">
                  <div class="list__body">
                    <div class="list__title">${b.number || "Draft invoice"}</div>
                    <div class="list__meta">${formatDate(b.date)}</div>
                  </div>
                  <div class="list__trail tabular">
                    ${money(store.invoiceTotal(b), prefs.currency)}
                    ${b.status === "paid" ? html`<br><span class="badge badge--ok">Paid</span>` : ""}
                  </div>
                </button></li>
              `)}
            </ul></div>
          </div>`
        : ""}

      <div class="section">
        <div class="section__head"><span class="section__title">Details</span></div>
        <div class="card">
          ${detail("Mobile", patient.phone)}
          ${detail("Email", patient.email)}
          ${detail("ID number", patient.idNumber)}
          ${detail("Address", patient.address)}
          ${detail("Medical aid", [patient.medicalAid?.scheme, patient.medicalAid?.plan]
            .filter(Boolean).join(" — "))}
          ${detail("Member number", patient.medicalAid?.number)}
          ${detail("Notes", patient.notes)}
        </div>
      </div>
    `,
    mount(root) {
      root.addEventListener("action", async ({ detail: { act } }) => {
        if (act === "edit") {
          router.go(`/patients/${patient.id}/edit`);
        } else if (act === "new-note") {
          const note = await store.encounters.save(store.newEncounter({ patientId: patient.id }));
          router.go(`/notes/${note.id}`);
        } else if (act === "new-invoice") {
          const number = await store.nextInvoiceNumber();
          const invoice = await store.invoices.save(store.newInvoice({ patientId: patient.id, number }));
          router.go(`/invoices/${invoice.id}`);
        }
      });
    },
  };
}
