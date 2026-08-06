// Hash router. Hash-based so the app works from a file:// URL, from a plain
// static host and from GitHub Pages project paths without server rewrites.

const routes = [];

/** `pattern` uses :name segments, e.g. "/patients/:id". */
export function route(pattern, loader) {
  const names = [];
  const source = pattern
    .replace(/\/:([A-Za-z0-9_]+)/g, (_, name) => {
      names.push(name);
      return "/([^/]+)";
    })
    .replace(/\//g, "\\/");
  routes.push({ regex: new RegExp(`^${source}$`), names, loader, pattern });
}

export function match(path) {
  for (const r of routes) {
    const m = r.regex.exec(path);
    if (!m) continue;
    const params = {};
    r.names.forEach((name, i) => {
      params[name] = decodeURIComponent(m[i + 1]);
    });
    return { ...r, params };
  }
  return null;
}

export function currentPath() {
  const hash = window.location.hash.slice(1) || "/";
  return hash.split("?")[0] || "/";
}

export function currentQuery() {
  const hash = window.location.hash.slice(1);
  const qs = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  return Object.fromEntries(new URLSearchParams(qs));
}

export function go(path, { replace = false } = {}) {
  const target = path.startsWith("#") ? path : `#${path}`;
  if (replace) window.history.replaceState(null, "", target);
  else window.location.hash = target;
  if (replace) window.dispatchEvent(new HashChangeEvent("hashchange"));
}

export function back(fallback = "/") {
  if (window.history.length > 1) window.history.back();
  else go(fallback);
}

export function start(onNavigate) {
  const handle = () => onNavigate(currentPath(), currentQuery());
  window.addEventListener("hashchange", handle);
  handle();
}
