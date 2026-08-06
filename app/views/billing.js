// Billing overview: what is outstanding and what has been settled.

import { html, formatDate, money, initials } from "../ui.js";
import { icon } from "../icons.js";
import * as store from "../store.js";
import { emptyState, pickPatient } from "../components.js";
import * as router from "../router.js";

export async function view() {
  const [invoices, patients, prefs] = await Promise.all([
    store.invoices.all(),
    store.patients.all(),
    store.getPreferences(),
  ]);
  const byId = new Map(patients.map((p) => [p.id, p]));

  const outstanding = invoices.filter((i) => i.status !== "paid");
  const thisYear = new Date().getFullYear();
  const billedThisYear = invoices
    .filter((i) => String(i.date).startsWith(String(thisYear)))
    .reduce((sum, i) => sum + store.invoiceTotal(i), 0);
  const outstandingTotal = outstanding.reduce((sum, i) => sum + store.invoiceTotal(i), 0);

  const row = (invoice) => {
    const patient = byId.get(invoice.patientId);
    return html`
      <li><button class="list__item" data-nav="/invoices/${invoice.id}">
        <div class="avatar">${initials(store.patientName(patient))}</div>
        <div class="list__body">
          <div class="list__title">${store.patientName(patient)}</div>
          <div class="list__meta">${invoice.number || "Draft"} · ${formatDate(invoice.date)}</div>
        </div>
        <div class="list__trail tabular">
          <div style="font-weight:600;color:var(--text)">${money(store.invoiceTotal(invoice), prefs.currency)}</div>
          ${invoice.status === "paid"
            ? html`<span class="badge badge--ok">Paid</span>`
            : html`<span class="badge badge--warn">Unpaid</span>`}
        </div>
      </button></li>
    `;
  };

  return {
    title: "Billing",
    largeTitle: true,
    action: { label: "New", act: "new-invoice" },
    content: html`
      <div class="tiles">
        <div class="tile" style="cursor:default">
          <div class="tile__value tabular">${money(outstandingTotal, prefs.currency)}</div>
          <div class="tile__label">Outstanding</div>
        </div>
        <div class="tile" style="cursor:default">
          <div class="tile__value tabular">${money(billedThisYear, prefs.currency)}</div>
          <div class="tile__label">Billed in ${thisYear}</div>
        </div>
      </div>

      ${outstanding.length
        ? html`<div class="section">
            <div class="section__head"><span class="section__title">Awaiting payment</span></div>
            <div class="card"><ul class="list">${outstanding.map(row)}</ul></div>
          </div>`
        : ""}

      <div class="section">
        <div class="section__head">
          <span class="section__title">All invoices</span>
          <span class="small muted">${invoices.length || "none"}</span>
        </div>
        ${invoices.length
          ? html`<div class="card"><ul class="list">${invoices.map(row)}</ul></div>`
          : emptyState({
              iconName: "receipt",
              title: "No invoices yet",
              text: "Raise an invoice against a patient and it lands here with a running total.",
              action: { label: "New invoice", act: "new-invoice" },
            })}
      </div>
    `,
    mount(root) {
      root.addEventListener("action", async ({ detail: { act } }) => {
        if (act !== "new-invoice") return;
        const patient = await pickPatient();
        if (!patient) return;
        const number = await store.nextInvoiceNumber();
        const invoice = await store.invoices.save(store.newInvoice({ patientId: patient.id, number }));
        router.go(`/invoices/${invoice.id}`);
      });
    },
  };
}
