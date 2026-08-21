// Reusable pieces of interface shared by more than one view.

import { html, mount, raw, esc, initials, formatDate, ageFrom, debounce, $ } from "./ui.js";
import { icon } from "./icons.js";
import * as store from "./store.js";
import * as formulary from "./formulary.js";

/**
 * Open a bottom sheet. Resolves with whatever `close(value)` is called with,
 * or null when dismissed.
 */
export function sheet({ title, body, onMount }) {
  return new Promise((resolve) => {
    const el = document.createElement("dialog");
    el.className = "sheet";
    mount(el, html`
      <div class="sheet__head">
        <div class="sheet__title">${title}</div>
        <button class="sheet__close" data-sheet-close aria-label="Close">${icon("close", { size: 18 })}</button>
      </div>
      <div class="sheet__body">${body}</div>
    `);
    document.body.appendChild(el);

    // Teardown is driven explicitly rather than from the dialog's `close`
    // event: some engines close the dialog without ever dispatching it, which
    // would leave the caller awaiting a promise that never settles.
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (el.open) el.close();
      el.remove();
      resolve(value);
    };

    el.addEventListener("click", (event) => {
      if (event.target.closest("[data-sheet-close]")) {
        finish(null);
        return;
      }
      // Tapping the backdrop (outside the sheet's own box) dismisses it.
      if (event.target === el) {
        const r = el.getBoundingClientRect();
        const outside =
          event.clientY < r.top || event.clientY > r.bottom ||
          event.clientX < r.left || event.clientX > r.right;
        if (outside) finish(null);
      }
    });
    // Esc and any native dismissal still land here.
    el.addEventListener("cancel", () => finish(null));
    el.addEventListener("close", () => finish(null));

    el.showModal();
    if (onMount) onMount(el.querySelector(".sheet__body"), finish);
  });
}

export function patientRow(patient, { trail = "" } = {}) {
  const age = ageFrom(patient.dob);
  const meta = [age != null ? `${age} yrs` : null, patient.dob ? formatDate(patient.dob) : null]
    .filter(Boolean)
    .join(" · ");
  return html`
    <div class="avatar">${initials(store.patientName(patient))}</div>
    <div class="list__body">
      <div class="list__title">${store.patientName(patient)}</div>
      ${meta ? html`<div class="list__meta">${meta}</div>` : ""}
    </div>
    ${trail ? html`<div class="list__trail">${trail}</div>` : ""}
    <span class="list__chevron">${icon("chevronRight", { size: 18 })}</span>
  `;
}

/** Pick an existing patient, or create one inline. Resolves to a patient or null. */
export async function pickPatient() {
  const all = await store.patients.all();

  return sheet({
    title: "Choose patient",
    body: html`
      <div class="search">
        <span class="search__icon">${icon("search", { size: 18 })}</span>
        <input class="input" id="pp-q" type="search" placeholder="Search by name" autocomplete="off">
      </div>
      <div id="pp-results"></div>
      <button class="btn btn--secondary btn--block" data-pp="new" style="margin-top:16px">
        ${icon("plus", { size: 18 })} New patient
      </button>
    `,
    onMount(root, close) {
      const results = root.querySelector("#pp-results");
      const input = root.querySelector("#pp-q");

      const draw = (rows) => {
        if (!rows.length) {
          mount(results, html`<p class="muted small" style="padding:16px 4px">
            ${all.length ? "No patient matches that search." : "No patients yet — add the first one below."}
          </p>`);
          return;
        }
        mount(results, html`
          <ul class="list">
            ${rows.map((p) => html`
              <li><button class="list__item" data-pp="pick" data-id="${p.id}">${patientRow(p)}</button></li>
            `)}
          </ul>
        `);
      };

      draw(all.slice(0, 50));

      input.addEventListener("input", debounce(() => {
        const q = input.value.trim().toLowerCase();
        const rows = q
          ? all.filter((p) =>
              `${p.firstName} ${p.surname} ${p.idNumber || ""}`.toLowerCase().includes(q))
          : all;
        draw(rows.slice(0, 50));
      }, 120));

      root.addEventListener("click", async (event) => {
        const el = event.target.closest("[data-pp]");
        if (!el) return;
        if (el.dataset.pp === "pick") {
          close(all.find((p) => p.id === el.dataset.id) || null);
        } else if (el.dataset.pp === "new") {
          const created = await quickAddPatient();
          if (created) close(created);
        }
      });

      setTimeout(() => input.focus(), 120);
    },
  });
}

/** Minimal capture so a script is never blocked by a full patient record. */
export function quickAddPatient() {
  return sheet({
    title: "New patient",
    body: html`
      <form id="qa-form" novalidate>
        <div class="field-grid">
          <label class="field">
            <span class="field__label">First name</span>
            <input class="input" name="firstName" autocomplete="given-name" required>
          </label>
          <label class="field">
            <span class="field__label">Surname</span>
            <input class="input" name="surname" autocomplete="family-name" required>
          </label>
        </div>
        <label class="field">
          <span class="field__label">Date of birth</span>
          <input class="input" name="dob" type="date" max="${new Date().toISOString().slice(0, 10)}">
        </label>
        <label class="field">
          <span class="field__label">Mobile</span>
          <input class="input" name="phone" type="tel" inputmode="tel" autocomplete="tel">
        </label>
        <p class="field__error hidden" id="qa-error"></p>
        <button class="btn btn--primary btn--block" type="submit">Save patient</button>
      </form>
    `,
    onMount(root, close) {
      const form = root.querySelector("#qa-form");
      const error = root.querySelector("#qa-error");
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(form));
        if (!data.firstName.trim() || !data.surname.trim()) {
          error.textContent = "A first name and surname are required.";
          error.classList.remove("hidden");
          return;
        }
        const saved = await store.patients.save(store.newPatient({
          firstName: data.firstName.trim(),
          surname: data.surname.trim(),
          dob: data.dob || "",
          phone: data.phone.trim(),
        }));
        close(saved);
      });
      setTimeout(() => form.querySelector("input")?.focus(), 120);
    },
  });
}

/**
 * Search the formulary by drug name or by indication/condition.
 * Resolves to a formulary entry, or null.
 */
/**
 * Search the formulary by drug name or by indication / medical condition.
 *
 * With `onPick` the sheet stays open and reports each choice, so a script with
 * four medicines is one visit rather than four. Without it, the first choice
 * closes the sheet and resolves.
 */
export async function pickMedicine({ prefillCondition = null, onPick = null } = {}) {
  const { drugs, conditions } = await formulary.catalogue();
  let mode = prefillCondition ? "condition" : "drug";
  let activeCondition = prefillCondition;
  const added = [];

  return sheet({
    title: onPick ? "Add medicines" : "Add medicine",
    body: html`
      <div class="chips" style="margin-bottom:12px">
        <button class="chip" data-mode="drug" aria-pressed="${String(mode === "drug")}">By drug name</button>
        <button class="chip" data-mode="condition" aria-pressed="${String(mode === "condition")}">By indication</button>
      </div>
      <div class="search">
        <span class="search__icon">${icon("search", { size: 18 })}</span>
        <input class="input" id="pm-q" type="search" autocomplete="off"
          autocapitalize="words" enterkeyhint="done" placeholder="Type any medicine name">
      </div>
      <div id="pm-typed"></div>
      <div id="pm-active"></div>
      <div id="pm-added"></div>
      <div id="pm-results"></div>
      ${onPick
        ? html`<button class="btn btn--primary btn--block" data-pm-done
            style="position:sticky;bottom:0;margin-top:16px">Done</button>`
        : ""}
    `,
    onMount(root, close) {
      const input = root.querySelector("#pm-q");
      const results = root.querySelector("#pm-results");
      const activeBox = root.querySelector("#pm-active");
      const typedBox = root.querySelector("#pm-typed");
      const addedBox = root.querySelector("#pm-added");

      /** Take a choice: either hand it back and close, or stay open for more. */
      const take = (drug) => {
        if (!drug) return;
        if (!onPick) return close(drug);
        onPick(drug);
        added.push(drug.name);
        input.value = "";
        redraw();
        input.focus();
        return undefined;
      };

      const drawAdded = () => {
        if (!added.length) return mount(addedBox, "");
        mount(addedBox, html`
          <div class="alert alert--info" style="margin-bottom:12px">
            ${icon("check")}
            <div><b>${added.length === 1 ? "Added" : `${added.length} added`}:</b> ${added.join(", ")}</div>
          </div>
        `);
      };

      /**
       * Most scripts here are trade names the reference list has never heard of,
       * so a typed name is an answer in its own right, not a failed search.
       * It sits above the results and stays available even when there are hits.
       */
      const drawTyped = () => {
        const typed = input.value.trim();
        if (mode === "condition" || typed.length < 2 || formulary.hasExactName(drugs, typed)) {
          return mount(typedBox, "");
        }
        mount(typedBox, html`
          <button class="btn btn--primary btn--block" data-use-typed style="margin-bottom:12px">
            ${icon("plus", { size: 18 })} Prescribe “${typed}”
          </button>
        `);
      };

      const drawActive = () => {
        if (!activeCondition) return mount(activeBox, "");
        mount(activeBox, html`
          <div class="chips" style="margin-bottom:12px">
            <button class="chip chip--active" data-clear-condition>
              ${activeCondition.label} · ${activeCondition.drugs.length}
              ${icon("close", { size: 14 })}
            </button>
          </div>
        `);
      };

      const drugRow = (d) => html`
        <div class="drug-result" data-drug-name="${d.name}">
          <div class="grow">
            <div class="drug-result__name">
              ${d.name}
              ${d.custom ? html` <span class="badge badge--muted">yours</span>` : ""}
              ${d.useCount > 1 ? html` <span class="badge badge--muted">×${d.useCount}</span>` : ""}
            </div>
            ${d.indications.length
              ? html`<div class="drug-result__ind">${d.indications.join(" · ")}</div>` : ""}
            ${(() => {
              const last = d.lastUsed || {};
              const strength = last.strength || d.default?.strength;
              const frequency = last.frequency || d.default?.frequency;
              return strength || frequency
                ? html`<div class="drug-result__dose">
                    ${[strength, frequency].filter(Boolean).join("  ")}
                  </div>`
                : "";
            })()}
          </div>
          <span class="drug-result__add">${icon("plusCircle", { size: 22 })}</span>
        </div>
      `;

      const drawDrugs = () => {
        const rows = formulary.search(drugs, input.value, { conditionKey: activeCondition, limit: 60 });
        if (!rows.length) {
          mount(results, html`<p class="muted small" style="padding:16px 4px">
            Nothing in the formulary matches — use the button above to prescribe it by name.
          </p>`);
          return;
        }
        // Medicines already prescribed lead; the reference list follows.
        const used = rows.filter((d) => d.useCount > 0);
        const rest = rows.filter((d) => !d.useCount);
        const group = (label, list) =>
          list.length
            ? html`
              <div class="section__head" style="margin-top:8px">
                <span class="section__title">${label}</span>
              </div>
              ${list.map(drugRow)}`
            : "";

        mount(results, used.length && rest.length
          ? html`${group("You prescribe", used)}${group("Formulary", rest)}`
          : html`${rows.map(drugRow)}`);
      };

      const drawConditions = () => {
        const rows = formulary.searchConditions(conditions, input.value, 60);
        mount(results, html`
          ${rows.map((c) => html`
            <div class="drug-result" data-condition="${c.key}">
              <div class="grow">
                <div class="drug-result__name">${c.label}</div>
                <div class="drug-result__ind">${c.drugs.length} medicine${c.drugs.length === 1 ? "" : "s"}</div>
              </div>
              <span class="drug-result__add">${icon("chevronRight", { size: 20 })}</span>
            </div>
          `)}
        `);
      };

      const redraw = () => {
        input.placeholder =
          mode === "drug" ? "Type any medicine name" : "Search conditions, e.g. hypertension";
        drawTyped();
        drawActive();
        drawAdded();
        if (mode === "condition" && !activeCondition) drawConditions();
        else drawDrugs();
      };

      redraw();
      input.addEventListener("input", debounce(redraw, 120));

      // Enter takes whatever is typed, so a script can be written without
      // lifting a thumb to tap a button.
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        const typed = input.value.trim();
        if (mode === "condition" || typed.length < 2) return;
        const exact = drugs.find((d) => d.name.toLowerCase() === typed.toLowerCase());
        take(exact || formulary.freeTextDrug(typed));
      });

      root.addEventListener("click", (event) => {
        if (event.target.closest("[data-pm-done]")) {
          close(null);
          return;
        }
        if (event.target.closest("[data-use-typed]")) {
          take(formulary.freeTextDrug(input.value.trim()));
          return;
        }
        const modeBtn = event.target.closest("[data-mode]");
        if (modeBtn) {
          mode = modeBtn.dataset.mode;
          activeCondition = null;
          input.value = "";
          root.querySelectorAll("[data-mode]").forEach((b) =>
            b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
          redraw();
          return;
        }
        if (event.target.closest("[data-clear-condition]")) {
          activeCondition = null;
          input.value = "";
          redraw();
          return;
        }
        const cond = event.target.closest("[data-condition]");
        if (cond) {
          activeCondition = conditions.find((c) => c.key === cond.dataset.condition) || null;
          input.value = "";
          mode = "condition";
          redraw();
          return;
        }
        // Matched by name, not id: a personal medicine has no reference id.
        const drug = event.target.closest("[data-drug-name]");
        if (drug) {
          const wanted = drug.dataset.drugName.toLowerCase();
          take(drugs.find((d) => d.name.toLowerCase() === wanted) || null);
        }
      });

      setTimeout(() => input.focus(), 120);
    },
  });
}

/** `action` is { label, nav } to navigate, or { label, act } to be handled locally. */
export function emptyState({ iconName = "note", title, text, action = null }) {
  return html`
    <div class="empty">
      <div class="empty__icon">${icon(iconName, { size: 48 })}</div>
      <div class="empty__title">${title}</div>
      ${text ? html`<p class="empty__text">${text}</p>` : ""}
      ${action
        ? html`<button class="btn btn--secondary"
            ${action.nav ? raw(`data-nav="${esc(action.nav)}"`) : raw(`data-act="${esc(action.act)}"`)}>
            ${action.label}
          </button>`
        : ""}
    </div>
  `;
}

/** Small helper so views can read a form without repeating FormData plumbing. */
export function readForm(form) {
  const data = {};
  for (const [key, value] of new FormData(form)) {
    if (key.endsWith("[]")) {
      const k = key.slice(0, -2);
      (data[k] ||= []).push(value);
    } else {
      data[key] = typeof value === "string" ? value.trim() : value;
    }
  }
  return data;
}

export { $ };
