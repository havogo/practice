#!/usr/bin/env python3
"""Convert the text-based formulary export into the app's searchable JSON.

Input  : a markdown-ish dump with `### Drug`, `**Indication:**`, `**Dosage:**` blocks.
Output : data/formulary.json  { version, source, generated, drugs[], conditions[] }

Usage: python3 tools/parse_formulary.py <input.txt> [output.json]
"""

import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone

DRUG_RE = re.compile(r"^###\s+(.*\S)\s*$")
SECTION_RE = re.compile(r"^##\s+(\S.*?)\s*$")
FIELD_RE = re.compile(r"^\*\*(\w+):\*\*\s*(.*)$")
BULLET_RE = re.compile(r"^[-*]\s+(.*\S)\s*$")

# A dose line usually reads "<Context>: <instruction>". Only treat the part before
# the first colon as a label when it is short and looks like a context, not prose.
LABEL_RE = re.compile(r"^([^:]{1,60}?):\s+(.*)$")

STRENGTH_RE = re.compile(
    r"(\d+(?:[.,]\d+)?)\s*(?:-\s*(\d+(?:[.,]\d+)?)\s*)?"
    r"(micrograms?|mcg|milligrams?|mg|grams?|g|units?|iu|mL|ml|%)\b",
    re.IGNORECASE,
)

TIMES_SHORTHAND = {1: "o.d.", 2: "b.d.", 3: "t.d.s.", 4: "q.i.d."}

# "2-3 times a day" must not collapse to the more frequent end of the range.
TIMES_RANGE_RE = re.compile(r"\b(\d)\s*-\s*(\d) times (?:a )?d(?:ay|aily)\b", re.I)

# Ordered most-specific first: a bare "daily" must never outrank "3 times a day".
FREQUENCY_MAP = [
    (re.compile(r"\b4 times (?:a )?d(?:ay|aily)\b|\bfour times (?:a )?d(?:ay|aily)\b", re.I), "q.i.d."),
    (re.compile(r"\b3 times (?:a )?d(?:ay|aily)\b|\bthree times (?:a )?d(?:ay|aily)\b", re.I), "t.d.s."),
    (re.compile(r"\btwice (?:a )?d(?:aily|ay)\b|\b2 times (?:a )?d(?:ay|aily)\b", re.I), "b.d."),
    (re.compile(r"\bevery (\d+(?:\s*-\s*\d+)?) hours?\b", re.I), None),  # rendered from the match
    (re.compile(r"\bonce (?:a )?d(?:aily|ay)\b", re.I), "o.d."),
    (re.compile(r"\bat bedtime\b|\bat night\b|\bnocte\b", re.I), "nocte"),
    (re.compile(r"\bas (?:required|needed)\b|\bp\.?r\.?n\b", re.I), "p.r.n."),
    (re.compile(r"\bdaily\b", re.I), "o.d."),
]

# Clauses that state a ceiling or an alternative, not the dose being prescribed.
NOISE_RE = re.compile(r"\(max[^)]*\)|\bmax\.?[^;.]*|\(or [^)]*\)", re.I)

ROUTE_MAP = [
    (re.compile(r"\b(?:by )?(?:IV|intravenous)\b", re.I), "IV"),
    (re.compile(r"\b(?:IM|intramuscular)\b", re.I), "IM"),
    (re.compile(r"\b(?:SC|subcutaneous)\b", re.I), "SC"),
    (re.compile(r"\binhalation\b|\binhaler\b|\bnebul", re.I), "inhaled"),
    (re.compile(r"\btopical(?:ly)?\b|\bapply\b|\bcream\b|\bointment\b", re.I), "topical"),
    (re.compile(r"\brectal(?:ly)?\b|\bsuppositor", re.I), "rectal"),
    (re.compile(r"\bnasal(?:ly)?\b", re.I), "nasal"),
    (re.compile(r"\beye\b|\bophthalmic\b|\beach eye\b", re.I), "ophthalmic"),
    (re.compile(r"\boral(?:ly)?\b|\btablet\b|\bcapsule\b|\bby mouth\b", re.I), "oral"),
]

# Split an indication string on separators that sit outside brackets.
def split_indications(text):
    text = text.strip().rstrip(".")
    parts, depth, buf = [], 0, []
    for ch in text:
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth = max(0, depth - 1)
        if ch in ",;" and depth == 0:
            parts.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    parts.append("".join(buf))

    out = []
    for p in parts:
        p = p.strip().strip(".").strip()
        # "A and B" at the tail of a list is still one clinical concept often enough
        # that we keep it whole; only strip a dangling leading conjunction.
        p = re.sub(r"^(?:and|or)\s+", "", p, flags=re.I).strip()
        if len(p) > 1:
            out.append(p[0].upper() + p[1:])
    return out


def slugify(name):
    s = name.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def norm_condition(text):
    """Normalise an indication phrase so variants collapse to one dropdown entry."""
    s = text.lower().strip()
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"^(?:treatment|management|prophylaxis|prevention|relief|maintenance"
               r"|symptomatic relief|adjunct|adjunctive treatment)\s+(?:of|in|for)\s+",
               "", s)
    s = re.sub(r"^(?:acute|chronic|severe|mild|moderate)\s+", "", s)
    s = s.strip(" .")
    return s


UNIT_CANON = {"milligram": "mg", "milligrams": "mg", "mcg": "micrograms",
              "microgram": "micrograms", "gram": "g", "grams": "g",
              "unit": "units", "iu": "units", "ml": "mL"}


def guess_strength(text):
    """Return (display, exact). `exact` is None for a range, so the UI must not
    silently prefill a dose the prescriber did not choose."""
    m = STRENGTH_RE.search(strip_noise(text))
    if not m:
        return None, None
    low, high, unit = m.group(1), m.group(2), m.group(3).lower()
    unit = UNIT_CANON.get(unit, unit)
    sep = "" if unit == "%" else " "
    if high:
        return f"{low}-{high}{sep}{unit}", None
    value = f"{low}{sep}{unit}"
    return value, value


def strip_noise(text):
    return NOISE_RE.sub(" ", text.split(";")[0])


def guess_frequency(text):
    body = strip_noise(text)
    m = TIMES_RANGE_RE.search(body)
    if m:
        low, high = int(m.group(1)), int(m.group(2))
        if low in TIMES_SHORTHAND and high in TIMES_SHORTHAND:
            return f"{TIMES_SHORTHAND[low]}–{TIMES_SHORTHAND[high]}"
    for rx, short in FREQUENCY_MAP:
        m = rx.search(body)
        if not m:
            continue
        if short is None:  # "every N hours"
            return f"every {m.group(1).replace(' ', '')} hours"
        return short
    return None


def guess_routes(blob):
    return [name for rx, name in ROUTE_MAP if rx.search(blob)]


def parse(path):
    drugs = []
    current = None
    field = None
    letter = None

    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for raw in fh:
            line = raw.rstrip("\n")

            m = SECTION_RE.match(line)
            if m and len(m.group(1)) <= 2:
                letter = m.group(1).upper()
                continue

            m = DRUG_RE.match(line)
            if m:
                current = {
                    "name": m.group(1),
                    "letter": letter or m.group(1)[:1].upper(),
                    "indications": [],
                    "dosages": [],
                }
                drugs.append(current)
                field = None
                continue

            if current is None:
                continue

            m = FIELD_RE.match(line)
            if m:
                key, value = m.group(1).lower(), m.group(2).strip()
                field = key
                if key == "indication" and value:
                    current["indications"] = split_indications(value)
                continue

            m = BULLET_RE.match(line)
            if m and field == "dosage":
                body = m.group(1)
                lm = LABEL_RE.match(body)
                if lm and not lm.group(1).lower().startswith(("initially", "increase")):
                    current["dosages"].append({"label": lm.group(1).strip(),
                                               "text": lm.group(2).strip()})
                else:
                    current["dosages"].append({"label": "", "text": body.strip()})
                continue

    return drugs


def enrich(drugs):
    for d in drugs:
        d["id"] = slugify(d["name"])
        blob = " ".join([d["name"]] + d["indications"] +
                        [x["label"] + " " + x["text"] for x in d["dosages"]])
        d["routes"] = guess_routes(blob)

        # Best default for a script: prefer an adult oral line.
        default = None
        for dose in d["dosages"]:
            label = dose["label"].lower()
            if "adult" in label or label == "":
                default = dose
                break
        default = default or (d["dosages"][0] if d["dosages"] else None)
        if default:
            display, exact = guess_strength(default["text"])
            d["default"] = {
                "strength": display,        # shown to the prescriber, may be a range
                "exact": exact,             # safe to prefill only when unambiguous
                "frequency": guess_frequency(default["text"]),
                "source": (default["label"] + ": " if default["label"] else "") + default["text"],
            }

        # Lower-cased haystack the client searches against.
        d["search"] = " ".join([d["name"].lower()] +
                               [i.lower() for i in d["indications"]])
    return drugs


def build_conditions(drugs):
    index = defaultdict(lambda: {"label": None, "drugs": []})
    for d in drugs:
        for ind in d["indications"]:
            key = norm_condition(ind)
            if not key or len(key) < 3:
                continue
            entry = index[key]
            if entry["label"] is None or len(ind) < len(entry["label"]):
                entry["label"] = ind
            if d["id"] not in entry["drugs"]:
                entry["drugs"].append(d["id"])

    conditions = [
        {"key": k, "label": v["label"], "drugs": sorted(v["drugs"])}
        for k, v in index.items()
    ]
    conditions.sort(key=lambda c: (-len(c["drugs"]), c["key"]))
    return conditions


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = sys.argv[1]
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(root, "data", "formulary.json")

    drugs = enrich(parse(src))
    drugs = [d for d in drugs if d["name"] and (d["indications"] or d["dosages"])]
    drugs.sort(key=lambda d: d["name"].lower())
    conditions = build_conditions(drugs)

    payload = {
        "version": 1,
        "source": os.path.basename(src),
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "drugCount": len(drugs),
        "conditionCount": len(conditions),
        "drugs": drugs,
        "conditions": conditions,
    }

    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))

    size = os.path.getsize(out) / 1024
    print(f"{len(drugs)} drugs, {len(conditions)} conditions -> {out} ({size:.0f} KB)")
    missing = [d["name"] for d in drugs if not d["dosages"]]
    if missing:
        print(f"  note: {len(missing)} without dosage lines, e.g. {missing[:5]}")


if __name__ == "__main__":
    main()
