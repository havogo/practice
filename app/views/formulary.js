// Browse the reference formulary and maintain your own additions.

import { html, mount, toast, debounce, confirmDialog } from "../ui.js";
import { icon } from "../icons.js";
import * as store from "../store.js";
import * as formulary from "../formulary.js";
import { sheet, readForm } from "../components.js";
import * as router from "../router.js";

export async function view(ctx) {
  const { drugs, conditions, meta } = await formulary.catalogue();
  let mode = "drug";
  let activeCondition = null;

  return {
    title: "Formulary",
    largeTitle: true,
    action: { label: "Add", act: "add-own" },
    content: html`
      <p class="view__subtitle">
        ${meta.drugCount} reference medicines · ${meta.conditionCount} indications
      </p>

      <div class="chips" style="margin-bottom:12px">
        <button class="chip" data-mode="drug" aria-pressed="true">By drug name</button>
        <button class="chip" data-mode="condition" aria-pressed="false">By condition</button>
        <button class="chip" data-mode="mine" aria-pressed="false">Mine</button>
      </div>

      <div class="search">
        <span class="search__icon">${icon("search", { size: 18 })}</span>
        <input class="input" id="fm-q" type="search" placeholder="Search drugs" autocomplete="off">
      </div>

      <div id="fm-active"></div>
      <div id="fm-results"></div>
    `,
    mount(root) {
      const input = root.querySelector("#fm-q");
      const results = root.querySelector("#fm-results");
      const activeBox = root.querySelector("#fm-active");

      function drawActive() {
        if (!activeCondition) return mount(activeBox, "");
        mount(activeBox, html`
          <div class="chips" style="margin-bottom:12px">
            <button class="chip chip--active" data-clear>
              ${activeCondition.label} · ${activeCondition.drugs.length} ${icon("close", { size: 14 })}
            </button>
          </div>
        `);
      }

      function drawDrugs(pool) {
        const rows = formulary.search(pool, input.value, { conditionKey: activeCondition, limit: 80 });
        if (!rows.length) {
          mount(results, html`
            <div class="empty">
              <div class="empty__title">Nothing found</div>
              <p class="empty__text">
                ${mode === "mine"
                  ? "You have not added any medicines of your own yet."
                  : "No medicine in the formulary matches that search."}
              </p>
              <button class="btn btn--secondary" data-act="add-own">Add it to your formulary</button>
            </div>
          `);
          return;
        }
        mount(results, html`
          <div class="card">
            <ul class="list">
              ${rows.map((d) => html`
                <li><button class="list__item" data-drug="${d.id}">
                  <div class="list__body">
                    <div class="list__title">
                      ${d.name}${d.custom ? html` <span class="badge badge--muted">yours</span>` : ""}
                    </div>
                    <div class="list__meta">${d.indications.join(" · ") || "—"}</div>
                  </div>
                  <span class="list__chevron">${icon("chevronRight", { size: 18 })}</span>
                </button></li>
              `)}
            </ul>
          </div>
        `);
      }

      function drawConditions() {
        const rows = formulary.searchConditions(conditions, input.value, 100);
        mount(results, html`
          <div class="card">
            <ul class="list">
              ${rows.map((c) => html`
                <li><button class="list__item" data-condition="${c.key}">
                  <div class="list__body">
                    <div class="list__title">${c.label}</div>
                    <div class="list__meta">${c.drugs.length} medicine${c.drugs.length === 1 ? "" : "s"}</div>
                  </div>
                  <span class="list__chevron">${icon("chevronRight", { size: 18 })}</span>
                </button></li>
              `)}
            </ul>
          </div>
        `);
      }

      function redraw() {
        input.placeholder =
          mode === "condition" ? "Search conditions, e.g. hypertension"
          : mode === "mine" ? "Search your medicines"
          : "Search drugs";
        drawActive();
        if (mode === "condition" && !activeCondition) drawConditions();
        else drawDrugs(mode === "mine" ? drugs.filter((d) => d.custom) : drugs);
      }

      redraw();
      input.addEventListener("input", debounce(redraw, 120));

      root.addEventListener("click", async (event) => {
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
        if (event.target.closest("[data-clear]")) {
          activeCondition = null;
          input.value = "";
          redraw();
          return;
        }
        const cond = event.target.closest("[data-condition]");
        if (cond) {
          activeCondition = conditions.find((c) => c.key === cond.dataset.condition) || null;
          input.value = "";
          redraw();
          return;
        }
        const drugEl = event.target.closest("[data-drug]");
        if (drugEl) {
          const drug = drugs.find((d) => d.id === drugEl.dataset.drug);
          if (drug) await showDrug(drug);
        }
      });

      root.addEventListener("action", async ({ detail: { act } }) => {
        if (act === "add-own") {
          const created = await editOwnMedicine();
          if (created) {
            toast("Added to your formulary", "ok");
            ctx.refresh();
          }
        }
      });

      async function showDrug(drug) {
        const chosen = await sheet({
          title: drug.name,
          body: html`
            ${drug.indications.length
              ? html`
                <div class="section" style="margin-top:0">
                  <div class="section__head"><span class="section__title">Indications</span></div>
                  <div class="chips">
                    ${drug.indications.map((i) => html`<span class="chip chip--static">${i}</span>`)}
                  </div>
                </div>` : ""}

            ${drug.dosages.length
              ? html`
                <div class="section">
                  <div class="section__head"><span class="section__title">Dosage</span></div>
                  <div class="card">
                    ${drug.dosages.map((d) => html`
                      <div class="switch-row">
                        <div>
                          ${d.label ? html`<div class="switch-row__label"><b>${d.label}</b></div>` : ""}
                          <div class="switch-row__hint" style="font-size:14px;color:var(--text)">${d.text}</div>
                        </div>
                      </div>
                    `)}
                  </div>
                </div>` : ""}

            <div class="section stack">
              <button class="btn btn--primary btn--block" data-pick="prescribe">
                ${icon("script")} Write a script with this
              </button>
              ${drug.custom
                ? html`
                  <button class="btn btn--outline btn--block" data-pick="edit">${icon("edit")} Edit</button>
                  <button class="btn btn--ghost btn--block" data-pick="delete" style="color:var(--danger-500)">
                    Remove from my formulary
                  </button>`
                : ""}
            </div>

            <p class="small muted" style="margin-top:16px">
              Reference guidance only — confirm against the current package insert.
            </p>
          `,
          onMount(sheetRoot, close) {
            sheetRoot.addEventListener("click", (event) => {
              const el = event.target.closest("[data-pick]");
              if (el) close(el.dataset.pick);
            });
          },
        });

        if (chosen === "prescribe") {
          sessionStorage.setItem("rx:seed-drug", drug.id);
          router.go("/prescribe");
        } else if (chosen === "edit") {
          const saved = await editOwnMedicine(await store.medicines.get(drug.id));
          if (saved) ctx.refresh();
        } else if (chosen === "delete") {
          const ok = await confirmDialog({
            title: `Remove ${drug.name}?`,
            message: "It will no longer appear in your formulary. Existing prescriptions are unaffected.",
            confirmLabel: "Remove",
            danger: true,
          });
          if (ok) {
            await store.medicines.remove(drug.id);
            toast("Removed");
            ctx.refresh();
          }
        }
      }
    },
  };
}

/** Add or edit a medicine of the prescriber's own. */
function editOwnMedicine(existing = null) {
  return sheet({
    title: existing ? "Edit medicine" : "Add to my formulary",
    body: html`
      <form id="om">
        <label class="field">
          <span class="field__label">Medicine name</span>
          <input class="input" name="name" value="${existing?.name || ""}" required placeholder="Glucophage XR">
        </label>
        <div class="field-grid">
          <label class="field">
            <span class="field__label">Strength</span>
            <input class="input" name="strength" value="${existing?.strength || ""}" placeholder="500 mg">
          </label>
          <label class="field">
            <span class="field__label">Form</span>
            <input class="input" name="form" value="${existing?.form || ""}" placeholder="tablet">
          </label>
        </div>
        <label class="field">
          <span class="field__label">Usual frequency</span>
          <input class="input" name="frequency" value="${existing?.frequency || ""}" placeholder="o.d.">
        </label>
        <label class="field">
          <span class="field__label">Indications <span class="muted">comma separated</span></span>
          <input class="input" name="indications"
            value="${(existing?.indications || []).join(", ")}" placeholder="Type 2 diabetes mellitus">
          <span class="field__hint">These make the medicine findable when you search by condition.</span>
        </label>
        <label class="field">
          <span class="field__label">Dosing notes</span>
          <textarea class="textarea" name="dose" style="min-height:70px">${existing?.dose || ""}</textarea>
        </label>
        <button class="btn btn--primary btn--block" type="submit">
          ${existing ? "Save changes" : "Add medicine"}
        </button>
      </form>
    `,
    onMount(root, close) {
      const form = root.querySelector("#om");
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = readForm(form);
        if (!data.name) return;
        const saved = await store.medicines.save({
          ...(existing || {}),
          name: data.name,
          strength: data.strength || "",
          form: data.form || "",
          frequency: data.frequency || "",
          dose: data.dose || "",
          indications: String(data.indications || "").split(",").map((s) => s.trim()).filter(Boolean),
        });
        close(saved);
      });
      setTimeout(() => form.querySelector("input")?.focus(), 120);
    },
  });
}
