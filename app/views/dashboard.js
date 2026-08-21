// Today: what was written recently, and the two things most often needed next.

import { html, formatDate, initials, plural, isoDate } from "../ui.js";
import { icon } from "../icons.js";
import * as store from "../store.js";
import { emptyState } from "../components.js";

export async function view() {
  const [prescriptions, patients, encounters, prescriber, activity] = await Promise.all([
    store.prescriptions.all(),
    store.patients.all(),
    store.encounters.all(),
    store.getPrescriber(),
    store.patientActivity(),
  ]);

  const today = isoDate();
  const thisMonth = today.slice(0, 7);
  const issued = prescriptions.filter((p) => p.status === "issued");
  const issuedThisMonth = issued.filter((p) => String(p.issuedAt).startsWith(thisMonth));
  const drafts = prescriptions.filter((p) => p.status !== "issued");
  const recent = prescriptions.slice(0, 6);
  const byId = new Map(patients.map((p) => [p.id, p]));

  const weekAgo = isoDate(new Date(Date.now() - 6 * 86400000));
  const seenThisWeek = store.seenSince(activity, weekAgo);
  const lastScript = issued[0] || null;

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  })();

  const firstName = prescriber.name.replace(/^Dr\.?\s+/i, "").split(/\s+/)[0];
  const firstRun = patients.length === 0 && prescriptions.length === 0;

  return {
    title: `${greeting}, Dr ${firstName}`,
    largeTitle: true,
    content: firstRun
      ? firstRunContent()
      : html`
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

        ${tiles({ issuedThisMonth, seenThisWeek, lastScript, patients, byId })}

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

/**
 * Nothing on file yet. Two counts of zero say nothing useful, so this states
 * what the app is for and offers the one path that leads somewhere — a patient,
 * because a script cannot be written without one.
 */
function firstRunContent() {
  return html`
    <p class="view__subtitle">
      Prescriptions, notes and certificates, on your own letterhead. Everything stays on this
      device unless you turn on sync.
    </p>

    <div class="card card--pad" style="text-align:center;padding:28px 20px">
      <div style="color:var(--brand-500);margin-bottom:12px">${icon("script", { size: 40 })}</div>
      <h2 style="font-size:19px;margin-bottom:6px">Start with a patient</h2>
      <p class="muted small" style="max-width:32ch;margin:0 auto 18px">
        Add someone once, and every script, note, certificate and invoice you write for them
        files itself against their record.
      </p>
      <button class="btn btn--primary btn--block" data-nav="/patients/new">
        ${icon("plus")} Add your first patient
      </button>
    </div>

    <div class="section">
      <div class="section__head"><span class="section__title">Or start from what you have</span></div>
      <div class="card">
        <ul class="list">
          <li><button class="list__item" data-nav="/import">
            <div class="avatar">${icon("camera", { size: 18 })}</div>
            <div class="list__body">
              <div class="list__title">Import an old script</div>
              <div class="list__meta">Photograph or upload one you wrote before</div>
            </div>
            <span class="list__chevron">${icon("chevronRight", { size: 18 })}</span>
          </button></li>
          <li><button class="list__item" data-nav="/formulary">
            <div class="avatar">${icon("pill", { size: 18 })}</div>
            <div class="list__body">
              <div class="list__title">Look through the formulary</div>
              <div class="list__meta">610 medicines, searchable by drug or condition</div>
            </div>
            <span class="list__chevron">${icon("chevronRight", { size: 18 })}</span>
          </button></li>
          <li><button class="list__item" data-nav="/settings">
            <div class="avatar">${icon("gear", { size: 18 })}</div>
            <div class="list__body">
              <div class="list__title">Check your letterhead</div>
              <div class="list__meta">Name, HPCSA number, signature</div>
            </div>
            <span class="list__chevron">${icon("chevronRight", { size: 18 })}</span>
          </button></li>
        </ul>
      </div>
    </div>
  `;
}

/** Two tiles that answer "how is the practice ticking over", not "how many rows". */
function tiles({ issuedThisMonth, seenThisWeek, lastScript, patients, byId }) {
  const lastLabel = lastScript
    ? `${store.patientName(byId.get(lastScript.patientId))} · ${relativeDay(lastScript.issuedAt)}`
    : "None yet";

  return html`
    <div class="tiles">
      <button class="tile" data-nav="/history">
        <div class="tile__value tabular">${issuedThisMonth.length}</div>
        <div class="tile__label">
          ${issuedThisMonth.length === 1 ? "Script this month" : "Scripts this month"}
        </div>
      </button>
      <button class="tile" data-nav="/patients">
        <div class="tile__value tabular">${seenThisWeek.length || patients.length}</div>
        <div class="tile__label">
          ${seenThisWeek.length ? "Seen in the last 7 days" : plural(patients.length, "patient")}
        </div>
      </button>
    </div>

    <button class="card list__item" data-nav="/history" style="width:100%;margin-top:12px">
      <div class="avatar">${icon("clock", { size: 18 })}</div>
      <div class="list__body">
        <div class="list__title">Last script</div>
        <div class="list__meta">${lastLabel}</div>
      </div>
      <span class="list__chevron">${icon("chevronRight", { size: 18 })}</span>
    </button>
  `;
}

/** "Today" / "Yesterday" / "3 days ago" reads faster than a date at a glance. */
export function relativeDay(value) {
  if (!value) return "";
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return String(value);
  const days = Math.round((new Date(isoDate()) - new Date(isoDate(then))) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days > 1 && days < 7) return `${days} days ago`;
  return formatDate(value);
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
