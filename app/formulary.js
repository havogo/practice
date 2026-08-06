// Formulary: the reference list shipped with the app, plus anything the
// prescriber has added themselves. Both are searchable by drug name and by
// indication / medical condition.

import * as store from "./store.js";

const DATA_URL = new URL("../data/formulary.json", import.meta.url);

let loaded = null;

export function load() {
  if (loaded) return loaded;
  loaded = fetch(DATA_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`Formulary failed to load (${res.status})`);
      return res.json();
    })
    .then((data) => {
      const drugs = data.drugs.map((d) => ({ ...d, custom: false }));
      return { ...data, drugs, byId: new Map(drugs.map((d) => [d.id, d])) };
    })
    .catch((err) => {
      loaded = null;
      throw err;
    });
  return loaded;
}

/** Personal additions, shaped like reference entries so search treats them alike. */
function asDrug(medicine) {
  const indications = medicine.indications || [];
  return {
    id: medicine.id,
    name: medicine.name,
    letter: (medicine.name[0] || "?").toUpperCase(),
    indications,
    dosages: medicine.dose ? [{ label: "", text: medicine.dose }] : [],
    routes: medicine.form ? [medicine.form] : [],
    default: {
      strength: medicine.strength || null,
      exact: medicine.strength || null,
      frequency: medicine.frequency || null,
      source: medicine.dose || "",
    },
    search: [medicine.name, ...indications].join(" ").toLowerCase(),
    custom: true,
    favourite: Boolean(medicine.favourite),
    form: medicine.form || "",
    useCount: medicine.useCount || 0,
    lastUsedAt: medicine.lastUsedAt || null,
    personalId: medicine.id,
    lastUsed: {
      strength: medicine.strength || "",
      frequency: medicine.frequency || "",
      dose: medicine.dose || "",
    },
  };
}

const nameKey = (value) => String(value || "").trim().toLowerCase();

/**
 * The reference list plus everything the prescriber has actually used.
 *
 * A personal entry that came from the reference is merged *onto* it rather than
 * replacing it — otherwise prescribing metformin once would shadow the entry
 * and lose its indications and dosing guidance.
 */
export async function catalogue() {
  const [reference, personal] = await Promise.all([load(), store.medicines.all()]);
  const referenceByName = new Map(reference.drugs.map((d) => [nameKey(d.name), d]));

  const drugs = [];
  const shadowed = new Set();

  for (const medicine of personal) {
    const key = nameKey(medicine.name);
    const ref =
      (medicine.fromFormulary && reference.byId.get(medicine.fromFormulary)) ||
      referenceByName.get(key);

    if (ref) {
      shadowed.add(nameKey(ref.name));
      drugs.push({
        ...ref,
        useCount: medicine.useCount || 0,
        lastUsedAt: medicine.lastUsedAt || null,
        personalId: medicine.id,
        // How this drug was last actually written, which beats the reference
        // default when putting it on a new script.
        lastUsed: {
          strength: medicine.strength || "",
          frequency: medicine.frequency || "",
          dose: medicine.dose || "",
        },
        // Still a reference medicine — it just happens to be one you use.
        custom: false,
      });
    } else {
      drugs.push(asDrug(medicine));
    }
  }

  for (const drug of reference.drugs) {
    if (shadowed.has(nameKey(drug.name))) continue;
    drugs.push({ ...drug, useCount: 0, lastUsedAt: null });
  }

  return { drugs, conditions: reference.conditions, meta: reference };
}

const normalise = (s) => String(s || "").toLowerCase().trim();

/**
 * Rank matches so the drug you typed the start of comes before one that merely
 * mentions the term somewhere in its indications.
 */
export function search(drugs, query, { limit = 40, conditionKey = null } = {}) {
  const q = normalise(query);

  let pool = drugs;
  if (conditionKey) {
    const wanted = new Set(conditionKey.drugs || []);
    pool = drugs.filter((d) => wanted.has(d.id) || d.custom);
  }
  if (!q) {
    // With nothing typed, the useful list is what you reach for most often.
    return pool
      .slice()
      .sort(
        (a, b) =>
          Number(b.favourite) - Number(a.favourite) ||
          (b.useCount || 0) - (a.useCount || 0) ||
          String(b.lastUsedAt || "").localeCompare(String(a.lastUsedAt || "")) ||
          a.name.localeCompare(b.name)
      )
      .slice(0, limit);
  }

  const scored = [];
  for (const drug of pool) {
    const name = normalise(drug.name);
    let score = 0;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.includes(q)) score = 60;
    else if (drug.indications.some((i) => normalise(i).startsWith(q))) score = 40;
    else if (drug.search.includes(q)) score = 20;
    if (!score) continue;

    // A drug you have prescribed before beats an equally-good reference match:
    // ten uses is worth as much as the gap between "contains" and "starts with".
    score += Math.min(drug.useCount || 0, 10) * 2;
    if (drug.favourite) score += 5;
    if (drug.custom) score += 2;
    scored.push({ drug, score });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (b.drug.useCount || 0) - (a.drug.useCount || 0) ||
      a.drug.name.localeCompare(b.drug.name)
  );
  return scored.slice(0, limit).map((s) => s.drug);
}

/** Is this exactly a name already in the catalogue? */
export function hasExactName(drugs, query) {
  const q = normalise(query);
  return q ? drugs.some((d) => normalise(d.name) === q) : false;
}

/** A medicine that exists only because it was typed. */
export function freeTextDrug(name) {
  const clean = String(name || "").trim();
  return {
    id: null,
    name: clean,
    letter: (clean[0] || "?").toUpperCase(),
    indications: [],
    dosages: [],
    routes: [],
    default: { strength: null, exact: null, frequency: null, source: "" },
    search: clean.toLowerCase(),
    custom: true,
    freeText: true,
    useCount: 0,
  };
}

/** Typeahead over the indication/condition index. */
export function searchConditions(conditions, query, limit = 30) {
  const q = normalise(query);
  if (!q) return conditions.slice(0, limit);
  const scored = [];
  for (const c of conditions) {
    const key = c.key;
    let score = 0;
    if (key === q) score = 100;
    else if (key.startsWith(q)) score = 70;
    else if (key.includes(q)) score = 40;
    else if (normalise(c.label).includes(q)) score = 20;
    if (score) scored.push({ c, score: score + Math.min(c.drugs.length, 20) / 100 });
  }
  scored.sort((a, b) => b.score - a.score || a.c.key.localeCompare(b.c.key));
  return scored.slice(0, limit).map((s) => s.c);
}

/**
 * Turn a formulary entry into prescription-line defaults. A dose the reference
 * gives as a range is deliberately left blank — the prescriber picks it.
 */
export function toPrescriptionItem(drug) {
  // How you last wrote it wins over the reference default — that is the dose
  // you settled on for this patient population, in the units you use.
  const last = drug.lastUsed || {};
  return {
    name: drug.name,
    drugId: drug.id,
    strength: last.strength || drug.default?.exact || "",
    dose: last.dose || "",
    frequency: last.frequency || drug.default?.frequency || "",
    form: drug.form || "",
    // Only genuine reference guidance earns that label — a personal entry's
    // note is the prescriber's own, and belongs in the dose field instead.
    reference: drug.custom ? "" : drug.default?.source || "",
  };
}
