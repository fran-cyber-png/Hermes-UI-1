# Evidencia — «Es la misma persona que…» (#58)

**25-jul-2026** · rama `feat/enlazar-personas` · PR #151

## Cómo se tomó

- Front del PR (`vite`), **contra los datos reales de producción** (`hermes-api.goberna.us`),
  con el usuario de prueba `Usuario1`. Lo que se ve en la ficha —Alejandro Vila, cliente,
  MXN 1.960 + MXN 2.800 en Cerberus— es de producción, no un fixture.
- **Ninguna escritura llegó a producción.** El navegador de este entorno no alcanza el host de
  la API, así que el front habló con un proxy local que reenvía **solo GET** y frena todo lo
  demás. La prueba está en su log: durante estas capturas frenó
  **4 × `POST /api/whatsapp/leido/…`** (el que manda tildes azules a leads reales) y
  **2 × `PUT /api/conversaciones/estado`**.
- `/api/enlaces*` lo sirvió el proxy: **el endpoint todavía no está desplegado** (este PR no
  está mergeado). Es un mock declarado, no un dato de producción disfrazado — el contacto
  enlazado (`rosita.gob`) es inventado a propósito.

## Las capturas

| Archivo | Qué muestra |
|---|---|
| `58-enlazar-1-ficha-boton.png` | La ficha real con el bloque **«La misma persona»**: sin enlaces dice qué es y ofrece el botón. Nada de un hueco. |
| `58-enlazar-2-buscador.png` | El buscador: por nombre o por teléfono, sobre conversaciones que ya existen. Dice, antes de elegir, que se une la ficha y no los chats. |
| `58-enlazar-3-confirmacion.png` | **La confirmación**: a quién se une, y escrito, **qué pasa** — la ficha agrega marcado por origen, los chats NO se mezclan, se puede deshacer y queda registrado. |
| `58-enlazar-4-ficha-unificada.png` | La ficha unificada: `rosita.gob` · **«de @rosita.gob · Instagram»** · su interés (`Diplomado en Gestión Pública`) · `2 gestiones · cotizado` · «Unida el 25 jul 2026 por Usuario1», con el botón de deshacer al lado. |
| `58-enlazar-5-mobile.png` | La misma ficha unificada en 390×844, cargada **de entrada** en ese tamaño. El bloque no desborda ni recorta. |
| `58-enlazar-6-deshecho.png` | Después de deshacer: la ficha vuelve al estado separado, con el botón para volver a unir. |

## Lo que las capturas NO prueban

- Que la revocación deja rastro en la base: eso lo fija un test con base
  (`identidad/enlazar.test.db.ts`, «deshacer separa las fichas — y el vínculo revocado NO se
  borra»), no una pantalla.
- Que el rebuild del poblador no borra los enlaces manuales:
  `ontologia/poblarIdentidad.test.db.ts`.

## Borde conocido (pre-existente, no de este PR)

En 390 px la app entera desborda a lo ancho: el panel de la ficha se superpone a la cola. Es el
layout de escritorio de Hermes, no el bloque nuevo — se ve igual en las capturas mobile de otras
features (`47-panel-notas-mobile.png`, `60-modal-venta-mobile.png`). El bloque nuevo, dentro de
su panel, no agrega desborde propio.
