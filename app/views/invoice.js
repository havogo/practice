// A single invoice: line items, total, and a printable version.

import { html, mount, toast, confirmDialog, formatDate, money, parseMoney, isoDate, uid } from "../ui.js";
import { icon } from "../icons.js";
import * as store from "../store.js";
import * as router from "../router.js";

export async function view(ctx) {
  const invoice = await store.invoices.get(ctx.params.id);
  if (!invoice) {
    return { title: "Invoice", back: "/billing", largeTitle: true,
      content: html`<p class="muted">This invoice no longer exists.</p>` };
  }
  const patient = invoice.patientId ? await store.patients.get(invoice.patientId) : null;
  const prefs = await store.getPreferences();
  const draft = structuredClone(invoice);

  return {
    title: draft.number || "Invoice",
    back: "/billing",
    action: { label: "Save", act: "save" },
    content: html`<div id="inv-root">${body(draft, patient, prefs)}</div>`,
    mount(root) {
      const canvas = root.querySelector("#inv-root");

      const redraw = () => {
        mount(canvas, body(draft, patient, prefs));
        bind();
      };

      function bind() {
        canvas.querySelectorAll("[data-field]").forEach((el) => {
          el.addEventListener("input", () => {
            const { field, lineId } = el.dataset;
            if (lineId) {
              const line = draft.lines.find((l) => l.id === lineId);
              if (!line) return;
              line[field] = field === "amount" ? parseMoney(el.value) : el.value;
              if (field === "amount") line.amountCents = line.amount;
              updateTotal();
            } else {
              draft[field] = el.value;
            }
          });
        });
      }

      function updateTotal() {
        const el = canvas.querySelector("#inv-total");
        if (el) el.textContent = money(store.invoiceTotal(draft), prefs.currency);
      }

      const persist = async () => {
        draft.totalCents = store.invoiceTotal(draft);
        const saved = await store.invoices.save(draft);
        draft.rev = saved.rev;
        return saved;
      };

      root.addEventListener("action", async ({ detail: { act, el } }) => {
        if (act === "add-line") {
          draft.lines.push({ id: uid("ln"), code: "", description: "", qty: 1, amountCents: 0 });
          redraw();
          canvas.querySelector(".rx-item:last-of-type [data-field='description']")?.focus();
        } else if (act === "remove-line") {
          draft.lines = draft.lines.filter((l) => l.id !== el.dataset.lineId);
          redraw();
        } else if (act === "save") {
          await persist();
          toast("Invoice saved", "ok");
        } else if (act === "toggle-paid") {
          draft.status = draft.status === "paid" ? "unpaid" : "paid";
          await persist();
          redraw();
          toast(draft.status === "paid" ? "Marked paid" : "Marked unpaid", "ok");
        } else if (act === "print") {
          await persist();
          await printInvoice({ invoice: draft, patient, prefs });
        } else if (act === "delete") {
          const ok = await confirmDialog({
            title: "Delete this invoice?", confirmLabel: "Delete", danger: true,
          });
          if (ok) {
            await store.invoices.remove(draft.id);
            toast("Invoice deleted");
            router.go("/billing");
          }
        }
      });

      bind();
    },
  };
}

function body(draft, patient, prefs) {
  return html`
    <div class="card card--pad">
      <div class="row row--between" style="margin-bottom:12px">
        <div>
          <div style="font-weight:600">${store.patientName(patient)}</div>
          <div class="small muted">${patient?.medicalAid?.scheme || "Private"}</div>
        </div>
        <span class="badge ${draft.status === "paid" ? "badge--ok" : "badge--warn"}">
          ${draft.status === "paid" ? "Paid" : "Unpaid"}
        </span>
      </div>
      <div class="field-grid">
        <label class="field">
          <span class="field__label">Invoice number</span>
          <input class="input" data-field="number" value="${draft.number || ""}">
        </label>
        <label class="field">
          <span class="field__label">Date</span>
          <input class="input" type="date" data-field="date" value="${draft.date || isoDate()}">
        </label>
      </div>
    </div>

    <div class="section">
      <div class="section__head">
        <span class="section__title">Line items</span>
        <span class="small muted tabular" id="inv-total">${money(store.invoiceTotal(draft), prefs.currency)}</span>
      </div>

      ${draft.lines.length
        ? draft.lines.map((line) => html`
          <div class="rx-item">
            <div class="rx-item__head">
              <div class="grow">
                <input class="input" data-field="description" data-line-id="${line.id}"
                  value="${line.description || ""}" placeholder="Consultation">
              </div>
              <button class="rx-item__remove" data-act="remove-line" data-line-id="${line.id}" aria-label="Remove line">
                ${icon("close", { size: 18 })}
              </button>
            </div>
            <div class="field-grid field-grid--3">
              <label class="field" style="margin-bottom:0">
                <span class="field__label">Code</span>
                <input class="input" data-field="code" data-line-id="${line.id}"
                  value="${line.code || ""}" placeholder="0190">
              </label>
              <label class="field" style="margin-bottom:0">
                <span class="field__label">Qty</span>
                <input class="input tabular" data-field="qty" data-line-id="${line.id}"
                  value="${line.qty ?? 1}" inputmode="numeric">
              </label>
              <label class="field" style="margin-bottom:0">
                <span class="field__label">Amount</span>
                <input class="input tabular" data-field="amount" data-line-id="${line.id}"
                  value="${((line.amountCents || 0) / 100).toFixed(2)}" inputmode="decimal">
              </label>
            </div>
          </div>
        `)
        : html`<div class="card card--pad" style="text-align:center">
            <p class="muted small">No line items yet.</p>
          </div>`}

      <button class="btn btn--secondary btn--block" data-act="add-line" style="margin-top:12px">
        ${icon("plus", { size: 18 })} Add line
      </button>
    </div>

    <div class="section">
      <label class="field">
        <span class="field__label">Notes</span>
        <textarea class="textarea" data-field="notes" style="min-height:70px">${draft.notes || ""}</textarea>
      </label>
    </div>

    <div class="section stack">
      <button class="btn btn--outline btn--block" data-act="print">${icon("print")} Print / PDF</button>
      <button class="btn ${draft.status === "paid" ? "btn--ghost" : "btn--primary"} btn--block" data-act="toggle-paid">
        ${draft.status === "paid" ? "Mark as unpaid" : html`${icon("check")} Mark as paid`}
      </button>
      <button class="btn btn--ghost btn--block" data-act="delete" style="color:var(--danger-500)">
        ${icon("trash")} Delete invoice
      </button>
    </div>
  `;
}

async function printInvoice({ invoice, patient, prefs }) {
  const prescriber = await store.getPrescriber();
  const root = document.querySelector("#print-root");
  const total = store.invoiceTotal(invoice);

  mount(root, html`
    <div class="script__header">
      <div class="script__name">${prescriber.name}</div>
      ${prescriber.qualifications ? html`<div class="script__quals">${prescriber.qualifications}</div>` : ""}
      <div class="script__reg">
        ${prescriber.practiceNumber ? html`Practice Number: ${prescriber.practiceNumber}` : ""}
        ${prescriber.hpcsa ? html`<br>HPCSA Registration: ${prescriber.hpcsa}` : ""}
      </div>
    </div>
    <hr class="script__rule">
    <div class="script__rx-mark">Invoice ${invoice.number || ""}</div>
    <div class="script__patient">
      <div class="script__field"><b>To:</b> ${store.patientName(patient)}</div>
      ${patient?.address ? html`<div class="script__field">${patient.address}</div>` : ""}
      ${patient?.medicalAid?.scheme
        ? html`<div class="script__field"><b>Medical aid:</b> ${patient.medicalAid.scheme}
            ${patient.medicalAid.number ? html`— ${patient.medicalAid.number}` : ""}</div>`
        : ""}
      <div class="script__field"><b>Date:</b> ${formatDate(invoice.date)}</div>
    </div>

    <table style="width:100%;border-collapse:collapse;margin-bottom:8mm">
      <thead>
        <tr style="border-bottom:1px solid #000">
          <th style="text-align:left;padding:2mm 0">Code</th>
          <th style="text-align:left;padding:2mm 0">Description</th>
          <th style="text-align:right;padding:2mm 0">Qty</th>
          <th style="text-align:right;padding:2mm 0">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${invoice.lines.map((line) => html`
          <tr style="border-bottom:1px solid #ccc">
            <td style="padding:2mm 0">${line.code || ""}</td>
            <td style="padding:2mm 0">${line.description || ""}</td>
            <td style="padding:2mm 0;text-align:right">${line.qty ?? 1}</td>
            <td style="padding:2mm 0;text-align:right">${money(line.amountCents, prefs.currency)}</td>
          </tr>
        `)}
        <tr>
          <td colspan="3" style="padding:3mm 0;text-align:right;font-weight:700">Total</td>
          <td style="padding:3mm 0;text-align:right;font-weight:700">${money(total, prefs.currency)}</td>
        </tr>
      </tbody>
    </table>

    ${invoice.notes ? html`<div class="script__meta">${invoice.notes}</div>` : ""}
    ${invoice.status === "paid" ? html`<div class="script__meta"><b>Paid — thank you.</b></div>` : ""}

    <div class="script__footer">
      ${[prescriber.addressLine, prescriber.postalLine, prescriber.email, prescriber.phone]
        .filter(Boolean).join(" | ")}
    </div>
  `);

  await new Promise((resolve) => setTimeout(resolve, 60));
  window.print();
}
