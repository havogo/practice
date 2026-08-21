// Getting a finished document out of the app.
//
// One implementation, used by the prescription screen, the certificate screen
// and the history list, so the three ways out of the app behave identically
// wherever you are.
//
// The three ways out are deliberately distinct, because they are not
// interchangeable:
//
//   Share    an image, through the operating system's share sheet. This is the
//            WhatsApp path, which is how a script actually reaches a pharmacy
//            here. iOS accepts a PNG through the sheet reliably and is
//            inconsistent with PDFs, so no attempt is made to force one.
//   PDF      the browser's own print dialogue, where "Save to Files" produces a
//            true A4 PDF. Better fidelity, more taps, no share sheet.
//   Copy     plain text, for typing into a message or a note.

import { html, toast } from "./ui.js";
import { icon } from "./icons.js";

/**
 * The three buttons. `layout: "row"` is the full-width version for a document
 * screen; "stack" is for inside a sheet.
 */
export function actionButtons({ layout = "row", preview = true } = {}) {
  const sharePdf = html`
    <button class="btn btn--primary" data-act="doc-share-pdf">
      ${icon("share")} Share PDF
    </button>`;
  const shareImage = html`
    <button class="btn btn--outline" data-act="doc-share">
      ${icon("share")} Share image
    </button>`;
  const print = html`
    <button class="btn btn--ghost" data-act="doc-print">${icon("print")} Print</button>`;
  const copy = html`
    <button class="btn btn--ghost" data-act="doc-copy">${icon("copy")} Copy text</button>`;
  const preview_ = html`
    <button class="btn btn--secondary btn--block" data-act="doc-preview">
      ${icon("search")} Preview it
    </button>`;

  if (layout === "stack") {
    return html`<div class="stack">
      ${preview ? preview_ : ""}${sharePdf}${shareImage}${print}${copy}
    </div>`;
  }
  return html`
    ${preview ? html`${preview_}<div style="height:8px"></div>` : ""}
    <div class="btn-row btn-row--split">${sharePdf}${shareImage}</div>
    <div class="btn-row btn-row--split">${print}${copy}</div>
  `;
}

const DOC_ACTIONS = ["doc-share", "doc-share-pdf", "doc-print", "doc-copy", "doc-preview"];

/** True when this act belongs to this module. */
export const isDocAction = (act) => DOC_ACTIONS.includes(act);

/**
 * Run one of the three. `kind` is "prescription" or "certificate"; `record` is
 * the document itself. Returns true if it handled the action.
 */
export async function runDocAction(act, { kind, patient, record }) {
  if (!isDocAction(act)) return false;
  if (!patient || !record) {
    toast("Choose a patient first", "error");
    return true;
  }

  const modules =
    kind === "certificate"
      ? await import("./certificate.js").then((m) => ({
          share: () => m.shareCertificate({ patient, certificate: record }),
          sharePdf: () => m.shareCertificatePdf({ patient, certificate: record }),
          print: () => m.printCertificate({ patient, certificate: record }),
          text: () => m.certificateToText({ patient, certificate: record }),
          canvas: () => m.certificateToCanvas({ patient, certificate: record }),
          label: "Certificate",
        }))
      : await import("./script.js").then((m) => ({
          share: () => m.shareScript({ patient, prescription: record }),
          sharePdf: () => m.shareScriptPdf({ patient, prescription: record }),
          print: () => m.printScript({ patient, prescription: record }),
          text: () => m.scriptToText({ patient, prescription: record }),
          canvas: () => m.scriptToCanvas({ patient, prescription: record }),
          label: "Prescription",
        }));

  const reportShare = ({ outcome }, what) => {
    if (outcome === "shared") toast("Shared", "ok");
    else if (outcome === "downloaded") toast(`Saved as a ${what} — attach it to your message`, "ok");
    // "cancelled" says nothing: the sheet was dismissed on purpose.
  };

  try {
    if (act === "doc-preview") {
      await previewDocument(modules, { kind, patient, record });
    } else if (act === "doc-share") {
      reportShare(await modules.share(), "image");
    } else if (act === "doc-share-pdf") {
      toast("Making the PDF…");
      reportShare(await modules.sharePdf(), "PDF");
    } else if (act === "doc-print") {
      await modules.print();
    } else if (act === "doc-copy") {
      const text = await modules.text();
      await navigator.clipboard.writeText(text);
      toast(`${modules.label} copied`, "ok");
    }
  } catch (err) {
    console.error("[docaction]", act, err);
    toast(String(err?.message || err), "error");
  }
  return true;
}

/**
 * Show the document exactly as it will be sent.
 *
 * The preview is the same canvas render the share and PDF paths use, not a
 * second approximation of it — so what is checked here is what goes out.
 */
async function previewDocument(modules, { kind, patient, record }) {
  const { sheet } = await import("./components.js");
  const canvas = await modules.canvas();
  const url = canvas.toDataURL("image/jpeg", 0.85);

  await sheet({
    title: kind === "certificate" ? "Certificate preview" : "Prescription preview",
    body: html`
      <img src="${url}" alt="The document as it will be sent"
        style="width:100%;display:block;border:1px solid var(--line);border-radius:8px;background:#fff">
      <p class="small muted" style="margin-top:12px">
        This is exactly what is shared or printed${
          canvas.height > 1754 ? ", across more than one page" : ""
        }.
      </p>
      <div style="margin-top:16px">${actionButtons({ layout: "stack", preview: false })}</div>
    `,
    onMount(root, close) {
      root.addEventListener("click", async (event) => {
        const el = event.target.closest("[data-act]");
        if (!el) return;
        close(null);
        await runDocAction(el.dataset.act, { kind, patient, record });
      });
    },
  });
}

/**
 * The same three actions in a sheet, for places that list documents rather than
 * showing one — the history list, where a row has no room for a button row.
 */
export async function documentActionSheet({ kind, patient, record, title }) {
  const { sheet } = await import("./components.js");
  await sheet({
    title: title || "Send this",
    body: html`
      ${actionButtons({ layout: "stack" })}
      <p class="small muted" style="margin-top:16px">
        <b>Share</b> sends an image through the share sheet — the reliable way to reach
        WhatsApp. <b>PDF / Print</b> opens the print dialogue, where “Save to Files” gives
        a true A4 PDF.
      </p>
    `,
    onMount(root, close) {
      root.addEventListener("click", async (event) => {
        const el = event.target.closest("[data-act]");
        if (!el) return;
        // Printing replaces the page for the print dialogue, so the sheet has
        // to be out of the way before it runs.
        if (el.dataset.act === "doc-print") close(null);
        await runDocAction(el.dataset.act, { kind, patient, record });
        if (el.dataset.act !== "doc-print") close(null);
      });
    },
  });
}
