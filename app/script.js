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

export async function scriptToBlob({ patient, prescription }) {
  const prescriber = await store.getPrescriber();
  const canvas = document.createElement("canvas");
  canvas.width = PAGE.w;
  canvas.height = PAGE.h;
  const ctx = canvas.getContext("2d");

  const serif = '"Iowan Old Style", Palatino, Georgia, serif';
  const left = PAGE.margin;
  const right = PAGE.w - PAGE.margin;
  const width = right - left;
  const centre = PAGE.w / 2;
  let y = PAGE.margin;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PAGE.w, PAGE.h);
  ctx.fillStyle = "#000000";
  ctx.textBaseline = "alphabetic";

  const write = (text, { size = 24, weight = "400", align = "left", style = "normal", gap = 8 } = {}) => {
    ctx.font = `${style} ${weight} ${size}px ${serif}`;
    ctx.textAlign = align;
    const x = align === "center" ? centre : left;
    for (const line of wrapText(ctx, text, width)) {
      y += size;
      ctx.fillText(line, x, y);
      y += gap;
    }
  };

  write(prescriber.name, { size: 40, weight: "700", align: "center", gap: 4 });
  if (prescriber.qualifications) write(prescriber.qualifications, { size: 22, align: "center", gap: 2 });
  if (prescriber.title) write(prescriber.title, { size: 22, align: "center", style: "italic", gap: 6 });
  if (prescriber.hpcsa) write(`HPCSA Registration: ${prescriber.hpcsa}`, { size: 20, align: "center", gap: 2 });
  if (prescriber.practiceNumber) write(`Practice Number: ${prescriber.practiceNumber}`, { size: 20, align: "center" });

  y += 28;
  ctx.beginPath();
  ctx.moveTo(left, y);
  ctx.lineTo(right, y);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#000";
  ctx.stroke();
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
    if (sub) {
      ctx.font = `400 20px ${serif}`;
      ctx.textAlign = "left";
      for (const line of wrapText(ctx, sub, width - 40)) {
        y += 22;
        ctx.fillText(line, left + 40, y);
        y += 2;
      }
    }
    y += 20;
  }

  if (prescription.notes) {
    y += 10;
    write(prescription.notes, { size: 20, style: "italic" });
  }

  // The signature follows the last item, but never runs into the footer.
  const footerY = PAGE.h - PAGE.margin;
  y = Math.min(y + 80, footerY - 200);
  write(formatDate(prescription.issuedAt) || prescription.issuedAt, { size: 22, gap: 10 });

  if (prescriber.signatureImage) {
    try {
      const img = await loadImage(prescriber.signatureImage);
      const h = Math.min(90, img.height);
      const w = (img.width / img.height) * h;
      ctx.drawImage(img, left, y, w, h);
      y += h;
    } catch {
      /* a broken signature must not stop the script rendering */
    }
  }

  y += 46;
  ctx.beginPath();
  ctx.moveTo(left, y);
  ctx.lineTo(left + 360, y);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  y += 6;
  write("Signature", { size: 20 });

  const footerText = [prescriber.addressLine, prescriber.postalLine, prescriber.email, prescriber.phone]
    .filter(Boolean)
    .join(" | ");
  ctx.beginPath();
  ctx.moveTo(left, footerY - 40);
  ctx.lineTo(right, footerY - 40);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.font = `400 17px ${serif}`;
  ctx.textAlign = "center";
  const footerLines = wrapText(ctx, footerText, width);
  let fy = footerY - 40 + 24;
  for (const line of footerLines) {
    ctx.fillText(line, centre, fy);
    fy += 21;
  }

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export function scriptFilename({ patient, prescription }) {
  const name = store.patientName(patient).replace(/[^\w]+/g, "-").replace(/^-|-$/g, "");
  return `Rx-${name}-${prescription.issuedAt}.png`;
}

/**
 * Hand the script to the operating system. Falls back to a download when the
 * browser cannot share files (desktop Safari, Firefox).
 */
export async function shareScript({ patient, prescription }) {
  const blob = await scriptToBlob({ patient, prescription });
  const file = new File([blob], scriptFilename({ patient, prescription }), { type: "image/png" });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: `Prescription — ${store.patientName(patient)}`,
      });
      return { shared: true };
    } catch (err) {
      if (err?.name === "AbortError") return { shared: false, cancelled: true };
      // fall through to download
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { shared: false, downloaded: true };
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
