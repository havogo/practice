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
  lastSyncAt: null,     // shown to the user; local clock
  lastError: null,
  running: false,
};

// Two separate watermarks, because two different clocks are involved.
//
//   cursor    – the highest server-stamped synced_at this device has seen.
//               Paging on it is safe no matter how far apart device clocks are;
//               paging on a client-written timestamp is not, because a device
//               running slow writes records that a faster device has already
//               scrolled past and would never pull.
//   pushedAt  – this device's own clock at its last push, used only to decide
//               which local records are new enough to send. Same clock on both
//               sides of that comparison, so skew cannot affect it.
let cursor = null;
let pushedAt = null;

let config = null;   // { url, anonKey }
let session = null;  // { access_token, refresh_token, expires_at, user }

export async function init() {
  config = await store.getSetting("sync.config", null);
  session = await store.getSetting("sync.session", null);
  state.lastSyncAt = await store.getSetting("sync.lastSyncAt", null);
  cursor = await store.getSetting("sync.cursor", null);
  pushedAt = await store.getSetting("sync.pushedAt", null);
  state.configured = Boolean(config?.url && config?.anonKey);
  state.signedIn = Boolean(session?.access_token);
  state.email = session?.user?.email || null;
  return state;
}

/** Loopback is allowed over http so the sync client can be tested locally. */
function validateEndpoint(raw) {
  const clean = String(raw || "").trim().replace(/\/+$/, "");
  let parsed;
  try {
    parsed = new URL(clean);
  } catch {
    throw new Error("That is not a valid web address. It should look like https://abcdefgh.supabase.co");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !loopback) {
    throw new Error("The project URL must start with https:// — patient records must not travel unencrypted.");
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new Error("Use only the project URL itself, with nothing after the domain.");
  }
  return parsed.origin;
}

export async function configure({ url, anonKey }) {
  const clean = validateEndpoint(url);
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
  // A push asks for `return=minimal`, so a success comes back with no body at
  // all. Calling res.json() on that throws, which would fail every push.
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`The server replied with something that is not JSON: ${text.slice(0, 120)}`);
  }
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
  const query = new URLSearchParams({ select: "*", order: "synced_at.asc" });
  if (since) query.set("synced_at", `gt.${since}`);
  const rows = await api(`/rest/v1/${TABLE}?${query}`);

  const existing = await db.snapshot(SYNCED_STORES);
  const current = new Map();
  for (const name of SYNCED_STORES) {
    for (const r of existing[name] || []) current.set(`${name}:${r.id}`, r);
  }

  const incoming = {};
  const appliedIds = new Set();
  let highest = since;

  for (const row of rows) {
    if (row.synced_at && (!highest || row.synced_at > highest)) highest = row.synced_at;
    if (!SYNCED_STORES.includes(row.store)) continue;
    const mine = current.get(row.id);
    // Conflicts resolve on updated_at — when the prescriber actually edited the
    // record — not on synced_at, which only says when it reached the server.
    //
    // The comparison uses the timestamp inside the payload, not the row column:
    // Postgres hands back "…+00:00" where JavaScript wrote "…Z", and comparing
    // those two spellings as strings gives the wrong answer for the same
    // instant. Both sides of this comparison were written by a browser.
    const theirs = String(row.payload?.updatedAt || "");
    if (mine && String(mine.updatedAt || "") >= theirs) continue;
    (incoming[row.store] ||= []).push(row.payload);
    appliedIds.add(row.id);
  }

  if (appliedIds.size) await db.replaceAll(incoming, { merge: true });
  return { pulled: rows.length, applied: appliedIds.size, cursor: highest, appliedIds };
}

async function push(since, skipIds = new Set()) {
  const ownerId = session?.user?.id;
  if (!ownerId) throw new Error("Not signed in.");

  const local = await db.snapshot(SYNCED_STORES);
  const rows = [];
  for (const name of SYNCED_STORES) {
    for (const record of local[name] || []) {
      // Records just written by the pull would otherwise be echoed straight back.
      if (skipIds.has(`${name}:${record.id}`)) continue;
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
  const startedAt = new Date().toISOString();

  try {
    const pulled = await pull(full ? null : cursor);
    const pushed = await push(full ? null : pushedAt, pulled.appliedIds);

    // Both watermarks only advance once the whole cycle succeeded, so a failure
    // half way through means the next run repeats the work rather than skipping it.
    cursor = pulled.cursor ?? cursor;
    pushedAt = startedAt;
    state.lastSyncAt = startedAt;
    await store.setSetting("sync.cursor", cursor);
    await store.setSetting("sync.pushedAt", pushedAt);
    await store.setSetting("sync.lastSyncAt", startedAt);

    return { pulled: pulled.pulled, applied: pulled.applied, pushed: pushed.pushed, at: startedAt };
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
  updated_at  timestamptz not null,          -- when the record was edited (device clock)
  synced_at   timestamptz not null default now(),  -- when it reached the server
  deleted     boolean not null default false,
  payload     jsonb not null
);

-- Devices page on synced_at, which comes from one clock — the server's. Paging
-- on updated_at would lose records written by a device whose clock runs slow.
create or replace function public.touch_synced_at()
returns trigger
language plpgsql
as $$
begin
  new.synced_at = now();
  return new;
end;
$$;

drop trigger if exists records_touch_synced_at on public.records;
create trigger records_touch_synced_at
  before insert or update on public.records
  for each row execute function public.touch_synced_at();

create index if not exists records_owner_synced_idx
  on public.records (owner, synced_at);

-- Row-level security decides which rows; these grants decide whether the
-- signed-in role may touch the table at all. Supabase usually applies them by
-- default — stating them explicitly avoids a confusing "permission denied".
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.records to authenticated;

alter table public.records enable row level security;

-- Each account reads and writes only its own rows.
drop policy if exists "own rows" on public.records;
create policy "own rows" on public.records
  for all
  using (auth.uid() = owner)
  with check (auth.uid() = owner);`;
