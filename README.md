# Receta HEAS

PWA para llenar e imprimir los recetarios oficiales del Hospital El Alto Sur:

- D-1 Atencion ambulatoria
- D-2 Atencion del paciente internado
- D-4 Servicios y productos especiales (UTI / UCIN)

## Funciones

- Medicamentos leidos en vivo desde **STOCKSUR**, de todas sus pestanas (SUS, Salud Renal, Lucha contra el Cancer,
  Tuberculosis, VIH, IPAS). El buscador los agrupa por programa con el color de su pestana: primero el programa del
  tipo de paciente y despues los demas. Cada opcion muestra su programa y su codigo.
- Aviso de restriccion al elegir un medicamento (solo en pantalla, no se imprime).
- Psicotropicos y estupefacientes: la cantidad se escribe sola en literal, segun LINAME.
  Ej.: `Fentanilo con conservante 0,05 mg/ml (tres inyectables)`.
- Diagnosticos CIE-10 y **procedimientos** leidos en vivo desde **diagnosticos-heas**; se buscan por nombre o por codigo.
  En el buscador los procedimientos salen aparte, debajo de los diagnosticos (codigo de una letra y ocho digitos).
- Guardar, cargar, buscar, respaldar e importar recetas (se guardan solo en el navegador del equipo).
- Borrador automatico: si la app se recarga (p. ej. al actualizarse), se recupera la receta en curso.
- Impresion en hoja carta completa o dos copias en hoja carta horizontal. PDF sin necesidad de internet.

## De donde salen los datos

| Dato | Se lee de | Respaldo dentro de la app |
|---|---|---|
| Medicamentos | `marceoviedo1980/stocksur/medicamentos.json` | `data/medicamentos.json` |
| Diagnosticos | `marceoviedo1980/diagnosticos-heas/datos_heas.json` | `data/datos_heas.json` |

Para actualizar medicamentos o diagnosticos **no se toca esta app**: se actualiza STOCKSUR o
diagnosticos-heas y la receta lo toma sola. Sin conexion usa la ultima copia descargada en el equipo y,
si no hay ninguna, la copia de `data/`. La linea "Medicamentos / Diagnosticos" de la pantalla dice cual usa.

Las direcciones estan al inicio de `app.js` (bloque "DATOS DEL ESTABLECIMIENTO").

## Publicar cambios de la app

Al cambiar cualquier archivo de la app, subir el numero `VERSION` en `sw.js` (es el unico lugar).
No hace falta cambiarlo cuando solo cambian los datos.

## Datos

No deben agregarse datos personales de pacientes al repositorio.
