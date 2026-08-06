// Today: what was written recently, and the two things most often needed next.

import { html, formatDate, initials } from "../ui.js";
import { icon } from "../icons.js";
import * as store from "../store.js";
import { emptyState } from "../components.js";

export async function view() {
  const [prescriptions, patients, encounters, prescriber] = await Promise.all([
    store.prescriptions.all(),
    store.patients.all(),
    store.encounters.all(),
    store.getPrescriber(),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);
  const issuedThisMonth = prescriptions.filter(
    (p) => p.status === "issued" && String(p.issuedAt).startsWith(thisMonth)
  );
  const drafts = prescriptions.filter((p) => p.status !== "issued");
  const recent = prescriptions.slice(0, 6);
  const byId = new Map(patients.map((p) => [p.id, p]));

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  })();

  const firstName = prescriber.name.replace(/^Dr\.?\s+/i, "").split(/\s+/)[0];

  return {
    title: `${greeting}, Dr ${firstName}`,
    largeTitle: true,
    content: html`
      <p class="view__subtitle">${formatDate(today, { weekday: "long" })}</p>

      <div class="btn-row btn-row--split" style="margin-bottom:8px">
        <button class="btn btn--primary" data-nav="/prescribe">${icon("script")} New script</button>
        <button class="btn btn--outline" data-nav="/patients/new">${icon("plus")} New patient</button>
      </div>
      <div class="btn-row btn-row--split" style="margin-bottom:20px">
        <button class="btn btn--ghost" data-act="new-certificate">
          ${icon("check", { size: 18 })} Certificate
        </button>
        <button class="btn btn--ghost" data-nav="/import">
          ${icon("camera", { size: 18 })} Import a script
        </button>
      </div>

      <div class="tiles">
        <button class="tile" data-nav="/history">
          <div class="tile__value tabular">${issuedThisMonth.length}</div>
          <div class="tile__label">Scripts this month</div>
        </button>
        <button class="tile" data-nav="/patients">
          <div class="tile__value tabular">${patients.length}</div>
          <div class="tile__label">Patients</div>
        </button>
      </div>

      ${drafts.length
        ? html`
          <div class="section">
            <div class="section__head"><span class="section__title">Unfinished</span></div>
            <div class="card">
              <ul class="list">
                ${drafts.slice(0, 4).map((p) => scriptRow(p, byId.get(p.patientId)))}
              </ul>
            </div>
          </div>`
        : ""}

      <div class="section">
        <div class="section__head">
          <span class="section__title">Recent prescriptions</span>
          ${prescriptions.length > 6 ? html`<button class="section__link" data-nav="/history">See all</button>` : ""}
        </div>
        ${recent.length
          ? html`<div class="card"><ul class="list">
              ${recent.map((p) => scriptRow(p, byId.get(p.patientId)))}
            </ul></div>`
          : emptyState({
              iconName: "script",
              title: "No prescriptions yet",
              text: "Write your first script — it takes about twenty seconds once a patient is on file.",
              action: { label: "Write a prescription", nav: "/prescribe" },
            })}
      </div>

      ${encounters.length
        ? html`
          <div class="section">
            <div class="section__head"><span class="section__title">Recent notes</span></div>
            <div class="card"><ul class="list">
              ${encounters.slice(0, 4).map((e) => html`
                <li><button class="list__item" data-nav="/notes/${e.id}">
                  <div class="avatar">${icon("note", { size: 18 })}</div>
                  <div class="list__body">
                    <div class="list__title">${store.patientName(byId.get(e.patientId))}</div>
                    <div class="list__meta">${e.assessment || e.subjective || "Clinical note"}</div>
                  </div>
                  <div class="list__trail">${formatDate(e.date)}</div>
                </button></li>
              `)}
            </ul></div>
          </div>`
        : ""}
    `,
    mount(root) {
      root.addEventListener("action", async ({ detail: { act } }) => {
        if (act !== "new-certificate") return;
        const { pickPatient } = await import("../components.js");
        const chosen = await pickPatient();
        if (!chosen) return;
        const cert = await store.certificates.save(store.newCertificate({ patientId: chosen.id }));
        window.location.hash = `#/certificates/${cert.id}`;
      });
    },
  };
}

function scriptRow(prescription, patient) {
  const summary = prescription.items.map((i) => i.name).join(", ") || "Empty script";
  return html`
    <li>
      <button class="list__item" data-nav="/prescribe/${prescription.id}">
        <div class="avatar">${initials(store.patientName(patient))}</div>
        <div class="list__body">
          <div class="list__title">${store.patientName(patient)}</div>
          <div class="list__meta">${summary}</div>
        </div>
        <div class="list__trail">
          ${prescription.status === "issued"
            ? formatDate(prescription.issuedAt, { month: "short", day: "numeric" })
            : html`<span class="badge badge--warn">Draft</span>`}
        </div>
      </button>
    </li>
  `;
}
