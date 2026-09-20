// Backup and restore.
//
// The point of this file: a copy of the practice that lives somewhere the
// browser cannot throw away. Exported to Files/iCloud Drive it is also the
// simplest way to move everything to a new phone.

import * as db from "./db.js";
import * as store from "./store.js";
import { isoDate } from "./ui.js";

const BACKUP_STORES = [
  "patients", "prescriptions", "encounters", "invoices", "certificates",
  "medicines", "pharmacies", "attachments", "settings",
];

const FORMAT = "practice-backup";
const FORMAT_VERSION = 1;

export async function buildBackup() {
  const data = await db.snapshot(BACKUP_STORES);
  const counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length]));
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    app: "Practice",
    counts,
    data,
  };
}

export function backupFilename(backup) {
  return `practice-backup-${isoDate(backup.exportedAt)}.json`;
}

/**
 * When a backup was last taken, and how many records it held.
 *
 * Kept so the app can say how exposed you are. This lives in the same database
 * as everything else, so it is not itself a safeguard — it exists to make the
 * absence of a real, off-device backup visible before it matters.
 */
export async function backupStatus() {
  const [record, counts] = await Promise.all([
    store.getSetting("backup.lastAt", null),
    Promise.all([
      store.patients.all(), store.prescriptions.all(),
      store.encounters.all(), store.certificates.all(),
    ]).then((sets) => sets.reduce((n, s) => n + s.length, 0)),
  ]);

  const days = record ? Math.floor((Date.now() - new Date(record).getTime()) / 86400000) : null;
  return {
    lastAt: record,
    days,
    records: counts,
    // Nothing worth losing yet is not the same as being safe.
    atRisk: counts > 0 && (record === null || days >= 14),
    never: record === null,
  };
}

async function recordBackup(backup) {
  await store.setSetting("backup.lastAt", backup.exportedAt);
}

/** Offer the backup to the OS: share sheet on iOS, download elsewhere. */
export async function exportBackup() {
  const backup = await buildBackup();
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const name = backupFilename(backup);
  const file = new File([blob], name, { type: "application/json" });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Practice backup" });
      await recordBackup(backup);
      return { method: "share", counts: backup.counts };
    } catch (err) {
      // Dismissing the share sheet means no file was saved anywhere, so this
      // must not count as a backup having been taken.
      if (err?.name === "AbortError") return { method: "cancelled", counts: backup.counts };
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  await recordBackup(backup);
  return { method: "download", counts: backup.counts };
}

export function parseBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  if (parsed?.format !== FORMAT || !parsed?.data) {
    throw new Error("That file is not a Practice backup.");
  }
  if (parsed.version > FORMAT_VERSION) {
    throw new Error("That backup was made by a newer version of the app.");
  }
  return parsed;
}

/**
 * `mode: "replace"` wipes what is here first. `mode: "merge"` keeps whichever
 * copy of a record was updated most recently, which is what you want when
 * pulling a backup onto a device that has also been used.
 */
export async function restoreBackup(backup, { mode = "merge" } = {}) {
  const incoming = {};

  if (mode === "replace") {
    for (const name of BACKUP_STORES) incoming[name] = backup.data[name] || [];
    await db.replaceAll(incoming, { merge: false });
    return { mode, counts: backup.counts };
  }

  const existing = await db.snapshot(BACKUP_STORES);
  const applied = {};

  for (const name of BACKUP_STORES) {
    const keyPath = name === "settings" ? "key" : "id";
    const current = new Map((existing[name] || []).map((r) => [r[keyPath], r]));
    const winners = [];

    for (const record of backup.data[name] || []) {
      const mine = current.get(record[keyPath]);
      if (!mine) {
        winners.push(record);
        continue;
      }
      // Last write wins on updatedAt; a tombstone at the same instant wins.
      const theirs = String(record.updatedAt || "");
      const ours = String(mine.updatedAt || "");
      if (theirs > ours || (theirs === ours && record.deletedAt && !mine.deletedAt)) {
        winners.push(record);
      }
    }
    applied[name] = winners;
  }

  await db.replaceAll(applied, { merge: true });
  return {
    mode,
    counts: Object.fromEntries(Object.entries(applied).map(([k, v]) => [k, v.length])),
  };
}

/** Read a file the user picked, with a size guard so a stray video is caught. */
export function readFile(file) {
  const MAX = 64 * 1024 * 1024;
  if (file.size > MAX) return Promise.reject(new Error("That file is too large to be a backup."));
  return file.text();
}
