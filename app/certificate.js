// Medical certificates.
//
// The wording follows what the HPCSA expects a certificate to state: when the
// patient was seen, whether the practitioner observed the condition or is
// repeating what the patient reported, what the patient is capable of, and the
// exact period — with the nature of the illness given only where the patient
// has agreed to disclose it.

import { html, mount, formatDate, ageFrom, $ } from "./ui.js";
import * as store from "./store.js";
import { letterhead, letterFooter, signatureBlock } from "./script.js";

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

export async function certificateToBlob({ patient, certificate }) {
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

  const write = (text, { size = 24, weight = "400", align = "left", style = "normal", gap = 8, lineGap = 8 } = {}) => {
    ctx.font = `${style} ${weight} ${size}px ${serif}`;
    ctx.textAlign = align;
    const x = align === "center" ? centre : left;
    for (const line of wrapText(ctx, text, width)) {
      y += size;
      ctx.fillText(line, x, y);
      y += lineGap;
    }
    y += gap - lineGap;
  };

  write(prescriber.name, { size: 40, weight: "700", align: "center", gap: 4, lineGap: 4 });
  if (prescriber.qualifications) write(prescriber.qualifications, { size: 22, align: "center", gap: 2, lineGap: 2 });
  if (prescriber.title) write(prescriber.title, { size: 22, align: "center", style: "italic", gap: 6, lineGap: 2 });
  if (prescriber.hpcsa) write(`HPCSA Registration: ${prescriber.hpcsa}`, { size: 20, align: "center", gap: 2, lineGap: 2 });
  if (prescriber.practiceNumber) write(`Practice Number: ${prescriber.practiceNumber}`, { size: 20, align: "center" });

  y += 26;
  ctx.beginPath();
  ctx.moveTo(left, y);
  ctx.lineTo(right, y);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#000";
  ctx.stroke();
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

  const footerY = PAGE.h - PAGE.margin;
  y = Math.min(y + 70, footerY - 210);
  write(formatDate(certificate.date) || certificate.date, { size: 21, gap: 10 });

  if (prescriber.signatureImage) {
    try {
      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = prescriber.signatureImage;
      });
      const h = Math.min(90, img.height);
      ctx.drawImage(img, left, y, (img.width / img.height) * h, h);
      y += h;
    } catch {
      /* a broken signature must not stop the certificate rendering */
    }
  }

  y += 44;
  ctx.beginPath();
  ctx.moveTo(left, y);
  ctx.lineTo(left + 360, y);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  y += 4;
  write(prescriber.name, { size: 20, gap: 0, lineGap: 2 });
  write("Signature", { size: 19 });

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
  let fy = footerY - 16;
  for (const line of wrapText(ctx, footerText, width)) {
    ctx.fillText(line, centre, fy);
    fy += 21;
  }

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

export async function shareCertificate({ patient, certificate }) {
  const blob = await certificateToBlob({ patient, certificate });
  const name = `Certificate-${store.patientName(patient).replace(/[^\w]+/g, "-")}-${certificate.date}.png`;
  const file = new File([blob], name, { type: "image/png" });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `Medical certificate — ${store.patientName(patient)}` });
      return { shared: true };
    } catch (err) {
      if (err?.name === "AbortError") return { shared: false, cancelled: true };
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { shared: false, downloaded: true };
}
