// Rendering a prescription for the outside world.
//
// Two outputs, because the phone and the printer want different things:
//   printScript()  – A4 via the browser's own print pipeline (Save to Files → PDF)
//   shareScript()  – an image drawn on a canvas, which is what iOS can hand to
//                    WhatsApp or Mail through the native share sheet.

import { html, mount, formatDate, ageFrom, $ } from "./ui.js";
import * as store from "./store.js";

/** One prescription line rendered the way it should read on paper. */
export function itemLine(item) {
  const head = [item.name, item.strength].filter(Boolean).join(" ");
  const tail = [item.dose, item.frequency, item.duration].filter(Boolean).join(" ");
  const qty = item.quantity ? `(${item.quantity})` : "";
  return [head, tail && `— ${tail}`, qty].filter(Boolean).join(" ");
}

export function itemSubLine(item) {
  const parts = [];
  if (item.instructions) parts.push(item.instructions);
  if (Number(item.repeats) > 0) parts.push(`Repeat × ${item.repeats}`);
  return parts.join("  ·  ");
}

function patientLabel(patient) {
  const age = ageFrom(patient?.dob);
  return [store.patientName(patient), age != null ? `${age} yrs` : null].filter(Boolean).join(", ");
}

// ---------------------------------------------------------------------------
// Print
// ---------------------------------------------------------------------------

/** The letterhead, shared by every document the practice puts on paper. */
export function letterhead(prescriber) {
  return html`
    <div class="script__header">
      <div class="script__name">${prescriber.name}</div>
      ${prescriber.qualifications ? html`<div class="script__quals">${prescriber.qualifications}</div>` : ""}
      ${prescriber.title ? html`<div class="script__role">${prescriber.title}</div>` : ""}
      <div class="script__reg">
        ${prescriber.hpcsa ? html`HPCSA Registration: ${prescriber.hpcsa}` : ""}
        ${prescriber.hpcsa && prescriber.practiceNumber ? html`<br>` : ""}
        ${prescriber.practiceNumber ? html`Practice Number: ${prescriber.practiceNumber}` : ""}
      </div>
    </div>
    <hr class="script__rule">
  `;
}

export function letterFooter(prescriber) {
  const line = [prescriber.addressLine, prescriber.postalLine, prescriber.email, prescriber.phone]
    .filter(Boolean)
    .join(" | ");
  return html`<div class="script__footer">${line}</div>`;
}

export function signatureBlock(prescriber, dateValue) {
  return html`
    <div class="script__sign">
      <div class="script__meta">${formatDate(dateValue) || dateValue}</div>
      ${prescriber.signatureImage
        ? html`<img class="script__sig-img" src="${prescriber.signatureImage}" alt="">`
        : ""}
      <div class="script__sign-line"></div>
      <div class="script__sign-label">${prescriber.name}<br>Signature</div>
    </div>
  `;
}

export function scriptMarkup({ prescriber, patient, prescription }) {
  return html`
    ${letterhead(prescriber)}

    <div class="script__patient">
      <div class="script__field"><b>Re:</b> ${store.patientName(patient)}</div>
      ${patient?.dob ? html`<div class="script__field"><b>DOB:</b> ${patient.dob}</div>` : ""}
      ${patient?.idNumber ? html`<div class="script__field"><b>ID:</b> ${patient.idNumber}</div>` : ""}
      ${prescription.diagnosis
        ? html`<div class="script__field"><b>Diagnosis:</b> ${prescription.diagnosis}${
            prescription.icd10 ? html` (${prescription.icd10})` : ""
          }</div>`
        : ""}
    </div>

    <div class="script__rx-mark">Rx :</div>

    <ul class="script__items">
      ${prescription.items.map(
        (item) => html`
          <li class="script__item">
            <div class="script__item-line">${itemLine(item)}</div>
            ${itemSubLine(item) ? html`<div class="script__item-sub">${itemSubLine(item)}</div>` : ""}
          </li>
        `
      )}
    </ul>

    ${prescription.notes ? html`<div class="script__meta">${prescription.notes}</div>` : ""}

    ${signatureBlock(prescriber, prescription.issuedAt)}
    ${letterFooter(prescriber)}
  `;
}

/** Render into the dedicated print root and hand off to the browser. */
export async function printScript({ patient, prescription }) {
  const prescriber = await store.getPrescriber();
  const root = $("#print-root");
  mount(root, scriptMarkup({ prescriber, patient, prescription }));
  // Let layout settle before the print dialog snapshots the page.
  await new Promise((resolve) => setTimeout(resolve, 60));
  window.print();
}

// ---------------------------------------------------------------------------
// Canvas → PNG → native share sheet
// ---------------------------------------------------------------------------

const PAGE = { w: 1240, h: 1754, margin: 96 }; // A4 at ~150dpi

function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const FOOTER_ZONE = 136;   // rule, address lines, bottom margin
const SIGNATURE_GAP = 80;  // clear space between the last medicine and the date

/**
 * Draw the script, or measure it without drawing.
 *
 * One routine for both passes so the measurement can never drift from what is
 * actually rendered. Returns where the body ended and how tall the signature
 * block is, which is what decides the page height.
 */
function layoutScript(ctx, { prescriber, patient, prescription, signature, pageHeight, draw }) {
  const serif = '"Iowan Old Style", Palatino, Georgia, serif';
  const left = PAGE.margin;
  const right = PAGE.w - PAGE.margin;
  const width = right - left;
  const centre = PAGE.w / 2;
  let y = PAGE.margin;

  if (draw) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, PAGE.w, pageHeight);
    ctx.fillStyle = "#000000";
    ctx.textBaseline = "alphabetic";
  }

  const write = (text, { size = 24, weight = "400", align = "left", style = "normal", gap = 8, indent = 0 } = {}) => {
    ctx.font = `${style} ${weight} ${size}px ${serif}`;
    ctx.textAlign = align;
    const x = align === "center" ? centre : left + indent;
    for (const line of wrapText(ctx, text, width - indent)) {
      y += size;
      if (draw) ctx.fillText(line, x, y);
      y += gap;
    }
  };

  const rule = (from, to, thickness) => {
    if (!draw) return;
    ctx.beginPath();
    ctx.moveTo(from, y);
    ctx.lineTo(to, y);
    ctx.lineWidth = thickness;
    ctx.strokeStyle = "#000";
    ctx.stroke();
  };

  write(prescriber.name, { size: 40, weight: "700", align: "center", gap: 4 });
  if (prescriber.qualifications) write(prescriber.qualifications, { size: 22, align: "center", gap: 2 });
  if (prescriber.title) write(prescriber.title, { size: 22, align: "center", style: "italic", gap: 6 });
  if (prescriber.hpcsa) write(`HPCSA Registration: ${prescriber.hpcsa}`, { size: 20, align: "center", gap: 2 });
  if (prescriber.practiceNumber) write(`Practice Number: ${prescriber.practiceNumber}`, { size: 20, align: "center" });

  y += 28;
  rule(left, right, 2);
  y += 34;

  write(`Re:  ${patientLabel(patient)}`, { size: 26, weight: "600", gap: 6 });
  if (patient?.dob) write(`DOB: ${patient.dob}`, { size: 22, gap: 4 });
  if (prescription.diagnosis) {
    write(`Diagnosis: ${prescription.diagnosis}${prescription.icd10 ? ` (${prescription.icd10})` : ""}`, { size: 22 });
  }

  y += 30;
  write("Rx :", { size: 34, weight: "700", gap: 14 });

  for (const item of prescription.items) {
    write(itemLine(item), { size: 26, gap: 4 });
    const sub = itemSubLine(item);
    if (sub) write(sub, { size: 20, gap: 2, indent: 40 });
    y += 20;
  }

  if (prescription.notes) {
    y += 10;
    write(prescription.notes, { size: 20, style: "italic" });
  }

  const bodyBottom = y;

  // The signature sits at the foot of the page when the script is short, and
  // directly under the last medicine when it is long. It is never pulled back
  // up over the content — the page grows instead.
  const signatureHeight = (signature ? signature.height + 8 : 0) + 22 + 10 + 46 + 6 + 20 + 8;
  const restingTop = pageHeight - FOOTER_ZONE - signatureHeight;
  y = Math.max(bodyBottom + SIGNATURE_GAP, restingTop);

  write(formatDate(prescription.issuedAt) || prescription.issuedAt, { size: 22, gap: 10 });

  if (signature && draw) {
    ctx.drawImage(signature.img, left, y, signature.width, signature.height);
  }
  if (signature) y += signature.height + 8;

  y += 46;
  rule(left, left + 360, 1.5);
  y += 6;
  write("Signature", { size: 20 });

  // The footer is pinned to the bottom of whatever the page turned out to be.
  const footerText = [prescriber.addressLine, prescriber.postalLine, prescriber.email, prescriber.phone]
    .filter(Boolean)
    .join(" | ");
  if (draw) {
    const footerRuleY = pageHeight - PAGE.margin - 40;
    ctx.beginPath();
    ctx.moveTo(left, footerRuleY);
    ctx.lineTo(right, footerRuleY);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#000";
    ctx.stroke();
    ctx.font = `400 17px ${serif}`;
    ctx.textAlign = "center";
    let fy = footerRuleY + 24;
    for (const line of wrapText(ctx, footerText, width)) {
      ctx.fillText(line, centre, fy);
      fy += 21;
    }
  }

  return { bodyBottom, signatureHeight, contentBottom: y };
}

/**
 * Render the script to an image.
 *
 * Measured first, then drawn. A script with enough medicines to fill the page
 * used to have its signature block clamped upward to keep it above the footer,
 * which stamped the signature across the last medicines — on a document that
 * gets signed and dispensed. The page now extends instead, so the layout can
 * always be honoured.
 */
export async function scriptToCanvas({ patient, prescription }) {
  const prescriber = await store.getPrescriber();

  let signature = null;
  if (prescriber.signatureImage) {
    try {
      const img = await loadImage(prescriber.signatureImage);
      const height = Math.min(90, img.height);
      signature = { img, height, width: (img.width / img.height) * height };
    } catch {
      /* a broken signature must not stop the script rendering */
    }
  }

  const probe = document.createElement("canvas").getContext("2d");
  const measured = layoutScript(probe, {
    prescriber, patient, prescription, signature, pageHeight: PAGE.h, draw: false,
  });

  const needed = measured.bodyBottom + SIGNATURE_GAP + measured.signatureHeight + FOOTER_ZONE;
  const pageHeight = Math.max(PAGE.h, Math.ceil(needed));

  const canvas = document.createElement("canvas");
  canvas.width = PAGE.w;
  canvas.height = pageHeight;
  layoutScript(canvas.getContext("2d"), {
    prescriber, patient, prescription, signature, pageHeight, draw: true,
  });

  return canvas;
}

export async function scriptToBlob({ patient, prescription, type = "image/png", quality } = {}) {
  const canvas = await scriptToCanvas({ patient, prescription });
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** A true PDF, paginated onto A4 sheets when the script runs long. */
export async function scriptToPdf({ patient, prescription }) {
  const canvas = await scriptToCanvas({ patient, prescription });
  const { canvasToPdf } = await import("./pdf.js");
  return canvasToPdf(canvas);
}

export async function shareScriptPdf({ patient, prescription }) {
  const blob = await scriptToPdf({ patient, prescription });
  return shareBlob({
    blob,
    filename: documentFilename({ prefix: "Rx", patient, date: prescription.issuedAt, extension: "pdf" }),
    title: `Prescription — ${store.patientName(patient)}`,
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * A filename a pharmacist can read at a glance in a WhatsApp thread, rather
 * than the slug-with-hyphens a download would otherwise get. Only the
 * characters a filesystem genuinely objects to are stripped.
 */
export function documentFilename({ prefix, patient, date, extension = "png" }) {
  const name = store.patientName(patient).replace(/[\\/:*?"<>|]+/g, "").trim();
  return `${prefix} – ${name} – ${date}.${extension}`;
}

export function scriptFilename({ patient, prescription }) {
  return documentFilename({ prefix: "Rx", patient, date: prescription.issuedAt });
}

/**
 * Hand the script to the operating system as an image.
 *
 * An image rather than a PDF is deliberate: WhatsApp on iOS reliably accepts a
 * PNG through the share sheet and is inconsistent with PDFs, and WhatsApp is
 * how a script actually reaches a pharmacy here. The PDF path is the print
 * dialog, offered separately.
 *
 * Resolves to { outcome } — "shared", "cancelled", "downloaded" — so the caller
 * can say something accurate rather than guessing.
 */
export async function shareScript({ patient, prescription }) {
  const blob = await scriptToBlob({ patient, prescription });
  return shareBlob({
    blob,
    filename: scriptFilename({ patient, prescription }),
    title: `Prescription — ${store.patientName(patient)}`,
  });
}

/** Shared by prescriptions and certificates. */
export async function shareBlob({ blob, filename, title }) {
  const file = new File([blob], filename, { type: blob.type || "image/png" });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return { outcome: "shared" };
    } catch (err) {
      // A dismissed share sheet is a decision, not a failure — do not then
      // dump a file into Downloads that was never asked for.
      if (err?.name === "AbortError") return { outcome: "cancelled" };
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { outcome: "downloaded" };
}

/** Plain-text version, handy for pasting into a message. */
export async function scriptToText({ patient, prescription }) {
  const prescriber = await store.getPrescriber();
  const lines = [
    prescriber.name,
    prescriber.qualifications,
    prescriber.hpcsa ? `HPCSA: ${prescriber.hpcsa}` : null,
    prescriber.practiceNumber ? `Practice no: ${prescriber.practiceNumber}` : null,
    "",
    `Re: ${patientLabel(patient)}`,
    patient?.dob ? `DOB: ${patient.dob}` : null,
    "",
    "Rx:",
    ...prescription.items.flatMap((item) => {
      const sub = itemSubLine(item);
      return sub ? [`  ${itemLine(item)}`, `      ${sub}`] : [`  ${itemLine(item)}`];
    }),
    "",
    formatDate(prescription.issuedAt) || prescription.issuedAt,
    prescriber.name,
  ];
  return lines.filter((l) => l !== null).join("\n");
}
