# Bitácora — sesión "auto-vinculación de WhatsApp" (2026-08-15)

> Estado: **implementado, revisado, con evidencia — sin commitear todavía**. Vive en el worktree
> `.claude/worktrees/auto-vinculacion-whatsapp`, rama `feat/auto-vinculacion-whatsapp`, branch base
> `main`. Este doc es la bitácora de la sesión: qué se pidió, qué se construyó, qué encontró la
> revisión y cómo quedó. No reemplaza al CLAUDE.md (que ya se actualizó con la parte permanente).

## El pedido

Estephano: *"hoy voy a ingresar a varios usuarios — 1 celular qr whatsmeow y 1 vendedor así
directamente"*. Al pedir precisión sobre "vendedor así directamente", la respuesta fue la decisión
de producto real:

> *"por ahora quiero solo que puedan usar las funcionalidades basicas, se enlazan cada uno con su
> qr, que ellos se puedan enlazar en el mismo aplicativo — siempre un vendedor (no supervisor) va
> tener la posibilidad de enlazar su numero al hermes solo 1 — y a partir de eso el supervisor va
> poder revisar las diferentes conversaciones de los diferentes numeros todo whatsmeow"*

O sea: no era una tarea operativa de hoy, era un frente nuevo — **auto-vinculación de WhatsApp
desde adentro de la app**, algo que **revierte parcialmente D13** (`docs/adr/` — "la app de la
vendedora no vincula, solo ve"). Se confirmó el alcance con el dueño (construir ahora, no solo
planear) antes de tocar código.

## Por qué esto no era trivial

- **D13 es una decisión escrita**: vincular era exclusivamente server-side, por un operador. Esto
  abre una segunda puerta, angosta, para que la vendedora traiga su propio número.
- **El problema técnico real, encontrado investigando ANTES de codear**: `WHATSAPP_NUMEROS` es
  estático — hasta ahora, aunque se vinculara una línea (por Cerberus o por el operador), quedaba
  **muda hasta un reinicio manual del server** (`sudo systemctl restart hermes` + editar `.env`).
  Sin resolver eso, "vincular desde la app" hubiera sido una promesa vacía: la vendedora escanea el
  QR y sigue sin poder atender hasta que alguien más reinicie el server.
- **Trabajo en worktree aparte** (regla dura #3): la rama de trabajo (`feat/campana-internacional`)
  tenía cambios sin commitear de otro frente (la frontera de asignación). Se abrió
  `.claude/worktrees/auto-vinculacion-whatsapp` desde `origin/main` para no tocar ese trabajo.

## Qué se construyó

### Server (`server/src/`)

| Archivo | Qué hace |
|---|---|
| `routes/miLinea.ts` **(nuevo)** | Router `/api/whatsapp/mi-linea`, detrás del perímetro `requiereVendedora` de siempre. `GET /` (mi línea de hoy), `POST /vincular`, `GET /vincular/estado` (polling), `DELETE /vincular` (cancelar). |
| `numeros/autoVinculacion.ts` **(nuevo)** | La regla pura: `puedeAutoVincular(vendedoraId, env, lineasActuales)` — no-supervisor + "solo 1 línea". Con tests (`autoVinculacion.test.ts`). |
| `numeros/estadoSesion.ts` **(nuevo)** | `sesionDeNumero()`, extraído de `admin.ts` para que las dos rutas (Cerberus y la vendedora) lean el mismo hecho de una sola función. |
| `whatsapp/wiring.ts` | Nueva función exportada `agregarLineaWhatsmeow(numero)`: monta una línea whatsmeow **en caliente**, sin reiniciar — reusa el mismo `montar()` del arranque. |
| `numeros/repositorio.ts` | `lineasDeVendedora`/`lineasDeVendedoraConProposito` pasaron de comparar exacto a comparar con `lower(btrim())` — normalización de grafías (ver hallazgo #3 abajo). |
| `routes/admin.ts` | Se le sacó la copia local de `sesionDeNumero` (ahora importa la de `numeros/estadoSesion.ts`). |
| `index.ts` | Monta `miLineaRouter` en `/api/whatsapp/mi-linea`. |

**Decisiones de diseño clave:**

- **Reusa el vinculador global de D13** (`whatsapp/vinculador.ts`), no uno nuevo: sigue siendo **un
  pareo a la vez en todo el server**. Cerberus vinculando una línea de campaña y una vendedora
  auto-vinculando la suya compiten por el mismo candado.
- **No pasa por `/api/admin`**: ese router lo llama Cerberus con credencial de servicio y su
  envelope de error es `{error:{motivo,mensaje}}`. `mi-linea` la llama la vendedora por la puerta de
  siempre, con el envelope `{ok:false, message, codigo}` que el cliente del front ya sabe leer.
- **Sin migración**: `numeros_wa.proposito` ya tenía el valor `'vendedora'` declarado (`PROPOSITOS`
  en `numeros/dominio.ts`), sin usar hasta ahora. `numero_vendedora` ya era muchos-a-muchos. No hizo
  falta tocar el schema.
- **"Solo 1"**: se verifica con la MISMA consulta que ya alimenta "Las mías" de la cola
  (`lineasDeVendedora`), no una lista aparte.
- **Un número ya registrado en `numeros_wa` (Escuela, campaña, u otra vendedora) se rechaza antes de
  tocar el vinculador** — no se pisa nada que Cerberus declaró.

### Front (`src/features/whatsapp/`, `src/features/auth/`)

| Archivo | Qué hace |
|---|---|
| `whatsapp/miLinea.ts` **(nuevo)** | Hooks de TanStack Query: `useMiLinea`, `useEstadoAutoVinculacion` (polling), `useIniciarAutoVinculacion`, `useCancelarAutoVinculacion`. |
| `whatsapp/VincularMiWhatsapp.tsx` **(nuevo)** | El modal. Partido en cableado (`VincularMiWhatsapp`, con los hooks) + vista presentacional (`VistaMiLinea`, sin un solo hook) — mismo patrón que `PanelUsuario`/`ContenidoUsuario`. |
| `whatsapp/VincularMiWhatsapp.test.tsx` **(nuevo)** | Tests jsdom: cada paso de `VistaMiLinea` por separado, más el cableado real (Escape cierra, Enter con número corto no dispara el POST). |
| `whatsapp/galeria-mi-linea.tsx` + `galeria-mi-linea.html` **(nuevos)** | Galería de evidencia (regla dura #2), sin server: `?paso=formulario\|qr\|conectado\|baneado\|error`. |
| `auth/PanelUsuario.tsx` | Cuando `mias.length === 0`, aparece el botón "Vincular tu WhatsApp". El modal vive en `PanelUsuario` (no en `ContenidoUsuario`) — al abrirlo se cierra primero el popover, para que no compitan dos listeners de Escape sobre `window`. |
| `reparto/galeria.tsx` | Se cableó `onVincular` de verdad (antes era un no-op) para poder demostrar el flujo completo con captura real. |

## Los 5 hallazgos de la revisión de código (y cómo quedaron)

Se corrió `/code-review medium` sobre el diff completo antes de dar el frente por terminado. Encontró
cinco problemas reales — ninguno cosmético:

1. **🔴 Orden de escritura invertido** (`routes/miLinea.ts`). `marcarVinculado()` corría ANTES de
   que `upsertNumero()` creara la fila: el `UPDATE` no tocaba nada (0 filas, sin error) y
   `vinculado_at` quedaba `NULL` para siempre — el panel de Cerberus hubiera mostrado "nunca se
   vinculó" sobre una línea viva. **Fix**: se invirtió el orden (`upsertNumero` primero).
2. **🔴 Condición de carrera en el candado** (`routes/miLinea.ts`). `vinculador.iniciar()` tiene su
   propio `await this.cerrar()` interno antes de marcarse `esperando`; leer `vinculador.estado()`
   como señal de "hay alguien en vuelo" tenía una ventana (un microtask) donde dos POST casi
   simultáneos pasaban los dos el chequeo, y el segundo `iniciar()` le cerraba el cliente al primero
   a mitad de camino. **Fix**: el candado (`pareoActual`) se toma de forma SÍNCRONA, antes de
   cualquier `await` — Node no interrumpe ese bloque para atender otra request en el medio.
3. **🔴 `lineasDeVendedora` comparaba exacto** (`numeros/repositorio.ts`). El mismo defecto de
   grafías ya documentado en este repo (Cerberus empuja `Luz`, el login usa `luz`) — con `eq()` a
   secas, alguien que YA tenía una línea asignada leía `[]` acá, y esta consulta es la que decide
   "¿ya tenés línea?" en la auto-vinculación. Hubiera terminado con **dos** números de WhatsApp por
   persona, rompiendo la regla "solo 1" en silencio. **Fix**: se normaliza con
   `lower(btrim())` de los dos lados (mismo patrón que `cola/asignadaSql.ts`), y se agregó
   `repositorio.test.db.ts` que reproduce el escenario exacto (`Luz` en la base, `luz` en la
   consulta).
4. **El montaje en caliente no sobrevive un reinicio** (`whatsapp/wiring.ts`). `agregarLineaWhatsmeow`
   monta la línea en el proceso vivo, pero no toca `WHATSAPP_NUMEROS` — si el server reinicia (N5,
   un crash), la línea auto-vinculada no vuelve a montarse sola. **No es una regresión**: es la
   MISMA limitación que ya tiene hoy una línea vinculada por Cerberus (gotcha ya documentado en
   CLAUDE.md — "N5 verde no siempre reinicia"). Se documentó fuerte en el código y en CLAUDE.md en
   vez de resolverse acá: la solución completa (leer las líneas vivas de `numeros_wa` en vez de
   `WHATSAPP_NUMEROS` al bootear) ya estaba anotada como frente aparte (**#194**) en
   `numeros/dominio.ts`, y es un cambio al arranque del server que merece su propio PR.
5. **CLAUDE.md sin actualizar** (regla dura #5: cambio de stack ⇒ se documenta en el mismo PR). Se
   agregó la sección sobre la excepción a D13, con las mismas dos advertencias (no sobrevive
   reinicio, Cerberus sigue siendo la única vía para líneas de Escuela/campaña).

## Verificación

- **Typecheck**: limpio, server (`npx tsc --noEmit`) y front (`npx tsc --noEmit -p
  tsconfig.app.json`).
- **Tests puros**: 2.262 tests de server (`npm test`, incluye los 5 nuevos de
  `autoVinculacion.test.ts`) y 1.127 de front (`npx vitest run`, incluye los 9 nuevos de
  `VincularMiWhatsapp.test.tsx`) — todos en verde.
- **Tests con base**: se agregó cobertura en `numeros/repositorio.test.db.ts` (el caso de grafías
  del hallazgo #3), pero **no se pudieron correr en esta sesión** — Docker no estaba levantado en
  el entorno. Pendiente: `docker compose -f docker-compose.test.yml up -d --wait && cd server &&
  npm run test:db`.
- **Evidencia visual** (regla dura #2), con Playwright real contra `npx vite --port 5199`:
  - Los 4 pasos del modal por separado (`galeria-mi-linea.html?paso=...`):
    `docs/evidencia/auto-vinculacion-formulario.png`, `-qr.png`, `-conectado.png`.
  - El flujo real de click dentro de `PanelUsuario` (no solo el componente aislado):
    `docs/evidencia/auto-vinculacion-boton-en-panel-usuario.png`.
  - Se verificó además, interactivamente: Escape con foco en el input NO cierra el modal (regla
    deliberada y compartida de `useEscape`/`reaccionDelPopover` — "con el foco en un campo, Escape
    es del campo"), y SÍ cierra una vez que el foco sale del input. Comportamiento correcto y
    heredado, no un bug.
  - Sin errores nuevos en consola (los `ERR_CONNECTION_REFUSED` de la galería son preexistentes:
    `PanelDerecho` pega a un server que no corre en la galería, nada que ver con este frente).

## Qué falta / decisiones que quedaron abiertas a propósito

- **No sobrevive un reinicio** (hallazgo #4) — documentado, no resuelto. Es el ítem con más
  filo de todo el frente: si hoy se hace un deploy o reinicia el server después de que alguien se
  auto-vincule, esa línea queda registrada pero muda hasta que un operador la agregue a
  `WHATSAPP_NUMEROS` a mano.
- **Un pareo a la vez en todo el server**: si dos personas intentan vincular exactamente al mismo
  tiempo (contando la consola de operador y el panel de Cerberus), la segunda recibe 409 y tiene
  que reintentar. Para el plan de hoy (onboarding secuencial) no debería notarse.
- **El panel de "Roles administrados desde Hermes"** (decisión del dueño, también del 15-ago,
  D1-D5 en memoria) es un frente MÁS GRANDE y separado — mueve roles y fronteras del `.env` a una
  tabla administrable. Este frente NO lo construye ni lo asume: sigue usando `HERMES_SUPERVISORES`
  tal cual está hoy.
- **No hay UI para que un supervisor vea "las conversaciones de las diferentes líneas" como una
  vista nueva** — la parte final del pedido ("a partir de eso el supervisor va a poder revisar
  las diferentes conversaciones de los diferentes números") **ya existe**: los supervisores ven
  todo sin filtro (no están sujetos a "Las mías"), y el selector de línea de la cola
  (`?linea=`) ya lista cualquier línea viva, incluidas las auto-vinculadas — no hizo falta
  construir nada nuevo para esa mitad.

## Próximos pasos (sin hacer todavía)

1. Correr los tests de base con Docker levantado.
2. Revisar el diff (`git diff` contra `origin/main` en el worktree).
3. Commit + PR (`goberna-pr`) — no se hizo en esta sesión, a la espera de una decisión explícita.
4. Probar con un teléfono real (la prueba de fuego del montaje en caliente: nunca antes se había
   montado una línea whatsmeow sin reiniciar el proceso).
