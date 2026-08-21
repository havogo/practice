// The patient list: recently dealt with first, then everyone, grouped by surname.

import { html, mount, debounce, formatDate } from "../ui.js";
import { icon } from "../icons.js";
import * as store from "../store.js";
import { emptyState, patientRow } from "../components.js";

const RECENT_LIMIT = 8;

/**
 * Everything worth matching on, flattened once so a keystroke is a substring
 * test over a prepared string rather than a walk of the record. At a few
 * hundred patients this stays instant, and it is all local so it works offline.
 */
function haystack(patient) {
  const aid = patient.medicalAid || {};
  return [
    patient.firstName, patient.surname,
    // Surname-first too, since that is how a name is often recalled.
    `${patient.surname || ""} ${patient.firstName || ""}`,
    patient.idNumber, patient.phone, patient.email,
    aid.number, aid.scheme, aid.plan,
  ].filter(Boolean).join(" ").toLowerCase();
}

export async function view() {
  const [patients, activity] = await Promise.all([store.patients.all(), store.patientActivity()]);

  const indexed = patients.map((p) => {
    const entry = activity.get(p.id);
    return {
      patient: p,
      text: haystack(p),
      lastAt: entry?.lastAt || "",
      // Clinical contact ranks a patient above one whose record you merely
      // edited, and is the date worth showing next to their name.
      lastSeenAt: entry?.lastSeenAt || "",
    };
  });

  const recent = indexed
    .filter((r) => r.lastSeenAt || r.lastAt)
    .sort(
      (a, b) =>
        (b.lastSeenAt || "").localeCompare(a.lastSeenAt || "") ||
        b.lastAt.localeCompare(a.lastAt)
    )
    .slice(0, RECENT_LIMIT);

  return {
    title: "Patients",
    largeTitle: true,
    action: { label: "Add", act: "add" },
    content: html`
      ${patients.length
        ? html`
          <div class="search">
            <span class="search__icon">${icon("search", { size: 18 })}</span>
            <input class="input" id="pt-q" type="search" autocomplete="off" enterkeyhint="search"
              placeholder="Name, ID number or medical aid">
          </div>`
        : ""}
      <div id="pt-list">${browse(indexed, recent)}</div>
    `,
    mount(root) {
      const input = root.querySelector("#pt-q");
      const target = root.querySelector("#pt-list");

      const run = () => {
        const q = input.value.trim().toLowerCase();
        if (!q) return mount(target, browse(indexed, recent));
        // Every term has to match, so "dlam 88" narrows rather than widens.
        const terms = q.split(/\s+/);
        const hits = indexed.filter((r) => terms.every((t) => r.text.includes(t)));
        mount(target, results(hits, q));
      };

      input?.addEventListener("input", debounce(run, 100));
      input?.addEventListener("search", run); // the clear (×) button

      root.addEventListener("action", ({ detail: { act } }) => {
        if (act === "add") window.location.hash = "#/patients/new";
      });
    },
  };
}

function row(entry, { showWhen = false } = {}) {
  const when = entry.lastSeenAt || entry.lastAt;
  return html`
    <li>
      <button class="list__item" data-nav="/patients/${entry.patient.id}">
        ${patientRow(entry.patient, {
          trail: showWhen && when ? formatDate(when, { month: "short", day: "numeric" }) : "",
        })}
      </button>
    </li>
  `;
}

function results(hits, query) {
  if (!hits.length) {
    return html`
      <div class="empty">
        <div class="empty__title">No match for “${query}”</div>
        <p class="empty__text">Try part of a surname, an ID number, or a medical aid number.</p>
        <button class="btn btn--secondary" data-nav="/patients/new">Add a new patient</button>
      </div>
    `;
  }
  return html`
    <div class="section" style="margin-top:0">
      <div class="section__head">
        <span class="section__title">${hits.length === 1 ? "1 match" : `${hits.length} matches`}</span>
      </div>
      <div class="card"><ul class="list">${hits.slice(0, 60).map((h) => row(h, { showWhen: true }))}</ul></div>
    </div>
  `;
}

function browse(indexed, recent) {
  if (!indexed.length) {
    return emptyState({
      iconName: "people",
      title: "No patients yet",
      text: "Add a patient once and every future script, note and invoice attaches to their record.",
      action: { label: "Add first patient", nav: "/patients/new" },
    });
  }

  // Grouping the whole list by initial is only worth the vertical space once
  // there are enough people that scanning it is actually work.
  const groups = new Map();
  for (const entry of indexed) {
    const letter = (entry.patient.surname || entry.patient.firstName || "?").trim()[0]?.toUpperCase() || "#";
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter).push(entry);
  }

  // Below a handful of patients the whole list is already one glance, and a
  // Recent section would just repeat it.
  const showRecent = indexed.length > 5 && recent.length >= 3;

  return html`
    ${showRecent
      ? html`
        <div class="section" style="margin-top:0">
          <div class="section__head"><span class="section__title">Recent</span></div>
          <div class="card"><ul class="list">${recent.map((r) => row(r, { showWhen: true }))}</ul></div>
        </div>`
      : ""}

    ${[...groups.entries()].map(
      ([letter, rows]) => html`
        <div class="section">
          <div class="section__head"><span class="section__title">${letter}</span></div>
          <div class="card"><ul class="list">${rows.map((r) => row(r))}</ul></div>
        </div>
      `
    )}
  `;
}
