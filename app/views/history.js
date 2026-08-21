// Every prescription ever written, newest first.

import { html, mount, formatDate, initials, debounce } from "../ui.js";
import { icon } from "../icons.js";
import * as store from "../store.js";
import { emptyState } from "../components.js";

export async function view() {
  const [scripts, patients] = await Promise.all([store.prescriptions.all(), store.patients.all()]);
  const byId = new Map(patients.map((p) => [p.id, p]));

  return {
    title: "Prescription history",
    back: "/",
    largeTitle: true,
    content: html`
      ${scripts.length
        ? html`
          <div class="search">
            <span class="search__icon">${icon("search", { size: 18 })}</span>
            <input class="input" id="h-q" type="search" placeholder="Search by patient or medicine" autocomplete="off">
          </div>`
        : ""}
      <div id="h-list">${list(scripts, byId)}</div>
    `,
    mount(root) {
      const input = root.querySelector("#h-q");
      const target = root.querySelector("#h-list");
      // Re-sending an old script is common — a pharmacy lost it, or the patient
      // wants it again — so it should not need opening the script first.
      root.addEventListener("action", async ({ detail: { act, el } }) => {
        if (act !== "send") return;
        const script = scripts.find((s) => s.id === el.dataset.id);
        if (!script) return;
        const { documentActionSheet } = await import("../docactions.js");
        await documentActionSheet({
          kind: "prescription",
          patient: byId.get(script.patientId),
          record: script,
          title: store.patientName(byId.get(script.patientId)),
        });
      });

      input?.addEventListener("input", debounce(() => {
        const q = input.value.trim().toLowerCase();
        const rows = q
          ? scripts.filter((s) => {
              const name = store.patientName(byId.get(s.patientId)).toLowerCase();
              const meds = s.items.map((i) => i.name).join(" ").toLowerCase();
              return name.includes(q) || meds.includes(q) || (s.diagnosis || "").toLowerCase().includes(q);
            })
          : scripts;
        mount(target, list(rows, byId, { searching: Boolean(q) }));
      }, 120));
    },
  };
}

function list(scripts, byId, { searching = false } = {}) {
  if (!scripts.length) {
    return searching
      ? html`<p class="muted small" style="padding:24px 4px;text-align:center">Nothing matches that search.</p>`
      : emptyState({
          iconName: "script",
          title: "No prescriptions yet",
          action: { label: "Write one", nav: "/prescribe" },
        });
  }

  // Group by month so scrolling back through a year stays oriented.
  const groups = new Map();
  for (const s of scripts) {
    const key = String(s.issuedAt || "").slice(0, 7) || "—";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }

  return html`
    ${[...groups.entries()].map(([month, rows]) => html`
      <div class="section">
        <div class="section__head">
          <span class="section__title">
            ${month === "—" ? "Undated" : formatDate(`${month}-01`, { month: "long", year: "numeric", day: undefined })}
          </span>
          <span class="small muted">${rows.length}</span>
        </div>
        <div class="card">
          <ul class="list">
            ${rows.map((s) => {
              const patient = byId.get(s.patientId);
              return html`
                <li class="list__item" style="cursor:default">
                  <button class="list__item" data-nav="/prescribe/${s.id}"
                    style="border:0;padding:0;flex:1;min-width:0">
                    <div class="avatar">${initials(store.patientName(patient))}</div>
                    <div class="list__body">
                      <div class="list__title">${store.patientName(patient)}</div>
                      <div class="list__meta">${s.items.map((i) => i.name).join(", ") || "Empty script"}</div>
                    </div>
                    <div class="list__trail">
                      ${s.status === "issued"
                        ? formatDate(s.issuedAt, { month: "short", day: "numeric", year: undefined })
                        : html`<span class="badge badge--warn">Draft</span>`}
                    </div>
                  </button>
                  ${s.items.length
                    ? html`
                      <button class="rx-item__remove" data-act="send" data-id="${s.id}"
                        aria-label="Send this prescription again"
                        style="padding:8px;color:var(--brand-600)">
                        ${icon("share", { size: 18 })}
                      </button>`
                    : ""}
                </li>
              `;
            })}
          </ul>
        </div>
      </div>
    `)}
  `;
}
