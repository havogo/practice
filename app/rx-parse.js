// Turning the text of an old prescription back into structured lines.
//
// The input is messy by nature — a PDF text layer keeps its line breaks but
// loses alignment, OCR mangles characters, and a pasted script has whatever
// shape the pharmacy's printer gave it. So nothing here is trusted: every field
// carries a confidence, and the import screen makes the prescriber confirm the
// result before it becomes a script.

const UNIT = "mg|milligrams?|mcg|microgram(?:me)?s?|µg|ug|g|grams?|kg|ml|mL|millilitres?|iu|units?|%";

const STRENGTH_RE = new RegExp(
  `\\b(\\d+(?:[.,]\\d+)?)\\s*(?:[-–]\\s*(\\d+(?:[.,]\\d+)?)\\s*)?(${UNIT})\\b`,
  "i"
);

// Frequency shorthand, longest and most specific patterns first.
const FREQUENCIES = [
  [/\b(?:q\.?i\.?d|q\.?d\.?s)\b|\bfour times (?:a )?d(?:ay|aily)\b|\b4 times (?:a )?d(?:ay|aily)\b/i, "q.i.d."],
  [/\b(?:t\.?d\.?s|t\.?i\.?d)\b|\bthree times (?:a )?d(?:ay|aily)\b|\b3 times (?:a )?d(?:ay|aily)\b/i, "t.d.s."],
  [/\b(?:b\.?d|b\.?i\.?d)\b|\btwice (?:a )?d(?:ay|aily)\b|\b2 times (?:a )?d(?:ay|aily)\b/i, "b.d."],
  [/\b(?:o\.?d|q\.?d|s\.?i\.?d)\b|\bonce (?:a )?d(?:ay|aily)\b|\bevery day\b/i, "o.d."],
  [/\bq\.?(\d+)\s*h\b|\bevery (\d+(?:\s*[-–]\s*\d+)?) hours?\b|\b(\d+)\s*hourly\b/i, null], // rendered below
  [/\bnocte\b|\bat night\b|\bat bed ?time\b|\bh\.?s\b/i, "nocte"],
  [/\bmane\b|\bin the morning\b|\beach morning\b/i, "mane"],
  [/\bp\.?r\.?n\b|\bas (?:required|needed)\b|\bwhen (?:required|necessary)\b/i, "p.r.n."],
  [/\bstat\b|\bimmediately\b/i, "stat"],
  [/\balt\.? die\b|\bevery other day\b|\balternate days?\b/i, "alt. die"],
  [/\bweekly\b|\bonce a week\b/i, "weekly"],
  // Last resort: a bare "daily" with no count in front of it.
  [/\bdaily\b/i, "o.d."],
];

// Route of administration, stripped from the name but not otherwise recorded.
const ROUTE_RE = /\b(?:p\.?o|per os|by mouth|orally|i\.?m|i\.?v|s\.?c|s\.?l|p\.?v|p\.?r|top(?:ically)?|inh)\b/i;

const DOSE_RE = new RegExp(
  `\\b(\\d+(?:[.,]\\d+)?|[½¼]|i{1,3}v?|iv|one|two|three|four|half)\\s*` +
    `(tablets?|tabs?|capsules?|caps?|pills?|sachets?|puffs?|drops?|gtt|sprays?|` +
    `patch(?:es)?|suppositor(?:y|ies)|ampoules?|vials?|scoops?|units?|ml|mL)\\b`,
  "i"
);

const DURATION_RE =
  /\bfor\s+(\d+)\s*(day|week|month|year)s?\b|\b[x×]\s*(\d+)\s*(day|week|month)s?\b|\b(\d+)\s*(day|week|month)s?\s+course\b/i;

// A bare parenthesised integer is a quantity; "(I10)" and the like are not.
const QUANTITY_RE = /\(\s*(\d{1,4})\s*\)|(?:\bqty|\bquantity|\bdisp(?:ense)?|\bmitte|#)\s*[:.]?\s*(\d{1,4})\b/i;

const REPEATS_RE =
  /\brepeat(?:s|ed)?\s*(?:[x×]\s*)?(\d{1,2})\b|\b(\d{1,2})\s*repeats?\b|\brpt\s*[x×]?\s*(\d{1,2})\b|\b[x×]\s*(\d{1,2})\s*months?\b/i;

const NO_REPEAT_RE = /\bno repeat|\bnr\b|\bdo not repeat\b/i;

// Where the medicine list starts and stops.
const RX_START_RE = /^\s*(?:℞|Rx|R\/|Script|Prescription|Medication[s]?)\s*[:.]?\s*$/i;
const RX_INLINE_RE = /^\s*(?:℞|Rx|R\/)\s*[:.]?\s+(?=\S)/i;
const RX_END_RE =
  /^\s*(?:signature|signed|sign(?:ature)? ?:|dr\b.*\bsignature|yours|kind regards|regards|_{4,}|-{6,}|per script|valid for|dispense before)/i;

// Footer noise from a printed page that must not be read as a medicine.
const NOISE_RE = new RegExp(
  "^\\s*(?:" +
    "page \\d+|\\d+\\s*/\\s*\\d+|localhost|https?://|www\\.|" +
    "p\\.?o\\.? box|hpcsa|practice (?:no|number)|reg(?:istration)? (?:no|number)|" +
    "tel[:.]|fax|e-?mail|\\d{1,2}/\\d{1,2}/\\d{2,4},|" +
    // header and label lines that are never a medicine
    "dr\\b|prof\\b|sister\\b|re\\s*[:.]|patient\\s*[:.]|name\\s*[:.]|" +
    "d\\.?o\\.?b\\b|date\\b|diagnosis\\s*[:.]|dx\\s*[:.]|id (?:no|number)\\b|" +
    "signature|signed|address\\s*[:.]|mbchb|independent medical" +
  ")",
  "i"
);

// ---------------------------------------------------------------------------
// Text clean-up
// ---------------------------------------------------------------------------

/**
 * OCR confuses letters and digits. Correcting that globally would wreck names,
 * so substitutions are applied only where a digit is unambiguous: inside a
 * number that is attached to a unit.
 */
export function repairOcr(text) {
  return String(text)
    .replace(/\r\n?/g, "\n")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/ /g, " ")
    .replace(/[|]/g, "l")
    // 5Omg -> 50mg, 1O0mg -> 100mg, l0mg -> 10mg
    .replace(/\b([\dOolIS]{1,4})\s*(mg|mcg|ml|mL|g|iu|units?)\b/gi, (m, num, unit) => {
      const fixed = num.replace(/[Oo]/g, "0").replace(/[lI]/g, "1").replace(/S/g, "5");
      return /^\d+$/.test(fixed) ? `${fixed} ${unit}` : m;
    })
    // Dosing shorthand collects stray digits: "o.d." is read as "o0.d.".
    .replace(/\b([obtq])0(\s*\.?\s*d)/gi, "$1$2")
    .replace(/\b([obtq])\s*\.?\s*d\s*\.?\s*s\b/gi, (m) => m.replace(/\s/g, ""))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

// ---------------------------------------------------------------------------
// Fuzzy matching against the formulary
// ---------------------------------------------------------------------------

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Levenshtein with an early exit once the distance cannot beat `cap`. */
function distance(a, b, cap = Infinity) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (row[j] < best) best = row[j];
    }
    if (best > cap) return cap + 1;
    prev = row;
  }
  return prev[b.length];
}

const similarity = (a, b) => {
  const longest = Math.max(a.length, b.length);
  if (!longest) return 0;
  return 1 - distance(a, b, Math.ceil(longest * 0.45)) / longest;
};

/**
 * Match a scanned drug name to the formulary. Returns the best candidate with a
 * score in 0..1, or null. A generic name is often written without its salt
 * ("Metformin" for "Metformin hydrochloride"), so the first word is compared too.
 */
export function matchDrug(name, drugs) {
  const query = norm(name);
  if (query.length < 3) return null;

  let best = null;
  for (const drug of drugs) {
    const full = norm(drug.name);
    const head = full.split(" ")[0];

    let score = similarity(query, full);
    // Comparing against the head only is generous, so it is discounted.
    if (head.length >= 4) score = Math.max(score, similarity(query, head) * 0.97);
    if (full.startsWith(query) && query.length >= 5) score = Math.max(score, 0.93);
    if (drug.custom) score += 0.02; // prefer the prescriber's own entries

    if (!best || score > best.score) best = { drug, score: Math.min(score, 1) };
  }

  return best && best.score >= 0.68 ? best : null;
}

// ---------------------------------------------------------------------------
// Line parsing
// ---------------------------------------------------------------------------

/**
 * The most specific matching pattern gives the frequency, but *every* matching
 * phrase is reported as a span. "every 8 hours as required" holds two of them,
 * and leaving the second in place would append it to the drug name.
 */
function readFrequency(line) {
  let value = null;
  const spans = [];
  for (const [re, label] of FREQUENCIES) {
    const m = re.exec(line);
    if (!m) continue;
    spans.push([m.index, m.index + m[0].length]);
    if (value !== null) continue;
    if (label) {
      value = label;
    } else {
      const hours = (m[1] || m[2] || m[3] || "").replace(/\s/g, "");
      if (hours) value = `every ${hours} hours`;
    }
  }
  return spans.length ? { value, spans } : null;
}

function readDuration(line) {
  const m = DURATION_RE.exec(line);
  if (!m) return null;
  const count = m[1] || m[3] || m[5];
  const unit = m[2] || m[4] || m[6];
  if (!count || !unit) return null;
  return {
    value: `${count} ${unit}${Number(count) === 1 ? "" : "s"}`,
    span: [m.index, m.index + m[0].length],
  };
}

function readRepeats(line) {
  const none = NO_REPEAT_RE.exec(line);
  if (none) return { value: 0, span: [none.index, none.index + none[0].length] };
  const m = REPEATS_RE.exec(line);
  if (!m) return null;
  const value = Number(m[1] || m[2] || m[3] || m[4]);
  if (!Number.isFinite(value) || value > 12) return null;
  return { value, span: [m.index, m.index + m[0].length] };
}

/**
 * Strip everything that was recognised as a field, leaving the drug name.
 *
 * Removal is by character range, never by searching for the matched text again:
 * "od" recognised as a frequency in "Amlodipine 5mg po od" would otherwise be
 * found first inside "Amlodipine" and turn it into "Aml ipine".
 */
function extractName(line, spans) {
  const chars = [...line];
  for (const [start, end] of spans) {
    for (let i = start; i < end && i < chars.length; i += 1) chars[i] = " ";
  }
  return chars
    .join("")
    .replace(/^\s*(?:\d+[.)]|[-•*·—])\s*/, "")   // list markers
    .replace(ROUTE_RE, " ")
    .replace(/\b(?:take|give|use|apply|inhale|instil|swallow|sig)\b/gi, " ")
    .replace(/[,;:]+\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-–—,.]+|[\s\-–—,.]+$/g, "")
    .trim();
}

/** Parse a single medicine line. Returns null when it holds no medicine. */
export function parseItemLine(rawLine, drugs = []) {
  const line = rawLine.trim();
  if (!line || line.length < 3 || NOISE_RE.test(line)) return null;

  const spans = [];

  const strengthMatch = STRENGTH_RE.exec(line);
  let strength = null;
  if (strengthMatch) {
    spans.push([strengthMatch.index, strengthMatch.index + strengthMatch[0].length]);
    const [, low, high, unit] = strengthMatch;
    const canonical = /^(micrograms?|microgramme|µg|ug|mcg)$/i.test(unit) ? "micrograms"
      : /^(milligrams?)$/i.test(unit) ? "mg"
      : /^(grams?)$/i.test(unit) ? "g"
      : /^(millilitres?)$/i.test(unit) ? "mL"
      : /^(iu|units?)$/i.test(unit) ? "units"
      : unit.toLowerCase() === "ml" ? "mL"
      : unit.toLowerCase();
    strength = high ? `${low}-${high} ${canonical}` : `${low}${canonical === "%" ? "" : " "}${canonical}`;
  }

  const doseMatch = DOSE_RE.exec(line);
  let dose = null;
  if (doseMatch) {
    spans.push([doseMatch.index, doseMatch.index + doseMatch[0].length]);
    dose = doseMatch[0].replace(/\s+/g, " ").trim();
  }

  const frequency = readFrequency(line);
  if (frequency) spans.push(...frequency.spans);
  const duration = readDuration(line);
  if (duration) spans.push(duration.span);
  const repeats = readRepeats(line);
  if (repeats) spans.push(repeats.span);

  const qtyMatch = QUANTITY_RE.exec(line);
  const quantity = qtyMatch ? qtyMatch[1] || qtyMatch[2] : null;
  if (qtyMatch) spans.push([qtyMatch.index, qtyMatch.index + qtyMatch[0].length]);

  const extracted = extractName(line, spans);
  // Without a name there is no medicine, whatever else the line contained.
  if (!extracted || extracted.length < 3 || !/[a-z]{3}/i.test(extracted)) return null;

  // Free text often trails the drug — "Prednisone then stop". If a leading
  // slice of the words matches the formulary distinctly better than the whole,
  // treat the remainder as instructions instead of part of the name.
  let name = extracted;
  let instructions = "";
  let match = matchDrug(extracted, drugs);
  const words = extracted.split(" ");
  if (words.length > 1) {
    for (let n = 1; n < words.length; n += 1) {
      const head = words.slice(0, n).join(" ");
      const headMatch = matchDrug(head, drugs);
      if (headMatch && headMatch.score >= 0.88 && (!match || headMatch.score > match.score + 0.02)) {
        name = head;
        instructions = words.slice(n).join(" ");
        match = headMatch;
      }
    }
  }

  const matched = match && match.score >= 0.78 ? match : null;

  // A line with none of the marks of a prescription — no strength, dose,
  // frequency or quantity — is only a medicine if the name itself is one.
  // This is what keeps "Dr Michael Smit" and "Re: Jane Smith" out of the list
  // when the document has no Rx marker to bound the search.
  const hasSignal = Boolean(strength || dose || frequency || quantity);
  if (!hasSignal && !(match && match.score >= 0.88)) return null;

  return {
    name: matched ? matched.drug.name : name,
    rawName: name,
    drugId: matched ? matched.drug.id : null,
    matchScore: match ? Number(match.score.toFixed(2)) : 0,
    suggestion: !matched && match ? match.drug.name : null,
    strength: strength || "",
    dose: dose || "",
    frequency: frequency?.value || "",
    duration: duration?.value || "",
    quantity: quantity || "",
    repeats: repeats?.value ?? 0,
    instructions,
    source: line,
  };
}

// ---------------------------------------------------------------------------
// Whole-document parsing
// ---------------------------------------------------------------------------

const DATE_PATTERNS = [
  /\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/,                       // 2026-06-28
  /\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/,                       // 28/06/2026
  /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})\b/i,
];

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// Lines that carry the patient's birth date, never the date of the script.
const DOB_LINE_RE = /\b(?:d\.?o\.?b|date of birth|born)\b/i;

/**
 * An ICD-10 code read by OCR loses its leading letter to a lookalike digit:
 * I10 becomes 110. Restore it when the rest of the code is well formed.
 */
function repairIcd(code) {
  const cleaned = String(code || "").toUpperCase().trim();
  if (/^[A-TV-Z]\d{2}(\.\d{1,2})?$/.test(cleaned)) return cleaned;
  const swapped = { 1: "I", 0: "O", 5: "S", 8: "B", 2: "Z", 6: "G" }[cleaned[0]];
  if (!swapped) return null;
  const candidate = swapped + cleaned.slice(1);
  return /^[A-TV-Z]\d{2}(\.\d{1,2})?$/.test(candidate) ? candidate : null;
}

function readDate(text) {
  for (const re of DATE_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    let year;
    let month;
    let day;
    if (re === DATE_PATTERNS[0]) [, year, month, day] = m;
    else if (re === DATE_PATTERNS[1]) {
      [, day, month, year] = m;              // day-first, as written in South Africa
    } else {
      day = m[1];
      month = MONTHS[m[2].slice(0, 3).toLowerCase()];
      year = m[3];
    }
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!Number.isNaN(new Date(iso).getTime())) return iso;
  }
  return null;
}

/**
 * Parse a whole prescription.
 * `drugs` is the merged formulary, used to correct scanned names.
 */
export function parsePrescription(rawText, drugs = [], { exactText = false } = {}) {
  const text = repairOcr(rawText);
  const lines = text.split("\n").map((l) => l.trim());
  const warnings = [];

  // --- patient -------------------------------------------------------------
  let patientName = null;
  let dob = null;
  let idNumber = null;

  for (const line of lines) {
    if (!patientName) {
      const m = /^\s*(?:re|patient|name|pt)\s*[:.]\s*(.+)$/i.exec(line);
      if (m) patientName = m[1].replace(/\s{2,}/g, " ").replace(/[,;]\s*$/, "").trim();
    }
    if (!dob) {
      const m = /\b(?:d\.?o\.?b|date of birth|born)\b\s*[:.]?\s*(.+)$/i.exec(line);
      if (m) dob = readDate(m[1]);
    }
    if (!idNumber) {
      const m = /\b(?:id(?: no| number)?|identity)\b\s*[:.]?\s*(\d[\d\s]{9,16})/i.exec(line);
      if (m) idNumber = m[1].replace(/\s/g, "");
    }
  }

  // A 13-digit SA ID encodes the date of birth, which beats a misread DOB line.
  if (idNumber && /^\d{13}$/.test(idNumber) && !dob) {
    const yy = Number(idNumber.slice(0, 2));
    const century = yy > Number(String(new Date().getFullYear()).slice(2)) ? 1900 : 2000;
    const iso = `${century + yy}-${idNumber.slice(2, 4)}-${idNumber.slice(4, 6)}`;
    if (!Number.isNaN(new Date(iso).getTime())) dob = iso;
  }

  // --- diagnosis -----------------------------------------------------------
  let diagnosis = null;
  let icd10 = null;
  for (const line of lines) {
    if (!diagnosis) {
      const m = /^\s*(?:diagnosis|dx|indication|for)\s*[:.]\s*(.+)$/i.exec(line);
      if (m) diagnosis = m[1].trim();
    }
    if (!icd10) {
      const m = /\b([A-TV-Z]\d{2}(?:\.\d{1,2})?)\b/.exec(line);
      if (m && /icd|diagnosis|dx/i.test(line)) icd10 = m[1];
    }
  }
  if (diagnosis && !icd10) {
    const m = /\(([A-TV-Z0-9]\d{1,2}(?:\.\d{1,2})?)\)/i.exec(diagnosis);
    const repaired = m && repairIcd(m[1]);
    if (repaired) {
      icd10 = repaired;
      diagnosis = diagnosis.replace(m[0], "").replace(/\s{2,}/g, " ").trim();
    }
  }

  // --- the medicine block --------------------------------------------------
  let start = -1;
  let inlineFirst = null;
  for (let i = 0; i < lines.length; i += 1) {
    if (RX_START_RE.test(lines[i])) {
      start = i + 1;
      break;
    }
    const inline = RX_INLINE_RE.exec(lines[i]);
    if (inline) {
      start = i + 1;
      inlineFirst = lines[i].slice(inline[0].length);
      break;
    }
  }

  let body;
  if (start === -1) {
    // No Rx marker at all — treat every line as a candidate and rely on the
    // per-line parser to reject the ones that hold no medicine.
    warnings.push("No “Rx” marker was found, so every line was checked for a medicine.");
    body = lines;
  } else {
    body = [];
    if (inlineFirst) body.push(inlineFirst);
    for (let i = start; i < lines.length; i += 1) {
      if (RX_END_RE.test(lines[i])) break;
      body.push(lines[i]);
    }
  }

  // A wrapped line ("Take one tablet" under the drug) belongs to the item above.
  const merged = [];
  for (const line of body) {
    if (!line) continue;
    const isContinuation =
      merged.length > 0 &&
      !STRENGTH_RE.test(line) &&
      /^(?:take|give|use|apply|to be|with|after|before|instructions?|sig\b|repeat)/i.test(line);
    if (isContinuation) merged[merged.length - 1] += ` ${line}`;
    else merged.push(line);
  }

  const items = [];
  for (const line of merged) {
    const item = parseItemLine(line, drugs);
    if (item) items.push(item);
  }

  if (!items.length) warnings.push("No medicines could be read from this document.");

  // An unmatched name means different things depending on where the text came
  // from. Read exactly out of a PDF it is almost always a legitimate trade name
  // — Glucophage rather than metformin — and nothing is wrong. Coming from OCR
  // it may equally be a misreading, and deserves a closer look.
  const unmatched = items.filter((i) => !i.drugId);
  if (unmatched.length) {
    const subject =
      unmatched.length === items.length
        ? unmatched.length === 1 ? "This medicine name is" : "These medicine names are"
        : unmatched.length === 1 ? "One medicine name is" : `${unmatched.length} medicine names are`;
    warnings.push(
      exactText
        ? `${subject} not in your formulary — most likely a trade name. You can add ` +
          `${unmatched.length === 1 ? "it" : "them"} to your own list from the ${unmatched.length === 1 ? "item" : "items"} below.`
        : `${subject} not in the formulary. Text recognition misreads names easily — ` +
          `check ${unmatched.length === 1 ? "it" : "each one"} against the original before issuing.`
    );
  }
  if (items.some((i) => !i.strength)) warnings.push("Some lines have no strength. Add it before issuing.");

  // The date the script was written is not the first date on the page — that is
  // usually the patient's date of birth. Ignore birth-date lines, and prefer the
  // last remaining date, since a script is dated by its signature at the foot.
  const dateCandidates = lines
    .filter((l) => l && !DOB_LINE_RE.test(l))
    .map((l) => readDate(l))
    .filter(Boolean);
  const issuedAt = dateCandidates.length ? dateCandidates[dateCandidates.length - 1] : null;

  return {
    patient: { name: patientName, dob, idNumber },
    issuedAt,
    diagnosis,
    icd10,
    items,
    warnings,
    text,
  };
}
