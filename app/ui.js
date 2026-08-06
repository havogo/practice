// Minimal, escape-by-default templating. No build step, no dependencies.
//
// Patient names, notes and pharmacy details are user data that ends up in the
// DOM, so interpolation escapes by default and only `raw()` opts out.

class Raw {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

export function raw(value) {
  return new Raw(value);
}

function stringify(value) {
  if (value == null || value === false) return "";
  if (value instanceof Raw) return value.value;
  if (Array.isArray(value)) return value.map(stringify).join("");
  return esc(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) {
    out += stringify(values[i]) + strings[i + 1];
  }
  return new Raw(out);
}

export function mount(target, content) {
  target.innerHTML = stringify(content);
  return target;
}

/** Event delegation: one listener per root, matched by `[data-act]`. */
export function delegate(root, type, handler) {
  root.addEventListener(type, (event) => {
    const el = event.target.closest("[data-act]");
    if (el && root.contains(el)) handler(el.dataset.act, el, event);
  });
}

export const $ = (selector, scope = document) => scope.querySelector(selector);
export const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatDate(value, opts = {}) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-ZA", { year: "numeric", month: "short", day: "2-digit", ...opts });
}

export function isoDate(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

/** Age in whole years, or null when the date of birth is unknown/invalid. */
export function ageFrom(dob, at = new Date()) {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  let age = at.getFullYear() - birth.getFullYear();
  const m = at.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < birth.getDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/** "1 patient" / "2 patients", with an irregular plural when given one. */
export function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function initials(name) {
  return String(name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] || "")
    .join("")
    .toUpperCase();
}

export function money(cents, currency = "ZAR") {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency }).format((cents || 0) / 100);
}

/** Parse "1 234,50" / "1234.50" / "R1 234" into integer cents. */
export function parseMoney(input) {
  const cleaned = String(input ?? "").replace(/[^\d.,-]/g, "").replace(/\s/g, "");
  if (!cleaned) return 0;
  // If both separators appear, the last one is the decimal separator.
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalised = cleaned;
  if (lastComma > lastDot) normalised = cleaned.replace(/\./g, "").replace(",", ".");
  else normalised = cleaned.replace(/,/g, "");
  const value = Number.parseFloat(normalised);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

// ---------------------------------------------------------------------------
// Chrome: toasts, confirmation, sheets
// ---------------------------------------------------------------------------

export function toast(message, kind = "info") {
  const host = $("#toasts") || document.body;
  const el = document.createElement("div");
  el.className = `toast toast--${kind}`;
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add("is-in"));
  setTimeout(() => {
    el.classList.remove("is-in");
    setTimeout(() => el.remove(), 250);
  }, kind === "error" ? 4500 : 2600);
}

/** Promise-based replacement for window.confirm, styled like the rest of the app. */
export function confirmDialog({ title, message, confirmLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "dialog";
    mount(dialog, html`
      <div class="dialog__body">
        <h2 class="dialog__title">${title}</h2>
        ${message ? html`<p class="dialog__text">${message}</p>` : ""}
        <div class="dialog__actions">
          <button type="button" data-choice="cancel" class="btn btn--ghost">Cancel</button>
          <button type="button" data-choice="ok"
            class="btn ${danger ? "btn--danger" : "btn--primary"}">${confirmLabel}</button>
        </div>
      </div>
    `);
    document.body.appendChild(dialog);

    // Resolved from the click, not from the dialog's `close` event — that event
    // is not dispatched everywhere, and a confirm that never settles would
    // silently stall whatever is awaiting it.
    let settled = false;
    const finish = (answer) => {
      if (settled) return;
      settled = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(answer);
    };

    dialog.addEventListener("click", (event) => {
      const choice = event.target.closest("[data-choice]");
      if (choice) finish(choice.dataset.choice === "ok");
      else if (event.target === dialog) finish(false); // backdrop
    });
    dialog.addEventListener("cancel", () => finish(false)); // Esc
    dialog.addEventListener("close", () => finish(false));

    dialog.showModal();
  });
}

export function debounce(fn, ms = 180) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function uid(prefix = "") {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  const body = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return prefix ? `${prefix}_${body}` : body;
}
