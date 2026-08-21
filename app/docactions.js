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
export function actionButtons({ layout = "row" } = {}) {
  const share = html`
    <button class="btn btn--primary" data-act="doc-share">
      ${icon("share")} Share
      <span class="small" style="opacity:.75;font-weight:400">image</span>
    </button>`;
  const print = html`
    <button class="btn btn--outline" data-act="doc-print">
      ${icon("print")} PDF / Print
    </button>`;
  const copy = html`
    <button class="btn btn--ghost" data-act="doc-copy">
      ${icon("copy")} Copy text
    </button>`;

  if (layout === "stack") {
    return html`<div class="stack">${share}${print}${copy}</div>`;
  }
  return html`
    <div class="btn-row btn-row--split">${share}${print}</div>
    ${copy}
  `;
}

/** True when this act belongs to this module. */
export const isDocAction = (act) => act === "doc-share" || act === "doc-print" || act === "doc-copy";

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
          print: () => m.printCertificate({ patient, certificate: record }),
          text: () => m.certificateToText({ patient, certificate: record }),
          label: "Certificate",
        }))
      : await import("./script.js").then((m) => ({
          share: () => m.shareScript({ patient, prescription: record }),
          print: () => m.printScript({ patient, prescription: record }),
          text: () => m.scriptToText({ patient, prescription: record }),
          label: "Prescription",
        }));

  try {
    if (act === "doc-share") {
      const { outcome } = await modules.share();
      if (outcome === "shared") toast("Shared", "ok");
      else if (outcome === "downloaded") toast("Saved as an image — attach it to your message", "ok");
      // "cancelled" says nothing: the user dismissed the sheet on purpose.
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
