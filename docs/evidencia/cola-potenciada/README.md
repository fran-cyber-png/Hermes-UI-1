# Evidencia — La cola potenciada (#49)

Capturas de la rama `feat/cola-potenciada`. El front se corrió contra
**producción** (`VITE_API_URL=https://hermes-api.goberna.us`), con sesión de
`Usuario1` iniciada **solo en el navegador** (Playwright, 2026‑07‑24). Viewport
desktop 1440×900 salvo la última (angosta 780×880).

> ⚠️ **Escritura PROHIBIDA contra prod**: el `PUT /api/conversaciones/estado`
> (pin/favorita/leído) se **mockeó** en el navegador (nunca salió al server). Se
> verificó que ningún request a `/conversaciones/estado` llegó a la red. Las
> LECTURAS (cola real, categorías) sí fueron en vivo.

> ⚠️ **Prod corre el backend VIEJO** (esta rama todavía no está deployada). Por
> eso los campos nuevos (`fijada`/`favorita`/`no_leido`/`categorias` y el
> `pide_info` corregido) no llegan desde prod: el front degrada limpio (no los
> pinta). Ver `cola-backend-nuevo.png`.

| Archivo | Qué muestra | Datos |
|---|---|---|
| `cola-mensajes.png` | Tabs **Todo · No leídos · Favoritos** + filtros secundarios **Piden info · Por vencer** + botón Listas. «1823 en cola». El conteo `n` ya es **gris neutro** (el azul se reserva para «sin leer»). | **Prod real.** Nota: el chip «Pide info» aparece en «Gracias»/«No gracias» → es el bug del dueño (backend viejo, `bool_or` histórico). Lo arregla esta rama. |
| `modo-listas.png` | **Modo Listas**: la lista izquierda se vuelve la lista de categorías (Interesada azul · Precio naranja · Reclamo rojo) con color + conteo, «Administrar» (CRUD) y volver a Cola. | **Prod real** (`/api/categorias`). |
| `categoria-drilldown.png` | Drill‑down de una categoría: cabecera «‹ Listas · ● Interesada». También se ven los controles de acción por fila al hacer hover. | **Prod real.** El conteo no filtra (1824) porque prod ignora el param `categoria`; el filtro real es del backend nuevo. |
| `cola-backend-nuevo.png` | **Simulación del backend nuevo** (GET mockeado con datos realistas, porque prod aún no lo tiene): **banda de pin** (Alan, Rosa) arriba de los nivel‑0; **punto azul** de sin leer; **estrella** de favorita; **píldora de categoría** con borde de color (sin sombra, sin oro); y **«Pide info» corregido** — ya NO aparece en «Gracias»/«No gracias»/«No por ahora». | GET mockeado (el backend está probado con `*.test.db.ts`). |
| `tab-no-leidos.png` | Tab **No leídos**: filtra a las 4 sin leer (Alan pineado sigue en la banda). «4 en cola». | GET mockeado con filtrado por tab. |
| `cola-angosta.png` | Viewport **angosto (780px)**: la cola conserva su ancho y legibilidad, sin overflow horizontal. | GET mockeado. |

## Lo que verifica cada parte

- **Tabs + filtros racionalizados** (no sopa de chips): `cola-mensajes.png`.
- **Modo Listas / drill‑down por categoría** (pedido literal del dueño):
  `modo-listas.png`, `categoria-drilldown.png`.
- **La fila respira** (pin, favorita, sin‑leer, categoría con color, «Pide info»
  solo del último entrante, conteo neutro): `cola-backend-nuevo.png`.
- **Filtrado por tab**: `tab-no-leidos.png`.
- **Robustez responsive**: `cola-angosta.png`.

El comportamiento de servidor (banda de pin sobre los 6 niveles, `no_leido`,
favoritos, aislamiento por vendedora, filtro por categoría, «pide info» del
último entrante, tope de 3 pines → 409) está fijado por 16 tests con base
(`server/src/cola/estado.test.db.ts`, `consultarCola.potenciada.test.db.ts`).
