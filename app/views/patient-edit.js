// Create or edit a patient record. Serves both /patients/new and /patients/:id/edit.

import { html, toast, isoDate, confirmDialog } from "../ui.js";
import * as store from "../store.js";
import { readForm } from "../components.js";
import * as router from "../router.js";

const listField = (value) => (Array.isArray(value) ? value.join(", ") : value || "");
const parseList = (value) =>
  String(value || "").split(",").map((s) => s.trim()).filter(Boolean);

export async function view(ctx) {
  const id = ctx.params.id || null;
  const patient = id ? await store.patients.get(id) : store.newPatient();

  if (id && !patient) {
    return { title: "Patient", back: "/patients", largeTitle: true,
      content: html`<p class="muted">This patient no longer exists.</p>` };
  }

  return {
    title: id ? "Edit patient" : "New patient",
    back: id ? `/patients/${id}` : "/patients",
    largeTitle: true,
    content: html`
      <form id="pf" novalidate>
        <div class="card card--pad">
          <div class="field-grid">
            <label class="field">
              <span class="field__label">First name</span>
              <input class="input" name="firstName" value="${patient.firstName || ""}" autocomplete="given-name" required>
            </label>
            <label class="field">
              <span class="field__label">Surname</span>
              <input class="input" name="surname" value="${patient.surname || ""}" autocomplete="family-name" required>
            </label>
            <label class="field">
              <span class="field__label">Date of birth</span>
              <input class="input" name="dob" type="date" value="${patient.dob || ""}" max="${isoDate()}">
            </label>
            <label class="field">
              <span class="field__label">Gender</span>
              <select class="select" name="gender">
                ${["", "Female", "Male", "Other"].map((g) => html`
                  <option value="${g}" ${g === (patient.gender || "") ? "selected" : ""}>${g || "—"}</option>
                `)}
              </select>
            </label>
            <label class="field field--wide">
              <span class="field__label">ID number <span class="muted">optional</span></span>
              <input class="input" name="idNumber" value="${patient.idNumber || ""}" inputmode="numeric">
            </label>
          </div>
        </div>

        <div class="section">
          <div class="section__head"><span class="section__title">Contact</span></div>
          <div class="card card--pad">
            <div class="field-grid">
              <label class="field">
                <span class="field__label">Mobile</span>
                <input class="input" name="phone" type="tel" inputmode="tel" value="${patient.phone || ""}" autocomplete="tel">
              </label>
              <label class="field">
                <span class="field__label">Email</span>
                <input class="input" name="email" type="email" inputmode="email" value="${patient.email || ""}" autocomplete="email">
              </label>
            </div>
            <label class="field" style="margin-bottom:0">
              <span class="field__label">Address</span>
              <textarea class="textarea" name="address" style="min-height:70px">${patient.address || ""}</textarea>
            </label>
          </div>
        </div>

        <div class="section">
          <div class="section__head"><span class="section__title">Clinical</span></div>
          <div class="card card--pad">
            <label class="field">
              <span class="field__label">Allergies <span class="muted">comma separated</span></span>
              <input class="input" name="allergies" value="${listField(patient.allergies)}" placeholder="Penicillin, sulphonamides">
              <span class="field__hint">Shown as a warning whenever you write this patient a script.</span>
            </label>
            <label class="field" style="margin-bottom:0">
              <span class="field__label">Chronic conditions <span class="muted">comma separated</span></span>
              <input class="input" name="chronicConditions" value="${listField(patient.chronicConditions)}"
                placeholder="Hypertension, type 2 diabetes">
            </label>
          </div>
        </div>

        <div class="section">
          <div class="section__head"><span class="section__title">Medical aid</span></div>
          <div class="card card--pad">
            <div class="field-grid">
              <label class="field">
                <span class="field__label">Scheme</span>
                <input class="input" name="ma_scheme" value="${patient.medicalAid?.scheme || ""}">
              </label>
              <label class="field">
                <span class="field__label">Plan</span>
                <input class="input" name="ma_plan" value="${patient.medicalAid?.plan || ""}">
              </label>
              <label class="field">
                <span class="field__label">Member number</span>
                <input class="input" name="ma_number" value="${patient.medicalAid?.number || ""}">
              </label>
              <label class="field">
                <span class="field__label">Dependant code</span>
                <input class="input" name="ma_dependantCode" value="${patient.medicalAid?.dependantCode || ""}" inputmode="numeric">
              </label>
            </div>
          </div>
        </div>

        <div class="section">
          <label class="field">
            <span class="field__label">Notes</span>
            <textarea class="textarea" name="notes">${patient.notes || ""}</textarea>
          </label>
        </div>

        <p class="field__error hidden" id="pf-error"></p>
        <button class="btn btn--primary btn--block" type="submit">
          ${id ? "Save changes" : "Add patient"}
        </button>
        ${id
          ? html`<button class="btn btn--ghost btn--block" type="button" data-act="delete"
              style="color:var(--danger-500);margin-top:8px">Delete patient</button>`
          : ""}
      </form>
    `,
    mount(root) {
      const form = root.querySelector("#pf");
      const error = root.querySelector("#pf-error");

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = readForm(form);
        if (!data.firstName || !data.surname) {
          error.textContent = "A first name and surname are required.";
          error.classList.remove("hidden");
          form.querySelector("[name='firstName']").focus();
          return;
        }
        const saved = await store.patients.save({
          ...patient,
          firstName: data.firstName,
          surname: data.surname,
          dob: data.dob || "",
          gender: data.gender || "",
          idNumber: data.idNumber || "",
          phone: data.phone || "",
          email: data.email || "",
          address: data.address || "",
          allergies: parseList(data.allergies),
          chronicConditions: parseList(data.chronicConditions),
          medicalAid: {
            scheme: data.ma_scheme || "",
            plan: data.ma_plan || "",
            number: data.ma_number || "",
            dependantCode: data.ma_dependantCode || "",
          },
          notes: data.notes || "",
        });
        toast(id ? "Patient updated" : "Patient added", "ok");
        router.go(`/patients/${saved.id}`, { replace: true });
      });

      root.addEventListener("action", async ({ detail: { act } }) => {
        if (act !== "delete") return;
        const ok = await confirmDialog({
          title: `Delete ${store.patientName(patient)}?`,
          message: "Their prescriptions, notes and invoices stay on file but the patient is removed from your list.",
          confirmLabel: "Delete",
          danger: true,
        });
        if (ok) {
          await store.patients.remove(patient.id);
          toast("Patient deleted");
          router.go("/patients");
        }
      });
    },
  };
}
