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
    .then((data) => ({
      ...data,
      drugs: data.drugs.map((d) => ({ ...d, custom: false })),
      byId: new Map(data.drugs.map((d) => [d.id, d])),
    }))
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
  };
}

export async function catalogue() {
  const [reference, personal] = await Promise.all([load(), store.medicines.all()]);
  const custom = personal.map(asDrug);
  const customNames = new Set(custom.map((d) => d.name.toLowerCase()));
  // A personal entry with the same name overrides the reference one.
  const merged = custom.concat(reference.drugs.filter((d) => !customNames.has(d.name.toLowerCase())));
  return { drugs: merged, conditions: reference.conditions, meta: reference };
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
    return pool
      .slice()
      .sort((a, b) => Number(b.favourite) - Number(a.favourite) || a.name.localeCompare(b.name))
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
    if (drug.favourite) score += 5;
    if (drug.custom) score += 2;
    scored.push({ drug, score });
  }

  scored.sort((a, b) => b.score - a.score || a.drug.name.localeCompare(b.drug.name));
  return scored.slice(0, limit).map((s) => s.drug);
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
  return {
    name: drug.name,
    drugId: drug.id,
    strength: drug.default?.exact || "",
    dose: "",
    frequency: drug.default?.frequency || "",
    form: drug.form || "",
    reference: drug.default?.source || "",
  };
}
