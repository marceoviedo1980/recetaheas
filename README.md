# Receta HEAS

PWA para llenar e imprimir los recetarios oficiales del Hospital El Alto Sur:

- D-1 Atencion ambulatoria
- D-2 Atencion del paciente internado
- D-4 Servicios y productos especiales (UTI / UCIN)

## Funciones

- Buscador de medicamentos desde `data/medicamentos.json` (stock de El Alto Sur).
- Buscador de diagnosticos y autollenado CIE-10 desde `data/cartera_servicios.json`.
- Guardar, cargar, respaldar e importar recetas (se guardan solo en el navegador del equipo).
- Impresion en hoja carta completa o dos copias en hoja carta horizontal.
- Instalacion como PWA.

## Publicacion en GitHub Pages

Archivos necesarios: `index.html`, `app.js`, `styles.css`, `heas-templates.js`, `heas-sheets.css`,
`manifest.webmanifest`, `sw.js`, `licencia-heas-recetas.json`, y las carpetas `icons/`, `img/` y `data/`.

## Datos

No deben agregarse datos personales de pacientes al repositorio.
