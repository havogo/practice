// Optional cloud sync, so the same records appear on the phone and the laptop.
//
// Deliberately not a dependency of anything else: the app is fully usable with
// sync switched off, and switching it on never changes how local data is read.
//
// Backend: Supabase. One table, row-level security scoped to the signed-in
// account, reached over its REST endpoint with fetch — no SDK, no build step.
// The SQL to create it is in README.md and repeated in Settings.

import * as db from "./db.js";
import * as store from "./store.js";

const SYNCED_STORES = ["patients", "prescriptions", "encounters", "invoices", "medicines"];
const TABLE = "records";

export const state = {
  configured: false,
  signedIn: false,
  email: null,
  lastSyncAt: null,
  lastError: null,
  running: false,
};

let config = null;   // { url, anonKey }
let session = null;  // { access_token, refresh_token, expires_at, user }

export async function init() {
  config = await store.getSetting("sync.config", null);
  session = await store.getSetting("sync.session", null);
  state.lastSyncAt = await store.getSetting("sync.lastSyncAt", null);
  state.configured = Boolean(config?.url && config?.anonKey);
  state.signedIn = Boolean(session?.access_token);
  state.email = session?.user?.email || null;
  return state;
}

export async function configure({ url, anonKey }) {
  const clean = String(url || "").trim().replace(/\/+$/, "");
  if (!/^https:\/\/[\w-]+\.supabase\.co$/.test(clean)) {
    throw new Error("That does not look like a Supabase project URL (https://xxxx.supabase.co).");
  }
  if (!String(anonKey || "").trim()) throw new Error("The anon key is required.");
  config = { url: clean, anonKey: String(anonKey).trim() };
  await store.setSetting("sync.config", config);
  state.configured = true;
  return config;
}

export async function disconnect() {
  config = null;
  session = null;
  await store.setSetting("sync.config", null);
  await store.setSetting("sync.session", null);
  await store.setSetting("sync.lastSyncAt", null);
  Object.assign(state, {
    configured: false, signedIn: false, email: null, lastSyncAt: null, lastError: null,
  });
}

function requireConfig() {
  if (!config?.url) throw new Error("Sync is not configured yet.");
  return config;
}

async function api(path, { method = "GET", body, headers = {}, auth = true } = {}) {
  const { url, anonKey } = requireConfig();
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json",
      ...(auth && session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401 && auth && session?.refresh_token) {
    await refreshSession();
    return api(path, { method, body, headers, auth });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 200)}` : ""}`);
  }
  return res.status === 204 ? null : res.json();
}

// --- Authentication ---------------------------------------------------------

export async function signIn(email, password) {
  const data = await api("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email, password },
    auth: false,
  });
  await storeSession(data);
  return state;
}

async function refreshSession() {
  const data = await api("/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    body: { refresh_token: session.refresh_token },
    auth: false,
  });
  await storeSession(data);
}

async function storeSession(data) {
  session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    user: { id: data.user?.id, email: data.user?.email },
  };
  await store.setSetting("sync.session", session);
  state.signedIn = true;
  state.email = session.user.email;
}

export async function signOut() {
  session = null;
  await store.setSetting("sync.session", null);
  state.signedIn = false;
  state.email = null;
}

// --- Push / pull ------------------------------------------------------------

/** Flatten a local record into the single remote table. */
const toRow = (storeName, record, ownerId) => ({
  id: `${storeName}:${record.id}`,
  owner: ownerId,
  store: storeName,
  record_id: record.id,
  updated_at: record.updatedAt,
  deleted: Boolean(record.deletedAt),
  payload: record,
});

async function pull(since) {
  const query = new URLSearchParams({ select: "*", order: "updated_at.asc" });
  if (since) query.set("updated_at", `gt.${since}`);
  const rows = await api(`/rest/v1/${TABLE}?${query}`);

  const existing = await db.snapshot(SYNCED_STORES);
  const current = new Map();
  for (const name of SYNCED_STORES) {
    for (const r of existing[name] || []) current.set(`${name}:${r.id}`, r);
  }

  const incoming = {};
  let applied = 0;
  for (const row of rows) {
    if (!SYNCED_STORES.includes(row.store)) continue;
    const mine = current.get(row.id);
    // Last write wins. Equal timestamps keep what is already on the device.
    if (mine && String(mine.updatedAt || "") >= String(row.updated_at || "")) continue;
    (incoming[row.store] ||= []).push(row.payload);
    applied += 1;
  }

  if (applied) await db.replaceAll(incoming, { merge: true });
  return { pulled: rows.length, applied };
}

async function push(since) {
  const ownerId = session?.user?.id;
  if (!ownerId) throw new Error("Not signed in.");

  const local = await db.snapshot(SYNCED_STORES);
  const rows = [];
  for (const name of SYNCED_STORES) {
    for (const record of local[name] || []) {
      if (since && String(record.updatedAt || "") <= since) continue;
      rows.push(toRow(name, record, ownerId));
    }
  }
  if (!rows.length) return { pushed: 0 };

  // Chunked so a first sync of a long history does not hit the request limit.
  const SIZE = 200;
  for (let i = 0; i < rows.length; i += SIZE) {
    await api(`/rest/v1/${TABLE}?on_conflict=id`, {
      method: "POST",
      body: rows.slice(i, i + SIZE),
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    });
  }
  return { pushed: rows.length };
}

/** Pull first so local edits made since the last sync win on the way back up. */
export async function run({ full = false } = {}) {
  if (state.running) return { skipped: true };
  if (!state.configured) throw new Error("Sync is not configured.");
  if (!state.signedIn) throw new Error("Sign in to sync.");

  state.running = true;
  state.lastError = null;
  const since = full ? null : state.lastSyncAt;
  const startedAt = new Date().toISOString();

  try {
    const pulled = await pull(since);
    const pushed = await push(since);
    state.lastSyncAt = startedAt;
    await store.setSetting("sync.lastSyncAt", startedAt);
    return { ...pulled, ...pushed, at: startedAt };
  } catch (err) {
    state.lastError = String(err?.message || err);
    throw err;
  } finally {
    state.running = false;
  }
}

/** The SQL a new Supabase project needs. Shown in Settings so it can be copied. */
export const SETUP_SQL = `-- Run once in the Supabase SQL editor.
create table if not exists public.records (
  id          text primary key,
  owner       uuid not null references auth.users (id) on delete cascade,
  store       text not null,
  record_id   text not null,
  updated_at  timestamptz not null,
  deleted     boolean not null default false,
  payload     jsonb not null
);

create index if not exists records_owner_updated_idx
  on public.records (owner, updated_at);

alter table public.records enable row level security;

-- Each account sees only its own rows.
create policy "own rows" on public.records
  for all
  using (auth.uid() = owner)
  with check (auth.uid() = owner);`;
