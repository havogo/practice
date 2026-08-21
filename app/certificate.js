// Medical certificates.
//
// The wording follows what the HPCSA expects a certificate to state: when the
// patient was seen, whether the practitioner observed the condition or is
// repeating what the patient reported, what the patient is capable of, and the
// exact period — with the nature of the illness given only where the patient
// has agreed to disclose it.

import { html, mount, formatDate, ageFrom, $ } from "./ui.js";
import * as store from "./store.js";
import { letterhead, letterFooter, signatureBlock, shareBlob, documentFilename } from "./script.js";

const CAPACITY_WORDING = {
  unfit: "unfit to attend work or school",
  "light-duties": "able to perform lighter duties only",
  fit: "fit to resume normal duties",
};

const TITLE = {
  "sick-leave": "MEDICAL CERTIFICATE",
  "fitness-to-work": "CERTIFICATE OF FITNESS TO WORK",
  "fitness-to-participate": "CERTIFICATE OF FITNESS TO PARTICIPATE",
  attendance: "CERTIFICATE OF ATTENDANCE",
};

export function conditionWording(certificate) {
  const condition = String(certificate.condition || "").trim();
  if (!certificate.disclose || !condition) return "a medical condition";
  // It lands mid-sentence, so "Acute gastroenteritis" should read "acute
  // gastroenteritis" — but an initialism like COVID-19 or TB keeps its case.
  const [first] = condition.split(/\s/);
  if (first === first.toUpperCase() && /[A-Z]/.test(first)) return condition;
  return condition[0].toLowerCase() + condition.slice(1);
}

/** The sentence that carries the clinical claim, assembled from the fields. */
export function statement(certificate, patient) {
  const name = store.patientName(patient);
  const seen = formatDate(certificate.examinedOn) || certificate.examinedOn;
  const time = certificate.examinedAt ? ` at ${certificate.examinedAt}` : "";
  // "I examined the patient … based on what they told me" contradicts itself,
  // so the opening verb has to follow the basis.
  const examined = certificate.basis === "examination";
  const opening = examined ? "I examined" : "I consulted with";
  const basis = examined
    ? "on my personal examination and observation"
    : "on information reported to me by the patient and not verified by examination";

  const days = store.certificateDays(certificate);
  const from = formatDate(certificate.fromDate) || certificate.fromDate;
  const to = formatDate(certificate.toDate) || certificate.toDate;
  const period =
    days === 1
      ? `on ${from}`
      : `from ${from} to ${to} (both dates inclusive)`;

  if (certificate.type === "attendance") {
    return `This is to certify that ${name} attended my rooms on ${seen}${time}.`;
  }

  if (certificate.type === "fitness-to-work" || certificate.capacity === "fit") {
    return (
      `This is to certify that ${opening} ${name} on ${seen}${time}. ` +
      `Based ${basis}, the patient is fit to resume normal duties with effect from ${from}.`
    );
  }

  return (
    `This is to certify that ${opening} ${name} on ${seen}${time}. ` +
    `Based ${basis}, the patient was suffering from ${conditionWording(certificate)} ` +
    `and was ${CAPACITY_WORDING[certificate.capacity] || CAPACITY_WORDING.unfit} ` +
    `${period}${days ? ` — ${days} day${days === 1 ? "" : "s"}` : ""}.`
  );
}

export function certificateMarkup({ prescriber, patient, certificate }) {
  const age = ageFrom(patient?.dob);
  return html`
    ${letterhead(prescriber)}

    <div class="script__rx-mark" style="text-align:center;letter-spacing:.08em">
      ${TITLE[certificate.type] || TITLE["sick-leave"]}
    </div>

    <div class="script__patient">
      <div class="script__field"><b>Patient:</b> ${store.patientName(patient)}</div>
      ${patient?.dob
        ? html`<div class="script__field"><b>Date of birth:</b> ${patient.dob}${
            age != null ? html` (${age} years)` : ""
          }</div>`
        : ""}
      ${patient?.idNumber ? html`<div class="script__field"><b>ID number:</b> ${patient.idNumber}</div>` : ""}
      ${certificate.employerRef
        ? html`<div class="script__field"><b>Employee number:</b> ${certificate.employerRef}</div>`
        : ""}
      <div class="script__field"><b>Date of examination:</b>
        ${formatDate(certificate.examinedOn) || certificate.examinedOn}${
          certificate.examinedAt ? html` at ${certificate.examinedAt}` : ""
        }
      </div>
    </div>

    <p style="margin-bottom:6mm;line-height:1.7">${statement(certificate, patient)}</p>

    ${!certificate.disclose
      ? html`<p class="script__meta" style="margin-bottom:4mm">
          The nature of the condition is withheld at the patient's request.
        </p>`
      : ""}

    ${certificate.remarks
      ? html`<p style="margin-bottom:6mm"><b>Remarks:</b> ${certificate.remarks}</p>`
      : ""}

    ${signatureBlock(prescriber, certificate.date)}
    ${letterFooter(prescriber)}
  `;
}

export async function printCertificate({ patient, certificate }) {
  const prescriber = await store.getPrescriber();
  mount($("#print-root"), certificateMarkup({ prescriber, patient, certificate }));
  await new Promise((resolve) => setTimeout(resolve, 60));
  window.print();
}

// ---------------------------------------------------------------------------
// Canvas rendering, so the certificate can go through the iOS share sheet
// ---------------------------------------------------------------------------

const PAGE = { w: 1240, h: 1754, margin: 96 };

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

const FOOTER_ZONE = 136;
const SIGNATURE_GAP = 70;

/** Draw the certificate, or measure it. See layoutScript in script.js. */
function layoutCertificate(ctx, { prescriber, patient, certificate, signature, pageHeight, draw }) {
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

  const write = (text, { size = 24, weight = "400", align = "left", style = "normal", gap = 8, lineGap = 8 } = {}) => {
    ctx.font = `${style} ${weight} ${size}px ${serif}`;
    ctx.textAlign = align;
    const x = align === "center" ? centre : left;
    for (const line of wrapText(ctx, text, width)) {
      y += size;
      if (draw) ctx.fillText(line, x, y);
      y += lineGap;
    }
    y += gap - lineGap;
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

  write(prescriber.name, { size: 40, weight: "700", align: "center", gap: 4, lineGap: 4 });
  if (prescriber.qualifications) write(prescriber.qualifications, { size: 22, align: "center", gap: 2, lineGap: 2 });
  if (prescriber.title) write(prescriber.title, { size: 22, align: "center", style: "italic", gap: 6, lineGap: 2 });
  if (prescriber.hpcsa) write(`HPCSA Registration: ${prescriber.hpcsa}`, { size: 20, align: "center", gap: 2, lineGap: 2 });
  if (prescriber.practiceNumber) write(`Practice Number: ${prescriber.practiceNumber}`, { size: 20, align: "center" });

  y += 26;
  rule(left, right, 2);
  y += 40;

  write(TITLE[certificate.type] || TITLE["sick-leave"], { size: 30, weight: "700", align: "center", gap: 28 });

  write(`Patient:  ${store.patientName(patient)}`, { size: 24, weight: "600", gap: 6 });
  if (patient?.dob) write(`Date of birth:  ${patient.dob}`, { size: 21, gap: 4 });
  if (patient?.idNumber) write(`ID number:  ${patient.idNumber}`, { size: 21, gap: 4 });
  if (certificate.employerRef) write(`Employee number:  ${certificate.employerRef}`, { size: 21, gap: 4 });
  write(
    `Date of examination:  ${formatDate(certificate.examinedOn) || certificate.examinedOn}` +
      (certificate.examinedAt ? ` at ${certificate.examinedAt}` : ""),
    { size: 21, gap: 26 }
  );

  write(statement(certificate, patient), { size: 23, gap: 18, lineGap: 12 });

  if (!certificate.disclose) {
    write("The nature of the condition is withheld at the patient's request.", {
      size: 19,
      style: "italic",
      gap: 14,
    });
  }
  if (certificate.remarks) write(`Remarks: ${certificate.remarks}`, { size: 21, gap: 14, lineGap: 10 });

  const bodyBottom = y;

  // Never clamped upward — the page grows instead, so the signature can never
  // be stamped across the certificate's own wording.
  const signatureHeight = (signature ? signature.height : 0) + 21 + 10 + 44 + 4 + 20 + 19 + 8;
  y = Math.max(bodyBottom + SIGNATURE_GAP, pageHeight - FOOTER_ZONE - signatureHeight);

  write(formatDate(certificate.date) || certificate.date, { size: 21, gap: 10 });

  if (signature && draw) ctx.drawImage(signature.img, left, y, signature.width, signature.height);
  if (signature) y += signature.height;

  y += 44;
  rule(left, left + 360, 1.5);
  y += 4;
  write(prescriber.name, { size: 20, gap: 0, lineGap: 2 });
  write("Signature", { size: 19 });

  if (draw) {
    const footerText = [prescriber.addressLine, prescriber.postalLine, prescriber.email, prescriber.phone]
      .filter(Boolean)
      .join(" | ");
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

  return { bodyBottom, signatureHeight };
}

export async function certificateToCanvas({ patient, certificate }) {
  const prescriber = await store.getPrescriber();

  let signature = null;
  if (prescriber.signatureImage) {
    try {
      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = prescriber.signatureImage;
      });
      const height = Math.min(90, img.height);
      signature = { img, height, width: (img.width / img.height) * height };
    } catch {
      /* a broken signature must not stop the certificate rendering */
    }
  }

  const probe = document.createElement("canvas").getContext("2d");
  const measured = layoutCertificate(probe, {
    prescriber, patient, certificate, signature, pageHeight: PAGE.h, draw: false,
  });
  const needed = measured.bodyBottom + SIGNATURE_GAP + measured.signatureHeight + FOOTER_ZONE;
  const pageHeight = Math.max(PAGE.h, Math.ceil(needed));

  const canvas = document.createElement("canvas");
  canvas.width = PAGE.w;
  canvas.height = pageHeight;
  layoutCertificate(canvas.getContext("2d"), {
    prescriber, patient, certificate, signature, pageHeight, draw: true,
  });
  return canvas;
}

export async function certificateToBlob({ patient, certificate }) {
  const canvas = await certificateToCanvas({ patient, certificate });
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

export async function certificateToPdf({ patient, certificate }) {
  const canvas = await certificateToCanvas({ patient, certificate });
  const { canvasToPdf } = await import("./pdf.js");
  return canvasToPdf(canvas);
}

export async function shareCertificatePdf({ patient, certificate }) {
  const blob = await certificateToPdf({ patient, certificate });
  return shareBlob({
    blob,
    filename: documentFilename({ prefix: "Certificate", patient, date: certificate.date, extension: "pdf" }),
    title: `Medical certificate — ${store.patientName(patient)}`,
  });
}

export async function shareCertificate({ patient, certificate }) {
  const blob = await certificateToBlob({ patient, certificate });
  return shareBlob({
    blob,
    filename: documentFilename({ prefix: "Certificate", patient, date: certificate.date }),
    title: `Medical certificate — ${store.patientName(patient)}`,
  });
}

/**
 * Plain text, for pasting into a message.
 *
 * `clinicalNote` is deliberately absent, as it is from the printed page and the
 * shared image — it is the practitioner's own record, not the patient's copy.
 */
export async function certificateToText({ patient, certificate }) {
  const prescriber = await store.getPrescriber();
  return [
    prescriber.name,
    prescriber.qualifications,
    prescriber.hpcsa ? `HPCSA: ${prescriber.hpcsa}` : null,
    "",
    TITLE[certificate.type] || TITLE["sick-leave"],
    "",
    `Patient: ${store.patientName(patient)}`,
    patient?.dob ? `Date of birth: ${patient.dob}` : null,
    certificate.employerRef ? `Employee number: ${certificate.employerRef}` : null,
    "",
    statement(certificate, patient),
    certificate.remarks ? `\nRemarks: ${certificate.remarks}` : null,
    "",
    formatDate(certificate.date) || certificate.date,
    prescriber.name,
  ].filter((line) => line !== null).join("\n");
}
