// The patient list, grouped by surname initial.

import { html, mount, debounce } from "../ui.js";
import { icon } from "../icons.js";
import * as store from "../store.js";
import { emptyState, patientRow } from "../components.js";

export async function view() {
  const patients = await store.patients.all();

  return {
    title: "Patients",
    largeTitle: true,
    action: { label: "Add", act: "add" },
    content: html`
      ${patients.length
        ? html`
          <div class="search">
            <span class="search__icon">${icon("search", { size: 18 })}</span>
            <input class="input" id="pt-q" type="search" placeholder="Search patients" autocomplete="off">
          </div>`
        : ""}
      <div id="pt-list">${list(patients)}</div>
    `,
    mount(root) {
      const input = root.querySelector("#pt-q");
      const target = root.querySelector("#pt-list");

      input?.addEventListener("input", debounce(() => {
        const q = input.value.trim().toLowerCase();
        const rows = q
          ? patients.filter((p) =>
              `${p.firstName} ${p.surname} ${p.phone || ""} ${p.idNumber || ""}`.toLowerCase().includes(q))
          : patients;
        mount(target, list(rows, { searching: Boolean(q) }));
      }, 120));

      root.addEventListener("action", ({ detail: { act } }) => {
        if (act === "add") window.location.hash = "#/patients/new";
      });
    },
  };
}

function list(patients, { searching = false } = {}) {
  if (!patients.length) {
    return searching
      ? html`<p class="muted small" style="padding:24px 4px;text-align:center">No patient matches that search.</p>`
      : emptyState({
          iconName: "people",
          title: "No patients yet",
          text: "Add a patient once and every future script, note and invoice attaches to their record.",
          action: { label: "Add first patient", nav: "/patients/new" },
        });
  }

  // Group by the first letter of the surname so a long list stays scannable.
  const groups = new Map();
  for (const p of patients) {
    const letter = (p.surname || p.firstName || "?").trim()[0]?.toUpperCase() || "#";
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter).push(p);
  }

  return html`
    ${[...groups.entries()].map(
      ([letter, rows]) => html`
        <div class="section">
          <div class="section__head"><span class="section__title">${letter}</span></div>
          <div class="card">
            <ul class="list">
              ${rows.map((p) => html`
                <li><button class="list__item" data-nav="/patients/${p.id}">${patientRow(p)}</button></li>
              `)}
            </ul>
          </div>
        </div>
      `
    )}
  `;
}
