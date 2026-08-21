// Domain model and repositories.
//
// Every record carries { id, createdAt, updatedAt, deletedAt, rev }. Deletes are
// tombstones, never hard removals, so a device that has been offline can still
// learn that a record went away when it next syncs.

import * as db from "./db.js";
import { uid, isoDate } from "./ui.js";

export const bus = new EventTarget();

function announce(store, action, record) {
  bus.dispatchEvent(new CustomEvent("change", { detail: { store, action, record } }));
}

const now = () => new Date().toISOString();

function envelope(record, existing) {
  const stamp = now();
  return {
    ...record,
    id: record.id || existing?.id || uid(),
    createdAt: existing?.createdAt || record.createdAt || stamp,
    updatedAt: stamp,
    deletedAt: record.deletedAt ?? existing?.deletedAt ?? null,
    rev: (existing?.rev || 0) + 1,
  };
}

const live = (rows) => rows.filter((r) => !r.deletedAt);

/** Generic repository over one object store. */
function repo(storeName, { sort } = {}) {
  return {
    name: storeName,

    async all({ includeDeleted = false } = {}) {
      const rows = await db.getAll(storeName);
      const visible = includeDeleted ? rows : live(rows);
      return sort ? visible.sort(sort) : visible;
    },

    async get(id) {
      const row = await db.get(storeName, id);
      return row && !row.deletedAt ? row : null;
    },

    async byPatient(patientId) {
      const rows = await db.getAllByIndex(storeName, "patientId", patientId);
      const visible = live(rows);
      return sort ? visible.sort(sort) : visible;
    },

    async save(record) {
      const existing = record.id ? await db.get(storeName, record.id) : null;
      const next = envelope(record, existing);
      await db.put(storeName, next);
      announce(storeName, existing ? "update" : "create", next);
      return next;
    },

    async remove(id) {
      const existing = await db.get(storeName, id);
      if (!existing) return null;
      const next = { ...existing, deletedAt: now(), updatedAt: now(), rev: (existing.rev || 0) + 1 };
      await db.put(storeName, next);
      announce(storeName, "delete", next);
      return next;
    },
  };
}

const byUpdatedDesc = (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt));
const byDateDesc = (a, b) => String(b.date || b.issuedAt || "").localeCompare(String(a.date || a.issuedAt || ""));

export const patients = repo("patients", {
  sort: (a, b) =>
    `${a.surname || ""} ${a.firstName || ""}`.trim().toLowerCase()
      .localeCompare(`${b.surname || ""} ${b.firstName || ""}`.trim().toLowerCase()),
});
export const prescriptions = repo("prescriptions", { sort: byDateDesc });
export const encounters = repo("encounters", { sort: byDateDesc });
export const invoices = repo("invoices", { sort: byDateDesc });
export const certificates = repo("certificates", { sort: byDateDesc });
export const medicines = repo("medicines", { sort: (a, b) => a.name.localeCompare(b.name) });
export const attachments = repo("attachments", { sort: byUpdatedDesc });

// ---------------------------------------------------------------------------
// Factories — one place that defines the shape of each record
// ---------------------------------------------------------------------------

export function newPatient(seed = {}) {
  return {
    firstName: "", surname: "", dob: "", idNumber: "", gender: "",
    phone: "", email: "", address: "",
    medicalAid: { scheme: "", number: "", plan: "", dependantCode: "" },
    allergies: [], chronicConditions: [], notes: "",
    ...seed,
  };
}

export function newPrescriptionItem(seed = {}) {
  return {
    id: uid("it"),
    name: "", strength: "", form: "", dose: "", frequency: "",
    duration: "", quantity: "", repeats: 0, instructions: "",
    drugId: null,
    ...seed,
  };
}

export function newPrescription(seed = {}) {
  return {
    patientId: null, issuedAt: isoDate(), status: "draft",
    items: [], notes: "", pharmacy: "", diagnosis: "", icd10: "",
    ...seed,
  };
}

export function newEncounter(seed = {}) {
  return {
    patientId: null, date: isoDate(), type: "consultation",
    subjective: "", objective: "", assessment: "", plan: "",
    icd10: "", vitals: { bp: "", pulse: "", temp: "", weight: "", height: "", spo2: "" },
    ...seed,
  };
}

export function newInvoice(seed = {}) {
  return {
    patientId: null, date: isoDate(), number: "", status: "unpaid",
    lines: [], notes: "", totalCents: 0,
    ...seed,
  };
}

/**
 * Remember a medicine the prescriber actually used.
 *
 * Most scripts here are written in South African trade names — Adco-Dol,
 * Purbac, Brufen — which a BNF-style reference list does not contain. So the
 * app keeps its own list of what has genuinely been prescribed, with the
 * strength and frequency last used, and ranks that above the reference. After a
 * few weeks of use the prescriber's own vocabulary is the formulary.
 *
 * Called when a prescription is saved, so nothing needs to be filed by hand.
 */
export async function recordMedicineUsage(items = []) {
  const existing = await medicines.all();
  const byName = new Map(existing.map((m) => [String(m.name || "").trim().toLowerCase(), m]));
  const seen = new Set();
  const stamp = now();

  for (const item of items) {
    const name = String(item.name || "").trim();
    if (name.length < 2) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue; // one bump per script, not per line
    seen.add(key);

    const prior = byName.get(key);
    await medicines.save({
      ...(prior || {}),
      // Keep the spelling first recorded, so casing does not flip about.
      name: prior?.name || name,
      strength: item.strength || prior?.strength || "",
      frequency: item.frequency || prior?.frequency || "",
      dose: item.dose || prior?.dose || "",
      form: item.form || prior?.form || "",
      indications: prior?.indications || [],
      // Links back to the reference entry when the drug came from there, so the
      // indications and dosing guidance are not lost by shadowing it.
      fromFormulary: item.drugId || prior?.fromFormulary || null,
      useCount: (prior?.useCount || 0) + 1,
      lastUsedAt: stamp,
    });
  }
}

/**
 * When each patient was last dealt with, and how much is on file for them.
 *
 * Derived from the records themselves rather than stamped on the patient when
 * you open them: writing on every view would churn `updatedAt` and push a row
 * to sync for merely looking at someone. Everything here is already local, so
 * it costs one pass over data the app has anyway and works offline.
 */
export async function patientActivity() {
  const [scripts, notes, bills, certs, people] = await Promise.all([
    prescriptions.all(), encounters.all(), invoices.all(), certificates.all(), patients.all(),
  ]);

  const activity = new Map();

  /**
   * Two timestamps, because they answer different questions.
   *   lastAt     – anything at all, including editing the record. Orders the
   *                "Recent" list, where having just looked someone up is
   *                exactly what makes them recent.
   *   lastSeenAt – clinical contact only. Answers "seen this week", which
   *                correcting a phone number plainly is not.
   */
  const touch = (patientId, when, kind, { clinical = false } = {}) => {
    if (!patientId || !when) return;
    const date = String(when).slice(0, 10);
    const entry = activity.get(patientId) || { lastAt: "", lastSeenAt: "", counts: {} };
    if (date > entry.lastAt) entry.lastAt = date;
    if (clinical && date > entry.lastSeenAt) entry.lastSeenAt = date;
    entry.counts[kind] = (entry.counts[kind] || 0) + 1;
    activity.set(patientId, entry);
  };

  for (const r of scripts) touch(r.patientId, r.issuedAt || r.updatedAt, "prescriptions", { clinical: true });
  for (const r of notes) touch(r.patientId, r.date || r.updatedAt, "notes", { clinical: true });
  for (const r of certs) touch(r.patientId, r.date || r.updatedAt, "certificates", { clinical: true });
  // Billing is administrative — raising an invoice is not seeing someone.
  for (const r of bills) touch(r.patientId, r.date || r.updatedAt, "invoices");
  // A patient with nothing on file yet is still recently touched.
  for (const p of people) touch(p.id, p.updatedAt, "patient");

  return activity;
}

/** Patient ids with clinical contact since `since` (an ISO date), newest first. */
export function seenSince(activity, since) {
  return [...activity.entries()]
    .filter(([, entry]) => entry.lastSeenAt && entry.lastSeenAt >= since)
    .sort((a, b) => b[1].lastSeenAt.localeCompare(a[1].lastSeenAt))
    .map(([id]) => id);
}

/**
 * What this patient has actually been given before, keyed by medicine name.
 * Powers the "you usually write …" hint, which is only worth showing when it
 * is this patient's own history rather than a general average.
 */
export async function patientDrugHistory(patientId) {
  if (!patientId) return new Map();
  const scripts = await prescriptions.byPatient(patientId);
  const history = new Map();

  for (const script of scripts) {
    for (const item of script.items || []) {
      const key = String(item.name || "").trim().toLowerCase();
      if (!key) continue;
      const when = script.issuedAt || script.updatedAt || "";
      const entry = history.get(key) || { count: 0, lastAt: "", strength: "", frequency: "", dose: "" };
      entry.count += 1;
      if (String(when) >= entry.lastAt) {
        entry.lastAt = String(when);
        entry.strength = item.strength || entry.strength;
        entry.frequency = item.frequency || entry.frequency;
        entry.dose = item.dose || entry.dose;
      }
      history.set(key, entry);
    }
  }
  return history;
}

export const CERTIFICATE_TYPES = {
  "sick-leave": "Medical certificate — sick leave",
  "fitness-to-work": "Certificate of fitness to work",
  "fitness-to-participate": "Certificate of fitness to participate",
  attendance: "Certificate of attendance",
};

/**
 * Shaped by what the HPCSA requires a certificate to state: when the patient
 * was seen, whether the practitioner observed the condition or was told about
 * it, what the patient is capable of, and the exact period.
 */
export function newCertificate(seed = {}) {
  return {
    patientId: null,
    type: "sick-leave",
    date: isoDate(),
    examinedOn: isoDate(),
    examinedAt: "",
    basis: "examination",          // examination | reported
    condition: "",
    disclose: false,               // print the condition, or "a medical condition"
    capacity: "unfit",             // unfit | light-duties | fit
    fromDate: isoDate(),
    toDate: isoDate(),
    employerRef: "",
    remarks: "",
    status: "draft",
    ...seed,
  };
}

/** Inclusive day count, so a single-day certificate reads as one day. */
export function certificateDays(certificate) {
  const from = new Date(certificate.fromDate);
  const to = new Date(certificate.toDate);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  const days = Math.round((to - from) / 86400000) + 1;
  return days > 0 ? days : null;
}

export function invoiceTotal(invoice) {
  return (invoice.lines || []).reduce(
    (sum, line) => sum + Math.round((Number(line.qty) || 0) * (Number(line.amountCents) || 0)),
    0
  );
}

/** Sequential invoice numbers scoped to the year: INV-2026-0007. */
export async function nextInvoiceNumber(date = new Date()) {
  const year = new Date(date).getFullYear();
  const rows = await invoices.all({ includeDeleted: true });
  const prefix = `INV-${year}-`;
  const highest = rows.reduce((max, inv) => {
    if (!String(inv.number || "").startsWith(prefix)) return max;
    const n = Number.parseInt(String(inv.number).slice(prefix.length), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return `${prefix}${String(highest + 1).padStart(4, "0")}`;
}

export function patientName(patient) {
  if (!patient) return "Unknown patient";
  const name = `${patient.firstName || ""} ${patient.surname || ""}`.trim();
  return name || "Unnamed patient";
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const DEFAULT_PRESCRIBER = {
  name: "Dr Michael Smit",
  qualifications: "MBChB (U.C.T 1997) DMH (SA) (1999)",
  title: "Independent Medical Practitioner",
  hpcsa: "MP 049 5441",
  practiceNumber: "0354074",
  addressLine: "15 Batten Bend, Blouberg Sands, Cape Town, 7441",
  postalLine: "P.O. Box 74, West Coast Village, 7433",
  email: "michaelsmit@outlook.com",
  phone: "084 922 3619",
  signatureImage: "",
};

export const DEFAULT_PREFERENCES = {
  scriptValidityDays: 30,
  defaultRepeats: 0,
  showFormularyDose: true,
  currency: "ZAR",
  consultationFeeCents: 0,
};

export async function getSetting(key, fallback = null) {
  const row = await db.get("settings", key);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  await db.put("settings", { key, value, updatedAt: now() });
  announce("settings", "update", { key, value });
  return value;
}

export async function getPrescriber() {
  return { ...DEFAULT_PRESCRIBER, ...(await getSetting("prescriber", {})) };
}

export async function getPreferences() {
  return { ...DEFAULT_PREFERENCES, ...(await getSetting("preferences", {})) };
}
