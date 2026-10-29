import { HEAS_TEMPLATES } from "./heas-templates.js?v=recetaheas-20261029-02";

// ===== DATOS DEL ESTABLECIMIENTO: lo propio del hospital se cambia aqui =====
const APP_NAME = "Receta HEAS";
const STORAGE_PREFIX = "recetaheas";
// =============================================================================

const templates = {
  ambulatorio: {
    title: "RECETARIO / RECIBO\nATENCION AMBULATORIA",
    showInternado: false,
  },
  internado: {
    title: "RECETARIO / RECIBO\nATENCION DEL PACIENTE INTERNADO",
    showInternado: true,
  },
  utiUcin: {
    title: "RECETARIO / RECIBO",
    showInternado: true,
  },
};

const SAVED_RECIPES_KEY = `${STORAGE_PREFIX}-recetas-guardadas-v1`;
const LICENSE_STATUS_URL = "./licencia-heas-recetas.json";
const LICENSE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LICENSE_STATUS_KEY = `${STORAGE_PREFIX}-licencia-v1`;
const LICENSE_LAST_CHECK_KEY = `${STORAGE_PREFIX}-licencia-ultima-revision-v1`;
const DEFAULT_LICENSE_MESSAGE =
  "Esta version ya no esta autorizada para uso institucional. Contacte al desarrollador para soporte o renovacion.";

let medicines = [
  {
    name: "Paracetamol",
    concentration: "500 mg",
    form: "Comprimido",
    route: "VO",
  },
  {
    name: "Ibuprofeno",
    concentration: "400 mg",
    form: "Comprimido",
    route: "VO",
  },
  {
    name: "Ceftriaxona",
    concentration: "1 g",
    form: "Vial",
    route: "IV",
  },
  {
    name: "Metformina",
    concentration: "850 mg",
    form: "Comprimido",
    route: "VO",
  },
  {
    name: "Omeprazol",
    concentration: "20 mg",
    form: "Capsula",
    route: "VO",
  },
];

let diagnoses = [];

const clinicalServices = [
  "CIRUGIA",
  "GINECOLOGIA",
  "GINECOLOGIA Y OBSTETRICIA",
  "MEDICINA INTERNA",
  "PEDIATRIA",
  "UNIDAD DE TERAPIA INTENSIVA",
  "UNIDAD DE CUIDADOS NEONATALES",
  "NEONATOLOGIA",
  "EMERGENCIAS",
  "TRAUMATOLOGIA",
  "NEUMOLOGIA",
];

const ambulatorioServices = HEAS_TEMPLATES.ambulatorio.lists.services;

const internadoProcedures = HEAS_TEMPLATES.internado.lists.procedures;

const state = {
  template: "ambulatorio",
  medicines: [],
  currentSavedId: null,
};

const form = document.querySelector("#recipeForm");
const preview = document.querySelector("#recipePreview");
const medicineList = document.querySelector("#medicineList");
const medicineInput = document.querySelector("#medicineInput");
const quantityInput = document.querySelector("#quantityInput");
const instructionInput = document.querySelector("#instructionInput");
const medicineOptions = document.querySelector("#medicineOptions");
const diagnosisOptions = document.querySelector("#diagnosisOptions");
const serviceSelect = document.querySelector("#serviceSelect");
const admissionServiceSelect = document.querySelector("#admissionServiceSelect");
const dischargeServiceSelect = document.querySelector("#dischargeServiceSelect");
const utiAdmissionServiceSelect = document.querySelector("#utiAdmissionServiceSelect");
const installButton = document.querySelector("#installBtn");
const pdfButton = document.querySelector("#pdfBtn");
const pdfButtonLabel = pdfButton?.querySelector("span");
const saveRecipeButton = document.querySelector("#saveRecipeBtn");
const openSavedButton = document.querySelector("#openSavedBtn");
const exportSavedButton = document.querySelector("#exportSavedBtn");
const importSavedButton = document.querySelector("#importSavedBtn");
const importSavedInput = document.querySelector("#importSavedInput");
const savedDialog = document.querySelector("#savedRecipesDialog");
const savedRecipesList = document.querySelector("#savedRecipesList");
const closeSavedDialogButton = document.querySelector("#closeSavedDialogBtn");
const licenseBlocker = document.querySelector("#licenseBlocker");
const licenseBlockerMessage = document.querySelector("#licenseBlockerMessage");
const tabs = [...document.querySelectorAll(".template-tab")];
const ambulatorioServicesOptions = document.querySelector("#ambulatorioServicesOptions");
const internadoProcedureOptions = document.querySelector("#internadoProcedureOptions");
let installPrompt = null;

populateMedicineOptions();
populateServiceOptions();

ambulatorioServicesOptions.innerHTML = renderCheckOptions("service", ambulatorioServices);
internadoProcedureOptions.innerHTML = renderCheckOptions("procedure", internadoProcedures);

form.addEventListener("input", render);
updatePdfButtonLabel();
window.addEventListener("resize", updatePdfButtonLabel);
window.addEventListener("orientationchange", updatePdfButtonLabel);

tabs.forEach((tab) => {
  tab.addEventListener("click", () => activateTemplate(tab.dataset.template));
});

document.querySelector("#printBtn").addEventListener("click", () => window.print());
pdfButton.addEventListener("click", generatePdf);
saveRecipeButton.addEventListener("click", saveCurrentRecipe);
openSavedButton.addEventListener("click", openSavedRecipes);
exportSavedButton.addEventListener("click", exportSavedRecipes);
importSavedButton.addEventListener("click", () => importSavedInput.click());
importSavedInput.addEventListener("change", importSavedRecipes);
closeSavedDialogButton.addEventListener("click", () => savedDialog.close());
document.querySelector("#clearBtn").addEventListener("click", () => {
  const shouldClear = window.confirm(
    "Seguro que quieres limpiar el formulario actual y borrar los medicamentos agregados? Las recetas guardadas no se borraran."
  );
  if (!shouldClear) {
    return;
  }

  form.reset();
  state.medicines = [];
  state.currentSavedId = null;
  render();
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  installButton.classList.remove("hidden");
});

installButton.addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  installButton.classList.add("hidden");
});

window.addEventListener("appinstalled", () => {
  installPrompt = null;
  installButton.classList.add("hidden");
});

function readStoredLicenseStatus() {
  try {
    return JSON.parse(localStorage.getItem(LICENSE_STATUS_KEY) || "null");
  } catch (error) {
    console.warn("No se pudo leer el estado local de licencia.", error);
    return null;
  }
}

function storeLicenseStatus(status) {
  localStorage.setItem(LICENSE_STATUS_KEY, JSON.stringify(status));
  localStorage.setItem(LICENSE_LAST_CHECK_KEY, String(Date.now()));
}

function shouldCheckLicense() {
  const lastCheck = Number(localStorage.getItem(LICENSE_LAST_CHECK_KEY) || "0");
  return !lastCheck || Date.now() - lastCheck > LICENSE_CHECK_INTERVAL_MS;
}

function applyLicenseStatus(status) {
  const isActive = status?.activo !== false;
  if (isActive) {
    licenseBlocker?.classList.add("hidden");
    document.body.classList.remove("license-locked");
    return;
  }

  if (licenseBlockerMessage) {
    licenseBlockerMessage.textContent = status?.mensaje || DEFAULT_LICENSE_MESSAGE;
  }
  document.body.classList.add("license-locked");
  licenseBlocker?.classList.remove("hidden");
}

async function checkRemoteLicense({ force = false } = {}) {
  const storedStatus = readStoredLicenseStatus();
  if (storedStatus) applyLicenseStatus(storedStatus);
  const mustRefreshBlockedStatus = storedStatus?.activo === false;
  if (!force && !mustRefreshBlockedStatus && !shouldCheckLicense()) return;

  try {
    const response = await fetch(`${LICENSE_STATUS_URL}?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Revision de licencia fallo: ${response.status}`);
    const remoteStatus = await response.json();
    storeLicenseStatus(remoteStatus);
    applyLicenseStatus(remoteStatus);
  } catch (error) {
    console.warn("No se pudo revisar la licencia remota. Se mantiene el ultimo estado conocido.", error);
  }
}

function activateTemplate(template) {
  state.template = template || "ambulatorio";
  tabs.forEach((item) => item.classList.toggle("active", item.dataset.template === state.template));
  const isInternado = state.template === "internado";
  const isUti = state.template === "utiUcin";
  document
    .querySelectorAll(".internado-only")
    .forEach((item) => item.classList.toggle("hidden", !isInternado));
  document
    .querySelectorAll(".ambulatorio-only")
    .forEach((item) => item.classList.toggle("hidden", state.template !== "ambulatorio"));
  document
    .querySelectorAll(".stay-only")
    .forEach((item) => item.classList.toggle("hidden", !(isInternado || isUti)));
  document.querySelectorAll(".uti-only").forEach((item) => item.classList.toggle("hidden", !isUti));
  document.querySelectorAll(".non-uti-only").forEach((item) => item.classList.toggle("hidden", isUti));
  document.querySelectorAll(".secondary-extra").forEach((item) => item.classList.toggle("hidden", isUti));
  render();
}

function readSavedRecipes() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_RECIPES_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("No se pudieron leer las recetas guardadas.", error);
    return [];
  }
}

function writeSavedRecipes(recipes) {
  localStorage.setItem(SAVED_RECIPES_KEY, JSON.stringify(recipes));
}

function saveCurrentRecipe() {
  const recipes = readSavedRecipes();
  const snapshot = buildRecipeSnapshot();
  const existingIndex = recipes.findIndex((recipe) => recipe.id === state.currentSavedId);

  if (existingIndex >= 0) {
    recipes[existingIndex] = {
      ...recipes[existingIndex],
      ...snapshot,
      id: state.currentSavedId,
      createdAt: recipes[existingIndex].createdAt,
      updatedAt: new Date().toISOString(),
    };
  } else {
    recipes.unshift(snapshot);
    state.currentSavedId = snapshot.id;
  }

  writeSavedRecipes(recipes);
  saveRecipeButton.classList.add("saved-flash");
  window.setTimeout(() => saveRecipeButton.classList.remove("saved-flash"), 700);
}

function buildRecipeSnapshot() {
  const formData = serializeForm();
  return {
    id: state.currentSavedId || crypto.randomUUID?.() || `receta-${Date.now()}`,
    template: state.template,
    title: recipeSnapshotTitle(formData),
    formData,
    medicines: state.medicines,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function recipeSnapshotTitle(formData) {
  const templateName = {
    ambulatorio: "Ambulatorio",
    internado: "Internado",
    utiUcin: "UTI / UCIN",
  }[state.template] || "Receta";
  const patient = [formData.paternalSurname, formData.maternalSurname, formData.givenNames].filter(Boolean).join(" ");
  const record = formData.clinicalRecord ? `Exp. ${formData.clinicalRecord}` : "Sin expediente";
  const date = formData.requestDate || new Date().toISOString().slice(0, 10);
  return `${templateName} - ${patient || "Sin nombre"} - ${record} - ${date}`;
}

function serializeForm() {
  const data = {};
  Array.from(form.elements).forEach((element) => {
    if (!element.name || element.disabled) return;
    if (element.type === "checkbox") {
      data[element.name] = element.checked;
      return;
    }
    if (element.type === "radio") {
      if (element.checked) data[element.name] = element.value;
      else if (!(element.name in data)) data[element.name] = "";
      return;
    }
    data[element.name] = element.value;
  });
  return data;
}

function restoreForm(formData = {}) {
  form.reset();
  Array.from(form.elements).forEach((element) => {
    if (!element.name || element.disabled) return;
    if (element.type === "checkbox") {
      element.checked = Boolean(formData[element.name]);
      return;
    }
    if (element.type === "radio") {
      element.checked = formData[element.name] === element.value;
      return;
    }
    element.value = formData[element.name] || "";
  });
}

function openSavedRecipes() {
  renderSavedRecipesList();
  if (typeof savedDialog.showModal === "function") savedDialog.showModal();
  else savedDialog.setAttribute("open", "");
}

function renderSavedRecipesList() {
  const recipes = readSavedRecipes();
  if (!recipes.length) {
    savedRecipesList.innerHTML = '<p class="empty saved-empty">No hay recetas guardadas todavia.</p>';
    return;
  }

  savedRecipesList.innerHTML = recipes
    .map(
      (recipe) => `
        <article class="saved-recipe-card">
          <div>
            <strong>${safe(recipe.title)}</strong>
            <span>${safe(formatSavedDate(recipe.updatedAt || recipe.createdAt))}</span>
          </div>
          <div class="saved-recipe-actions">
            <button class="secondary-button icon-button compact-button" type="button" data-load-id="${safe(recipe.id)}">
              <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
              <span>Cargar</span>
            </button>
            <button class="remove-button icon-button compact-button" type="button" data-delete-id="${safe(recipe.id)}">
              <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 15H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
              <span>Borrar</span>
            </button>
          </div>
        </article>
      `,
    )
    .join("");

  savedRecipesList.querySelectorAll("[data-load-id]").forEach((button) => {
    button.addEventListener("click", () => loadSavedRecipe(button.dataset.loadId));
  });
  savedRecipesList.querySelectorAll("[data-delete-id]").forEach((button) => {
    button.addEventListener("click", () => deleteSavedRecipe(button.dataset.deleteId));
  });
}

function loadSavedRecipe(id) {
  const recipe = readSavedRecipes().find((item) => item.id === id);
  if (!recipe) return;
  state.currentSavedId = recipe.id;
  state.medicines = Array.isArray(recipe.medicines) ? recipe.medicines : [];
  restoreForm(recipe.formData);
  activateTemplate(recipe.template);
  savedDialog.close();
}

function deleteSavedRecipe(id) {
  const recipes = readSavedRecipes().filter((recipe) => recipe.id !== id);
  if (state.currentSavedId === id) state.currentSavedId = null;
  writeSavedRecipes(recipes);
  renderSavedRecipesList();
}

function exportSavedRecipes() {
  const recipes = readSavedRecipes();
  const payload = {
    app: APP_NAME,
    exportedAt: new Date().toISOString(),
    recipes,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `recetas-guardadas-heas-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function importSavedRecipes(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const imported = Array.isArray(parsed) ? parsed : parsed.recipes;
    if (!Array.isArray(imported)) throw new Error("Formato no valido");
    const current = readSavedRecipes();
    const merged = [...imported, ...current].reduce((accumulator, recipe) => {
      if (recipe?.id && !accumulator.some((item) => item.id === recipe.id)) accumulator.push(recipe);
      return accumulator;
    }, []);
    writeSavedRecipes(merged);
    renderSavedRecipesList();
    openSavedRecipes();
  } catch (error) {
    console.error("No se pudo importar el respaldo.", error);
    alert("No se pudo importar el respaldo. Verifica que sea un archivo JSON exportado desde esta app.");
  }
}

function formatSavedDate(value) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("es-BO", { dateStyle: "short", timeStyle: "short" });
}

async function generatePdf() {
  if (isMobilePdfFlow()) {
    window.print();
    return;
  }

  const button = pdfButton;
  const originalText = pdfButtonLabel?.textContent || "Generar PDF";

  try {
    button.disabled = true;
    if (pdfButtonLabel) pdfButtonLabel.textContent = "Generando...";
    preview.classList.add("pdf-exporting");
    await loadPdfLibraries();

    const canvas = await window.html2canvas(preview, {
      backgroundColor: "#ffffff",
      scale: 2.5,
      useCORS: true,
      width: preview.scrollWidth,
      height: preview.scrollHeight,
      windowWidth: preview.scrollWidth,
      windowHeight: preview.scrollHeight,
    });

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({
      orientation: preview.classList.contains("is-half-copies") ? "landscape" : "portrait",
      unit: "pt",
      format: "letter",
    });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imageRatio = canvas.width / canvas.height;
    let imageWidth = pageWidth;
    let imageHeight = imageWidth / imageRatio;

    if (imageHeight > pageHeight) {
      imageHeight = pageHeight;
      imageWidth = imageHeight * imageRatio;
    }

    const offsetX = (pageWidth - imageWidth) / 2;
    const offsetY = (pageHeight - imageHeight) / 2;
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", offsetX, offsetY, imageWidth, imageHeight);
    pdf.save(pdfFileName());
  } catch (error) {
    console.error("No se pudo generar el PDF.", error);
    alert("No se pudo generar el PDF. Verifica tu conexion a internet e intentalo nuevamente.");
  } finally {
    preview.classList.remove("pdf-exporting");
    button.disabled = false;
    if (pdfButtonLabel) pdfButtonLabel.textContent = originalText;
  }
}

function updatePdfButtonLabel() {
  if (!pdfButtonLabel) return;
  pdfButtonLabel.textContent = isMobilePdfFlow() ? "Guardar PDF" : "Generar PDF";
}

function isMobilePdfFlow() {
  const userAgent = navigator.userAgent || "";
  const isAndroidOrIos = /Android|iPhone|iPad|iPod/i.test(userAgent);
  const isIpadDesktopMode = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return isAndroidOrIos || isIpadDesktopMode;
}

function loadPdfLibraries() {
  if (window.html2canvas && window.jspdf?.jsPDF) return Promise.resolve();

  return Promise.all([
    loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"),
    loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"),
  ]);
}

function loadScript(src) {
  const existing = document.querySelector(`script[src="${src}"]`);
  if (existing) {
    return existing.dataset.loaded === "true"
      ? Promise.resolve()
      : new Promise((resolve, reject) => {
          existing.addEventListener("load", resolve, { once: true });
          existing.addEventListener("error", reject, { once: true });
        });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    document.head.appendChild(script);
  });
}

function pdfFileName() {
  const templateName = {
    ambulatorio: "ambulatorio",
    internado: "internado",
    utiUcin: "uti-ucin",
  }[state.template] || "recetario";
  return `recetario-${templateName}-${new Date().toISOString().slice(0, 10)}.pdf`;
}

document.querySelector("#addMedicineBtn").addEventListener("click", () => {
  const rawMedicine = medicineInput.value.trim();
  const selected = findMedicine(rawMedicine);
  const quantity = Number(quantityInput.value || 1);
  const instruction = instructionInput.value.trim();

  if (!rawMedicine) {
    medicineInput.focus();
    return;
  }

  state.medicines.push({
    ...(selected || freeTextMedicine(rawMedicine)),
    quantity,
    instruction,
  });

  medicineInput.value = "";
  quantityInput.value = "1";
  instructionInput.value = "";
  render();
});

form.elements.diagnosis.addEventListener("change", () => fillDiagnosisCode(form.elements.diagnosis, form.elements.cie10));
form.elements.admissionDiagnosis.addEventListener("change", () =>
  fillDiagnosisCode(form.elements.admissionDiagnosis, form.elements.admissionDiagnosisCode),
);

Array.from({ length: 5 }, (_, index) => index + 1).forEach((number) => {
  const diagnosisInput = form.elements[`secondaryDiagnosis${number}`];
  const codeInput = form.elements[`secondaryCode${number}`];
  diagnosisInput.addEventListener("change", () => fillDiagnosisCode(diagnosisInput, codeInput));
});

function findMedicine(value) {
  const normalizedValue = normalize(value);
  return medicines.find((medicine) => normalize(medicineLabel(medicine)) === normalizedValue);
}

function medicineLabel(medicine) {
  return [medicine.name, medicine.concentration, medicine.form].filter(Boolean).join(" ");
}

function freeTextMedicine(value) {
  return {
    name: value,
    concentration: "",
    form: "",
    route: "",
    freeText: true,
  };
}

function normalize(value) {
  return value.trim().toLowerCase();
}

async function loadLocalData() {
  const [medicineResult, diagnosisResult] = await Promise.allSettled([
    fetch("./data/medicamentos.json").then((response) => response.json()),
    fetch("./data/cartera_servicios.json").then((response) => response.json()),
  ]);

  if (medicineResult.status === "fulfilled" && Array.isArray(medicineResult.value)) {
    medicines = medicineResult.value.map((item) => ({
      code: item.codigo || "",
      name: item.medicamento || "",
      concentration: item.concentracion || "",
      form: item.forma || "",
      observation: item.observacion || "",
      route: "",
    }));
    populateMedicineOptions();
  }

  if (diagnosisResult.status === "fulfilled" && Array.isArray(diagnosisResult.value)) {
    diagnoses = diagnosisResult.value.map((item) => ({
      code: item.CODIGO || "",
      name: item.SERVICIO || "",
      patientType: item["TIPO DE PACIENTE"] || "",
    }));
    populateDiagnosisOptions();
  }

  render();
}

function populateMedicineOptions() {
  medicineOptions.innerHTML = medicines
    .map((medicine) => `<option value="${safe(medicineLabel(medicine))}"></option>`)
    .join("");
}

function populateDiagnosisOptions() {
  diagnosisOptions.innerHTML = diagnoses
    .map((diagnosis) => `<option value="${safe(diagnosis.name)}" label="${safe(diagnosis.code)}"></option>`)
    .join("");
}

function populateServiceOptions() {
  const list = document.querySelector("#serviceOptionsList");
  if (!list) return;
  list.innerHTML = clinicalServices.map((service) => `<option value="${safe(service)}"></option>`).join("");
}

function findDiagnosis(value) {
  const normalizedValue = normalize(value);
  return diagnoses.find((diagnosis) => normalize(diagnosis.name) === normalizedValue);
}

function fillDiagnosisCode(diagnosisInput, codeInput) {
  const selected = findDiagnosis(diagnosisInput.value);
  if (!selected) return;
  codeInput.value = selected.code;
  render();
}

function renderCheckOptions(prefix, options) {
  return options
    .map(
      (option, index) => `
        <label class="check-option">
          <input type="checkbox" name="${prefix}${index}" />
          <span>${safe(option)}</span>
        </label>
      `,
    )
    .join("");
}

function getData() {
  return Object.fromEntries(new FormData(form).entries());
}

function splitDate(value) {
  if (!value) return { day: "", month: "", year: "" };
  const [year, month, day] = value.split("-");
  return { day, month, year };
}

function renderMedicineList() {
  if (!state.medicines.length) {
    medicineList.innerHTML = '<p class="empty">Sin medicamentos agregados.</p>';
    return;
  }

  medicineList.innerHTML = state.medicines
    .map(
      (medicine, index) => `
        <div class="medicine-row">
          <div>
            <strong>${medicineLabel(medicine)}</strong>
            <small>${medicineMeta(medicine)}</small>
          </div>
          <span>Cant. ${medicine.quantity}</span>
          <button class="remove-button" type="button" data-index="${index}">Quitar</button>
        </div>
      `,
    )
    .join("");

  const capacity = HEAS_CAPACITY[state.template];
  if (state.medicines.length > capacity) {
    medicineList.insertAdjacentHTML(
      "beforeend",
      `<p class="empty">Aviso: este recetario tiene espacio para ${capacity} medicamentos. Los ${state.medicines.length - capacity} restantes no se imprimiran.</p>`,
    );
  }

  medicineList.querySelectorAll(".remove-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.medicines.splice(Number(button.dataset.index), 1);
      render();
    });
  });
}

function medicineMeta(medicine) {
  return [medicine.route, medicine.instruction || "Sin indicacion"].filter(Boolean).join(" · ");
}

function renderPreview() {
  const data = getData();
  const isHalfCopies = data.printLayout === "halfCopies";
  preview.classList.remove("pdf-preview-page");
  preview.classList.toggle("is-ambulatorio", state.template === "ambulatorio");
  preview.classList.toggle("is-internado", state.template === "internado");
  preview.classList.toggle("is-uti-ucin", state.template === "utiUcin");
  preview.classList.toggle("is-half-copies", isHalfCopies);
  preview.classList.toggle("is-full-page", !isHalfCopies);

  let recipeHtml = "";
  if (state.template === "internado") {
    recipeHtml = renderInternadoRecipe(data);
  } else if (state.template === "utiUcin") {
    recipeHtml = renderUtiUcinRecipe(data);
  } else {
    recipeHtml = renderAmbulatorioRecipe(data);
  }

  preview.innerHTML = isHalfCopies ? renderHalfSheetCopies(recipeHtml) : recipeHtml;
  updatePrintPageStyle(data.printLayout);
}

function updatePrintPageStyle(layout) {
  let styleEl = document.querySelector("#printPageStyle");
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "printPageStyle";
    document.head.appendChild(styleEl);
  }
  if (layout === "halfCopies") {
    styleEl.innerHTML = "@page { size: letter landscape; margin: 0; }";
  } else {
    styleEl.innerHTML = "@page { size: letter portrait; margin: 0; }";
  }
}

function renderHalfSheetCopies(recipeHtml) {
  return `
    <div class="half-sheet-copy">
      <div class="half-copy-content">${recipeHtml}</div>
    </div>
    <div class="sheet-cut-line" aria-hidden="true"></div>
    <div class="half-sheet-copy">
      <div class="half-copy-content">${recipeHtml}</div>
    </div>
  `;
}

function splitPatientName(value) {
  const parts = (value || "").trim().split(/\s+/);
  return {
    paternal: parts[0] || "",
    maternal: parts[1] || "",
    names: parts.slice(2).join(" "),
  };
}

function getPatientParts(data) {
  if (data.paternalSurname || data.maternalSurname || data.givenNames) {
    return {
      paternal: data.paternalSurname || "",
      maternal: data.maternalSurname || "",
      names: data.givenNames || "",
    };
  }

  return splitPatientName(data.patientName);
}

function safe(value) {
  if (value === undefined || value === null || value === "") return "&nbsp;";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ===== Recetarios oficiales HEAS (D-1, D-2 y D-4), generados desde los Excel oficiales =====
const HEAS_CAPACITY = {
  ambulatorio: HEAS_TEMPLATES.ambulatorio.meds,
  internado: HEAS_TEMPLATES.internado.meds,
  utiUcin: HEAS_TEMPLATES.utiUcin.meds,
};
const HEAS_PROGRAMS = ["VIH", "TUBERCULOSIS", "SALUD RENAL", "LUCHA CONTRA EL CANCER"];
const HEAS_SALES = ["SOAT", "RGL", "VENTA"];
const MM_TO_PX = 96 / 25.4;

function heasContext(key, data) {
  const ctx = { ...data };
  ctx.ptype = key === "utiUcin" ? data.utiPatientType || "" : data.patientType || "";
  ctx.admsvc =
    key === "utiUcin" ? data.utiAdmissionService || data.admissionService || "" : data.admissionService || "";
  return ctx;
}

function heasMedicine(index, field) {
  const medicine = state.medicines[index];
  if (!medicine) return "";
  if (field === "qty") return safe(medicine.quantity);
  const label = medicineLabel(medicine);
  if (field === "name") return safe(label);
  if (field === "instr") return safe(medicine.instruction || "");
  if (field === "nameinstr") return safe(medicine.instruction ? `${label} - ${medicine.instruction}` : label);
  return "";
}

function heasToken(expr, ctx) {
  const [kind, ...rest] = expr.split(":");
  const arg = rest.join(":");
  if (kind === "f") {
    const raw = ctx[arg] ?? "";
    return arg === "observations" ? safe(raw).replaceAll("\n", "<br>") : safe(raw);
  }
  if (kind === "full") {
    const p = getPatientParts(ctx);
    return safe([p.names, p.paternal, p.maternal].filter(Boolean).join(" "));
  }
  if (kind === "d") {
    const [field, part] = arg.split(":");
    return safe(splitDate(ctx[field] || "")[part]);
  }
  if (kind === "m") {
    const [field, value] = arg.split("=");
    return ctx[field] === value ? '<span class="xmark">X</span>' : "&nbsp;";
  }
  if (kind === "pt") {
    const type = ctx.ptype || "";
    if (arg === "sus") return type === "SUS" ? '<span class="xmark">X</span>' : "&nbsp;";
    if (arg === "prog") return HEAS_PROGRAMS.includes(type) ? `<span class="ptxt">${safe(type)}</span>` : "&nbsp;";
    if (arg === "venta") {
      if (!HEAS_SALES.includes(type)) return "&nbsp;";
      return type === "VENTA" ? '<span class="xmark">X</span>' : `<span class="ptxt">${safe(type)}</span>`;
    }
    return "&nbsp;";
  }
  if (kind === "chk") return ctx[arg] ? '<span class="xmark">X</span>' : "&nbsp;";
  if (kind === "sex") return ctx.sex === arg ? `<span class="sel">${arg}</span>` : arg;
  if (kind === "med") {
    const [index, field] = arg.split(":");
    return heasMedicine(Number(index), field) || "&nbsp;";
  }
  return "";
}

function renderHeas(key, data) {
  const ctx = heasContext(key, data);
  const tpl = HEAS_TEMPLATES[key];
  const isHalf = data.printLayout === "halfCopies";
  // escala: carta completa = la del Excel; media carta = ajustada a la mitad de la hoja horizontal
  const zoom = isHalf
    ? Math.min(((139.5 - 8) * MM_TO_PX) / tpl.W, ((216 - 8) * MM_TO_PX) / tpl.H)
    : tpl.zoom;
  const body = tpl.html.replace(/\{\{([^}]+)\}\}/g, (_, expr) => heasToken(expr.trim(), ctx));
  return (
    `<div class="hs-wrap" style="width:${(tpl.W * zoom).toFixed(1)}px;height:${(tpl.H * zoom).toFixed(1)}px">` +
    `<div class="hs-scale" style="width:${tpl.W}px;height:${tpl.H}px;transform:scale(${zoom.toFixed(4)})">${body}</div></div>`
  );
}

function renderAmbulatorioRecipe(data) {
  return renderHeas("ambulatorio", data);
}

function renderInternadoRecipe(data) {
  return renderHeas("internado", data);
}

function renderUtiUcinRecipe(data) {
  return renderHeas("utiUcin", data);
}

function render() {
  renderMedicineList();
  renderPreview();
}

render();
checkRemoteLicense();
loadLocalData().catch((error) => {
  console.warn("No se pudieron cargar las bases locales.", error);
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    navigator.serviceWorker
      .register(`./sw.js?v=recetaheas-20261029-02`, { updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch((error) => {
        console.warn("No se pudo activar la PWA.", error);
      });
  });
}
