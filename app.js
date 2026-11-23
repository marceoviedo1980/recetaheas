import { HEAS_TEMPLATES } from "./heas-templates.js";
import {
  escapeHtml,
  normalizar,
  numeroALetras,
  mostrarAviso,
  cargarFuente,
  textoOrigen,
  crearBuscador,
} from "./utilidades.js";

// ===== DATOS DEL ESTABLECIMIENTO: lo propio del hospital se cambia aqui =====
const APP_NAME = "Receta HEAS";
const STORAGE_PREFIX = "recetaheas";
const DATA_CACHE = "recetaheas-datos"; // debe coincidir con DATA_CACHE en sw.js

// De donde se leen los datos. "enLinea" es el archivo publicado por la otra PWA;
// "local" es la copia de respaldo dentro de esta app (carpeta data/).
const FUENTE_MEDICAMENTOS = {
  enLinea: "https://raw.githubusercontent.com/marceoviedo1980/STOCKSUR/main/medicamentos.json",
  local: "./data/medicamentos.json",
};
const FUENTE_DIAGNOSTICOS = {
  enLinea: "https://raw.githubusercontent.com/marceoviedo1980/diagnosticos-heas/main/datos_heas.json",
  local: "./data/datos_heas.json",
};

// Tipo de paciente de la receta -> programa de STOCKSUR. Los demas tipos (SOAT, RGL, VENTA o vacio)
// muestran todos los programas.
const PROGRAMA_POR_TIPO = {
  SUS: "sus",
  VIH: "vih",
  TUBERCULOSIS: "tb",
  "SALUD RENAL": "renal",
  "LUCHA CONTRA EL CANCER": "cancer",
};
const NOMBRE_PROGRAMA = { sus: "SUS", vih: "VIH", tb: "TB", renal: "Renal", cancer: "Cáncer" };

// Psicotropicos y estupefacientes: cantidad en literal dentro del parentesis, con la forma
// farmaceutica tal como figura en el LINAME. Ej.: "Fentanilo con conservante 0,05 mg/ml (tres inyectables)".
const UNIDAD_CONTROLADO = [
  { patron: /iny|ampoll|vial/i, singular: "inyectable", plural: "inyectables", femenino: false },
  { patron: /comprim|c[aá]psul|tableta|gragea/i, singular: "comprimido", plural: "comprimidos", femenino: false },
];
// =============================================================================

const SAVED_RECIPES_KEY = `${STORAGE_PREFIX}-recetas-guardadas-v1`;
const DRAFT_KEY = `${STORAGE_PREFIX}-borrador-v1`;
const DRAFT_MAX_AGE_MS = 4 * 60 * 60 * 1000;
const LICENSE_STATUS_URL = "./licencia-heas-recetas.json";
const LICENSE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LICENSE_STATUS_KEY = `${STORAGE_PREFIX}-licencia-v1`;
const LICENSE_LAST_CHECK_KEY = `${STORAGE_PREFIX}-licencia-ultima-revision-v1`;
const DEFAULT_LICENSE_MESSAGE =
  "Esta version ya no esta autorizada para uso institucional. Contacte al desarrollador para soporte o renovacion.";

let medicines = [];
let diagnoses = [];
const dataStatus = { medicamentos: null, diagnosticos: null };

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
  pendingMedicine: null,
};

const form = document.querySelector("#recipeForm");
const preview = document.querySelector("#recipePreview");
const medicineList = document.querySelector("#medicineList");
const medicineInput = document.querySelector("#medicineInput");
const quantityInput = document.querySelector("#quantityInput");
const instructionInput = document.querySelector("#instructionInput");
const medicineHint = document.querySelector("#medicineHint");
const dataStatusLine = document.querySelector("#dataStatus");
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
const savedSearchInput = document.querySelector("#savedSearchInput");
const savedSearchCount = document.querySelector("#savedSearchCount");
const closeSavedDialogButton = document.querySelector("#closeSavedDialogBtn");
const licenseBlocker = document.querySelector("#licenseBlocker");
const licenseBlockerMessage = document.querySelector("#licenseBlockerMessage");
const tabs = [...document.querySelectorAll(".template-tab")];
const ambulatorioServicesOptions = document.querySelector("#ambulatorioServicesOptions");
const internadoProcedureOptions = document.querySelector("#internadoProcedureOptions");
let installPrompt = null;

populateServiceOptions();

ambulatorioServicesOptions.innerHTML = renderCheckOptions("service", ambulatorioServices);
internadoProcedureOptions.innerHTML = renderCheckOptions("procedure", internadoProcedures);

form.addEventListener("input", (event) => {
  // los campos de cada medicamento agregado actualizan solo la hoja (para no perder el cursor)
  if (event.target.closest("#medicineList")) return;
  render();
});
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
savedSearchInput?.addEventListener("input", () => renderSavedRecipesList());
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
  clearPendingMedicine();
  clearDraft();
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

// ===== Licencia =====
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

// ===== Tipo de recetario =====
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

// ===== Recetas guardadas =====
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
  const formData = serializeForm();
  const missing = [
    !formData.paternalSurname?.trim() && "apellido paterno",
    !formData.givenNames?.trim() && "nombres",
  ].filter(Boolean);
  if (missing.length && !window.confirm(`Falta: ${missing.join(" y ")} del paciente.\n¿Guardar la receta de todos modos?`)) {
    return;
  }

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

  try {
    writeSavedRecipes(recipes);
  } catch (error) {
    console.error("No se pudo guardar la receta.", error);
    mostrarAviso("No se pudo guardar: la memoria del navegador está llena. Exporte un respaldo y borre recetas antiguas.", "error");
    return;
  }
  saveDraft();
  saveRecipeButton.classList.add("saved-flash");
  window.setTimeout(() => saveRecipeButton.classList.remove("saved-flash"), 700);
  mostrarAviso(existingIndex >= 0 ? "Receta actualizada" : "Receta guardada");
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
  if (savedSearchInput) savedSearchInput.value = "";
  renderSavedRecipesList();
  if (typeof savedDialog.showModal === "function") savedDialog.showModal();
  else savedDialog.setAttribute("open", "");
}

function recipeMatchesSearch(recipe, terms) {
  const data = recipe.formData || {};
  const haystack = normalizar(
    [recipe.title, data.clinicalRecord, data.paternalSurname, data.maternalSurname, data.givenNames, data.identityCard].join(" "),
  );
  return terms.every((term) => haystack.includes(term));
}

function renderSavedRecipesList() {
  const allRecipes = readSavedRecipes();
  const terms = normalizar(savedSearchInput?.value).split(" ").filter(Boolean);
  const recipes = terms.length ? allRecipes.filter((recipe) => recipeMatchesSearch(recipe, terms)) : allRecipes;
  if (savedSearchCount) {
    savedSearchCount.textContent = terms.length
      ? `${recipes.length} de ${allRecipes.length} recetas`
      : `${allRecipes.length} ${allRecipes.length === 1 ? "receta guardada" : "recetas guardadas"}`;
  }
  if (!allRecipes.length) {
    savedRecipesList.innerHTML = '<p class="empty saved-empty">No hay recetas guardadas todavia.</p>';
    return;
  }
  if (!recipes.length) {
    savedRecipesList.innerHTML = '<p class="empty saved-empty">No se encontraron recetas con esa busqueda.</p>';
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
  clearPendingMedicine();
  activateTemplate(recipe.template);
  savedDialog.close();
}

function deleteSavedRecipe(id) {
  const recipe = readSavedRecipes().find((item) => item.id === id);
  if (!recipe) return;
  if (!window.confirm(`¿Borrar esta receta guardada?\n\n${recipe.title}\n\nNo se podrá recuperar.`)) return;
  const recipes = readSavedRecipes().filter((item) => item.id !== id);
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

// ===== Borrador automatico (se recupera si la app se recarga, p. ej. al actualizarse) =====
let draftTimer = null;

function saveDraft() {
  try {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        template: state.template,
        formData: serializeForm(),
        medicines: state.medicines,
        currentSavedId: state.currentSavedId,
        savedAt: Date.now(),
      }),
    );
  } catch (error) {
    console.warn("No se pudo guardar el borrador.", error);
  }
}

function scheduleDraftSave() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraft, 400);
}

function clearDraft() {
  clearTimeout(draftTimer);
  localStorage.removeItem(DRAFT_KEY);
}

function draftHasContent(draft) {
  if (draft.medicines?.length) return true;
  return Object.entries(draft.formData || {}).some(
    ([key, value]) => key !== "printLayout" && value !== "" && value !== false,
  );
}

function restoreDraft() {
  let draft = null;
  try {
    draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
  } catch (error) {
    draft = null;
  }
  if (!draft || Date.now() - (draft.savedAt || 0) > DRAFT_MAX_AGE_MS || !draftHasContent(draft)) {
    clearDraft();
    return false;
  }
  restoreForm(draft.formData);
  state.medicines = Array.isArray(draft.medicines) ? draft.medicines : [];
  state.currentSavedId = draft.currentSavedId || null;
  activateTemplate(draft.template);
  mostrarAviso("Se recuperó la receta que estaba llenando");
  return true;
}

// ===== PDF =====
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
    alert("No se pudo generar el PDF. Usa el boton Imprimir y elige \"Guardar como PDF\".");
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

// Librerias incluidas en la app (carpeta vendor/): el PDF se genera sin internet.
function loadPdfLibraries() {
  if (window.html2canvas && window.jspdf?.jsPDF) return Promise.resolve();

  return Promise.all([loadScript("./vendor/html2canvas.min.js"), loadScript("./vendor/jspdf.umd.min.js")]);
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

// ===== Datos: medicamentos (STOCKSUR) y diagnosticos (diagnosticos-heas) =====
const esCodigoDiagnostico = (codigo) => /^[A-Z]\d{2}(\.[\dA-Z]+)?$/.test(codigo);
// procedimientos de diagnosticos-heas: una letra y ocho digitos (ej. D09641006 Electrocardiograma)
const esCodigoProcedimiento = (codigo) => /^[A-Z]\d{8}$/.test(codigo);

function prepararMedicamentos(lista) {
  return lista
    .filter((item) => item && item.medicamento)
    .map((item) => ({
      code: item.codigo || "",
      name: String(item.medicamento || "").trim(),
      concentration: String(item.concentracion || "").trim(),
      form: String(item.forma || "").trim(),
      observation: String(item.observacion || "").trim(),
      program: item.programa || "",
      controlado: item.controlado || "",
      route: "",
    }));
}

// Ambitos de diagnosticos-heas, en el orden en que se muestran.
const AMBITOS = [
  { k: "ce", corto: "CE", largo: "Consulta externa" },
  { k: "emerg", corto: "Emerg.", largo: "Emergencias" },
  { k: "hosp", corto: "Hosp.", largo: "Hospitalización" },
  { k: "uti", corto: "UTI", largo: "Terapia intensiva" },
  { k: "apoyo", corto: "Apoyo", largo: "Servicios de apoyo" },
];
// Ambitos que corresponden a cada recetario (se resaltan; los demas se ven en gris).
const AMBITOS_DE_RECETA = { ambulatorio: ["ce", "emerg"], internado: ["hosp"], utiUcin: ["uti"] };

function prepararDiagnosticos(json) {
  const servicios = Array.isArray(json.servicios) ? json.servicios : [];
  const vistos = new Set();
  return json.items
    .map(([codigo, nombre, grupos]) => {
      // especialidades habilitadas, agrupadas por ambito
      const porAmbito = {};
      (Array.isArray(grupos) ? grupos : []).forEach((indice) => {
        const servicio = servicios[indice];
        if (!servicio?.a) return;
        (porAmbito[servicio.a] ||= new Set()).add(servicio.e);
      });
      return { code: String(codigo).trim().toUpperCase(), name: String(nombre).trim(), porAmbito };
    })
    .map((item) => ({ ...item, tipo: esCodigoDiagnostico(item.code) ? "dx" : esCodigoProcedimiento(item.code) ? "pr" : "" }))
    .filter((item) => item.tipo && !vistos.has(item.code) && vistos.add(item.code))
    .map((item) => ({ ...item, search: normalizar(`${item.code} ${item.name}`) }));
}

function diagnosisScopes(item) {
  const destacados = AMBITOS_DE_RECETA[state.template] || [];
  return AMBITOS.filter((ambito) => item.porAmbito?.[ambito.k])
    .map(
      (ambito) =>
        `<span class="ambito${destacados.includes(ambito.k) ? " ambito-activo" : ""}" title="${ambito.largo}">${ambito.corto}</span>`,
    )
    .join("");
}

function diagnosisDetail(item) {
  const partes = AMBITOS.filter((ambito) => item.porAmbito?.[ambito.k]).map(
    (ambito) => `<strong>${ambito.corto}:</strong> ${escapeHtml([...item.porAmbito[ambito.k]].join(", "))}`,
  );
  return partes.length ? `Habilitado en ${partes.join(" · ")}` : "";
}

async function loadLocalData() {
  const [medicineResult, diagnosisResult] = await Promise.allSettled([
    cargarFuente({
      ...FUENTE_MEDICAMENTOS,
      cache: DATA_CACHE,
      clave: `${STORAGE_PREFIX}-medicamentos`,
      validar: (data) => Array.isArray(data) && data.length > 0 && data.some((item) => item?.medicamento),
    }),
    cargarFuente({
      ...FUENTE_DIAGNOSTICOS,
      cache: DATA_CACHE,
      clave: `${STORAGE_PREFIX}-diagnosticos`,
      validar: (data) => Array.isArray(data?.items) && data.items.length > 0,
    }),
  ]);

  if (medicineResult.status === "fulfilled") {
    medicines = prepararMedicamentos(medicineResult.value.data);
    medicines.forEach((medicine) => (medicine.search = normalizar(medicineLabel(medicine))));
    dataStatus.medicamentos = medicineResult.value;
  } else {
    console.warn("No se pudieron cargar los medicamentos.", medicineResult.reason);
  }

  if (diagnosisResult.status === "fulfilled") {
    diagnoses = prepararDiagnosticos(diagnosisResult.value.data);
    dataStatus.diagnosticos = { ...diagnosisResult.value, version: diagnosisResult.value.data.version };
  } else {
    console.warn("No se pudieron cargar los diagnosticos.", diagnosisResult.reason);
  }

  renderDataStatus();
  render();
}

function renderDataStatus() {
  if (!dataStatusLine) return;
  const med = dataStatus.medicamentos;
  const dx = dataStatus.diagnosticos;
  const dxText = dx
    ? `${dx.origen === "en-linea" ? "versión" : textoOrigen(dx) + ", versión"} ${dx.version || ""}`.trim()
    : "no disponible";
  dataStatusLine.innerHTML =
    `<span><strong>Medicamentos (STOCKSUR):</strong> ${escapeHtml(textoOrigen(med))}</span>` +
    `<span><strong>Diagnósticos HEAS:</strong> ${escapeHtml(dxText)}</span>`;
  dataStatusLine.classList.toggle("is-offline", Boolean((med && med.origen !== "en-linea") || (dx && dx.origen !== "en-linea")));
}

// ===== Medicamentos: buscador, restricciones y cantidad en literal =====
function currentPatientType() {
  const data = getData();
  return state.template === "utiUcin" ? data.utiPatientType || "" : data.patientType || "";
}

function currentProgram() {
  return PROGRAMA_POR_TIPO[currentPatientType()] || "";
}

function medicinesForCurrentPatient() {
  const program = currentProgram();
  return program ? medicines.filter((medicine) => medicine.program === program) : medicines;
}

function medicineLabel(medicine) {
  return [medicine.name, medicine.concentration, medicine.form].filter(Boolean).join(" ");
}

function isControlled(medicine) {
  return Boolean(medicine?.controlado);
}

function controlledUnit(medicine) {
  return UNIDAD_CONTROLADO.find((unit) => unit.patron.test(medicine.form || "")) || UNIDAD_CONTROLADO[0];
}

function quantityInWords(medicine, quantity) {
  const amount = Number(quantity);
  const unit = controlledUnit(medicine);
  const words = numeroALetras(amount, { femenino: unit.femenino });
  if (!words) return "";
  return `${words} ${amount === 1 ? unit.singular : unit.plural}`;
}

// Texto que se imprime en la columna de medicamentos.
// Controlados: nombre + concentracion + (cantidad en literal + forma). Nada despues del parentesis.
function printedLabel(medicine) {
  if (!isControlled(medicine)) return medicineLabel(medicine);
  const literal = quantityInWords(medicine, medicine.quantity);
  const base = [medicine.name, medicine.concentration].filter(Boolean).join(" ");
  return literal ? `${base} (${literal})` : base;
}

function hasRestriction(medicine) {
  const text = normalizar(medicine?.observation);
  return Boolean(text) && text !== "sin restriccion";
}

function medicineNotes(medicine) {
  const notes = [];
  if (hasRestriction(medicine)) {
    notes.push(`<span class="med-note med-note-restriccion">⚠ ${escapeHtml(medicine.observation)}</span>`);
  }
  if (isControlled(medicine)) {
    const tipo = medicine.controlado === "estupefaciente" ? "Estupefaciente" : "Psicotrópico";
    notes.push(`<span class="med-note med-note-controlado">${tipo} · cantidad en literal</span>`);
  }
  return notes.join("");
}

function findMedicine(value) {
  const normalizedValue = normalizar(value);
  return (
    medicinesForCurrentPatient().find((medicine) => medicine.search === normalizedValue) ||
    medicines.find((medicine) => medicine.search === normalizedValue)
  );
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

function searchMedicines(text) {
  const terms = normalizar(text).split(" ").filter(Boolean);
  const showProgram = !currentProgram();
  return medicinesForCurrentPatient()
    .filter((medicine) => terms.every((term) => medicine.search.includes(term)))
    .sort((a, b) => Number(!a.search.startsWith(terms[0])) - Number(!b.search.startsWith(terms[0])))
    .slice(0, 30)
    .map((medicine) => ({ medicine, showProgram }));
}

crearBuscador(medicineInput, {
  buscar: searchMedicines,
  pintar: ({ medicine, showProgram }) =>
    `<span class="buscador-principal">${escapeHtml(medicineLabel(medicine))}` +
    `${showProgram && medicine.program ? ` <em class="buscador-etiqueta">${escapeHtml(NOMBRE_PROGRAMA[medicine.program] || medicine.program)}</em>` : ""}</span>` +
    `${hasRestriction(medicine) ? `<small class="buscador-nota">⚠ ${escapeHtml(medicine.observation)}</small>` : ""}`,
  elegir: ({ medicine }) => {
    medicineInput.value = medicineLabel(medicine);
    state.pendingMedicine = medicine;
    renderMedicineHint();
    quantityInput.focus();
    quantityInput.select();
  },
});

medicineInput.addEventListener("input", () => {
  if (state.pendingMedicine && normalizar(medicineInput.value) !== state.pendingMedicine.search) {
    state.pendingMedicine = null;
  }
  renderMedicineHint();
});
quantityInput.addEventListener("input", renderMedicineHint);

function pendingMedicine() {
  return state.pendingMedicine || (medicineInput.value.trim() ? findMedicine(medicineInput.value) : null);
}

function renderMedicineHint() {
  if (!medicineHint) return;
  const medicine = pendingMedicine();
  if (!medicine) {
    medicineHint.innerHTML = "";
    medicineHint.hidden = true;
    return;
  }
  const parts = [];
  if (hasRestriction(medicine)) {
    parts.push(`<div class="hint-restriccion">⚠ <strong>Restricción:</strong> ${escapeHtml(medicine.observation)}</div>`);
  }
  if (isControlled(medicine)) {
    const quantity = sanitizeQuantity(quantityInput.value);
    parts.push(
      `<div class="hint-controlado"><strong>Se imprimirá:</strong> ${escapeHtml(printedLabel({ ...medicine, quantity }))}</div>`,
    );
  }
  medicineHint.innerHTML = parts.join("");
  medicineHint.hidden = !parts.length;
}

function clearPendingMedicine() {
  state.pendingMedicine = null;
  renderMedicineHint();
}

function sanitizeQuantity(value) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number >= 1 ? number : 1;
}

document.querySelector("#addMedicineBtn").addEventListener("click", () => {
  const rawMedicine = medicineInput.value.trim();
  if (!rawMedicine) {
    medicineInput.focus();
    return;
  }
  const selected = pendingMedicine();
  const quantity = sanitizeQuantity(quantityInput.value);
  const instruction = instructionInput.value.trim();

  const base = selected ? { ...selected } : freeTextMedicine(rawMedicine);
  delete base.search;
  state.medicines.push({ ...base, quantity, instruction });

  medicineInput.value = "";
  quantityInput.value = "1";
  instructionInput.value = "";
  clearPendingMedicine();
  render();
  medicineInput.focus();
});

// ===== Diagnosticos: buscador por nombre o codigo =====
// sin signos de puntuacion, para que "neumonia no esp" encuentre "Neumonía, no especificada"
const sinSignos = (texto) => texto.replace(/[^a-z0-9. ]/g, " ").replace(/\s+/g, " ").trim();

const MAX_DIAGNOSTICOS = 20;
const MAX_PROCEDIMIENTOS = 10;

// Devuelve primero los diagnosticos y despues, aparte, los procedimientos (cada grupo con su cabecera).
function searchDiagnoses(text) {
  const query = sinSignos(normalizar(text));
  const terms = query.split(" ").filter(Boolean);
  const matches = { dx: [], pr: [] };
  for (const item of diagnoses) {
    if (!terms.every((term) => item.search.includes(term))) continue;
    const name = sinSignos(normalizar(item.name));
    const rank = item.code.toLowerCase().startsWith(query) ? 0 : name.startsWith(query) ? 1 : name.includes(query) ? 2 : 3;
    matches[item.tipo].push({ item, rank, length: name.length });
  }
  const ordenar = (lista, maximo) =>
    lista
      .sort((a, b) => a.rank - b.rank || a.length - b.length || a.item.code.localeCompare(b.item.code))
      .slice(0, maximo)
      .map((match) => match.item);
  const dx = ordenar(matches.dx, MAX_DIAGNOSTICOS);
  const pr = ordenar(matches.pr, MAX_PROCEDIMIENTOS);
  // la cabecera de grupo se pone en el primer elemento de cada grupo; "Diagnosticos" solo si tambien hay procedimientos
  const resultado = [
    ...dx.map((item, i) => ({ ...item, cabecera: i === 0 && pr.length ? "Diagnósticos" : "" })),
    ...pr.map((item, i) => ({ ...item, cabecera: i === 0 ? "Procedimientos" : "" })),
  ];
  return resultado;
}

function findDiagnosisByCode(code) {
  const normalizedCode = String(code || "").trim().toUpperCase().replace(/\s+/g, "");
  return diagnoses.find((diagnosis) => diagnosis.code === normalizedCode);
}

const diagnosisFieldPairs = [];

function renderDiagnosisDetails() {
  diagnosisFieldPairs.forEach(({ nameInput, codeInput, detalle }) => {
    const found = codeInput.value.trim() ? findDiagnosisByCode(codeInput.value) : null;
    const html = found && nameInput.value.trim() ? diagnosisDetail(found) : "";
    detalle.innerHTML = html;
    detalle.hidden = !html;
  });
}

function connectDiagnosisFields(nameInput, codeInput) {
  if (!nameInput || !codeInput) return;
  crearBuscador(nameInput, {
    minimo: 2,
    buscar: searchDiagnoses,
    pintar: (item) =>
      (item.cabecera ? `<div class="dx-grupo">${escapeHtml(item.cabecera)}</div>` : "") +
      `<div class="dx-opcion${item.tipo === "pr" ? " dx-opcion-pr" : ""}"><span class="buscador-codigo">${escapeHtml(item.code)}</span>` +
      `<span class="dx-texto"><span class="buscador-principal">${escapeHtml(item.name)}</span>` +
      `<span class="dx-ambitos">${diagnosisScopes(item)}</span></span></div>`,
    elegir: (item) => {
      nameInput.value = item.name;
      codeInput.value = item.code;
      render();
    },
  });
  // especialidades del diagnostico elegido (solo pantalla)
  const detalle = document.createElement("small");
  detalle.className = "dx-detalle";
  detalle.hidden = true;
  nameInput.parentElement.appendChild(detalle);
  diagnosisFieldPairs.push({ nameInput, codeInput, detalle });
  // escribir solo el codigo completa el nombre si esta vacio
  codeInput.addEventListener("change", () => {
    const found = findDiagnosisByCode(codeInput.value);
    if (!found) return;
    codeInput.value = found.code;
    if (!nameInput.value.trim()) nameInput.value = found.name;
    render();
  });
}

connectDiagnosisFields(form.elements.diagnosis, form.elements.cie10);
connectDiagnosisFields(form.elements.admissionDiagnosis, form.elements.admissionDiagnosisCode);
Array.from({ length: 5 }, (_, index) => index + 1).forEach((number) => {
  connectDiagnosisFields(form.elements[`secondaryDiagnosis${number}`], form.elements[`secondaryCode${number}`]);
});

function populateServiceOptions() {
  const list = document.querySelector("#serviceOptionsList");
  if (!list) return;
  list.innerHTML = clinicalServices.map((service) => `<option value="${safe(service)}"></option>`).join("");
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

// ===== Lista de medicamentos agregados (editable) =====
function renderMedicineList() {
  if (!state.medicines.length) {
    medicineList.innerHTML = '<p class="empty">Sin medicamentos agregados.</p>';
    return;
  }

  medicineList.innerHTML = state.medicines
    .map(
      (medicine, index) => `
        <div class="medicine-row" data-index="${index}">
          <div class="medicine-row-name">
            <strong data-label>${escapeHtml(printedLabel(medicine))}</strong>
            ${medicineNotes(medicine)}
          </div>
          <label class="medicine-row-field medicine-row-qty">
            <span>Cant.</span>
            <input type="number" min="1" step="1" inputmode="numeric" value="${escapeHtml(medicine.quantity)}" data-edit="quantity" aria-label="Cantidad" />
          </label>
          <label class="medicine-row-field medicine-row-instr">
            <span>Indicación</span>
            <input value="${escapeHtml(medicine.instruction || "")}" data-edit="instruction" aria-label="Indicacion" />
          </label>
          <button class="remove-button" type="button" data-remove="${index}">Quitar</button>
        </div>
      `,
    )
    .join("");

  const capacity = HEAS_CAPACITY[state.template];
  if (state.medicines.length > capacity) {
    medicineList.insertAdjacentHTML(
      "beforeend",
      `<p class="empty capacity-warning">Aviso: este recetario tiene espacio para ${capacity} medicamentos. Los ${state.medicines.length - capacity} restantes no se imprimiran.</p>`,
    );
  }
}

medicineList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove]");
  if (!button) return;
  state.medicines.splice(Number(button.dataset.remove), 1);
  render();
});

medicineList.addEventListener("input", (event) => {
  const field = event.target.closest("[data-edit]");
  if (!field) return;
  const row = field.closest(".medicine-row");
  const medicine = state.medicines[Number(row.dataset.index)];
  if (!medicine) return;
  if (field.dataset.edit === "quantity") {
    if (field.value === "") return;
    medicine.quantity = sanitizeQuantity(field.value);
    row.querySelector("[data-label]").textContent = printedLabel(medicine);
  } else {
    medicine.instruction = field.value;
  }
  renderPreview();
  scheduleDraftSave();
});

medicineList.addEventListener("change", (event) => {
  const field = event.target.closest('[data-edit="quantity"]');
  if (!field) return;
  const medicine = state.medicines[Number(field.closest(".medicine-row").dataset.index)];
  if (medicine) field.value = medicine.quantity;
});

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
  return escapeHtml(value);
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
  const label = printedLabel(medicine);
  if (field === "name") return safe(label);
  if (field === "instr") return safe(medicine.instruction || "");
  if (field === "nameinstr") {
    // en controlados no se escribe nada despues del parentesis
    if (isControlled(medicine)) return safe(label);
    return safe(medicine.instruction ? `${label} - ${medicine.instruction}` : label);
  }
  return "";
}

function heasToken(expr, ctx) {
  const [kind, ...rest] = expr.split(":");
  const arg = rest.join(":");
  if (kind === "f") {
    const raw = ctx[arg] ?? "";
    // un codigo de procedimiento (9 caracteres) no cabe en el casillero a tamano normal
    if (/^(cie10|admissionDiagnosisCode|secondaryCode\d)$/.test(arg) && String(raw).trim().length > 6) {
      return `<span style="font-size:8pt">${safe(raw)}</span>`;
    }
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
  renderMedicineHint();
  renderDiagnosisDetails();
  scheduleDraftSave();
}

if (!restoreDraft()) render();
renderDataStatus();
checkRemoteLicense();
loadLocalData().catch((error) => {
  console.warn("No se pudieron cargar las bases de datos.", error);
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      saveDraft();
      window.location.reload();
    });

    navigator.serviceWorker
      .register("./sw.js", { updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch((error) => {
        console.warn("No se pudo activar la PWA.", error);
      });
  });
}
