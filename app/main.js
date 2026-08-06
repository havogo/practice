// Application shell: routing, chrome, and the one place a view gets mounted.

import { html, mount, raw, toast, $ } from "./ui.js";
import { icon } from "./icons.js";
import * as router from "./router.js";
import { bus } from "./store.js";
import * as db from "./db.js";

const TABS = [
  { path: "/", label: "Today", icon: "home" },
  { path: "/prescribe", label: "Prescribe", icon: "script" },
  { path: "/patients", label: "Patients", icon: "people" },
  { path: "/formulary", label: "Formulary", icon: "pill" },
  { path: "/settings", label: "Settings", icon: "gear" },
];

// Views are loaded on demand so the first paint stays small.
const VIEWS = {
  "/": () => import("./views/dashboard.js"),
  "/prescribe": () => import("./views/prescribe.js"),
  "/import": () => import("./views/import.js"),
  "/prescribe/:id": () => import("./views/prescribe.js"),
  "/patients": () => import("./views/patients.js"),
  "/patients/new": () => import("./views/patient-edit.js"),
  "/patients/:id": () => import("./views/patient.js"),
  "/patients/:id/edit": () => import("./views/patient-edit.js"),
  "/notes/:id": () => import("./views/note.js"),
  "/formulary": () => import("./views/formulary.js"),
  "/billing": () => import("./views/billing.js"),
  "/invoices/:id": () => import("./views/invoice.js"),
  "/certificates/:id": () => import("./views/certificate.js"),
  "/history": () => import("./views/history.js"),
  "/settings": () => import("./views/settings.js"),
};

for (const [pattern, loader] of Object.entries(VIEWS)) router.route(pattern, loader);

const app = $("#app");
let currentMount = null; // teardown for the view being replaced
let renderToken = 0;

function shell({ title, back, action, largeTitle, content }) {
  return html`
    <header class="topbar">
      ${back
        ? html`<button class="topbar__back" data-act="back" aria-label="Back">
            ${icon("chevronLeft", { size: 22 })}<span>Back</span>
          </button>`
        : ""}
      <h1 class="topbar__title">${largeTitle ? "" : title}</h1>
      ${action
        ? html`<button class="topbar__action" data-act="${action.act}" ${action.disabled ? "disabled" : ""}>
            ${action.label}
          </button>`
        : ""}
    </header>
    <main class="view" id="view">
      ${largeTitle ? html`<h2 class="view__title">${title}</h2>` : ""}
      ${content}
    </main>
  `;
}

function tabbar(activePath) {
  const isActive = (path) =>
    path === "/" ? activePath === "/" : activePath === path || activePath.startsWith(`${path}/`);
  return html`
    <nav class="tabbar" role="tablist">
      ${TABS.map(
        (t) => html`
          <button class="tabbar__item" role="tab" data-nav="${t.path}"
            ${isActive(t.path) ? raw('aria-current="page"') : ""}>
            ${icon(t.icon)}<span>${t.label}</span>
          </button>
        `
      )}
    </nav>
  `;
}

function errorScreen(message, detail) {
  return shell({
    title: "Something went wrong",
    largeTitle: true,
    content: html`
      <div class="alert alert--danger">${icon("warning")}<div>${message}</div></div>
      ${detail ? html`<pre class="small muted" style="white-space:pre-wrap">${detail}</pre>` : ""}
      <button class="btn btn--outline btn--block" data-act="reload">Reload</button>
    `,
  });
}

async function navigate(path, query) {
  const token = ++renderToken;
  const matched = router.match(path);

  if (currentMount) {
    try { currentMount(); } catch { /* a teardown must never block navigation */ }
    currentMount = null;
  }

  if (!matched) {
    mount(app, html`${errorScreen(`No screen at ${path}`)}${tabbar(path)}`);
    return;
  }

  const ctx = {
    params: matched.params,
    query,
    path,
    go: router.go,
    refresh: () => navigate(router.currentPath(), router.currentQuery()),
  };

  try {
    const module = await matched.loader();
    if (token !== renderToken) return; // a newer navigation won
    const spec = await module.view(ctx);
    if (token !== renderToken) return;

    mount(app, html`${shell(spec)}${tabbar(path)}`);
    window.scrollTo(0, 0);

    if (typeof spec.mount === "function") {
      currentMount = spec.mount($("#view"), ctx) || null;
    }
  } catch (err) {
    console.error("[navigate]", err);
    if (token !== renderToken) return;
    mount(app, html`${errorScreen("This screen failed to load.", String(err?.message || err))}${tabbar(path)}`);
  }
}

// --- Global interaction handlers -------------------------------------------

app.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-nav]");
  if (nav) {
    event.preventDefault();
    router.go(nav.dataset.nav);
    return;
  }
  const el = event.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;

  if (act === "back") {
    event.preventDefault();
    router.back();
    return;
  }
  if (act === "reload") {
    window.location.reload();
    return;
  }

  // Everything else belongs to the view. Dispatching through the view element
  // means a view handles its own buttons and the top bar's action identically,
  // even though the top bar is not inside it.
  const view = $("#view");
  if (view) view.dispatchEvent(new CustomEvent("action", { detail: { act, el, event } }));
});

// Shadow under the top bar only once the content has scrolled beneath it.
let ticking = false;
window.addEventListener(
  "scroll",
  () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const bar = $(".topbar");
      if (bar) bar.classList.toggle("is-stuck", window.scrollY > 4);
      ticking = false;
    });
  },
  { passive: true }
);

// Data written in another tab should not leave this one showing stale records.
let refreshTimer = null;
bus.addEventListener("change", () => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    document.dispatchEvent(new CustomEvent("data:changed"));
  }, 50);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("[unhandled]", event.reason);
  toast(String(event.reason?.message || event.reason || "Unexpected error"), "error");
});

// --- Boot -------------------------------------------------------------------

async function boot() {
  try {
    await db.open();
  } catch (err) {
    mount(app, errorScreen("The local database could not be opened.", String(err?.message || err)));
    return;
  }

  // Ask once for durable storage; granted automatically when installed to the
  // Home Screen, which is what keeps records safe from Safari's cache clearing.
  db.requestPersistence().catch(() => {});

  router.start(navigate);

  // ?nosw disables the offline cache for a session. While developing, a worker
  // serving the previous copy of a module looks exactly like an edit that did
  // not take, and costs more time to diagnose than it saves.
  const noWorker = new URLSearchParams(location.search).has("nosw");
  if (noWorker) {
    const registrations = await navigator.serviceWorker?.getRegistrations?.() ?? [];
    await Promise.all(registrations.map((r) => r.unregister()));
    await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
    console.info("[sw] disabled for this session (?nosw)");
  } else if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    const swUrl = new URL("../sw.js", import.meta.url);
    navigator.serviceWorker.register(swUrl, { scope: "./" }).catch((err) => {
      console.warn("[sw] registration failed", err);
    });
  }
}

boot();
