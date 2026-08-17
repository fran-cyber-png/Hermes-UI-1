# Hermes — reglas para Claude

**Hermes es el CRM de la Escuela**: una app de escritorio (Tauri; la UI vive en el server — OTA) donde
una vendedora de Goberna atiende, desde una sola pantalla, a toda la gente que levantó la mano por
**Facebook, Instagram, Messenger y WhatsApp** — con la ficha del contacto al lado del chat, y
registrando la venta contra Cerberus. Negocio: la **Escuela** de Goberna (formación política, LATAM).

Extraído de `meta-escuela` preservando historia git (ADR 0001). Plan en `docs/plan-hermes-mvp.md`,
concepto en `docs/concepto.md`.

> 📐 **Qué es este archivo, desde ADR 0045**: acá va **lo que frena un error antes de que lo cometas**
> — la trampa, el archivo donde vive la regla, el comando. **El fundamento de cada decisión vive en su
> ADR**, y cada sección dice cuál; un frente sin ADR apunta a `docs/claude-md-2026-08-09-completo.md`,
> que es este archivo entero antes del recorte. **Si agregás un frente, escribí el ADR y dejá acá solo
> los 🔴.** El 🔴 es para lo que YA mordió o muerde en silencio; no lo repartas.

Los cinco documentos: `CONTEXT.md` glosario del negocio · **`docs/mapa.md` el inventario, GENERADO
(`npm run mapa`)** · `docs/arquitectura.md` la forma y el porqué · `docs/estado.md` la foto de hoy ·
`docs/adr/` las decisiones.

> 🔴 **`docs/arquitectura.md` YA NO CUENTA NADA, y ésa es la corrección** (ADR 0057). Hasta el
> 16-ago-2026 se llamaba a sí mismo «el mapa» y traía las cifras a mano: decía ~39 archivos vivos y
> 27 routers cuando había **680 y 49**. Nueve días después de escrito describía un repo **ocho veces
> más chico**, y nada se puso rojo porque nada lo miraba. **Lo contable se mira en `docs/mapa.md`,
> que se genera del árbol**; en `arquitectura.md` queda lo que un generador no puede derivar.

> ⚠️ **Este repo tiene DOS MITADES.** La extracción se trajo el árbol entero de meta-escuela, así que
> conviven el CRM que se usa (~39 archivos: `whatsapp` `auth` `cerberus` `cola` `realtime`, 13 de 27
> routers) y el dashboard de pauta del que salió (~45 archivos: `analisis` `canales` `decisions`
> `pauta` `ontologia` `fuentes` `sdk`, 14 routers). **Ninguna acción de la vendedora alcanza la
> segunda mitad.** No está rota, está desconectada — y los comentarios de `server/src/index.ts`
> describen la arquitectura vieja, así que engañan. Ver `docs/arquitectura.md` §2.

## El mapa y sus candados (**ADR 0057**)

`npm run mapa` regenera `docs/mapa.md` · `npm run mapa:verificar` es lo que corre en **N1 del CI**.
Lo único escrito a mano es **`arquitectura.json`**: seis reglas con su porqué medido, y **la
responsabilidad declarada de cada módulo** — la línea que decide si un archivo nuevo va ahí o no.

- 🔴 **`handlersEnvueltos` — todo handler async de `routes/` va adentro de `ruta()`**
  (`server/src/lib/ruta.ts`). Express 4 **no atrapa el rechazo de un handler `async`**: se vuelve
  `unhandledRejection` y **el proceso se cae**. Ya dejó a las cinco vendedoras sin Hermes
  (`routes/auth.falloDeBase.test.ts`).
  ⚠️ **La regla dice «está envuelto», NO «tiene un try/catch»**, y la diferencia es todo: en
  `venta.ts POST /crear` el `try` abre en la 129 y el `await crearVenta(...)` de la 120 queda
  AFUERA; y en `autorespuesta.ts` los cuatro handlers hacían `catch (e) { if (!faltaEsquema(e))
  throw e; … }`, o sea que el try era el mecanismo que **garantizaba** el escape. «Tiene un try» no
  se puede chequear con un grep; «está envuelto», sí.
  ⚠️ `ruta()` **no reemplaza a los errores TIPADOS** (`no_es_supervisor`, `adjunto_muy_pesado`, los
  ocho de Ivi): ésos son respuestas deliberadas que la pantalla ramifica. Y **nada devuelve
  `err.message` al cliente**: con drizzle ese mensaje es el SQL — se loguea con `porQueFallo`.
- **El server también tiene capas declaradas** (#388): `db`·`lib`·`telefono` (0) → negocio (2, por
  `capaPorDefecto`) → `routes`·`webhook`·`scripts` (3) → `index` (4). No hubo que construirla:
  **259 de 260 aristas ya la respetaban**.
  🔴 **Al server NO se le inventa una capa `dominio` como la del front**: medido, arrancaría con 6 a
  18 violaciones. Allá 58 de 148 imports cruzados apuntaban a UN módulo (`canales`); acá el archivo
  más pedido concentra 7 de 129 (5,4 %). El piso de negocio del server es plano de verdad.
- ⚠️ **Las 15 galerías (`features/*/galeria*.tsx`) NO entran al grafo**, como los tests: ninguna la
  importa la app —cada una se sirve por su `galeria-*.html`— y estaban inflando el termómetro (el
  nudo de 7 del front era de 3). La exclusión se imprime en el mapa: no es silenciosa.

- 🔴 **`mapa:verificar` falla si el mapa quedó VIEJO, no sólo si hay violaciones.** Compara
  `docs/mapa.md` byte a byte contra el que se generaría hoy: mover un archivo sin regenerar pone el
  CI rojo. Es lo único que impide repetir `arquitectura.md`. ⚠️ **Corolario**: el generador no puede
  imprimir fechas ni contadores de corrida — cualquier dato que cambie solo rompe la comparación.
- ⚠️ **Si agregás un módulo, escribí su responsabilidad en `arquitectura.json` o el CI no pasa**
  (`moduloDeclarado`). Es a propósito: un módulo sin responsabilidad es uno del que nadie puede
  decir qué le corresponde.
- 🔴 **`sinCiclosDeArchivo` NO es «cero ciclos entre módulos», y confundirlos cuesta un trimestre.**
  Medido: el grafo de MÓDULOS daba un nudo de 18 (casi todo el front) y otro de 22; el de ARCHIVOS,
  **tres pares**. El código ya era un DAG — lo enredado eran las fronteras de las carpetas. Los
  nudos de módulos se **reportan** como termómetro y bajan solos al sacar lo compartido a su capa.
  **Antes de proponer un reordenamiento por ciclos, medí a nivel de ARCHIVO.**
- 🔴 **Los cuatro routers exentos de `routersSinSqlInline` se MIDIERON, no se dedujeron**:
  `costoPorLead` (ni montado en `index.ts`), `decisions`, `leads`, `overview` — cero llamadas desde
  `src/`. Reescribir código que nadie ejecuta para satisfacer una regla es riesgo sin beneficio.
- 🔴 **UNA REGLA NUEVA REPORTA SU PROPIO BUG ANTES QUE EL DEL REPO.** `docsSinRutasMuertas` dio 226
  violaciones y las dos causas grandes eran defectos míos: la alternancia `(?:ts|tsx)` matcheaba
  `Avatar.tsx` como `Avatar.ts` (**60 falsos positivos** — va `tsx` primero), y el mapa **se citaba
  a sí mismo** al listar las rutas muertas (**123 más**). Antes de mandar a arreglar N cosas, abrí
  diez y comprobá que están mal de verdad.
- 🔴 **LOS TESTS-CANDADO QUE LEEN EL ÁRBOL NO LOS ALCANZA EL COMPILADOR.**
  `whatsapp/lid.paridad.test.ts` abre un archivo del FRONT con `new URL(...)`. Moverlo fue un
  **ENOENT en ejecución** con el typecheck de las dos mitades en verde. Al mudar un archivo que
  algún test cruza por ruta, `grep -rn` de la ruta vieja en `src` y `server/src` **antes** de
  darlo por bueno.

## Stack

- **Front** (`src/`): React 19 + Vite 8 (React Compiler), Tailwind 4, TanStack Query, lucide-react.
  **Sin router** — un espacio con vistas conmutadas por estado (ADR 0002): Dashboard · Pipeline ·
  Contactos · Mensajes · Correos · Agenda · Entrenar bot · Libreta · Navegador (⌘1..⌘9) · **Routing**.
  ⚠️ **El rango se DERIVA de `VISTAS`**: agregar una vista es tocar ese array y nada más, y el candado
  que importa es el de la ÚLTIMA — un número clavado dejaría andando a todas menos esa.
  🔴 **Y con la DÉCIMA el rango se derivaba y estaba mal igual** (ADR 0053): comparaba **cadenas**
  (`e.key <= String(VISTAS.length)`), y `'2' <= '10'` da **false** — quedaba andando ⌘1 y se rompían
  las ocho del medio. El candado de «la ÚLTIMA» **no puede ver esto**: la décima no tiene tecla (no
  existe ⌘10), así que ese test ni se puede escribir y el que se pone rojo es ⌘2. Ahora se compara el
  NÚMERO y el tope es `Math.min(vistas.length, TECLAS_DE_VISTA)`, donde 9 es **cuántas teclas de
  dígito hay**, no un tope de diseño. De la décima en adelante el `title` **no promete** una tecla.
  ⚠️ **Y el riel ya no es igual para todas**: una entrada puede llevar `soloPara`
  (`features/vistas/acceso.ts`), y **el riel, los ⌘N y la Cabina leen la MISMA lista filtrada**
  (`vistasDe`) — con dos, la cabina anuncia un número que abre otra vista. Eso es **visibilidad, no
  una frontera**: esconder algo del riel no protege nada, el recorte de datos va en el `WHERE` de su
  ruta (ADR 0035/0036).
  Qué entra al riel es un criterio, no un número (**ADR 0034**, enmienda 0002): un **LUGAR** con
  **acción primaria nombrable**; lo que se consulta y se cierra —Cabina `?`, Ivi `i`— no entra.
  Marca en `src/index.css` (azul + dorado, Montserrat; **el dorado significa tiempo que se acaba**,
  nada más). Norte de producto: `docs/plan-crm-definitivo.md`. El **caché de consultas se persiste en
  IndexedDB** y se restaura antes del primer render (ADR 0007, `src/lib/datos/`).
  **TRES CAPAS, y el CI las verifica** (ADR 0057): `lib` · `components` (capa 0, no saben de
  negocio) → **`src/dominio/`** (capa 1: qué ES una conversación — `conversaciones`, `cola`, `canal`,
  `curso`, `ventana`, `antiguedad`, `cliente`, `dueno`, `lineas`, `fotoVisible`,
  `conversacionNueva`, `paletaCategorias`, `desglose`; importa `lib` y nada más) → `features/*`.
  🔴 **`dominio/` nació de una medición**: el modelo vivía adentro de `features/canales` —que es la
  VISTA de la cola— así que **58 de los 148 imports cruzados del front (39 %) entraban a una feature
  a buscar el modelo**, y `conversaciones.ts` sola tenía 36 consumidores de afuera. Sacarlo partió
  el nudo de 18 módulos en 7 · 3 · 2. ⚠️ El caso que lo explica es `desglose.ts`: `FilaDesglose`
  vivía en `vistas/tablero.ts`, o sea que el modelo importaba una PANTALLA para tipar la respuesta
  de su propia consulta.
- **Escritorio** (`src-tauri/`): **Tauri v2** — la cáscara solo abre `https://hermes-api.goberna.us`
  (OTA; fallback al dist local). Windows se compila en Actions (`tauri-windows.yml`), no cross-compila.
  **Electron se archivó el 7-ago-2026 (ADR 0039)**. `dev:app` es `tauri dev`, `empaquetar:mac` es
  `tauri build`.
  ⚠️ **`base: './'` en `vite.config.ts` NO se saca** aunque su comentario hable de Electron: el
  fallback local carga el build sin server detrás, y con rutas absolutas abre en blanco — o sea que el
  defecto aparecería **solo durante una caída**.
  🔴 **Un comando propio de Tauri necesita permiso declarado o anda en dev y falla en producción.** La
  ventana `main` navega a un origen **remoto** y Tauri chequea el ACL para todo pedido no local. Se
  declara en `src-tauri/permissions/*.toml` y se referencia en las **dos** capabilities
  (`default.json` y `remote.json`). Los tests de `lib.rs` lo fijan invocando por el IPC real con la URL
  de producción (ADR 0040 §5.3).
- **Server** (`server/`): Express 4 + Drizzle ORM + Postgres 17 (imagen pgvector, puerto **5434** en
  local) + Zod 4. Event store append-only + proyecciones.
- **WhatsApp**: `@whatsmeow-node/whatsmeow-node` (protocolo no oficial, binario Go vía subprocess).

## Correr en local

```bash
docker compose up -d --wait                       # Postgres (event store), en la raíz del repo
cd server && npm install && npm run dev            # API en :4100 (necesita server/.env)
npm install && npm run dev:app                     # la cáscara Tauri (arranca Vite :5173 sola)
```

- `npm run dev` (sin `:app`) abre el front en el navegador: la cola y la conversación funcionan.
- **Tests**: server `cd server && npm test` (node:test); front `npm test` (vitest, entorno `node`).
  **Typecheck**: front `npx tsc --noEmit -p tsconfig.app.json`, server `cd server && npx tsc --noEmit`.
- **Tests de COMPONENTE (con DOM)**: `*.test.tsx` con `// @vitest-environment jsdom` en la **primera
  línea** (por archivo, no global). El andamio vive en `src/pruebas/dom.tsx`: `montar(<X/>)`,
  `teclear('Escape')`, `await reposar()`. Existen porque **una regresión de teclado no la puede ver
  ningún test puro**: `escapeDePopover.ts` estaba testeada hasta el hueso y la app perdió igual el
  Escape global, porque el defecto estaba en el CABLEADO (ADR 0024).
- **Tests con base (SQL)** (ADR 0008): `docker compose -f docker-compose.test.yml up -d --wait`, luego
  `cd server && npm run test:db`. Archivo `*.test.db.ts` (el glob puro no lo toma), `const db = await
  baseDePrueba(t)` (`src/pruebas/base.ts`), sembrás con `src/pruebas/sembrar.ts` y le pasás **ese
  `db`** al seam (`consultarRadar(db)`…), nunca al singleton. Ejemplo: `src/pruebas/humo.test.db.ts`.
  Guardia hard-fail anti-prod (5442, nunca 5438/5434/5439 — este último es de OTRO proyecto
  desde el 16-ago-2026, ver ADR 0008).
- **Refrescar datos de Meta**: `cd server && npm run ingest:interactions` (polling manual, read-only).
  ⚠️ **Desde el 7-ago-2026 NO es el camino principal** (lo es el webhook): queda como red de seguridad
  y como lo único que puede traer lo VIEJO.

## WhatsApp — la costura y la vinculación

> Detalle: `docs/claude-md-2026-08-09-completo.md` §WhatsApp · banco de pruebas en
> `docs/plan-banco-de-pruebas.md`.

- **Todo pasa por la interfaz `TransporteWhatsapp`** (`server/src/whatsapp/transporte.ts`). Habla
  **teléfonos, nunca JIDs** (la conversión vive en `identidadWa.ts`). **DOS implementaciones, no
  tres**: `falso` (dev/tests) y `whatsmeow` (real), elegidas por `WHATSAPP_TRANSPORTE`.
  ⚠️ **`cloud-api` NO existe como transporte** (verificado el 29-jul-2026). De la Cloud API existe solo
  **la mitad que RECIBE**: `server/src/webhook/whatsapp.ts` + `firma.ts` (#107, HMAC). Importa para
  cualquier discusión de mover el bot: mientras el canal sea whatsmeow, el envío vive **atado a VPS1**
  (proceso Go largo, sesión en `.wa-sessions/<numero>.db`) y no se puede mudar a un edge.
- **Vincular un número** = server-side, aparte de la app (**D13**): `cd server && npm run wa:vincular
  -- <numero>`. ⚠️ **Se vincula por QR, no por código de 8 dígitos** (`vincular.ts:47-56` lo renderiza
  a `$TMPDIR/hermes-wa-qr.png` y lo rota cada ~20 s; el pairCode por número daba 400 en este número).
  La sesión queda en `server/.wa-sessions/` — **gitignored: es la credencial de la cuenta, NUNCA se
  commitea**.
  ⚠️ **Y esa credencial no va en una laptop**: el 29-jul se encontró la línea de VENTAS en el checkout
  de desarrollo. El `.gitignore` cubre **el nombre exacto** `.wa-sessions/`, así que renombrar ese
  directorio deja 43 MB de credencial a la vista de git. Para desarrollo va `WHATSAPP_TRANSPORTE=falso`.
  🔴 **Desde el 15-ago-2026, D13 ya NO es absoluto: la app de la vendedora TAMBIÉN vincula.**
  Decisión del dueño, **enmendada el 18-ago-2026**: **cualquiera del equipo, supervisoras incluidas**,
  puede traer su propio número — **solo 1**— escaneando el QR desde adentro de Hermes (`PanelUsuario` → «Vincular tu WhatsApp» →
  `server/src/routes/miLinea.ts`, `POST /api/whatsapp/mi-linea/vincular`). Reusa el MISMO vinculador
  global de D13 (uno-a-la-vez en todo el server); lo que cambia es quién lo dispara y que la línea se
  monta **en caliente** (`whatsapp/wiring.ts:agregarLineaWhatsmeow`, sin `WHATSAPP_NUMEROS` ni reinicio).
  Cerberus sigue siendo la ÚNICA vía para líneas de Escuela o de campaña; esto es solo `proposito:
  'vendedora'`, y el número queda atado 1:1 a quien lo trajo (`numeros/autoVinculacion.ts`).
  ⚠️ **El veto que queda es del SERVER, no de la persona**: `numeros/autoVinculacion.ts` pregunta
  primero **`WHATSAPP_TRANSPORTE=whatsmeow`**, porque `Vinculador.iniciar()` hace
  `createClient({ store: .wa-sessions/<n>.db })` **sin mirar el transporte** — un botón escribiría
  43 MB de credencial real en VPS1 para un server que nunca va a montar esa línea.
  🔴 **Este archivo decía «producción corre `falso`, así que contesta 409» y quedó VIEJO**: medido el
  18-ago-2026 en el `.env` de VPS1, **`WHATSAPP_TRANSPORTE=whatsmeow`**. O sea que la puerta está
  abierta de verdad. **Antes de afirmar que este frente está apagado, `grep WHATSAPP_TRANSPORTE` en
  el `.env` de VPS1** — no lo deduzcas de acá.
  🔴 **Y el veto por ROL se retiró el 18-ago-2026** (enmienda del dueño). Antes `esSupervisor()`
  rechazaba con `es_supervisor`, y en producción eso eran tres personas reales
  (`HERMES_SUPERVISORES` = `ventas10@grupogoberna.com`, `alan`, `Usuario1`). **Lo que NO se tocó es
  el tope de UNA línea por persona**: se sacó el veto de quién, no el de cuántas — y hay test que se
  pone rojo si alguien los confunde.
  ⚠️ **No sobrevive un reinicio.** El montaje en caliente vive solo en el proceso: si el server
  reinicia (N5, un crash), la línea auto-vinculada no vuelve a montarse sola — sigue siendo
  `WHATSAPP_NUMEROS` + reinicio manual lo que la trae de vuelta, igual que hoy con una línea de
  Cerberus. Cerrar esa brecha del todo es sacar el arranque de esa variable y leerlo de `numeros_wa`
  (anotado como #194 en `numeros/dominio.ts`) — frente aparte, no resuelto acá.
  🔴 **Y eso NO es una molestia, es la precondición**: medido, producción reinicia **24 veces por
  semana** con mediana de **1,36 h** entre reinicios. Una línea auto-vinculada tiene vida esperada
  de HORAS. **Sin #194 esto no se puede prender**, y el workaround «agregala a `WHATSAPP_NUMEROS`»
  tampoco alcanza mientras el transporte esté en `falso`: ahí `wiring.ts` ni siquiera lee esa lista.
  ⚠️ **Si el montaje en caliente falla, la fila QUEDA** (no hay `quitar` en `GestorWhatsapp`): la
  respuesta trae `montada: false` y la pantalla lo dice en vez de festejar. El reintento es **volver
  a vincular el MISMO número** — «solo 1» es cuántas líneas, no cuántas veces. Una línea que YA está
  montada se rechaza con `linea_ya_corriendo`: el vinculador y el transporte abrirían el mismo `.db`
  y SQLite no admite dos escritores.
- **El webview viejo ya no existe**: `PanelWhatsapp.tsx`, `cuentas.ts`, `whatsapp/tipos.ts` y los tres
  preloads de `electron/` se borraron con ADR 0039.
- **Nada de automatización, con UNA excepción escrita**: no envío masivo, no warmup, **no anti-ban**.
  Un envío = una acción humana, por `EnvioControlado` (la única puerta hacia `enviarTexto`). El
  `temporary_ban` **se muestra siempre**, nunca se esconde.
- **LLAMADAS DE VOZ — habilitadas en la línea del bot, y todavía NO se puede llamar.** Medido el
  3-ago-2026 en `51984429504`: `calling.status = ENABLED` con `call_icon_visibility = DISABLE_ALL`,
  oculto a propósito (sin WebRTC ni SIP no hay con qué atender; 2 llamadas sin responder restringen, 4
  revocan). ⚠️ **Primero el webhook, después el switch**: Meta rechaza habilitar el calling si la app
  no está suscrita al campo `calls` (error **138018**) — es al revés del orden intuitivo. **No se puede
  llamar en frío**: hace falta `call_permission_request` (`npm run wa:permiso-llamada -- <numero>`,
  dry-run por default), 1/día y 2/semana por persona, con la ventana de 24 h abierta; **ese permiso
  decide si el frente entero vale la pena**. Las líneas de las vendedoras no entran (whatsmeow no puede
  iniciar ni aceptar llamadas). Los eventos se guardan crudos en `events` (`source='meta_wa_call'`) y
  la clave de idempotencia (`webhook/llamadas.ts`) **lleva el evento**: una llamada manda varios
  webhooks con el mismo `id` y sin eso se perdía el `terminate`, el único que trae `duration`.

### La auto-respuesta fuera de horario (#125, **ADR 0015 · 0016 · 0018 · 0020**)

Del tamaño exacto del agujero que tapa: 44 % de los leads llega fuera de horario y el 44 % de esos
nunca recibe respuesta. Solo puede mandar **un acuse de una plantilla registrada** a quien **escribió
primero**, **fuera de la franja**, tras **30 min sin respuesta humana**, **una vez por día**, y **nunca
a quien dijo que no**. Nada de eso se negocia en un `if`: vive en `server/src/autorespuesta/`.

- **La franja se pregunta DOS veces, y la que importa es sobre el MENSAJE** (#166, ADR 0020):
  `dentroDe(ahora)` = «¿hace falta?», `dentroDe(ultimoEntranteEn)` = «¿corresponde?». Con una sola, a
  la 1 AM calificaba todo el mundo (25 de 40 borradores eran de gente que escribió en horario). Motivo
  `escribio_en_horario`. **Hay techo de antigüedad además del piso**: `AUTO_RESPUESTA_MAX_ESPERA_H`
  (12 h), motivo `espera_excesiva`.
- **Ninguna plantilla dice que es automática** — decisión del dueño del 27-jul que **revierte
  ADR 0015**. `plantillas.test.ts` **prohíbe** «automático», «bot» y «sistema».
- **Una despedida no es una consulta esperando respuesta** (`conversacion_cerrada`). Las tres formas de
  decir que no viven en `rechazo.ts`. ⚠️ **«gracias» a secas NO es despedida**, y `PIDE_ALGO` no puede
  llevar una palabra que aparezca dentro de una frase de rechazo («necesito» rompería «no es lo que
  necesito»).
- **DOS MODOS: apagada · supervisada** (ADR 0018). **Hermes no manda solo: siempre hay una persona
  aprobando.** `automatica` se retiró: `PUT /modo` con ese valor responde **409 `modo_retirado`** y
  `PUT /interruptor {encendida:true}` deja **supervisada**. ⚠️ El valor sigue siendo **representable** a
  propósito (`MODOS` lo tiene, `MODOS_ELEGIBLES` no): una fila vieja puede tenerlo y `leerModo` debe
  devolverlo tal cual, o la pantalla diría «apagada» mientras el despachador manda.
  La garantía del modo supervisado es una línea: lo preparado queda en `preparada`, y `EN_COLA_DE_ENVIO`
  (`autorespuesta/estados.ts`) **no lo incluye**. `preparada → enviada` no existe.
- **El MODO REVISIÓN pasa DENTRO del chat** (ADR 0018): la vista Mensajes filtrada — `ColaRevision.tsx`
  a la izquierda, la conversación real al centro, `PorQueEstaSugerencia.tsx` arriba de la ficha, el
  borrador en el composer. El botón dice **Aprobar**, no Enviar. Se entra por el renglón del chip o con
  **`a`**; **`⌘↵`** aprobar · **`⌘D`** descartar · **`⌘↓`/`⌘↑`** saltar · **`Esc`** salir (acordes: el
  foco vive en el composer). ⚠️ La sugerencia **no** se guarda en el Map de `borradorComposer.ts`, y en
  revisión **Enter no manda**. **Aprobar en lote se retiró en ADR 0020.** Estado en `useModoRevision.ts`,
  el «a cuál voy» puro en `revision.ts`, caducidad (3 h, nunca cruza el día) en `caducidad.ts`.
- **Apagada por default y con dos llaves**: `AUTO_RESPUESTA=on` **y** el interruptor de base
  (`auto_respuesta_estado.modo`), que es el **kill-switch sin deploy** — `PUT /api/autorespuesta/modo`,
  manejado desde el chip de la cabecera con los dos segmentos a la vista. Sin la migración dice «falta
  la migración» en vez de un estado falso.
- **La plantilla depende de la CAMPAÑA** (`autorespuesta/campana.ts`): interés asentado > formulario >
  anuncio, la MISMA precedencia del chip de curso (#72). **Cuál de los tres ganó se GUARDA**
  (`campana_fuente`): es el «por qué» que el panel muestra, y sin él una recomendación no se puede
  supervisar, solo obedecer.
- **El ritmo es el contrato**: un envío a la vez, 60–240 s entre uno y otro, lo de la madrugada recién
  desde las 7:30, techos de 20/hora y 60/día por número. Freno TOTAL ante `temporary_ban`, error de
  envío o desconexión; cancelación si la vendedora responde; la cola se cancela al empezar el horario.
- **Antes de prenderla, siempre**: `cd server && npm run auto:simulacro` — imprime el plan real **sin
  mandar nada**, y cada renglón empieza por **la hora local en que escribió la persona** y **cuánto
  lleva esperando** (#166): el plan del 27-jul se veía impecable y estaba mal de siete formas porque
  mostraba la hora de SALIDA. `--hora 03:00` mueve el reloj, `--demo` corre sin base.
- Los envíos automáticos quedan en `envios_wa.automatico` y **se ven en la burbuja**: desde ADR 0016
  distingue «Automático» de «Aprobado · ana». **Sigue prohibido**: generar texto libre, iniciar
  conversaciones y cualquier mecanismo cuyo fin sea que el tráfico no se detecte.

### La campaña por plantilla aprobada (`npm run campana`, **ADR 0055**)

Dry-run por default; `--enviar` manda. Dos orígenes de público: `--desde/--hasta` (quien **escribió**
a la línea: es seguimiento) y **`--lista <csv>`** (un padrón de afuera: **eso es contacto en frío** y
enmienda ADR 0015 §37 — lo autoriza el dueño, no el hecho de que el modo exista). El encabezado
imprime **«🧊 CONTACTO EN FRÍO»** para que no haya que deducirlo de los flags.

- 🔴 **RENOMBRAR LA PLANTILLA APAGA EL CANDADO DEL DOBLE ENVÍO.** La guarda compara `pieza_ref`
  contra la plantilla de ESA corrida, y **Meta obliga a crear una plantilla nueva para cambiarle una
  letra al texto**: la segunda campaña de un evento —el caso normal— es justo donde deja de
  reconocer a quien recibió la primera. Medido: con la v2 salían **244 en vez de 104** sobre 245, y
  el simulacro decía «1 porque YA recibieron esta campaña». Se declara con
  **`--ya-recibieron <refs>`**, que alimenta las tres preguntas vía `PIEZAS_QUE_BLOQUEAN`.
- 🔴 **UN TELÉFONO MALFORMADO NO CUESTA UN MENSAJE: CUESTA LA CORRIDA** (el bucle frena ante
  cualquier error que no sea `131049`), y un número mal leído **le llega a otra persona**.
  `campana/lista.ts` acepta sólo las dos formas que se leen de UNA manera (9 dígitos con 9, o
  `51`+eso) y descarta el resto **con su motivo**. No se adivina `512221285857` ni se arregla
  `5151997604093`.
- 🔴 **`reasignar()` NO VERIFICA EL DESTINO Y ESTE SCRIPT NO PASA POR `/api/reparto`.** Un dedazo en
  `--asignar-a` escribía filas válidas con un `vendedora_id` inexistente y esas conversaciones
  desaparecían de la cola de todos, sin síntoma. Se verifica **antes de leer nada**.
- ⚠️ Con `--lista` se apagan dos vetos y el simulacro **los nombra**: «llegó por un anuncio» (nunca
  escribió, no puede tener uno) y «ya compró» (mira `clientes_padron` = «compró ALGO», y un padrón
  de prospectos son clientes por definición). **Que no compraron ESTE producto se garantiza al
  generar la lista, contra `icarus.sales`** — el script no te salva de eso.
- ⚠️ **Un `fetch failed` no es un rechazo de Meta**: cortó una corrida en el 446 de 999 con la línea
  GREEN. La clasificación vive pura en `campana/reintento.ts`, con 3 reintentos.
- ⚠️ **Mirá el renglón de «RETENIDO por Meta (pacing)»**: con una plantilla nueva Meta retiene parte
  de los mensajes y **descarta los que siguen si las señales salen mal**. «Salieron 1.000» puede
  querer decir «Meta aceptó 1.000 POSTs y soltó 200».
- **El orden de magnitud, medido**: `foro_estado_5_ago` fueron 1.000 mensajes → **31 respuestas y 1
  compra**. Y sale por `51984429504`, la **única línea que trae leads**.

## El navegador vive ADENTRO de la mesa — webview hijo (ADR 0043, enmienda 0040)

La vendedora sale a la web con la **sesión de trabajo**, separada de su Chrome personal, sin salir de
Hermes: `src/features/navegador/` (vista ⌘9) + comandos `navegador_*` en `src-tauri/src/navegador.rs`.

- **Por qué NO un `<iframe>`**: `app.goberna.us` manda `X-Frame-Options: DENY`, y los dos destinos que
  motivaron el frente tampoco entran (`chatgpt.com` `SAMEORIGIN`, `accounts.google.com` `DENY`).
- 🔴 **Medido ANTES de construir, y era la precondición del frente**: Google **no bloquea** el webview
  embebido. ⚠️ **Medido en macOS/WKWebView; Windows/WebView2 sigue SIN verificar**, y las vendedoras
  usan Windows. Tampoco se probó el login completo ni que la sesión sobreviva al reinicio.
- 🔴 **UN WEBVIEW HIJO ES UNA CAPA DEL SO ENCIMA DEL DOM**: tapa lo que caiga en su rectángulo. La vista
  lo **esconde** cuando hay algo encima (`tapado = cabina || ivi` en `App.tsx`) y al desmontarse. La
  costura vive en UN lugar (`useNavegadorEmbebido.ts`), con test de DOM. **Una capa nueva sobre la mesa
  hay que sumarla a `tapado`**; el síntoma de olvidarse es que aparece detrás.
- 🔴 **LAS CAPABILITIES ACOTAN POR `webviews`, NO POR `windows` — y esto es seguridad, no estilo.** El
  ACL resuelve con un **O** (`ipc/authority.rs:459`): con `"windows": ["main"]` el webview hijo matchea
  por su VENTANA, o sea que `chatgpt.com` quedaba a **un solo candado** de la API nativa. Con
  `"webviews": ["main"]` quedan los dos (label y origen).
  `el_navegador_embebido_no_alcanza_ningun_comando` lo fija y **se verificó que se pone rojo**.
- 🔴 **DOS GUARDAS CON DOS SUJETOS DISTINTOS, y no se colapsan.** `validar()` juzga **lo que la
  vendedora pide**: solo `https`. `navegacion_permitida()` juzga **a dónde el sitio se lleva al webview
  solo**, y es lista NEGRA (`file:`, `javascript:`, `tauri:`, `data:`). Endurecer la segunda copiando la
  primera **rompe el login de Google** (salta por `about:blank`) y media web que redirige de `http`.
- **Atrás/adelante van por `history` y están siempre habilitados**: Tauri no expone el historial. **La
  barra de direcciones SONDEA** `navegador_donde` 1×/s porque el front no tiene `@tauri-apps/api` a
  propósito (la UI se sirve por OTA) y media navegación de un login la hace el sitio solo.
- **Sin almacén propio para el hijo**, a propósito: `data_store_identifier` es macOS ≥ 14 y
  `data_directory` abre un segundo entorno de WebView2 en Windows.
- Ver sin server: `npx vite --port 5199` → `/galeria-navegador.html`. ⚠️ **El webview embebido NO se
  puede fotografiar desde un navegador común**: hay que apuntar el `devUrl` de `tauri dev` a esa galería
  con `?ir=<sitio>` y `HERMES_DEV_EVIDENCIA=1` (sin eso `screencapture` fotografía la app INSTALADA,
  porque las dos son el proceso `app`). Capturas: `docs/evidencia/navegador-*.png`.
- 🔴 **LOS TESTS DE LA CÁSCARA NO SON GATE DE PR, Y ESO YA COSTÓ UNA ROTURA INVISIBLE.** `ci.yml` corre
  en runners self-hosted sin Rust (desde el 18-ago-2026 los de CI están en VPS2; tampoco lo tiene); los de la cáscara viven en `tauri-windows.yml`, que es
  `workflow_dispatch`. Medido el 9-ago-2026: **el último build verde de Windows es del 4-ago**, y hoy
  falla en «Tests de la cáscara» con `STATUS_ENTRYPOINT_NOT_FOUND` (`0xc0000139`) — el binario de test
  compila y no arranca, así que **no hay `.exe`**. Es de **ADR 0040**, no de 0043 (verificado disparando
  el workflow sobre `6803145`). Pista: falta `WebView2Loader.dll` al lado del `.exe` de test.
  ⚠️ **El frente que toca `cargo test` de `src-tauri/` tiene que disparar `tauri-windows.yml` a mano en
  su PR** — si no, los está escribiendo a ciegas.
  · **Desde el 12-ago-2026 el BUILD VA PRIMERO y los tests llevan `continue-on-error`.** El motivo:
    un test roto le estaba secuestrando el instalador a las vendedoras, que son las que están en
    Windows — el crate compila, lo que no arranca es el binario de test, y como el paso cortaba el
    job **no salía `.exe` desde el 4-ago**. Un test roto tiene que costar el test, no el instalador.
    🔴 **El precio, y hay que tenerlo presente**: `cargo test` ya **no puede voltear el workflow**, y
    ahí adentro vive `el_navegador_embebido_no_alcanza_ningun_comando`, la guarda del ACL de ADR 0043.
    O sea que ahora **hay que MIRAR el paso, no el resultado del job**. Devolverle el poder de corte
    es lo correcto el día que `STATUS_ENTRYPOINT_NOT_FOUND` se arregle.
- 🔴 **LA CÁSCARA Y LA UI SE DESPLIEGAN POR CAMINOS DISTINTOS, y eso rompió el frente el día 1.**
  «Command abrir_navegador not allowed by ACL» **no era la config**: la UI viaja por OTA y llega en el
  acto, pero el `.dmg`/`.exe` se reinstala a mano, así que ninguna cáscara instalada tenía el comando.
  Ahora un rechazo de «no tengo ese comando» **cae al peldaño de abajo** (`navegador/cascara.ts`, puro y
  con tests). ⚠️ Un rechazo de `validar()` NO cae al fallback, y lo que separa los dos casos es que
  **nuestros mensajes están en castellano y los de Tauri en inglés** (hay test).
- 🔴 **La escalera tiene TRES peldaños**: (1) cáscara con el embebido → el viewport de adentro;
  (2) cáscara vieja con `abrir_navegador` → la ventana aparte de ADR 0040; (3) fuera de Tauri → el
  navegador del sistema. **El peldaño se decide con el PRIMER INTENTO REAL, nunca preguntando si estamos
  en Tauri** (adentro de una cáscara vieja el puente existe y el comando no).
  ⚠️ **Y las máquinas están repartidas en DOS peldaños distintos** (10-ago-2026): el Mac de Estephano
  corre la cáscara **0.3.0** y ve el peldaño 1 — verificado comparando binarios, los diez comandos
  `navegador_*` están en el instalado y **ninguno** estaba en el 0.2.0 del 7-ago. **Las tres máquinas de
  las vendedoras siguen en ADR 0040 y no pueden salir de ahí**: son Windows, y el `.exe` no compila desde
  el 4-ago. O sea que el peldaño 2 no es transitorio — es lo que ve el equipo que vende.

## Instagram y Facebook — nunca se enchufó el caño (ADR 0042)

Medido capa por capa en VPS1 el 7-ago-2026: token **VIVO** de system user (no expira, ve 12 Páginas y
9 cuentas de IG), UI cableada, cola preparada — y **cero** eventos `meta_comment_fb`/`meta_comment_ig`/
`meta_message_fb`. La captura era un script manual que nadie corría y no había webhook.

- 🔴 **La lección**: `docs/estado.md` afirmaba «Cola unificada 4 canales» y era cierto del CÓDIGO y
  falso de la REALIDAD. **Antes de afirmar que un canal anda, contá filas en la base — no leas
  componentes.**
- **Ahora hay webhook**: `POST /webhook/meta` (objetos `page` e `instagram`), receptor en
  `server/src/webhook/meta.ts` + `metaPayload.ts` (la traducción, **pura**: el handler importa `db`).
  Misma firma HMAC y **el mismo `WHATSAPP_APP_SECRET`** (es el App Secret de la MISMA app de Meta, no
  algo de WhatsApp). Ack primero — Meta desactiva la suscripción si no ve 200.
- 🔴 **LOS DOS CAMINOS CONVIVEN.** Escriben con la MISMA función (`meta/proyectarInteraccion.ts`) y el
  MISMO `external_id`. Si alguien renombra un `source` de un solo lado, el comentario entra DOS veces y
  **no hay error ni log**. Candados: `meta/caminos.paridad.test.ts` (lee el archivo del polling) y
  `meta/caminos.test.db.ts` (escribe por los dos caminos, en los dos órdenes).
- **Los tres casos que mal leídos guardan una fila razonable y mienten en la pantalla**: `is_echo` es
  NUESTRO mensaje · `feed` trae TODO el muro (`verb: remove`/`hide` no es contenido) · **el webhook de
  comentarios de IG NO manda hora** (con 0 la fila cae en 1970, fuera de la ventana de 30 días:
  `momento()` usa la del `entry` y distingue segundos de milisegundos).
- ⚠️ **FALTA LA MITAD QUE NO ES CÓDIGO**: declarar el callback
  `https://hermes-api.goberna.us/webhook/meta` para `page` e `instagram` en el dashboard de la app, y
  después `cd server && npm run meta:suscribir` (dry-run por default, `-- --aplicar`). Sin lo primero, el
  script dice ✅ y no llega nada. **Verificá contando filas en `events`, nunca por un 200.**

## El bot de primera línea (**ADR 0028**)

> 🔴 **Este archivo no lo mencionaba, y es el SEGUNDO módulo más grande del server**: 32 archivos de
> código y ~8.000 líneas en `server/src/bot/` (13.119 con tests). Se agrega acá el 16-ago-2026 al
> encontrarlo con `docs/mapa.md`. El fundamento vive en su ADR y en los docblocks del módulo, que
> son de los mejor escritos del repo — **leelos antes de tocar nada acá**.

El bot contesta el primer turno con texto libre de un LLM, en las líneas que diga `BOT_LINEAS`.
Entra por el webhook, decide, y si manda, manda por la misma puerta que todo lo demás.

- **TRES MODOS y el vocabulario vive UNA vez** (`bot/modo.ts`): `apagado` · `sombra` · `automatico`.
  🔴 **Nació de un bug mudo**: `decision.ts` sabía de tres y `config.ts` tipaba dos con un `as` sobre
  el entorno, así que **`BOT_MODO=automatiko` pasaba el cast** y el bot quedaba ni apagado ni
  automático — pensaba y no mandaba, sin un aviso.
- 🔴 **`guardrails.ts` es lo ÚLTIMO que mira el texto antes de que lo lea una persona**, y sus tres
  prohibiciones no son estilo: **precio** (el bot no cotiza — lo comercial sale como pieza del
  catálogo, tal cual), **automatismo** (regla del dueño del 27-jul: el lead todavía no puede saber
  que hay una máquina) e **identidad**. Cada una revierte una decisión del dueño o una regla dura.
- 🔴 **SALTAR NO ES DESCARTAR** (`decision.ts`). De los nueve motivos de salto, **tres son
  transitorios** (el transporte vuelve, el tope de la hora se reinicia, alguien suelta el freno).
  El pipeline borraba el pendiente ante CUALQUIERA, así que el mensaje de un lead se perdía **para
  siempre** por una condición que dura minutos, y el lead nunca se enteraba de que escribió al vacío.
- 🔴 **DOS FRENOS ESTABAN MUERTOS Y EL TEST DEL MOTOR PASABA EN VERDE** (`frenos.ts`). `decision.ts`
  evalúa nueve motivos y está testeado hasta el hueso, pero `armarHechos()` le pasaba
  `huboSalienteHumanoDespuesDe: null` y `entranteEsRepetido: false` **fijos**: `vendedora_activa` y
  `spam` no se podían disparar nunca. **Es la forma más cara de un bug** — el motor decide bien
  sobre hechos que nadie recolecta. Al agregar un motivo, verificá que ALGUIEN lo alimente.
- **La identidad del lead tiene precedencia** (`identidad.ts`): lo dicho en el chat gana, después lo
  verificado de Cerberus, y último el nombre del perfil de WhatsApp. ⚠️ Para el PAÍS el último
  recurso es el prefijo del teléfono, que es **una probabilidad, no un dato**: se etiqueta «del
  prefijo del teléfono» y **no se persiste**.
- **`orquestador.ts` es un pipeline de 16 pasos**, uno por responsabilidad, que reemplazó al
  monolito `procesarClaim()` de `despachador.ts`. ⚠️ Algunos pasos son **stubs honestos** que pasan
  los datos sin tocarlos: el docblock dice cuáles.
- Se entrena y se mira desde la app (vista **Entrenar bot**), con sus corridas y lecciones
  (`server/src/corridas/`, `server/src/entrenamiento/`). Verificar sin mandar nada:
  `cd server && npm run bot:verificar` y `npm run reenganche:simulacro`.
- ⚠️ **`BOT_LINEAS` es aparte de `WHATSAPP_NUMEROS`**: si se olvida al retirar una línea, el bot
  queda habilitado sobre una línea muerta y **contestaría el día que se re-vincule**.

## Adjuntos: el tope es de la LÍNEA, y un video que no entra se achica acá

**El tope NO es de Hermes, es del transporte de esa línea** (`server/src/whatsapp/limitesMedia.ts`).
Cloud API: imagen **5 MB** (solo JPEG/PNG) · video **16 MB** (H.264+AAC) · audio 16 MB. Las líneas
whatsmeow **no** tienen esos topes (el único es `express.raw({ limit: '64mb' })`), y aplicarles los de
Meta rechazaría envíos que hoy salen bien.

- Se verifica **antes** de escribir a disco y de subir → **409 `adjunto_muy_pesado`** con las dos
  cifras. `GET /api/whatsapp/sesion` publica `transporte` + `limitesMedia`; eso es conveniencia, la
  garantía es el 409. ⚠️ El front lo lee como **opcional**: **sin N5 el arreglo no existe.**
  `limitesMedia.paridad.test.ts` lee el archivo del front y falla si las redacciones divergen (#37).
- **⌘V pega adjuntos** (`pegarAdjunto.ts`). ⚠️ El `preventDefault` va **solo cuando hay archivo**: uno
  de más rompe pegar texto y eso no se ve ni en un test de DOM ni en una captura. El nombre genérico
  (`image.png`) se renombra por fecha; el de un archivo copiado **se conserva** (entra en la versión de
  la pieza, ADR 0022).
- **Un video que no entra se achica en la app** (**ADR 0038**): `planDeCompresion.ts` (puro) decide y
  `comprimirVideo.ts` ejecuta con ffmpeg.wasm. **Bitrate primero, resolución solo cuando el bitrate ya
  no alcanza**; nunca un plan por debajo del mínimo de su resolución. El resultado **se mira antes de
  mandarlo**. Medido: 199 s para 2:13 de video (single-thread), se anuncia antes de empezar.
  · 🔴 **El core lo copia el plugin `goberna:ffmpeg-core` de `vite.config.ts`, dentro del build** (a
    `public/ffmpeg/`, gitignored, 32 MB). **NO un hook de npm**: estaba en `"prebuild"` y no corrió nunca
    en producción porque el pipeline invoca `npx vite build` DIRECTO. El deploy salió VERDE con la
    compresión rota, y encima invisible: **el fallback SPA de Express devuelve `index.html` con 200**.
    Al verificar un estático en prod, mirá **content-type y tamaño**, nunca el status.
    `coreEnElBuild.test.ts` falla si la copia vuelve a depender de npm. Tiene que ser el build **ESM**
    (el worker de `@ffmpeg/ffmpeg` es `type: "module"` y pide un `export default`), no se puede importar
    con `?url` (Vite lo pre-bundlea) y **sin `toBlobURL`** (el core pierde su `import.meta.url`).
- ⚠️ **«Mandarlo como documento» NO es una salida — MEDIDO** (`npm run wa:cloud-api:limites`, 5-ago-2026,
  con CONTROL que frena la conclusión si la credencial no sirve): `video/mp4` 17,9 MB **rechazado** ·
  `application/pdf` 17,9 MB y 70 MB **aceptados** · `image/png` 9 MB rechazado. O sea: **el tope se
  aplica en la SUBIDA y sale del MIME declarado** — la opción existiría solo mintiendo el mime, y al lead
  le llegaría un adjunto que WhatsApp no sabe reproducir. Los 100 MB de documento son reales: ahí el que
  corta en 64 somos NOSOTROS con `express.raw`.

## Las reacciones — 👍 al flyer

> Detalle: `docs/claude-md-2026-08-09-completo.md` §Las reacciones.

Un 👍 es la señal de compra más barata que existe. **No era un bug de dibujo: la ingesta las descartaba
enteras.** Server en `server/src/reacciones/`, tabla `reacciones_wa` (migración **0019**), UI en la
burbuja de `HiloWhatsapp.tsx`.

- 🔴 **`tieneContenido` sigue diciendo que NO es contenido, y tiene que seguir diciéndolo.** La reacción
  se rescata **arriba** de ese descarte (`esSoloReaccion`), no relajándolo: si alguien saca
  `reactionMessage` de `CLAVES_SIN_CONTENIDO`, vuelve el fantasma del fix #70.
  `reacciones/cicloCompleto.test.ts` cruza los dos módulos.
- **Una reacción no es un mensaje**: **cuelga** del mensaje al que reacciona. Por eso tabla propia, y por
  eso `onReaccion` es un canal aparte de `onMensaje` (opcional: el falso no la emite).
- **La PK es `(mensaje, persona)` — es un ESTADO, no un historial.** Reaccionar de nuevo **reemplaza**;
  el emoji **vacío QUITA**. Con historial, un mensaje mostraría 👍❤️😮 de la misma persona.
- ⚠️ **`mensaje_external_id` es texto y no una FK**, a propósito: una reacción puede llegar **antes** que
  el mensaje. El JOIN va por el mismo `wa:<id>` de la proyección (un test lee `proyectar.ts`).
- **Los dos canales, una sola forma**: `reaccionDeCloudApi` y `reaccionDeWhatsmeow`, con test de paridad.
  En whatsmeow gana el **sello propio** de la reacción sobre el del sobre.
- **Degrada, no tumba**: sin la migración, `guardar` avisa por log y `porMensaje` devuelve vacío. Es lo
  contrario del catálogo de piezas (ADR 0023) y por el mismo criterio: acá el consumidor es una persona.
- **Y se puede reaccionar NOSOTROS** (`reacciones/enviar.ts`, `POST /api/whatsapp/reaccionar`): solo en
  los **entrantes** y solo con la sesión viva.
  · 🔴 **NO pasa por `EnvioControlado`, y no es un descuido**: `envios_wa` es el registro de MENSAJES con
    su pieza y su versión (ADR 0022), y una reacción no tiene ninguna de las dos. Peor: **contaría contra
    el ritmo** (20/hora, 60/día), o sea que reaccionar le robaría cupo a los envíos de verdad. Sí conserva
    la guarda de línea equivocada y el freno por sesión caída o `temporary_ban`.
  · ⚠️ El botón está **siempre en el DOM**, invisible hasta el hover: montarlo al pasar haría que el
    primer clic caiga en la nada. La mutación es **optimista**.
- Ver sin server: `/galeria-composer.html`. Capturas: `docs/evidencia/reacciones-en-el-hilo.png`.

## Las otras tres cosas que se hacen sobre un mensaje (12-ago-2026)

Las acciones de la burbuja viven agrupadas en un solo bloque de `HiloWhatsapp.tsx` y **van del lado de
AFUERA** (izquierda en los salientes, derecha en los entrantes): del lado de adentro se montan sobre el
hilo, del lado del borde se salen de la vista. Las tres copian el molde de reaccionar —**siempre en el
DOM**, invisibles hasta el hover— pero **cada una tiene un alcance distinto, y esa asimetría es la
decisión**: reaccionar es solo de los entrantes y con la línea viva, copiar y responder van en los dos
sentidos, y copiar además no mira la sesión (es local: con la línea caída sigue sirviendo).

- 🔴 **«NO SE PUEDE COPIAR EL CHAT» ERA UN PROBLEMA DE CONTRASTE, NO DE BLOQUEO.** `::selection` pintaba
  `var(--secondary)` sobre `var(--navy)` y **la burbuja saliente ES exactamente `bg-secondary
  text-navy`**: contraste 1.000, o sea que arrastrar el mouse sobre un mensaje propio no cambiaba un
  solo píxel. La vendedora arrastraba, no veía nada, y concluía que el hilo no se copiaba. Nada estaba
  bloqueado: no hay `user-select:none`, ni handlers en la burbuja, ni nadie que intercepte ⌘C, y en
  macOS Tauri instala el menú Editar solo. **El candado es `src/seleccionVisible.test.ts`**, que lee
  `index.css` y falla si el resalte baja de 3:1 contra el fondo de CUALQUIERA de las dos burbujas.
  ⚠️ Ese test necesita `css: { include: [/index\.css/] }` en `vitest.config.ts`: por default vitest
  sirve todo `.css` como cadena VACÍA —incluido `?raw`— y el test pasaba leyendo nada.
- ⚠️ **Copiar sin texto no se dibuja**: un adjunto suelto o el «Vino del anuncio» no tienen qué poner en
  el portapapeles, y un botón que copia la cadena vacía parece que anduvo.
- 🔴 **ARRASTRAR UN ARCHIVO ESCUCHA EN LA VENTANA, NO EN UN RECTÁNGULO** (`aceptarArchivos`, compartida
  con ⌘V). Dos razones y la segunda obliga: la vendedora suelta el flyer sobre la conversación, no sobre
  la cajita; y **si nadie cancela el default, el webview NAVEGA al archivo** y ella queda afuera de
  Hermes con un JPG a pantalla completa y sin botón de volver. Se filtra por `types` con `'Files'` para
  no comerse el arrastre de las tarjetas del Pipeline.
  · ⚠️ **La decisión es la MISMA que la del pegado** (`decidirPegado`), no una copia: dos puertas al
    mismo envío que acepten cosas distintas es #37, y se notaría tarde — cuando a un lead le llegue por
    una vía algo que la otra rechazaba.
  · 🔴 **Y en la app de escritorio NO alcanza el front**: Tauri se queda los drops del SO antes de que
    el DOM los vea, así que hace falta **`dragDropEnabled: false`** en `src-tauri/tauri.conf.json`.
    Eso es CÁSCARA: **no viaja por OTA, hay que reinstalar** — y en Windows no puede llegar mientras el
    `.exe` no compile. O sea que el equipo que vende ve el copiar y el responder, y **no** el arrastre.

## Responder citando un mensaje (ADR 0054)

Molde: las reacciones. Una señal que cuelga de un mensaje, dos dialectos, una forma canónica
(`server/src/whatsapp/cita.ts`) y **la receta `wa:<id>` importada de `reacciones/dominio.ts`** — con
dos recetas el JOIN da cero filas en silencio. **Sin migración**: una cita es un ATRIBUTO del mensaje
(no cambia nunca, no existe sin él), así que va como una clave más del crudo, al lado de `media`.

- 🔴 **`stanzaID` VA CON D MAYÚSCULA, y los tipos publicados dicen lo contrario.** El `.d.ts` de
  `@whatsmeow-node` y su `examples/reply-and-mentions.ts` declaran `stanzaId`; el binario Go tiene
  **13 `stanzaID` y CERO `stanzaId`**, con tres `json:"stanzaID,omitempty"` (medido el 12-ago-2026 con
  `strings`). Seguir el `.d.ts` manda un campo que `encoding/json` **descarta sin un solo error**: el
  mensaje sale y la cita no. Al leer se aceptan las dos, al escribir van las dos (el precedente es
  `origen.ts:39`). Candado: `cita.paridad.test.ts`. **Corolario**: con cita hay que usar
  `sendRawMessage`, porque el `MessageContent` tipado solo admite la grafía equivocada.
- 🔴 **SIN CITA, NINGÚN TRANSPORTE CAMBIA UNA LETRA DEL PROTO.** whatsmeow sigue mandando
  `{ conversation }` por `sendMessage` y Cloud API sigue sin `context`. Mover el caso normal a
  `extendedTextMessage` «ya que estamos» sería cambiar el 100 % de los envíos por una función nueva.
- 🔴 **EL NAVEGADOR MANDA SOLO EL ID (`citaDe`), y el server resuelve el resto.** Tiene el autor y el
  texto en pantalla, pero es un dato que **el lead va a ver**: el `participant` mal puesto le atribuye
  la tirita a otra persona y un `quotedMessage` inventado le muestra un texto que nadie escribió. Vive
  en `whatsapp/citaRepositorio.ts`. Un id que Hermes no conoce **se cita igual** (lo resuelve WhatsApp):
  se pierde el preview, no la cita.
- 🔴 **EL CITADO QUE NO ESTÁ SE DIBUJA COMO HUECO, nunca se descarta el mensaje**: «Un mensaje
  anterior» y **sin autor** (no se afirma de quién era sin haberlo mirado). No es un borde raro: la
  ingesta tiraba el `contextInfo`, así que **no hay historia que reproyectar** y esto va a ser
  mayoritario las primeras semanas. La lectura vive pura en `src/features/whatsapp/cita.ts`.
- ⚠️ El citado se resuelve en una **segunda consulta**, donde ya se resuelven reacciones y ✓✓: en
  `hiloDe` sería un self-join sobre la tabla que esa consulta ya está leyendo.
- ⚠️ **«Responder» va en los DOS sentidos y sin mirar la sesión** (como Copiar: no manda nada), y **no
  existe en modo revisión**. Un mensaje sin texto ni adjunto —la marca «Vino del anuncio»— no se puede
  citar: su tirita saldría en blanco. **Escape suelta la cita**, y solo cuando hay una.
- ⚠️ **Citar al mandar un ADJUNTO no está hecho**, y el composer lo dice ANTES de mandar. Recibir y
  dibujar una cita a un adjunto sí anda. **Tocar la tirita no salta al original** a propósito: puede
  estar fuera de la ventana de 200, y un clic que a veces no hace nada es peor que uno que nunca hace.
- 🔴 **Y el hilo servía los 200 mensajes MÁS VIEJOS** (`ORDER BY occurred_at ASC LIMIT 200` son los
  PRIMEROS). Muerde en 1 de 4.009 conversaciones… y justo acá, porque una cita apunta a lo reciente.
  Ahora el `LIMIT` va sobre el orden DESC y la respuesta sale ASC (`MENSAJES_DEL_HILO`).
- Capturas: `docs/evidencia/responder-citando-*.png`. Sin server: `/galeria-composer.html` — sirve los
  tres casos **incluidos los feos**, porque el ideal ya escondió tres defectos una vez.

## Editar un mensaje ya enviado — solo whatsmeow (ADR 0056)

Molde: las reacciones y las citas. Una edición cuelga del mensaje (`ediciones_wa`, migración **0027**,
PK en el mensaje — es un ESTADO, editar de nuevo REEMPLAZA, no hay historial), nunca pisa
`interactions.texto` ni `envios_wa.texto` (esa es la AUDITORÍA de qué salió, la que mide piezas de
#169).

- 🔴 **LA CLOUD API DE META NO TIENE ESTO.** Verificado contra su doc oficial el 14-ago-2026: no existe
  ningún `PATCH` de mensajes, solo `POST` para mandar uno nuevo. whatsmeow sí (`editMessage`, un método
  propio del wrapper — sin la trampa de grafía `stanzaID` de las citas). **Y desde el 13-ago Hermes
  corre con UNA sola línea, y es Cloud API**: el día que se escribió esto, *ninguna* línea viva puede
  editar. Se construyó igual —decisión del dueño— para el día que vuelva a haber whatsmeow vivo.
  ⚠️ Antes de asumir que esto anda en producción, verificá qué línea está corriendo hoy.
- 🔴 **`editarTexto` es OPCIONAL y FEATURE-DETECTADO, nunca un `if transporte==='whatsmeow'`.** El
  server publica `puedeEditar` en `GET /api/whatsapp/sesion?numeroPropio=`
  (`Boolean(transporte.editarTexto)`); el botón de la burbuja lee esa bandera. Con dos lugares
  decidiendo lo mismo, el día que la Cloud API sume esto (o llegue un transporte nuevo) hay que acordarse
  de tocar los dos — la lección de #37, otra vez.
- **No pasa por `EnvioControlado`**, mismo argumento que reaccionar: corrige algo que YA le llegó a esa
  persona, no hay pieza que estampar de nuevo, y contarlo contra el ritmo (20/hora, 60/día) le robaría
  cupo a los envíos de verdad. Sí conserva la guarda de línea equivocada y el freno por sesión caída o
  baneada.
- **El editor vive ADENTRO de la burbuja**, no en el composer (a diferencia de Reenviar, que sí lo usa
  porque arma un mensaje nuevo): sacarlo de su lugar le haría perder el contexto. Copiar y Reenviar leen
  el texto VIGENTE (`editado?.texto ?? texto`) — reenviar una edición manda la versión corregida, no la
  que tenía el error.
- ⚠️ **Sin historial de versiones, ni siquiera el original en la marca**: «Editado» se ve, como en
  WhatsApp, sin decir qué decía antes.
- Sin captura contra whatsmeow real (no hay línea viva): verificado con `TransporteFalso` y mocks.
  `docs/adr/0056-editar-un-mensaje-enviado.md`.

## Abrir un chat lo marca leído — y NO lo mueve de lugar

- **El bug**: `POST /api/whatsapp/leido/:telefono` mandaba los ticks azules al lead y **no tocaba
  `estado_conversacion.leido_hasta`**. Ahora la misma ruta hace las dos cosas — aparte, porque son dos
  destinatarios distintos y que uno falle no puede llevarse al otro.
- **Y BAJA.** El orden es `fijada → fijada_at → no_leido DESC → nivel → antigüedad`
  (`bandaPinOrdenSql`). Decisión del dueño del 7-ago. ⚠️ **Lo que cuesta**: un chat leído y urgente queda
  debajo de uno sin leer que no lo es.
- 🔴 **La red que hace aceptable eso es un chip que filtra por `NOT respondida`** —sin mirar el cursor de
  lectura— y lleva su número. **Sin ese chip la decisión escondería deuda.**
  `cola/abrirMarcaLeido.test.db.ts` lo verifica explícitamente. ⚠️ **Desde ADR 0052 ese chip es «Te
  escribieron»**, que es lo mismo cortado a 7 días (`NOT respondida` a secas daba 505 con el 93 % de más
  de una semana). Sigue siendo red para este caso, y mejor: un chat que acabás de abrir es reciente por
  definición.
- **Leer cambia el ORDEN, no la URGENCIA.** El nivel de `urgencia.ts` no se toca: es la misma regla que
  comparte con el radar, con su test de paridad.
- 🔴 **EL CURSOR VA PRIMERO Y LOS TILDES DESPUÉS.** Al revés tardaba **3 segundos** (el endpoint esperaba
  a `transporte.marcarLeido()`, una llamada de RED al subprocess, antes de tocar el cursor). Ahora:
  cursor → `res.json()` → tildes fire-and-forget.
- **El front es OPTIMISTA**: `onMutate` con `setQueriesData` sobre TODAS las variantes de la cola (la
  queryKey lleva los filtros). Si el server falla, **se vuelve a encender**. ⚠️ **No se reordena en el
  navegador**: el orden es del server y reimplementarlo sería la misma regla en dos lados (#37).
- ⚠️ **Sin `numeroPropio` el cursor no se toca** (`estado_conversacion` se indexa por
  `conv:whatsapp:<tel>:<linea>`). **El cursor es POR VENDEDORA** (con test).

## Los ✓✓ — «¿le llegó?» vs «¿no me contestó?»

Server en `server/src/entrega/`, columnas `envios_wa.estado_entrega{,_en}` (migración **0021**,
expand-only), UI en la línea de la hora de cada saliente.

- **La escala es MONÓTONA**: `enviado → entregado → leido`, más `fallido` aparte (gana siempre, no se
  resucita). Los recibos llegan **desordenados**, así que pisar con «el último que llegó» mostraría como
  no leído algo que el lead ya vio.
- 🔴 **El avance se hace EN LA BASE, no leyendo y escribiendo.** El `UPDATE` lleva su propio `WHERE` con
  el orden de la escala, así que la base arbitra. La regla vive igual en `entrega/dominio.ts` (pura) y
  **`entrega/paridad.test.ts` cruza las dos** para TODO par de estados (patrón de ADR 0009).
- 🔴 **En whatsmeow, `ReceiptTypeDelivered` es la CADENA VACÍA.** Tratar `''` como «desconocido» perdería
  **todos los entregados**, o sea el ✓✓ gris, que es el estado más frecuente.
- ⚠️ **`read-self` y `played-self` NO son del destinatario**: son otro dispositivo tuyo. Contarlos
  pintaría el ✓✓ azul porque la vendedora abrió su propio WhatsApp.
- **Un recibo abarca VARIOS mensajes** (`ids[]`); el UPDATE los mueve de una. Los dos canales van por
  caminos distintos (`onRecibo` y `statuses[]`), misma escala y mismo repositorio.
- **Ausente ≠ `enviado`**: los mensajes anteriores al frente no tienen estado y **no se dibuja nada**. No
  hay backfill posible, y un ✓ inventado es peor que un hueco.
- UI: ✓ / ✓✓ / ✓✓ **azul**, el vocabulario que la vendedora ya trae del teléfono. `fallido` rompe el molde
  (triángulo rojo) porque es lo único que pide una acción. `docs/evidencia/entrega-tildes.png`.
- 🔴 **Y ESE TRIÁNGULO ERA MUDO POR CONSTRUCCIÓN — se leía como «no se mandó», que es lo contrario de lo
  que pasó** (ADR 0058). El webhook leía `st.status`, `st.id` y `st.timestamp` y **nunca `st.errors`**,
  que es donde Meta manda el código del rechazo. El mensaje SALE (queda `id_externo`) y el `failed`
  llega un segundo después por webhook: `estado='enviado'` + `estado_entrega='fallido'`. Ahora el
  código se guarda (`estado_entrega_codigo`, migración **0028**) y el motivo va **escrito abajo de la
  burbuja**, no en un hover que nadie visita.
  · **Se guarda el CÓDIGO, no la frase**: el diccionario vive en el front (`whatsapp/motivoEntrega.ts`)
    y se reescribe sin tocar una fila. ⚠️ El `detalle` en inglés de Meta va a `motivo` para AUDITAR y
    **no se sirve**. Un código desconocido **no inventa** una explicación: muestra el número.
  · ⚠️ **`entrega` sigue siendo la CADENA** y `entregaMotivo` viaja al lado: volverla objeto rompía los
    hilos rehidratados de IndexedDB (ADR 0007), sin error y hasta que alguien limpie el caché.
  · **Lo que se mide es casi todo un solo motivo**: `131047`, la ventana de 24 h. Los dos únicos fallos
    manuales de dos semanas (16-ago-2026) eran eso, a 28,3 h y a **24,5 h** — uno se pasó por media
    hora. Al medir esto filtrá `vendedora_id <> 'campana'`: los 202 del 14-ago son la campaña.
  · **Sin backfill**: los fallos anteriores a 0028 no tienen código y nunca lo van a tener.

## Correos — con qué buzón sale, y a quién le contestan (ADR 0058)

Un correo = UNA vendedora → UN destinatario, auditado. Server en `server/src/correos/` (todo puro
salvo `repositorio.ts`) + `server/src/routes/correos.ts`, front en `src/features/correos/`, tabla
`remitentes_correo` + cuatro columnas de `correos` (migración **0029**). Las dos decisiones del
dueño: los remitentes viven en una tabla y se administran desde la app, y **el `Reply-To` es el
correo de quien escribió**.

- 🔴 **EL SMTP ES AMAZON SES** (`email-smtp.us-east-1.amazonaws.com`), **no `mail.goberna.us`** —el
  MX de `goberna.us` es Google Workspace, así que por ahí no sale nada—. La doc lo dijo mal desde el
  21-jul hasta el 17-ago-2026, y ese nombre de host **es lo que un operador busca justo cuando algo
  falla**: manda a revisar un buzón de Google mientras el problema está en la consola de SES, con un
  lead esperando. Una doc que miente sobre un dato de diagnóstico no es doc vieja, es una pista falsa.
- 🔴 **`grupogoberna.com` NO está verificado en SES: los `ventas1X@` pueden ser `Reply-To` y NUNCA
  `From`.** Medido mandando de verdad, con dos controles que cortan (`prueba@gmail.com` y
  `a@gobernaus.com` dan **554 «Email address is not verified»**). `goberna.us` sí está verificado
  **como dominio y cubre sus subdominios** (`avisos@mail.goberna.us` aceptado). De ahí sale la forma
  del sobre: el `From` sale por un buzón verificado con el nombre de la vendedora en el display name
  —que SES no verifica— y el `Reply-To` es la rendija, porque **SES verifica de quién SALE, no a
  dónde se CONTESTA**. La lista vive en `SMTP_DOMINIOS_VERIFICADOS` y se chequea al **dar de alta**
  (`correos/verificado.ts`), no al mandar: un remitente mal cargado no se ve mal en ningún lado y
  aparece días después, en el correo de otra persona.
- 🔴 **`sinSaltos()` ES LO ÚNICO QUE SEPARA LA CAJA DE ASUNTO DE UNA INYECCIÓN DE CABECERAS.** Una
  cabecera SMTP termina en CRLF: un `\r` adentro del asunto la cierra y **lo que sigue se manda como
  una cabecera nueva** — o sea que desde la pantalla se podía agregar un `Bcc:` y mandarle el correo
  a quien fuera, sin tocar la API y sin dejar rastro en `correos`. Los que inyectan son `\r` y `\n`;
  los otros cuatro se limpian igual para que la regla no tenga excepciones que alguien deba recordar.
  ⚠️ Se reemplazan por un espacio, **no se borran**: borrarlos pega las palabras y al lead le llega
  un asunto que en la pantalla se veía bien.
- 🔴 **DAR DE ALTA EL PRIMER REMITENTE ES UN PASO MANUAL DEL DEPLOY**: `cd server && npm run
  correos:remitentes -- --alta <buzón> --nombre "…" --aplicar` (dry-run por default). El front sale
  por **N4** y el server por **N5**, así que hay una ventana con la tabla creada y vacía en la que la
  pantalla de administración **todavía no existe del otro lado**. Sin el script eso se destraba con
  un `INSERT` a mano contra producción, que **se saltea `puedeSerRemitente`** —el único control de
  dominio verificado del frente— y el defecto sale en el 554 del primer envío. Mientras no haya
  ninguno, Correos sale por `SMTP_FROM` como el 21-jul (compat, no falla).
- Sin server: `npx vite --port 5199` → `/galeria-correos.html` (un flag por caso real). ⚠️ Sirve las
  **tres filas que existen en producción** —las tres pruebas, con `desde` en hueco— y no un caso
  ideal. Capturas: `docs/evidencia/correos-*.png`.

## La Libreta se comparte — espacios de trabajo (ADR 0046, revierte 0012 y 0034 §7)

Una página vive en **mi libreta privada** o en un **espacio con miembros elegidos**. Server en
`server/src/espacios/`, front en `src/features/notas/`, migración **0022**.

- **La regla vive UNA vez y pura** (`espacios/visibilidad.ts`), con su gemelo `visibleParaSql` y el
  test de paridad que los cruza contra base en **todas** las combinaciones:
  `se ve ⟺ (espacio_id IS NULL ∧ autora = yo) ∨ (espacio_id = E ∧ soy miembro de E)`.
- 🔴 **`espacio_id IS NULL` es «mi libreta privada», no «sin clasificar»** — y por eso **sin la
  migración esto degrada EXACTAMENTE a la Libreta de antes** (`espaciosDe` devuelve `[]` y la regla
  colapsa a `vendedora_id = yo`). Degrada hacia MENOS, nunca hacia más. Sembrar un espacio privado por
  persona costaba un backfill y una escritura adentro de un GET. «Privado» en plural sigue existiendo:
  un espacio puede tener **un solo miembro**.
- 🔴 **ES UNA FRONTERA Y ES LA TERCERA DEL REPO** (con el padrón y el Dashboard), no un filtro: una
  página de un espacio ajeno **no se sirve ni pidiéndola por id**, y por eso el recorte vive en el
  `WHERE` y nunca en un `if` del navegador. **También del lado de la ESCRITURA** (`puedeEscribirEn`):
  el POST lleva `espacioId` en el body, así que sin esa guarda cualquiera **planta** una página en el
  espacio de otro equipo mandando un número — y ahí se ve como una página más y de nadie.
- 🔴 **`editarNota`/`archivar`/`desarchivar` YA NO son «solo la autora»**: son «miembro del espacio»,
  y la regla vive en `noPuedeTocar`, una vez. Sobre una nota privada da **lo mismo** que antes, así que
  nadie pierde el candado que tenía. Editar una página ajena **no reescribe su autoría**.
- **A quién se puede invitar NO se inventa**: rueda ∪ `numero_vendedora` (9 personas), reusando
  `destinosPosibles`. Un destino desconocido es **409 enumerando a quién sí se puede** — un
  `vendedora_id` tipeado a mano escribe una fila válida y esa persona no ve el espacio nunca.
- 🔴 **A la creadora NO se la puede sacar, ni ella misma**: agregar exige ser la creadora y verlo exige
  ser miembro, así que el espacio quedaría imposible de arreglar desde la app. Para irse, se archiva —
  y archivar el espacio **no toca las páginas**.
- 🔴 **Todo compara normalizando los DOS lados** (`mismaVendedora` server, `mismoUsuario` front): con
  `Luz` vs `luz`, la agregan a un espacio y **no lo ve nunca**, sin un solo síntoma. El índice
  `espacio_miembro_vendedora_idx` va sobre `lower(vendedora_id)` **por eso**, no por rendimiento.
- ⚠️ **La bienvenida es SOLO de la libreta privada.** Se lleva la pantalla entera, selector incluido:
  en un espacio recién creado (vacío por definición) dejaba a la vendedora **encerrada**, sin forma de
  volver. Y su texto —«es tuya, nadie más la ve»— sería falso ahí. Fijado en
  `Libreta.espacios.test.tsx`, junto con que **cambiar de espacio cierra la página abierta** (si no,
  el editor sigue autoguardando una página del espacio anterior a los 800 ms).
- ⚠️ **El `espacioId` va en la `queryKey`** (`['notas', clave, espacioId]`): sin él las dos listas
  comparten caché y al saltar se ven las páginas del anterior bajo el nombre del nuevo.
- **`buscarNotas` ya no está clavada a `clave='general'`**: busca en todo lo visible. El GIN no se
  reindexa — `to_tsvector('spanish', texto)` nunca tuvo `clave` adentro.
- **Sigue sin haber botón de mandar** y **sin oro**. Las notas históricas de `gestiones` **no entran a
  un espacio**: son de otra tabla, de solo lectura y por autora.
- Capturas: `docs/evidencia/libreta-espacios-*.png`. Sin server:
  `node scratchpad/api-espacios.mjs` + `VITE_API_URL=http://localhost:4199 npx vite --port 5199`.

### El link público y mover páginas (ADR 0047)

- 🔴 **`/n/<token>` ES LA PRIMERA PUERTA ANÓNIMA DEL REPO, y vive FUERA de `/api`.** El perímetro es
  cerrado por defecto (cicatriz del #36: 19 de 27 routers abiertos) y sus tres excepciones son
  credenciales de servicio. Una excepción DENTRO de `/api` sería un prefijo que el próximo router
  hereda sin notarlo. El token es `randomBytes(16)`, **nunca el id** (con el id, `/n/1`, `/n/2` es la
  libreta de todos), y lo que no tiene forma de token se descarta **antes** de tocar la base.
- 🔴 **Cortar BORRA la fila** (no un flag), y hay **un link por página** (índice UNIQUE): con dos,
  cortar uno deja el otro vivo. Archivar la página también la saca del link.
- **La respuesta pública lleva `titulo`+`texto`+`doc` y NADA más** — sin autora, espacio, fechas ni
  id; hay test que compara las claves. `noindex` no es opcional. Un token inexistente, uno cortado y
  una página archivada contestan **lo mismo**.
- **El HTML es puro y vive aparte** (`espacios/paginaPublica.ts`): el router importa `db`, así que un
  test puro no podría cargarlo — y ese test es el que importa, porque **es el único lugar donde texto
  de una persona se vuelve HTML para un desconocido**. Se pinta desde `texto`, no desde `doc`, y no
  lleva una línea de JavaScript.
- 🔴 **Mover pide LOS DOS permisos** (`espacios/mover.ts`): origen y destino. Sin el de origen, mover
  es la puerta de atrás para LEER lo que la frontera niega; sin el de destino, para PLANTAR.
- 🔴 **Traer una página a tu libreta SE LA SACA AL EQUIPO** — se pregunta nombrando a la gente, no con
  «¿estás segura?». Compartir hacia un espacio no pregunta nada. ⚠️ **Mover no toca `editado_at`**.
- **El tope de una página pasó de 2.000 a 20.000**: el playbook real del equipo (27 `hechos`) son
  **5.267 caracteres** y no entraba. ⚠️ El número vive en server y front y **ya divergieron una vez**:
  el candado es `notas/limiteTexto.paridad.test.ts`.
- **La lista marca con 🔗 lo que está afuera**: sin eso compartir es una acción sin inventario.
- Mapa de todo el frente: `docs/mapa-libreta.md`. Capturas: `docs/evidencia/libreta-link-*.png`.

### El link tiene ALCANCE y PERMISO (ADR 0048)

- **Dos ejes**: `alcance` (`publico` · `goberna`) y `permiso` (`ver` · `editar`).
  🔴 **`editar` exige `goberna`, y lo garantiza el TIPO** (`ConfiguracionDeLink` es una unión que hace
  imposible construir «público + editar»), no un `if`: **sin identidad no hay autoría**. Un permiso
  `editar` sobre alcance público es **400, no se degrada a `ver`** — degradar daría un link que hace
  menos de lo que la pantalla dijo.
- 🔴 **UN LINK `goberna` NO SIRVE CONTENIDO POR `/n/`.** Una navegación del navegador **no lleva el
  token** (la sesión vive en `localStorage`, no en cookie), así que ahí el server no sabe quién sos:
  se manda una **página puente sin una letra del contenido** → `/#n=<token>` → la app pregunta por
  `/api/notas/por-link/:token`, detrás del perímetro. **El contenido interno nunca sale por la ruta
  anónima.**
- ⚠️ **Leer el hash NO es un router** (ADR 0002): se lee **una vez** en el primer render y **se limpia
  enseguida** — el token es una credencial y en la barra se copia, queda en el historial y sale en
  cualquier captura.
- 🔴 **SACAR A ALGUIEN DEL ESPACIO LE CORTA LOS LINKS QUE ABRIÓ**, en la MISMA transacción que la baja.
  Sin esto, ADR 0046 prometía sacarle las páginas y le dejaba abierta la puerta al mundo. El corte es
  **quirúrgico**: no toca los de los demás ni los de su libreta privada. **Archivar el espacio corta
  todos los suyos** — es el único caso donde archivar destruye algo, y destruye la puerta, no el
  contenido. Las dos funciones **devuelven cuántos cortaron**.
- **Vencimiento opcional**: `null` = no vence (default). Una fecha que no se entiende **se rechaza**,
  no se ignora. **Vencido se ve igual que inexistente.**
- **«Se abrió por última vez»**: un timestamp, **sin quién ni cuántas veces**. `null` = nunca lo abrió
  nadie. Se anota **sin await**: si falla se pierde higiene, no la página.
- **Reconfigurar CONSERVA el token**: cambiar de público a interno surte efecto sobre el link ya
  repartido. Uno nuevo dejaría el viejo vivo con las reglas viejas.
- ⚠️ **`/n/` sigue SIN rate limit** — verificado: ni nginx ni Express. Con 128 bits no es fuga, es
  disponibilidad. Es un cambio a mano en VPS1 y va aparte.

## Auth

Login de vendedoras **contra Cerberus** (Django, sin API REST): `cerberus/auth.ts` hace el handshake CSRF
+ POST a `/ingresar/`. Éxito → Hermes emite un **token HMAC Bearer** (`auth/sesion.ts`). El `vendedoraId`
= username de Cerberus. Middleware `requiereVendedora` delante de todo lo que envía o atribuye.

**La sesión de Cerberus se PERSISTE** (#106, ADR 0027): la cookie vive en `sesiones_cerberus` (TTL 14
días, decidido al leer) con el `Map` como caché del proceso — un deploy ya no desloguea a las tres a la
vez. El store (`cerberus/sesionStore.ts`) es un seam inyectable y **degrada, nunca tumba**. Un solo store
compartido a propósito: dos cachés servirían una cookie vieja tras un re-login.

En el cliente, la sesión **se cree el token antes de preguntar** (ADR 0007): si hay uno guardado que no
venció, la app se pinta ya y `/api/auth/yo` valida por detrás. La firma la verifica el server en cada
request igual, y un 401 real echa y borra el caché.

### «Cambiar contraseña» en el perfil — la de Cerberus, entrando de nuevo con la actual (**ADR 0062**)

El botón vive en `PanelUsuario` (el avatar de abajo a la izquierda) y abre `CambiarClave`;
el server (`cerberus/cambiarClave.ts`, `POST /api/auth/cambiar-clave`) le pide el cambio a
**Cerberus** (`POST /perfil/clave/`, `miweb/auth_views.py`) — es la única clave que hay.

- 🔴 **CAMBIAR LA CLAVE MATA TODAS LAS OTRAS SESIONES DE CERBERUS DE ESA PERSONA**, incluida
  la de `sesiones_cerberus`. Sobrevive **sólo la de la request que hizo el cambio, CICLADA**
  (viene en el `Set-Cookie` de esa respuesta), y ésa es la que se guarda — nunca la que
  entró. Por eso el server **entra de nuevo con la clave actual** en vez de usar la
  guardada, y por eso `guardarSesion` va DESPUÉS del 200. Fijado en `cambiarClave.test.ts`.
- 🔴 **La clave actual mal es 400, NO 401**: el front borra la sesión de Hermes ante un 401
  real, y lo que está mal es lo que tipeó. El token de Hermes **no depende de la clave** y
  no se toca: la pantalla dice «seguís adentro».
- ⚠️ **Sólo para quien tiene cuenta de Cerberus**: una identidad `centurion:` no ve el botón
  y el server contesta 409. **Deploy: Cerberus primero**; al revés el server dice
  `503 cerberus_sin_soporte` (el 404 de la ruta que todavía no existe), no «caído».
- Sin server: `/galeria-cambiar-clave.html?paso=panel|formulario|rechazo_django|listo`.

### Los roles viven en la tabla `equipo` (migración **0028**)

Tres roles y son una **escalera**, no tres cajones (`server/src/equipo/roles.ts`): `vendedora` <
`supervisor` < `admin`. El permiso se pregunta con `alcanzaRol`/`puedeSupervisar`, nunca con
`rol === 'supervisor'` — con la comparación exacta el **admin** se queda afuera del padrón y de «El
negocio». Reemplaza a `HERMES_SUPERVISORES`, que queda como **respaldo** hasta que se apague. La
tercera lista de roles —`VEN_ROUTING` en el FRONT (`src/features/vistas/acceso.ts`)— sigue viva.

- 🔴 **`cargarRol` RESUELVE EL BEARER POR SU CUENTA; no puede leer `req.vendedoraId`.** `'/api/auth'`
  está en `PREFIJOS_ABIERTOS` y `routes/auth.ts` monta `requiereVendedora` como handler **del propio
  `/yo`**, o sea después de todo `app.use`. Leyendo el request, el rol quedaría `undefined` justo en
  `/api/auth/yo`, que es el ÚNICO canal por el que baja al front: **el panel invisible para todos,
  incluido el admin, sin 403 y sin log**. Usa `verificarSesion` (puro), **nunca responde 401** —solo
  anota— y con `if (!id) return next()` los tokens de servicio (`/api/admin`, `/api/catalogo`) no
  pagan la consulta. Candado: `equipo/cargarRol.test.ts`.
- 🔴 **«LA TABLA NO ESTÁ» Y «LA CONSULTA FALLÓ» NO SON LO MISMO, y colapsarlos abre la cola.** Tabla
  ausente → cascada al `.env`, `sinTablaDeEquipo`, frontera **APAGADA** (como hoy). Blip de Postgres →
  `vendedora`, `rolNoResuelto`, frontera **ENCENDIDA**. Tratar el blip como falta de migración apagaría
  la frontera en cada hipo de la base — con los CSV ya apagados, eso es la cola entera servida a
  cualquier token por unos segundos. Dos banderas, dos ramas, y `equipo/cascada.test.ts` se pone rojo
  si alguien las unifica.
- 🔴 **`persona_id` es CANÓNICO y lo garantiza la BASE** (`equipo_id_canonico_ck`): la fila `Luz` no
  entra. Las grafías crudas viven en `equipo_grafia`. Las tres partidas de producción son `luz`/`Luz`,
  `usuario1`/`Usuario1` y `usuario2`/`Usuario2` — **`alan` tiene una sola**.
- **`HERMES_ADMINS` es el martillo detrás del vidrio**: entra como `admin` **antes** de mirar la base,
  porque una salida de emergencia que depende de la base no es una salida. Marca `porBreakGlass`.
- **La siembra corre al ARRANQUE** (molde de `sembrarAliasCurso`), es idempotente y **no pisa lo
  editado a mano**: con un upsert, cada restart le devolvería su rol de fábrica a quien el admin acaba
  de cambiar. ⚠️ **Y no siembra a quien el `.env` hace supervisor con un rol menor** (`revisarSemilla`):
  una fila activa le gana al CSV, así que eso le sacaría el padrón en el próximo restart sin un error.
  · 🔴 **La lista sale de la BASE, no de la cabeza de nadie.** El censo encontró **once** personas
    donde el análisis nombraba cinco, y la que faltaba —`Tracy`— está activa en la rueda con 10
    conversaciones. `npm run equipo:sembrar` (dry-run por default) rehace el censo contra la base viva
    y **dice quién apareció que la semilla no tiene**. Las cadenas de servicio (`campana`,
    `goberna-admin`, `bot`) no son personas, y `centurion:` se excluye **por prefijo**.
- ⚠️ **`ventas10@grupogoberna.com` no está en la semilla a propósito**: su rol es una pregunta sin
  decidir, y sin fila conserva exactamente lo que el `.env` le da hoy.

## El tiempo real se filtra por dueña (**ADR 0059**)

`GET /api/stream` era un **broadcast**: le empujaba a cada vendedora el teléfono de **cada** mensaje
de todo Hermes, en vivo y sin quedar en ningún log. Server en `server/src/realtime/`.
Contexto y las 82 fugas: `docs/auditoria-aislamiento-de-chats-2026-08-17.md`.

- **El invariante, y es de todo el frente de aislamiento**: *ve el contenido de una conversación ⟺
  es su dueña, o supervisa*. «Su supervisor» = **TODOS los supervisores** (decisión del dueño): se
  pregunta **`mandaEnElEquipo(req)`**, nunca `rol === 'supervisor'`, o el admin queda afuera.
- 🔴 **DOS TIPOS, y esa ES la frontera** (`realtime/bus.ts`): `EventoRT` se publica adentro y lleva
  `duena`; `EventoPublico` es lo que sale por el cable y **no tiene dónde ponerla**. El nombre de la
  dueña es un metadato ajeno («a Luz le escribieron recién»): que no se pueda serializar es más
  fuerte que acordarse de no hacerlo.
- 🔴 **`duena` es REQUERIDO aunque casi siempre valga `null`.** Opcional, un emisor nuevo compila sin
  resolverlo: no fuga (la regla es fail-closed) pero deja **una campanita muerta sin un solo
  síntoma**. Requerido, el compilador obliga a decidir.
- 🔴 **La regla FALLA CERRADO y normaliza los DOS lados** (`realtime/visibilidad.ts`, pura). Con
  `Luz` vs `luz` la comparación exacta no da error: da que **Luz se queda sin su propia campanita**,
  para siempre. Misma cicatriz que `esMiaSql` y `mismaVendedora`.
- 🔴 **NO copia `lineaAlcanzableSql`, y eso es deliberado.** La cola además lista **lo huérfano de tus
  líneas**; acá no. Son dos preguntas —la cola decide qué se LISTA, esto qué se NOMBRA— y traer ese
  predicado a TypeScript sería #37 **en una frontera**, donde divergir falla hacia ABIERTO.
  ⚠️ **Lo que cuesta**: una conversación **sin dueña no le suena a nadie**. La fila igual aparece en
  la cola y el hilo abierto se sigue refrescando; falta el sonido.
- ⚠️ **El evento recortado SE MANDA igual** (`{tipo, canal}`): callarlo dejaría la cola de quien no es
  dueña sin refrescar. Y en el front, sin `telefono` se invalida el **prefijo**
  `['wa','conversacion']` — sin esa rama, toda conversación sin dueña dejaría de actualizarse sola
  con el chat abierto, que es el defecto que este bus vino a arreglar.
- 🔴 **EL PRIMER MENSAJE DE UN LEAD NUEVO SALE SIN DUEÑA**, porque `asignarSiHaceFalta` corre
  **después** de persistir (y ese orden es a propósito: «un lead perdido no vuelve»). Por eso
  `webhook/whatsapp.ts` avisa **de nuevo** tras asignar, y **sólo si antes no tenía dueña** —
  `asignarSiHaceFalta` devuelve la dueña exista o no, así que sin esa comparación una conversación ya
  asignada dispara DOS campanitas por mensaje.
- **DOS candados, y el segundo es el que importa**: `visibilidad.test.ts` (la regla) y
  **`routes/stream.test.ts` (el CABLEADO)**, que levanta el montaje real de `index.ts`, conecta dos
  vendedoras y mira los bytes de cada cable. El defecto no era una regla mal escrita: era que **el
  handler nunca miraba el request** (lección de ADR 0024). Los dos se verificaron en rojo.
  ⚠️ Ese test necesita **`server.closeAllConnections()`**: `close()` espera a que las conexiones
  abiertas terminen y un SSE no termina nunca.

### `/vincular` ya no se monta en producción — y le quedó UN candado, no dos

La consola de operador (D13) vivía montada **fuera del perímetro** y **sin un solo middleware**:
`GET /vincular/estado` servía el **data-URI del QR** de un pareo en vuelo sin `Authorization` (quien
lo escanee se queda con la sesión de WhatsApp de esa línea) y `POST /vincular/iniciar` **actuaba sin
credencial**, abriendo un segundo escritor whatsmeow sobre el mismo SQLite. Leía el MISMO singleton
`whatsapp/vinculador.ts` que las otras dos puertas, así que **derrotaba la guarda por dueño de
`routes/miLinea.ts`** — cuyo propio docblock ya advertía «si Ana inicia un pareo y Bea consulta
`/vincular/estado`, Bea vería el QR de Ana».

Se cerró **moviendo el mount adentro de `if (NODE_ENV !== 'production')`** (PR #400), no borrándolo:
en local sigue siendo la herramienta de trabajo. Candado: `routes/vincular.montaje.test.ts`.

- 🔴 **TIENE UN SOLO CANDADO Y SUS VECINOS TIENEN DOS.** `_sim` y `_dev` se montan igual sólo fuera de
  producción **y además** su exención del perímetro es solo-dev (`auth/perimetro.ts`) — es eso lo que
  respalda la frase «en prod no hay agujero que recordar». **`/vincular` vive fuera de `/api`, así que
  el perímetro nunca lo mira**: su única defensa es el `NODE_ENV`. Un despliegue con esa variable mal
  puesta reabre la puerta entera.
- ⚠️ **La regla de NGINX que la tapaba sigue SIN versionar en el repo** (403 desde internet, 200 desde
  `127.0.0.1:4110`, medido el 17-ago — y VPS1 corre decenas de contenedores que alcanzan ese puerto).
  Ya no es la única protección, pero sigue siendo config invisible para quien lea el código.
- ⚠️ **La lección del método, y vale más que el arreglo**: leer el código da la SUPERFICIE y sólo el
  sistema vivo da el ALCANCE. Los auditores la reportaron como alcanzable desde internet — lo es en el
  código y no lo era en producción. Hacen falta los dos.

### Lo que este frente NO cierra

El hilo (`GET /api/whatsapp/conversacion/:telefono`), la ficha y `GET /api/persona/:interactionId`
—**enumerable**, el id es un `serial`— siguen sirviendo cualquier conversación a cualquier token, y
con ellas ~40 rutas más. **Lo que NO hay que hacer es parchearlas una por una**: así se llegó acá. La
forma es el seam único `puedeVerConversacion(rol, vendedoraId, clave)` con su gemelo SQL, su test de
paridad y un middleware que **rompa el arranque** si una ruta nueva no lo declara (auditoría §7.2).

## Ivi — el puente al cerebro RAG (proxy)

> Fundamento: **ADR 0021** (la costura) y **ADR 0024** (la superficie).

La app le pregunta a **Ivi** (el cerebro RAG en geografo) a través de Hermes, nunca directo: **`POST
/api/ivi/preguntar`** (`server/src/routes/ivi.ts`), detrás de `requiereVendedora`. El server reenvía a
`IVI_URL/api/preguntar` con `Authorization: Bearer IVI_SERVICE_TOKEN` (que la vendedora **jamás** ve).
Cliente en `server/src/ivi/cliente.ts`; el contrato de vuelta se valida con Zod.

- **Body**: `{ pregunta, historial? }` con tope (4000 caracteres la pregunta y cada turno, 30 turnos). El
  `usuario` sale del token, no del body — no se puede suplantar.
- **La costura habla el dialecto de Ivi**: hacia afuera `snake_case` y el historial como `[{q,a}]` —
  ⚠️ **`{rol,texto}` se lee como cadena vacía y el follow-up se pierde en silencio**. Las dos
  traducciones (`aCamelCase`, `aParesQA`) viven en `cliente.ts` y en ningún otro lado. **Nada de
  `.strict()`**: Ivi solo agrega campos, y cerrarlo convertiría cada campo nuevo en un 502; lo único que
  rompe es renombrar, y de eso se defiende el fixture `CUERPO_REAL_DE_IVI`.
- **Un `200` con `tipo: SIN_EVIDENCIA` NO es un error**: Ivi funcionó y no sabe. Sale por el camino
  normal y **no se reintenta**. El vocabulario (`HECHO` · `CONTEXTO` · `SIN_EVIDENCIA`) está publicado
  para que la UI ramifique, pero el schema **no lo cierra**: un tipo nuevo cae en la rama conservadora.
- **`reintentable` mira el `codigo` Y el estado HTTP** (`esReintentable`). El caso que obliga a mirar el
  estado es **`http_inesperado`, un cajón de sastre**: adentro caen el 404 de «todavía no lo
  desplegaron» (permanente) **y** el 500 propio de Ivi y los 502/504 de nginx (transitorios). **El código
  decide primero**: un `503` es `ivi_sin_token_configurado`, config y no caída.
  **El front LO LEE y le gana a su propia tabla** (#175): `ErrorApi` lleva `reintentable` y
  `lecturaDeError()` lo prefiere; la tabla de `errores.ts` queda como **respaldo** para un server viejo —
  por eso lo que se fija con test es la **relación**: `server/src/ivi/paridad-front.test.ts`.
  ⚠️ Solo un booleano cuenta como opinión del server: `null` o una cadena quedan en `undefined`.
- **Los campos informativos degradan, no tumban** (`numerosNoVerificados` acepta ausente, `null` o una
  forma inesperada). Los tres que cargan el peso (`texto`, `tipo`, `groundingOk`) **sí** son estrictos.
- ⚠️ **`traza_id`**: cada pregunta lleva uno (`hermes-<uuid>`) y vuelve en el éxito y en el 502. **Hoy no
  cierra ningún lazo** — verificado contra `ivi-cerebro@1e5d2f3`: `responder()` no lo acepta y
  `rag/traza.py` no existe. Se manda igual porque no se puede reconstruir después. **Al afirmar algo
  sobre otro repo, decí contra qué snapshot lo verificaste**: acá se mezclaron dos fotos una vez y el ADR
  terminó prometiendo un lazo que no existía.
- **FAIL-CLOSED y RUIDOSO**: cualquier fallo es un **502 con `codigo`**, los ocho de `CODIGO_ERROR_IVI`:
  `falta_config` · `config_hermes` (401) · `ivi_no_configurado` (503) · `timeout` (30 s, incluye leer el
  body) · `red` · `respuesta_invalida` · `http_inesperado` · `desconocido`. **Nunca** se muestra un fallo
  como «Ivi no encontró datos». Cada `ErrorIvi` deja rastro en los logs.
- **Env**: `IVI_URL` + `IVI_SERVICE_TOKEN`. Del lado geografo, `POST /api/preguntar` puede **no estar vivo
  aún** (al 27-jul da 404, así que lo que se ve es el `http_inesperado`).

### La superficie en la app (#169, ADR 0024)

`src/features/ivi/`. Se abre con **`i`** o el botón de la barra: **hoja a la derecha, encima de la mesa**
(el molde de `LibretaPersonal`). El panel derecho es de **esa persona**, Ivi es del **negocio**.

- ⚠️ **`App.tsx` la monta SIEMPRE**, abierta o cerrada, y por eso le pasa `abierta` a `useEscape`. Sin esa
  guarda, el listener en captura se come el Escape de **toda la app**: dejan de andar cerrar la
  conversación, la Cabina y la libreta. **Si montás un modal que vive montado, pasale la condición.**
- **El botón de mandar y `⌘↵` consultan la MISMA función** (`motivoParaNoPreguntar` en `ivi.ts`, pura).
  Separadas divergían: el acorde se saltaba el tope de 4000.
- **Los tres tipos cambian de FORMA, no de color** (un color se aprende, una forma se reconoce sin leer):
  `HECHO` filete sólido · `CONTEXTO` punteado + hundido · `SIN_EVIDENCIA` sin relleno. **Sin oro.** Un
  `tipo` desconocido cae en `CONTEXTO` y lo dice: nunca `HECHO`, nunca un throw. La regla vive fuera del
  JSX, pura y con test: `presentacion.ts` (un `switch` adentro de un componente no se puede interrogar
  sobre el tipo que todavía no existe).
- **`grounding_ok: false`** marca **las cifras** dentro del texto y no descarta la respuesta.
  ⚠️ **`edad_del_dato: null` es NO MEDIDO, no «fresco»**: se dice siempre.
- **Los ocho códigos tienen lectura propia** (`errores.ts`); «Reintentar» solo en lo transitorio, y un
  test falla si alguna lectura se puede confundir con «Ivi no encontró datos».
- ⚠️ **No hay puente al composer, a propósito**: lo que sale hacia un lead viene del catálogo (ADR 0015);
  esto es prosa de un LLM. Se copia, pero el botón «poner en la caja» no existe.
- Ver sin server: `/galeria-ivi.html`. Capturas: `docs/evidencia/169-ivi-*.png`.

## El catálogo de piezas — lo que Ivi lee para poder ELEGIR sin inventar (ADR 0023)

**Ivi ARMA, no inventa**: devuelve **ids, nunca texto**, y Hermes compone con su texto ACTUAL. De ahí sale
la propiedad que hace segura la integración: *un índice viejo del lado de Ivi degrada la **calidad** de la
selección, nunca la **corrección** de lo que se manda*. `server/src/catalogo/` + `routes/catalogo.ts`,
**solo lectura**.

- **`GET /api/catalogo/piezas`**: cada pieza se direcciona con **`{clase, id}`** (`plantilla` · `hecho` ·
  `acuse` · `gancho`) y trae `version`, `estado`, `texto`, `momentos`, `familia`, `alcance` +
  `propietario`, `placeholders` y `enviable`. ⚠️ **`clase` es semántica, no la tabla** (hoy son cuatro
  catálogos separados, dos en código), y unificarlos —otro frente— no puede romperle el contrato a Ivi. Un
  **paso** no tiene id propio: viaja dentro de su plantilla, con su `orden` y su propia `version`.
- **Si el catálogo no se puede servir: ERROR, jamás una lista vacía** (cicatriz del ADR 0002 de Ivi). Base
  caída → **503 `catalogo_indisponible`** y el cuerpo **sin `piezas`**; cero piezas → **500
  `catalogo_vacio`**; un filtro que no deja nada → 200 con `filtrado: true`. Por eso
  `catalogo/repositorio.ts` **no degrada** como `hechos/repositorio.ts`: la degradación honesta para una
  persona es una mentira para un índice que cachea. Ni siquiera se sirve medio catálogo.
- **EL DIRECCIONAMIENTO Y LA RECETA DE VERSIÓN VIVEN EN `server/src/piezas/`**, el mismo módulo que
  importa el lazo de resultados (ADR 0022). Ivi devuelve `{id, version}` **para que el join cierre**, y
  con dos recetas ese join da **cero filas en silencio** — que se lee como «esa pieza no se usó nunca».
  Candados: `piezas/vectores.ts` (versiones y refs literales que los dos frentes afirman) y
  `piezas/receta-unica.test.ts` (falla si aparece un `createHash` nuevo).
- **Nadie arma una `Pieza` fuera de `catalogo/armar.ts`.** Si cada origen se armara la suya, cada origen
  calcularía su versión.
- **Detrás de una credencial de servicio PROPIA** (`HERMES_CATALOGO_SERVICE_TOKEN`,
  `requiereServicioDeCatalogo`): darle el token de `/api/admin` para leer una lista le daría de yapa
  re-apuntar números y borrar sesiones. Sin el secreto responde **503 `falta_config`** (distinto del 401
  de credencial equivocada — si no, una falla de config se disfraza de token mal mandado).
- **`GET /api/catalogo/vocabulario`** publica los **momentos de venta como dato** (Ivi es Python y no
  puede importar `sugerencias/estado.ts`). Se **deriva** de `MOMENTOS_DE_VENTA` en cada request. Tres
  guardas: la derivación, el `Record` `DESCRIPCION_MOMENTO` (agregar un momento sin describirlo **no
  compila**) y un test contra la copia a mano del front (`src/features/hechos/hechos.ts`).
- ⚠️ **Un momento desconocido viaja tal cual, nunca se filtra**: en `hechos`, `momentos: []` significa
  «vale para todos», así que descartar un valor nuevo **ensancharía** la pieza en vez de acotarla.

## «Se le puede hablar» — la ventana de conversación (ADR 0041)

La cola ordena la DEUDA. Esta es la otra pregunta: **¿a quién todavía se le puede escribir?**
**24 h desde el último ENTRANTE** en un chat · **7 días** desde un comentario de FB/IG.

- 🔴 **NO es una etapa del embudo, y como etapa habría sido destructivo**: una conversación tiene UNA
  etapa, así que marcar «abierto» **borraría `cotizado`**. Es una **señal derivada** (como «Cotizado»,
  ADR 0016): no se guarda, se deriva en cada consulta. **El embudo no se toca.**
- 🔴 **DESDE EL ÚLTIMO ENTRANTE, nunca desde lo último que pasó.** La ventana la abre quien escribe y
  nuestra respuesta no la extiende. Con `referencia`, responder a las 23 h se leería como «te quedan 24 h
  más».
- 🔴 **EN LA COLA LA SEÑAL SE DICE EN POSITIVO Y NO PUEDE DEJAR DE ESTARLO.** El plazo es duro **solo en
  la línea de la Cloud API**; en whatsmeow Meta **no rechaza nada** (el riesgo ahí es el ban). Un «ya no
  le podés escribir» sería falso en toda línea whatsmeow. **En la cola, una ventana cerrada no dibuja
  NADA.** Misma forma que `limitesMedia`: el plazo lo impone el transporte.
  🔴 **PERO EL COMPOSER SÍ AVISA, y eso NO reabre esto** (ADR 0058, enmienda del 17-ago-2026). Lo que la
  regla protege es no MENTIR donde el plazo no existe; la fila de la cola no sabe por qué línea sale la
  respuesta y **el composer sí** (`numeroPropio` → `transporte` de `/api/whatsapp/sesion`). Donde se
  sabe que el plazo es duro, callarlo no es prudencia: es dejar que el mensaje rebote. `lecturaDeVentana`
  (la píldora) **no cambió**; el que puede decir «cerrada» es `avisoDeComposer` (`dominio/ventana.ts`), y
  **solo con `cloud-api`** — con `transporte` ausente (server viejo) tampoco avisa.
  🔴 **AVISA, NO BLOQUEA**, y el motivo no es estilo: el cierre se calcula sobre el último entrante **que
  Hermes conoce**, y la ingesta ya se perdió mensajes. Un aviso que sobra cuesta una línea; un bloqueo
  que sobra cuesta la venta. La garantía nunca es el front — quien rechaza es Meta, y eso ahora se lee.
  ⚠️ **Lo que sí hay que releer**: al 17-ago-2026 corre **UNA sola línea y es Cloud API**
  (`WHATSAPP_TRANSPORTE=falso`), así que hoy el plazo rige para todo lo que mandan las vendedoras.
- La regla vive **una vez**, pura, en `cola/ventana.ts`, con su gemelo `ventanaCierraSql` y
  `ventana.paridad.test.db.ts` de candado — que verifica **el instante** del cierre, no solo el sí/no.
  ⚠️ **`ventanaDiasSql` NO se toca**: es el contrato de `EXPIRA`, vale solo para comentarios y tiene su
  propio test. Se comparte la **constante**, no la expresión.
- **El oro vuelve a significar tiempo que se acaba**: solo abajo de `UMBRAL_ORO_MS` (3 h). El front lee
  `ventana_cierra` como **opcional** y conserva la marca vieja de respaldo (N4 va solo, N5 es un botón).
- ⚠️ **La barra de filtros pasa a DOS PISTAS**: arriba qué cola (la línea), abajo el recorte. Con las
  cuatro líneas en una sola pista, **el chip de la deuda quedaba detrás de un scroll invisible** — y ese
  chip es la red de «abrir marca leído». Cada pista lleva **su propio** estado de sombra y navegación por
  teclado, y **lo encendido se trae a la vista tocando solo `scrollLeft`** (con
  `scrollIntoView({block:'nearest'})` los chips activos arrastraban la página entera).
- **Y EN EL PIPELINE**: tercer chip de recorte en Contactados y **la píldora en TODAS las columnas** — el
  caso más valioso es un **Cotizado con la ventana abierta**, que vive en una columna sin recorte. El
  número sale de `FilaDesglose.ventana` y la paridad fija que sea **exactamente** `?ventana=1`.
  ⚠️ `precio` y `ventana` **no se derivan una de la otra** (de 611 con precio, 12 en ventana).
- Ver sin server: `/galeria-ventana.html`, `/galeria-embudo.html`. Capturas:
  `docs/evidencia/ventana-*.png`.

## El embudo se DERIVA de lo que hizo el COMPRADOR (ADR 0044)

> ✅ **VIVO EN PRODUCCIÓN desde el 9-ago-2026** (`043544f`, N5 14:57 Lima). Verificado **midiendo**:
> `sin_respuesta 2.576 · cotizado 790 · interesado 377 · contactado 217 · cierre 13`.

`gestiones` tiene **39 filas en toda la base**: el embudo no medía el negocio, medía cuánto se acordó
alguien de tocar un botón. **La regla que ordena todo**: *las condiciones de salida de una etapa se
definen por **acciones del COMPRADOR**, no por actividades del vendedor*.

- 🔴 **`etapaEfectivaSql` deriva CUATRO peldaños**: `cierre` (venta posterior) arriba de todo,
  `sin_respuesta` debajo, y `precio_enviado → cotizado` por encima de `respondida → contactado`.
- 🔴 **`sin_respuesta` existe porque `precio_enviado` promovía a gente que nunca dijo una palabra.** Sin
  ningún entrante, `respondida` da **true** (el último saliente le gana a un `-infinity`), así que una
  difusión caía en `contactado` y con precio en `cotizado`: **2.252 de los 3.050 Cotizados (74 %) nunca
  habían escrito**. Ahora la derivación pide `hablo`, y quien no lo tiene cae en su propia columna — la
  más grande del tablero (65 %). **Se deriva y NO se declara**: no está en `ETAPAS`, no se puede arrastrar
  ahí (`compuertas.ts`) y **deja de ser cierta sola**.
- ⚠️ **CONTRATO**: quien consuma `etapaEfectivaSql` tiene que emitir **`hablo`**, **`ya_le_hablamos`** y
  **`precio_enviado`** además de `respondida`. El Dashboard las emite calculadas aunque su `HAVING` exija
  un primer entrante: el día que ese HAVING cambie, el embudo no empieza a mentir en silencio. El
  Dashboard llamaba a esto `precio_mencionado` **con un regex PROPIO más pobre**, así que la misma
  conversación contaba como cotizada en Mensajes y no en el Dashboard; se unificó contra `cola/precio.ts`
  (#37).
- **Sigue siendo un PISO**: solo empuja hacia arriba. Lo declarado más avanzado gana, `perdido` es
  terminal humano y el precio **no resucita** una conversación descartada (con test).
- ⚠️ **El «subregistro» del Dashboard cuenta lo ASENTADO A MANO**, no la etapa efectiva: leer la efectiva
  haría que el hueco diera **0 siempre**.
- **EL RECORTE ES POR COLUMNA** (`tablero.ts`, `recortesDeColumna` puro). El eje nuevo es **«Para
  seguir»** (silencio nuestro + entre 3 y 14 días en la etapa, `cola/tiempoEnEtapa.ts`): sobre 3.051
  Cotizados, «en ventana» dejaba 1 y «sin respuesta» 2.928, y éste deja **82**. La cabecera muestra **las
  dos cifras** («82 · de 3.051»). Cierre y Perdidos no llevan recorte.
  · ⚠️ **La regla del cero tiene DOS mitades**: un recorte que daría cero no se ofrece **y uno que daría
    el total, tampoco**. La excepción, para las dos: **el chip activo se ofrece siempre**, o no hay cómo
    apagarlo. Lo encontró la captura de evidencia, no un test.
  · 🔴 **«SE CALLARON CON EL PRECIO»**: de los 798 Cotizados, **540 venían conversando y dejaron de
    hacerlo en el momento exacto en que vieron el número**. Va como RECORTE y no como sexta columna.
    ⚠️ **El nombre no promete causa**: dice que se callaron *después* (regla de `resultados/medicion.ts`).
    Exige `hablo`, así que las 2.252 de difusión no se cuelan.
- **Cada tarjeta dice cuánto lleva en su columna** (`canales/antiguedad.ts`, `etapa_desde`). **Sin oro**:
  acá no corre ningún plazo. Se calla abajo de un día y cuando repetiría el reloj de arriba.
- ⚠️ **La quinta columna dejó el GRID ajustado**: a 1280 los mínimos suman 1.020 sobre ~1.256 px, con el
  gap en 8 px. Agregar otra columna **obliga a rehacer esa cuenta**, no a sumar un `minmax`.
- 🔴 **«Cierre» se DERIVA de una venta posterior** (`ventaPosteriorCteSql`). **La POSTERIORIDAD va en el
  `ON` del join**, no en un `WHERE` suelto: puesta ahí es imposible que un consumidor se la olvide, y sin
  ese `>=` la columna se llenaría con los **947 clientes que compraron ANTES** de que les escribiéramos.
  Con el filtro son **13**, y 13 es la verdad.
  · ⚠️ **`conversiones_wa` dice «esta persona compró alguna vez», NO «esta conversación vendió»**: 1.448
    de sus 1.464 filas son match por `telefono_e164`, con ventas desde marzo-2024 contra un `interactions`
    que cubre 18 días. No autoriza a concluir que conversar no vende: autoriza a decir que Hermes
    **todavía no puede medirlo**.
  · **El Dashboard NO deriva cierre**: usa `ventaJoinVacioSql`. Su embudo mide a los que LLEGARON en un
    período y cuenta el cierre por `subregistro`.
- 🔴 **Y depende de que Hermes SEPA de la venta**: **417 ventas reales en 30 días, 0 webhooks recibidos.**
  El puente `ventas:sincronizar` rechazaba el **99,6 %** de los payloads porque el esquema pedía
  `telefonos: string[]` y Cerberus manda objetos. Arreglado: de **0 a 1.565 ventas atribuidas**. Ver
  `atribucion/payload.ts`.
- 🔴 **DOS LISTAS DE ETAPAS, y confundirlas ya costó un bug**: se **declara** lo que una persona afirma
  (`ETAPAS`) y se **consulta** todo lo que el embudo puede devolver (`ETAPAS_CONSULTABLES`).
  `GET /api/conversaciones?etapa=` validaba contra la primera, así que **`?etapa=sin_respuesta` respondía
  400**. **No lo vio ningún test con base** —todos llaman al seam directo, salteándose la ruta—: el
  defecto vivía en la costura. Candado: `routes/conversaciones.etapa.test.ts`, y lo que fija es la
  RELACIÓN: *toda etapa que el embudo puede DEVOLVER se tiene que poder pedir*.
- Capturas: `docs/evidencia/embudo-derivado.png`, `pipeline-*.png`.

### Qué columnas tiene el tablero (ADR 0050)

`Te esperan → Contestaron → Saben el precio → Compraron`, y `Dijeron que no` al costado. **Cinco.**

- 🔴 **«Nunca contestaron» NO es columna, y la etapa SÍ existe.** Se retiró de `COLUMNAS_TRABAJO`
  (qué se DIBUJA), no de `etapaEfectivaSql` (qué es CIERTO) — eran 2.575 de 3.971 tarjetas, el 65 %
  de la mesa, que nadie trabajaba. **Por eso esto NO reabre ADR 0044**: esas conversaciones no
  vuelven a inflar «Contestaron» ni «Saben el precio», siguen derivando `sin_respuesta` y se siguen
  viendo en Mensajes. Candado en `tablero.test.ts`.
- 🔴 **«Ventana» NO puede ser columna** (se propuso y se midió: **1 tarjeta** en todo el tablero).
  Es una **señal que cruza a todas las etapas**, no un peldaño: una conversación tiene UNA etapa, así
  que soltarla ahí le **borraría** «Saben el precio» — y ese cruce es el caso más valioso que hay.
  Como chip se pregunta; como columna, no (ADR 0041).
- ⚠️ **«Te esperan» volvió a ser columna** (revierte #87) y **no hizo falta tocar el server**:
  `interesado` ya estaba en `ETAPAS_CONSULTABLES`. No se puede arrastrar ahí, como a `sin_respuesta`.
- ⚠️ **`BandejaDeuda` se borró**: su desglose («sin abrir · volvieron») y su botón «Responder en
  Mensajes» viven en la cabecera de «Te esperan». `resumirBandeja` no se tocó.
- ⚠️ **El GRID se rehizo**: mínimos **1.060** sobre ~1.256 px a 1280, ~164 de aire. Una sexta columna
  obliga a rehacer la cuenta, no a sumar un `minmax`.
- Captura: `docs/evidencia/embudo-cinco-columnas.png`. ⚠️ Ahí **«En ventana» no se dibuja en «Te
  esperan»** a propósito: daría el total y la regla del cero lo esconde sola.

### Cómo se LLAMA cada etapa (ADR 0049)

El nombre dice **el hecho, en pasado y del lado del comprador** — la misma regla que ADR 0044 usa
para derivar. `Te esperan → Nunca contestaron → Contestaron → Saben el precio → Compraron`, y
`Dijeron que no` al costado.

- 🔴 **EL RÓTULO VIVE UNA VEZ: `ETAPA_ROTULO` en `src/lib/etapas.ts`.** Vivía en **cinco** lugares
  —`vistas/tablero.ts`, `gestion/BarraGestion.tsx`, **dos `ETAPA_LABEL` privados e idénticos** en
  `FormularioVenta.tsx` y `RegistrarGestion.tsx`— y **cuatro componentes pintaban el IDENTIFICADOR
  crudo** con un `capitalize` de CSS (chip del radar, **leyenda del riel** —«611 cotizado»—, fila de
  la cola y el `aria-label` de la barra). Con ids de una palabra eso se veía bien **de casualidad**.
  Si agregás una pantalla que nombre etapas, leé de ahí.
  · ⚠️ **El grep encontró uno; la CAPTURA encontró los otros tres.** Ningún test de DOM los veía:
    cada componente renderizaba lo que su código decía, y lo que estaba mal era **la relación entre
    el chip de color y el texto de al lado**. El candado (`etapas.test.ts`) fija esa relación
    leyendo el árbol con `import.meta.glob` — ⚠️ **no `node:fs`**: pasa en vitest y **falla** en
    `tsc -p tsconfig.app.json`, que no lleva los tipos de node.
- 🔴 **LOS IDENTIFICADORES NO SE TOCAN.** `sin_respuesta`, `cotizado` y compañía viven en
  `gestiones`, en el SQL, en `?etapa=` y en el caché de IndexedDB (ADR 0007). Se cambia **lo que se
  lee**, nunca lo que se guarda — por eso esto es front puro y sale por **N4**.
- 🔴 **DOS ETAPAS NO PUEDEN COMPARTIR RÓTULO**, y el candado es `src/lib/etapas.test.ts`. «Sin
  respuesta» (deuda del LEAD) y «Sin contestar» (deuda NUESTRA) son **opuestas** y sonaban igual; la
  segunda es la urgente. Por eso `interesado` es **«Te esperan»** — el nombre que `BandejaDeuda` ya
  usaba, no uno nuevo.
- ⚠️ **El valor es un par `{uno, varios}`**, no un string: una columna es un montón y una ficha es
  una persona. Con un solo string cada consumidor volvía a conjugar — que es cómo nacieron las cinco
  copias. `rotuloEtapa(etapa, 'uno'|'varios')` **degrada al id**, nunca tira (N4 va antes que N5).
- ⚠️ **Lo que este ADR daba por faltante —una sexta columna «Llenaron el formulario»— NO se hizo, y
  se decidió al revés**: los leads entran a «Te esperan». Ver ADR 0051 acá abajo.
- Captura: `docs/evidencia/embudo-rotulos-claros.png`.

### Los formularios entran a «Te esperan» (ADR 0051, enmienda 11-ago-2026)

Decisión del dueño: **la columna no es «te escribieron por WhatsApp», es «la pelota es nuestra»**. Un
tercer brazo en el `UNION ALL` de la cola (`server/src/cola/leadsCte.ts`), al lado de los comentarios
y las conversaciones.

- ⚠️ **No son 25.386 tarjetas, son ~154**: la cola mira **30 días** (`ventanaCola`), y eso no es una
  limitación sino la definición — un lead de hace ocho meses no está esperando. Por eso tampoco hizo
  falta virtualizar nada, contra lo que el plan había dimensionado.
- **No hizo falta una etapa nueva**: un lead sin mensajes tiene `hablo = false` y
  `ya_le_hablamos = false`, y con eso `etapaDerivada` cae **sola** en `interesado`. No entra a
  `sin_respuesta`, que exige que le hayamos escrito.
- 🔴 **`tipo = 'lead'` GOBIERNA EL ORDEN DE LA COLA, no es una etiqueta.** Los niveles de
  `cola/urgencia.ts` preguntaban `tipo === 'mensaje'`, así que un lead **caía al nivel 5** —«el
  resto: ventanas cerradas, nada corre peligro»— y como todas las conversaciones de «Te esperan» son
  nivel 3, los 154 formularios quedaban **después de las 377: página 10** de una lista que pagina de
  a 40. La columna los contaba y no se podían ver. Quién decide: **`ESPERAN_RESPUESTA`**
  (`['mensaje','lead']`), y `urgenciaSql.ts` **genera su `IN` desde esa constante**.
  · ⚠️ **Es una lista explícita, NO `tipo !== 'comentario'`**: con la negación, un `tipo` nuevo entra
    de callado arriba de todo en la mesa de trabajo.
  · 🔴 **El test de paridad no lo vio por DOS razones que se tapaban**: no sembraba ningún lead, y su
    `comoItem` colapsaba a `'mensaje'` todo lo que no fuera comentario. Si tocás un tipo de fila,
    sembralo en `urgencia.paridad.test.db.ts` — si no, las dos escrituras divergen mudas.
  · ⚠️ **Cambia también el orden de Mensajes**, a propósito: los leads ya estaban en esa cola, en el
    nivel 5. Dos órdenes distintos para el mismo hecho es #37.
- 🔴 **EL REPARTO NO LOS FILTRA: LOS BORRA — y por eso lleva exención explícita.** `esMiaSql` mira
  `conversacion_asignada`, que se llena en el webhook de la Cloud API (o sea, **cuando llega un
  mensaje**): un lead no pasa por ahí y no puede tener fila nunca. Medido en local contra una copia
  de prod: `ventas10@` (en la rueda, así que `enElReparto` se prende sola) veía **1 tarjeta y cero
  formularios** contra las 522 de alguien fuera de la rueda. La exención es **por fila**
  (`(esMia) OR tipo = 'lead'`), no apagando el recorte — las conversaciones ajenas se siguen
  recortando, y hay test de las dos mitades. ⚠️ Se acepta que las cinco vean la misma pila: repartir
  leads es otro frente (`contacto_habilitado`, ADR 0035).
- 🔴 **UNA TARJETA POR PERSONA, NO POR ENVÍO** (`DISTINCT ON` por sufijo, gana el más reciente): la
  misma persona manda el formulario varias veces — **154 envíos de 145 personas** en la ventana,
  25.399 de 21.217 en el histórico. Sin eso «makanaky» ocupaba **cuatro tarjetas seguidas** y la
  vendedora le abre conversación dos veces. ⚠️ **El subselect que lo encierra no es decorativo**: un
  `ORDER BY` suelto en un brazo de `UNION ALL` se lo queda la unión entera y ahí `phone` no existe.
- ⚠️ **Se caen del UNION con recorte de LÍNEA o de CANAL**, como los comentarios: nadie les escribió,
  así que no entraron por ningún número nuestro — y su brazo lee `leads`, que **no tiene columna
  `canal`**, así que el `AND canal = …` de los otros dos ni siquiera compilaría.
- **La deduplicación falla hacia el lado seguro**: se descarta por `sufijoTelefonoSql` (la llave
  canónica, #37) contra `interactions`. Un choque del sufijo de 9 (#119) **esconde** un lead, nunca
  duplica una conversación viva — al revés de `clienteSql.ts`, donde un falso positivo pinta una
  venta que no existe, y por eso allá hay guarda de país y acá no.
- 🔴 **DOS TRABAJOS OPUESTOS COMPARTEN COLUMNA**: a quien te escribió le contestás y es gratis; a un
  lead hay que **abrirle** el chat en frío, que en whatsmeow es el camino corto al ban (regla dura
  #7). Por eso la píldora **«Formulario»**, y va en el **segundo renglón** — al lado del nombre se lo
  comía en 225 px. **Lo mostró la captura, no un test.**
- 🔴 **`canal === 'whatsapp'` RESPONDE TRES PREGUNTAS DISTINTAS, y para un lead las respuestas son
  OPUESTAS.** Está escrito **20 veces** en `src/`, y confundirlas dejaba la ficha de un lead vacía
  —«Sin ficha · este canal no lo trae»— **al lado de su propio número** y sin su correo. El dato no
  faltaba: `/api/contactos/lead` ya lo devolvía; el front no lo pedía.
  · **¿el `persona_id` es un teléfono?** → **`canales/canal.ts`** (`personaEsTelefono`). `landing` **sí**.
  · **¿le pedimos la foto de perfil?** → `canales/fotoVisible.ts` (`quiereFoto`). `landing` **no**:
    nunca le escribimos (#59).
  · **¿se le puede MANDAR algo?** → `DosRespuestas`, `PanelPlantillas`, `BloqueHechos`,
    `compuertas.ts`. `landing` **no**: no hay hilo (regla dura #7).
  ⚠️ **Solo la primera se unificó. Las otras dos se quedan separadas: eso ES el arreglo.** Hay test
  (`canal.test.ts`) que se pone rojo si alguien las vuelve a colapsar.
- Capturas: `docs/evidencia/te-esperan-con-formularios.png`,
  `te-esperan-formularios-arriba.png`, `te-esperan-vendedora-de-la-rueda.png`,
  `ficha-lead-de-formulario.png`, `ficha-lead-de-formulario-correo.png`.
- 🔴 **LOS DOS DEFECTOS DE ARRIBA LOS ENCONTRÓ CORRER LA APP CONTRA UNA COPIA DE PRODUCCIÓN**, no un
  test ni el SQL: los datos sembrados no tienen ni gente que manda el formulario cuatro veces ni una
  rueda de reparto cargada. **Para un frente que toca la cola, traé los datos** — `pg_dump
  --data-only` de las 16 tablas (~85 MB), restaurar con `SET session_replication_role = replica`, y
  `VITE_API_URL=http://127.0.0.1:4100 npm run dev`. ⚠️ **El `.env` de la raíz apunta el front a
  `hermes-api.goberna.us`**: sin ese override, «local» le pega a producción.

## Los leads de formulario en el radar (8-ago-2026)

Las dos reglas viven en **`server/src/dashboard/fuenteLead.ts`**, puras y con test.

- 🔴 **`platform = 'landing'` NO MATCHEA NINGUNA FILA de `leads`.** Lo escribe `webhook/landing.ts` (el
  webhook de Bravo, que nunca recibió nada); lo que escribe todos los días es `icarus/mapeo.ts`, con
  **`platform: "web"`**. Medido: `web` **25.511** filas (todas `form_name = icarus:*`) · `ig`/`fb` 651
  (muertos desde el 19-may-2026) · `landing` **0**. O sea: **el panel decía que el canal muerto traía
  gente y el vivo no traía nada.** `esDeLanding()` contempla los DOS escritores; el valor **no se
  reescribe en la base** (cambiar el hecho para no cambiar la consulta es al revés).
- 🔴 **`COALESCE(form_name, campaign_name)` elegía EL PEOR de los dos.** `form_name` siempre existe para
  icarus (`icarus:landing`, un placeholder con namespace) y tapaba a `campaign_name`, que es donde vive el
  nombre del diploma. Con el fix, 0 filas quedan sin rótulo. `productoDeLead()` reconoce el **prefijo**,
  no la cadena exacta. ⚠️ **`gente/leadDeTelefono.ts` YA hacía lo correcto**: eran **dos lecturas del
  mismo dato y sólo una estaba bien** — #37 otra vez.
- **Un lead de formulario ABRE LA FICHA al costado**, como un chat: la mitad que responde «quién es» se
  busca **por TELÉFONO**, no por hilo. Es el caso que `canales/conversacionNueva.ts` existe para cubrir
  (ADR 0035); mandar al buscador costaba el radar entero.
- 🔴 **UNA sola palabra para el origen** (`origenDeLead`, `features/cerberus/leadForm.ts`): la fila decía
  «Landing» y la ficha «Web», sobre el mismo hecho — había **tres** copias del ternario. Es un `switch`
  exhaustivo: el día que se agregue una fuente el compilador obliga a decidir su palabra en vez de
  meterla de callado en el `else`. ⚠️ El **valor** del contrato sigue siendo `web`.
- ⚠️ **La galería mostraba el CASO IDEAL y por eso nunca reflejó ninguno de los tres defectos.** Ahora
  sirve los valores reales de producción. **Una galería que no sirve los valores reales no es evidencia.**
  Captura: `docs/evidencia/radar-lead-landing-ficha.png`.

## Señales automáticas — «Cotizado» y «Se enfrió»

`server/src/senales/` calcula, sobre el hilo, si ya le mandaron el **precio** y si **se enfrió** después.
`GET /api/senales?claves=a,b,c`, detrás de `requiereVendedora`, solo lectura.

- **No se guardan** (ADR 0016): se derivan en cada consulta, como la etapa efectiva (0013) y `no_leido`
  (0014). Conviven con las categorías manuales (#48) sin ser una: la manual es píldora de **borde**, la
  automática de **fondo** tenue; misma paleta `--cat-*`, **sin oro**.
- **El criterio vive UNA vez**, puro: `senales/cotizacion.ts` (monto con moneda plausible, veto a la
  instrucción de pago) y `senales/enfriamiento.ts` (con reloj inyectado). El SQL de `consultarSenales.ts`
  solo hace un **prefiltro superconjunto** y el veredicto lo da la función pura — así no hay segunda
  implementación que pueda divergir (#37).
- **Umbral**: `SENALES_DIAS_ENFRIAMIENTO` (default 3; un valor inválido se ignora). Medir precisión sobre
  datos reales: `cd server && npm run medir:cotizaciones [días]` (read-only).

## Cada filtro de la cola se gana el lugar (ADR 0052)

**El chip «Piden info» mentía: el 82 % de lo que enganchaba era el texto que PRELLENA META** al tocar
el botón de un anuncio («Hola Quiero más información del Diploma…», 424 conversaciones con ese texto
exacto). El predicado nuevo vive en `server/src/cola/pregunta.ts`; la barra, en `canales/cola.ts`.

- **EL CRITERIO, y es lo que hay que releer antes de agregar un chip** (docblock de `FILTROS_SEC`):
  (1) es trabajo, no un estado · (2) se puede hacer hoy · (3) **cabe en un turno, ~5 a 50 filas** ·
  (4) no lo contesta otro chip. Medido sobre 3.995 conversaciones, de seis chips **dos mentían y uno
  era la mesa entera con otro nombre** («Ya compraron», 1.082 = 27 %).
- **TRES NIVELES, y los vetos solo pisan a los débiles**: `PRECIO` (plata: no lo tumba ninguna
  cortesía) · `CONCRETO` (temario, certificado, requisitos — **le gana al veto del anuncio**, porque
  el texto de Meta no contiene ninguna de esas palabras) · `GENERICO` (información, `info`, me
  interesa — éste **sí** cede ante el anuncio, el cierre y la autorespuesta ajena). 685 → **115**.
  · ⚠️ **Los dos intentos que fallaron están escritos en el módulo, y valen más que la regla**: sacar
    `informaci` perdía «Necesito información» (escrito a mano); vetar la cortesía sobre TODO el
    predicado descartaba «Cual es el precio. Gracias» y otras 5 de gente real que mezclan
    agradecimiento con señal de plata.
  · 🔴 **ANTES DE CITAR UN TEXTO DE PRODUCCIÓN COMO CASO, CRUZÁ SU `persona_id` CONTRA `numeros_wa`.**
    El ejemplo original de esa regla se documentó como «el mejor lead de la mesa» y es **Walter
    probando el bot** (el bot le contesta «Perfecto, Walter»). Una línea de Goberna escribiéndole a
    otra se ve idéntica a una persona.
- 🔴 **«Preguntaron precio» NO filtra por `respondida`, a propósito.** «Ya le contesté» no es
  terminado: quien preguntó el precio y se calló es el seguimiento más rentable (ADR 0044 midió 540).
  El chip viejo necesitaba `AND NOT respondida` porque su predicado mentía; arreglado, el parche sobra.
- 🔴 **EL REGEX COMPARTIDO NO PUEDE USAR `\b` NI `\y`.** En Postgres `\b` es un backspace; `\y` no
  existe en JavaScript. `cola/precio.ts` ya lo documentaba y **`canales/consultas.ts` lo pisó igual**:
  su copia con `info\b` **nunca matcheó nada**, sin error y sin log (`'necesito info hoy' ~* 'info\b'`
  → `f`, verificado en la base). El borde se escribe a mano: `(^|[^a-záéíóúñ])info([^a-záéíóúñ]|$)`.
- 🔴 **«Solo hizo clic» se arregla en el PREVIEW, no con una píldora.** `textoDePreview` gana un paso
  0 y esas 563 filas dicen **«📣 Vino del anuncio»** (la frase que la cadena YA tenía). Una píldora no
  servía: el renglón 2 ya está repartido y esas filas casi siempre traen chip de curso — y sobre todo,
  **una etiqueta al lado de la mentira no la corrige, la acompaña.** El programa no se pierde: lo dice
  el chip de curso.
- ⚠️ **La deuda vieja no se esconde: se le retira la promesa.** Las 472 sin responder de +7 días
  siguen en la cola y en `conteosFiltro.sinResponder` (sin chip). Qué hacer con ellas es otro frente.
- ⚠️ **Compat**: `pide-info`, `sin-responder` y `ya-compraron` se siguen aceptando como `?intencion=`
  (criterio de `por-vencer`), y `pide-info` se sirve con el predicado NUEVO. `pregunto_precio` y
  `solo_clic` viajan **opcionales**: ausentes = server viejo o caché de IndexedDB (ADR 0007), y ahí se
  comporta como antes.
- Ver sin server: `npx vite --port 5199` → `/galeria-filtros.html`. ⚠️ **Sirve los textos y los
  números REALES de producción**; una galería con el caso ideal ya escondió tres defectos una vez.
  Captura: `docs/evidencia/filtros-cola-nuevos.png`.
- **Lo que el censo encontró y este frente NO arregla**: de 3.995 conversaciones solo 1.061 tienen un
  entrante, **396 escribieron y nunca recibieron respuesta** (36 % de la línea grande), y al primer
  mensaje se contesta en <5 min el **15 %** en las líneas humanas contra el **65 %** en la del bot.
  Eso es operación antes que código.

## Lo que el bot dijo, EN LA COLA

`bot_calificaciones` **no tenía un solo lector**. El 1-ago-2026 el bot escaló tres conversaciones de leads
que estaban por comprar: escalar lo silencia a propósito (`bot_pausas`, 2 h) y del otro lado no había
nadie. **El bot solo servía mientras alguien lo vigilaba.**

- **Se deriva en la consulta de la cola**, no en un job ni en una columna nueva: `cola/botSql.ts` (LEFT
  JOIN por `clave`) y tres columnas por fila — `bot_escalada`, `bot_temperatura`, `bot_motivo`. Va en el
  LISTADO y no en la ficha porque la pregunta es «¿a quién atiendo AHORA?».
- **NO toca el orden de la cola.** La urgencia vive una vez (`cola/urgencia.ts` + `urgenciaSql.ts`) con su
  test de paridad: una escalada se encuentra por el **chip de filtro**, no empujando filas.
- **Dos filtros, no uno**: `?intencion=bot-escalada` (el bot se frenó y espera a una persona) y
  `?intencion=bot-caliente` (pidió precio/cuotas/forma de pago). Juntarlas enterraría las 3 urgentes entre
  las 14 calientes.
- **Los dos chips solo se dibujan con conteo > 0** (el activo siempre): el bot corre en UNA línea de
  cuatro. **El chip apareciendo ES el aviso.**
- En la fila: píldora de fondo tenue con ícono de bot (**sin oro**), rojo escalada, naranja caliente.
  `tibio`/`frio` no se dibujan (serían 50 de 66 filas). La lectura de los seis motivos vive pura en
  `src/features/canales/bot.ts`, y un motivo desconocido cae en «Pidió ayuda», nunca en un throw ni en un
  motivo parecido.

## El ruteo por campaña — qué pauta cae en qué vendedora (ADR 0053)

La rueda reparte parejo **porque no sabe de dónde viene nadie**. Acá se le dice que una campaña
entera tiene dueña. Vista **Routing** (`src/features/routing/`), server en `server/src/routing/`,
migración **0025**. Detalle y lo medido: `docs/adr/0053-el-ruteo-por-campana.md`.

- 🔴 **CATORCE ANUNCIOS SON DOS CAMPAÑAS** (medido el 11-ago-2026 en `51984429504`), y por eso la
  unidad es la CAMPAÑA: `[AGO] OSINT…` ACTIVE con 4 anuncios y 10 personas, `[JUL] INTELIGENCIA | WSP`
  PAUSED con 10 y 78. Por anuncio serían catorce renglones para dos decisiones, y cada anuncio nuevo
  nacería sin regla.
- 🔴 **META NO MANDA EL NOMBRE DE LA CAMPAÑA**: el `referral` trae `source_id` (el ad_id) y el
  `headline`, nada más. Se resuelve contra la Graph API (`campaign{id,name,effective_status}`).
  ⚠️ **Y el `headline` NO es identidad**: el mismo `ad_id` llega con dos titulares distintos cuando le
  cambian el creativo — agrupar por titular parte una campaña en dos, mudo. Se agrupa por `source_id`.
  ⚠️ Con `?ids=` se resuelven de a 50, pero **un id inválido tira el LOTE ENTERO**: hay reintento de a
  uno (`routing/meta.ts`), o un `12345` de una prueba vieja dejaba sin resolver a las trece de verdad.
- 🔴 **`campana_anuncio` NO ES UN CACHÉ, ES UNA PRECONDICIÓN**: el reparto corre adentro del webhook,
  con un lead esperando, así que ahí **no se le puede preguntar nada a Meta**. Un anuncio estrenado
  hoy cae a la rueda hasta que alguien refresque — y por eso **los anuncios sin resolver se CUENTAN en
  la pantalla**: son el único motivo por el que una campaña viva puede faltar de la lista.
- **La tabla vacía ES el interruptor**: sin reglas, el reparto es el round-robin de siempre. Elegir en
  la pantalla es encender; no hay flag. `aQuienLeCae` devuelve `null` —«que decida la rueda»— en los
  tres casos dudosos, y ninguno es un error (fail-open, como todo el reparto).
- 🔴 **LA LÍNEA SALE DEL ENV `WHATSAPP_CLOUD_API_NUMERO_PROPIO`, NO DEL GESTOR DE WHATSAPP.** Buscarla
  por transporte vivo ataba la pantalla a que el proceso esté arriba: con él caído, Routing decía «no
  hay línea» mientras las reglas seguían guardadas y aplicándose. **Un ruteo es config: se mira justo
  cuando algo anda mal.** No son dos fuentes — `whatsapp/wiring.ts` monta la línea con esa variable.
- ⚠️ **Refrescar es un POST** (`/api/routing/refrescar`, `npm run routing:refrescar` dry-run por
  default), nunca dentro del GET: mirar la pantalla no puede cambiar el estado, ni tardar lo que tarde
  Meta. `--todo` es lo único que refresca el ESTADO (una campaña pausada ayer sigue diciendo «activa»).
- ⚠️ **La regla NO reasigna lo ya repartido** (se aplica en el primer mensaje) y **sacarla BORRA la
  fila**, al revés de `reparto_rueda`: acá la fila es una preferencia, no la pertenencia de nadie.
- **Sigue siendo un FILTRO, no un permiso**, y **solo existe en la línea de Cloud API**: las tres de
  whatsmeow no reciben `referral`, así que ahí la decisión no se puede tomar.
- Capturas: `docs/evidencia/routing-campanas.png`, `routing-campana-elegida.png`.

### De qué producto es una pieza — el SKU manda y se puede corregir (ADR 0060)

Medido el 18-ago-2026: **93 de 153 campañas sin producto y 7 en el equivocado**, más **4 de los 22
formularios** mal enlazados. Se arregló por los dos lados. Detalle: `docs/adr/0060-*.md`.

- 🔴 **EL SKU QUE LA PAUTA ESCRIBE ENTRE CORCHETES LE GANA AL ALIAS DE TEXTO**
  (`familiaAfirmadaPorSku` → `resolverFamilia`, `cursos/alias.ts`): `[MAR] [DIPCIBE004] CIBERDEFENSA`
  es DIPCIBE aunque el alias «ciberdefensa» diga DIPCINTE. Es la regla de ADR 0019 — lo afirmado
  gana sobre lo inferido. **Los corchetes NO son cosmética**: sin ellos, `CONSULTOR360` y
  `GOBERNA360` inventaban familias (cero falsos positivos con ellos, sobre las 153 reales).
  ⚠️ La familia la extrae **`familiaDeSku`**, no un regex nuevo: los `GEN*` son cada uno su propia
  familia y el prefijo los colapsaría.
- 🔴 **IDENTIDAD ≠ NOMBRE, y por eso esto no puede empeorar una pantalla.** Nueve familias afirmadas
  por SKU no tienen alias: `nombreCurso` queda **`null`** y quien muestra texto se queda con el
  título crudo. **La vendedora nunca puede leer «PKGOSAN» en el chip del curso.**
- 🔴 **CORREGIR A MANO ESCRIBE EN `alias_curso`, así que CORRIGE EN TODAS LAS PANTALLAS** — la cola,
  el Dashboard y el bot leen ese diccionario (decisión del dueño). La hoja lo dice **antes** de que
  elijas. Un override es **un alias que es el TEXTO ENTERO de la pieza** (`decididoAMano`): gana por
  la regla de especificidad que ya existía, y **al SKU hay que ganarle a propósito** — sin eso,
  corregir una campaña con `[DIPMP0001]` adentro contestaba `ok` y la lectura siguiente la pisaba.
- 🔴 **DEL NAVEGADOR VIAJA LA CLAVE, NUNCA EL TEXTO** (`textoDeLaPieza` lo resuelve en el server): el
  alias se compara por texto exacto normalizado, así que un `×` por una `x` escribe una fila que no
  matchea nada y **la corrección se ve aplicada sin estarlo**.
- ⚠️ **El clic del renglón NO abre la hoja** (la abre su botón de producto): si hiciera las dos
  cosas, cablear costaría un Escape cada vez — la hoja tapa la columna de vendedoras.
- 🔴 **Y el Escape de `VistaRouting` se APAGA mientras la hoja está montada.** `stopPropagation()` de
  `useEscape` frena al shell (burbuja) pero **no a un hermano en captura sobre `window`**; sin el
  apagado explícito, un Escape cerraba la hoja **y** la campaña abierta. Lo descubrió el test.
- ⚠️ **«Sin producto» solo si de verdad no tiene**: el rótulo de la columna estaba clavado y afirmaba
  eso sobre piezas que sí pertenecían a uno. **Lo encontró la captura, no un test** — lo que estaba
  mal era la relación entre el rótulo y lo que decía la hoja al lado.
- Sin server: `node scratchpad/api-routing-producto.mjs` + `VITE_API_URL=http://localhost:4199 npx
  vite --port 5199` (sirve los 22 cursos y las 2 campañas **reales**, mojibake incluido). Capturas:
  `docs/evidencia/routing-producto-hoja.png`, `routing-producto-lista.png`.

## La campaña no la ve la Escuela — la única frontera que el rol NO abre (**ADR 0061**)

Goberna son DOS planos y no se cruzan: la **Escuela** (lo que Hermes atiende) y la **Consultoría** (el
comando de campaña de un candidato). `numeros_wa.proposito = 'campana'` es la frontera, y la regla vive
una vez en `server/src/numeros/campana.ts` con su gemelo SQL y su paridad.

**Una línea de campaña sólo se le sirve a quien la atiende** (`numero_vendedora`). Medido el
18-ago-2026: `51963139984` («Betto», la atienden `usuario2` y `centurion:betto.romero`) tiene 25
conversaciones y 80 envíos en 30 días, y los veían enteros `alex` (supervisor), `alan` y `usuario1`
(admin) — en la cola, el Pipeline, el selector, el Dashboard y el SSE, con teléfono y en vivo.

- 🔴 **EL ROL NO ABRE ESTA PUERTA, Y ES LA ÚNICA ASÍ EN EL REPO.** El padrón (0035), el Dashboard
  (0036), la cola (`fronteraDeAsignacionSql`) y el SSE (0059) le sirven todo a supervisor y admin
  porque **quien supervisa es quien reparte**. Acá no: esto no separa el trabajo de un equipo que
  comparte un negocio, separa **dos negocios**. Por eso `esVedadaParaMi` **no tiene parámetro
  `veTodo`** — la firma es la garantía, y hay test que se pone rojo si aparece.
  · ⚠️ **Administrar la línea sigue siendo de admin** (Routing, Equipo, alta y baja). Lo que se corta
    es LEER sus conversaciones.
  · ⚠️ **Dos de los tres «supervisores de ventas» son `admin`** (`alan`, `usuario1`). Escribir la
    regla contra `rol === 'supervisor'` cumplía el pedido a un tercio, sin síntoma en pantalla.
- 🔴 **EL GEMELO SQL PREGUNTA EN LA MISMA CONSULTA, no recibe una lista leída antes.** Es lo que hace
  que no haya degradación que discutir: sin `numeros_wa` la consulta falla y no se sirve nada. Con una
  lista aparte habría un `catch`, y su única respuesta cómoda es servir de más.
  · Las **rutas** sí necesitan la lista (deciden un 403): `numeros/cargarLineasVedadas.ts`, gemelo de
    `cargarRol`. Atrapa para que el proceso no se caiga (Express 4), pero **`vedadasDe(req)` TIRA** →
    500. **No atrapar no es lo mismo que fallar abierto.**
- ⚠️ **`NULL` y `''` PASAN, y es la mitad del contrato**: los comentarios de FB/IG y los leads de
  formulario no entraron por ninguna línea nuestra. Un `NOT IN` a secas los tira a todos (`NULL NOT IN
  (…)` es NULL) y eso se lee como «se cayeron los comentarios», nunca como una frontera de más.
- 🔴 **EL HILO TIENE DOS MITADES**: con `?numeroPropio=` de campaña es **403 `linea_de_campana`**;
  **sin** él se sirve igual y lo de campaña se cae adentro — `hiloDe` sin línea junta TODAS las del
  teléfono, así que un 403 escondería también la conversación de la Escuela con la misma persona.
- ⚠️ **`hiloDe` NO tiene default fail-closed, a propósito**: tres de sus cinco llamadores son
  MAQUINARIA (`bot/orquestador.ts`, `bot/contexto.ts`, `corridas/correrCorrida.ts`) y el bot que
  atiende la campaña ES esa línea. La frontera se resuelve en la RUTA, que es donde hay una persona.
- ⚠️ **En `/api/persona/*` va como filtro del `WHERE` → 404, no 403**: el id es un `serial`
  ENUMERABLE (hallazgo C3 de la auditoría), y un 403 confirmaría que existe.
- ⚠️ **En el SSE, `linea` es un campo REQUERIDO de `EventoRT`** (como `duena`) y se consulta **ANTES**
  que `esSuya` — que devuelve `true` de entrada para quien supervisa. Ese orden ES la regla.
- **Una línea SIN registrar no se veda**: no hay propósito que leer, y vedar por las dudas escondería
  tráfico real (`51987654321`, 2 conversaciones en prod y ninguna fila en `numeros_wa`).
- **`soloSusLineas` no se toca**: sigue encerrando al operador de campaña en lo suyo. Son las dos
  mitades de la misma frase — el docblock de `cola/lineas.ts` ya decía «y al revés tampoco», y esta
  es la mitad que faltaba.
- Sin server: `node scratchpad/api-campana.mjs` + `VITE_API_URL=http://localhost:4199 npx vite --port
  5199`. Capturas: `docs/evidencia/campana-selector-sin-betto.png`, `campana-hilo-403.png`.

## El reparto de leads — de quién es cada conversación

> Plan y decisiones: `docs/plan-reparto-de-leads.md`.

Desde el 4-ago-2026 **varias personas comparten un número** (la línea del bot `51984429504`). Sin reparto,
**dos contestan al mismo lead** y **nadie contesta a otro**. Server en `server/src/reparto/`.

> ✅ **VIVO EN PRODUCCIÓN desde el 4-ago-2026** (PR #273). La rueda tiene **5 vendedoras**
> (`ventas10@grupogoberna.com` … `ventas14@…`, el username de Cerberus **es el correo completo**); Luz
> queda afuera a propósito. Las conversaciones anteriores al reparto **no se reparten solas**. Auditar:
> `ssh deploy@161.132.39.165 'cd /srv/hermes/server && npm run reparto:rueda'`.

- **Round-robin, y se elige por CARGA, no con un puntero** (`reparto/rueda.ts`, puro): se le da al que
  menos tiene. Un puntero se desincroniza y queda apuntando a quien ya no está. La propiedad que fija el
  test: **entre el que más y el que menos recibe nunca hay más de 1** (al azar, 10 leads entre 6 pueden
  caer 4 y 0, y esa varianza **se lee como favoritismo**).
- **Dos tablas** (`db/reparto.ts`, migración `0015`): `reparto_rueda` y `conversacion_asignada`. ⚠️ La
  rueda **no se deriva de `numero_vendedora`**: ese mapa responde «¿quién atiende este número?», no «¿entre
  quiénes se reparte?» — y como lo empuja Cerberus, derivarla movería el reparto en silencio.
- **Se asigna en el webhook de Cloud API**, después de persistir y **después** de notificar al bot.
  **Fail-open**: sin tabla o sin rueda devuelve `null` — un lead perdido por un fallo del reparto es
  infinitamente peor que un lead sin repartir.
- **Es un FILTRO, no un permiso**: `requiereVendedora` dice «es una vendedora», no «cuál». Lo que hay es
  **rastro** (`asignada_por`).
- 🔴 **`?mios=1` NO es `?mias=1`.** Una vocal, la misma ruta, y confundirlos **no rompe nada visible:
  devuelve otra cola**. `mias` = mis LÍNEAS (`cola/lineas.ts`); `mios` = mis CONVERSACIONES asignadas
  (`cola/asignadaSql.ts`). Adentro son `misLineas` y `misAsignadas`, y un test los cruza
  (`consultarCola.mios.test.db.ts`).
- **«Míos» recorta el UNIVERSO**, no una columna; su propio chip se cuenta **con el filtro apagado**. **No
  es fail-open**: cero asignadas es un hecho verdadero, y lo que evita la cola vacía sin explicación es
  que el chip **lleva su número**. Lo único que se apaga solo es sin la migración (`sinAsignacion`).
- ⚠️ **El join proyecta DOS columnas, no la tabla**: `conversacion_asignada.numero_propio` choca con el de
  la cola y un `LEFT JOIN` a secas rompe la consulta entera con `42702`.
- **En la fila, el dueño va en el RENGLÓN 1** (`canales/dueno.ts`, puro): «Vos» en navy y el nombre de la
  otra persona en neutro. **Sin dueño no se dibuja nada** y **dentro de «Míos» tampoco se rotula lo
  propio**. Abajo NO entra: con el chip del bot al lado el preview quedaba en «Bue…».
- **El destino de una reasignación se VERIFICA** (`reparto/destino.ts`, puro): `vendedora_id` es el
  username de Cerberus y **Hermes no tiene padrón**, así que un dedazo escribe una fila válida y la
  conversación desaparece de la cola de todos, sin un solo síntoma. Un destino que no está ni en la rueda
  ni en `numero_vendedora` es **409 enumerando a quién sí se puede**; con la lista vacía rechaza a todos.
- 🔴 **EL MISMO HUMANO TIENE DOS GRAFÍAS VIVAS EN PROD**: `numero_vendedora` dice **`Luz`** (lo empuja
  Cerberus) y `sesiones_cerberus` dice **`luz`** (lo que se tipea al entrar, de donde sale el
  `vendedoraId`). Con comparación exacta, una conversación asignada como `Luz` es **invisible para su
  propia dueña**. Se compara normalizando **de los DOS lados** (`lower()` en `cola/asignadaSql.ts`,
  `mismaVendedora` en `reparto/destino.ts` y `canales/dueno.ts`) y se **guarda la grafía que vino**
  (reescribirla rompería el cruce con `gestiones`). **Lo que reabre el agujero es normalizar de UN lado.**
- **La rueda se carga con `cd server && npm run reparto:rueda`** (dry-run por default), nunca con SQL a
  mano: `--agregar a,b,c` · `--sacar x` · sin flags imprime cómo va y **verifica la propiedad**. Sacar a
  alguien es **baja lógica**. La ruta `/api/reparto` solo LEE.
- Ver sin server: `/galeria-reparto.html`. Captura: `docs/evidencia/reparto-cola.png`.

## El padrón de contactos — los 72.923 que NUNCA escribieron (ADR 0035)

La cola ordena a quien **ya escribió**. El padrón responde: **¿a quiénes les hablamos ahora?** Son los
contactos de **`icarus.contacts`** (72.923 · 71.341 con teléfono usable · 61.298 con correo). Vive en la
vista **Contactos**, primera solapa (`src/features/padron/`, `server/src/padron/`).

- 🔴 **ACÁ EL RECORTE ES UNA FRONTERA, NO UN FILTRO** — y es la única de Hermes junto con el Dashboard.
  **La vendedora no ve el padrón, ve lo que le habilitaron.** Por eso el recorte está en el `WHERE` de la
  ruta y **no** en un `if` del navegador: un recorte dibujado en el front no existe, los datos ya viajaron.
  Lo que NO cambia: el resto de Hermes sigue sin modelo de permisos.
- **Quién manda sale de la tabla `equipo`** (§Los roles, migración 0028), con `HERMES_SUPERVISORES`
  todavía de respaldo. Un **admin** entra igual que un supervisor: se pregunta `mandaEnElEquipo(req)`,
  nunca `rol === 'supervisor'`. **Fail-closed**, y la pantalla lo **dice** (`sinSupervisores`, que se
  resuelve con `hayQuienMande` — la MISMA cascada que el rol, o el copy contradice al 403) en vez de
  mostrar una lista vacía. Se compara normalizando los dos lados.
- **El reparto se guarda en Hermes** (`contacto_habilitado`, migración `0017`), nunca en icarus: la
  conexión fuerza `default_transaction_read_only=on` y **icarus sirve a un cliente real de consultoría**.
  ⚠️ `icarus.contacts.assigned_to` **parece** esto y no lo es: sus valores son **números de línea**.
- ⚠️ **Dos bases, sin JOIN**: los ids salen de `hermes_db` y las filas se piden a icarus
  (`= ANY(...)::bigint[]`). Por eso hay tope de página duro, y con icarus caído la lista **no se puede
  servir** — ahí va un error, jamás una lista vacía (cicatriz de ADR 0023).
- 🔴 **«Compró» se pregunta a `icarus.sales`, NUNCA a `n_purchases`**: 10.564 contactos dicen haber
  comprado y solo **4.783** tienen una venta que lo respalde. En la tabla los tres estados se distinguen:
  verde **Sí** · gris **sin respaldo** · `—`.
- **Un contacto, una dueña**: `contacto_id` es PRIMARY KEY; re-habilitar **pisa**. **El destino se
  VERIFICA** contra la rueda + `numero_vendedora` (`padron/destinos.ts` reusa `destinosPosibles`): 409
  enumerando a quién sí se puede.
- **Repartir NO manda nada.** Lo que sigue es outbound en frío y tiene un problema de canal antes que de
  código (las líneas de las vendedoras son whatsmeow, y abrir en frío es el camino corto al ban). Otro
  frente.
- **El buscador por teléfono** quedó en la segunda solapa: pregunta a **Cerberus en vivo** y trae folios y
  montos, que el padrón (copia de icarus) no tiene.
- **Un clic en la fila abre la ficha al costado**: el mismo `PanelDerecho`. La `Conversacion` se
  **sintetiza** del teléfono (`canales/conversacionNueva.ts`): timeline, señales e intereses vienen
  **vacíos**, y eso es la verdad. ⚠️ Sin teléfono usable la fila no se abre: una hoja vacía se leería como
  «no es cliente» y lo que pasa es que no se lo pudo preguntar.
- **MULTIFILTROS con facetas**: cinco dimensiones multivalor (país · curso · etapa · nivel · fuente), **OR
  adentro de cada una y AND entre ellas**. Cada opción llega con **su conteo**
  (`GET /api/padron/facetas`), y ese número **es** el total que el filtro después devuelve (con test).
  ⚠️ **Cada dimensión se cuenta SIN su propio filtro** (`donde.ts` con `omitir`): si se contara con él,
  tildar «Perú» reduciría la lista a Perú y no habría forma de AGREGAR México. Las opciones **se derivan de
  los datos**, nunca de una lista a mano. El `WHERE` vive UNA vez en `padron/donde.ts`, compartido por la
  lista y las facetas — con dos, la pantalla ofrecería «México · 11.646» y devolvería otra cosa (#37).
- 🔴 **«Curso» y «qué compró» son DOS DATOS DISTINTOS, y la tabla los mezclaba.** `course`/`last_course` los
  llena **la landing** con lo que la persona DIJO que le interesaba; lo que **pagó** vive en `sales` →
  `sale_items` → `products`. De los 19.776 de `landing`, 19.405 tienen curso y solo 1.086 compraron; los
  **477 que entran por el webhook de `cerberus` tienen venta en el 100 % y curso en NINGUNO** — por eso la
  tabla se leía al revés y las dos mitades eran correctas. Ahora viajan separados (`curso` · `comprado`).
  El producto sale por **LATERAL** (venta más reciente, ítem más caro); un JOIN plano multiplicaría la fila
  e inflaría el total del reparto.
- **SE PUEDE REPARTIR TODO LO FILTRADO, no solo la página**: la selección **cambia de forma**
  (`seleccion.ts`, puro) a `{modo:'recorte', excluidos}`. **Viaja el FILTRO, no los ids**
  (`POST /api/padron/habilitar-recorte`): 72.923 ids son ~700 KB por sentido, y el recorte es lo que el
  supervisor quiso decir, no su fotografía.
  · ⚠️ **Destildar en modo recorte NO rompe el modo** — volver a `lista` con los ids de la página sería el
    bug clásico (destildás uno de 17.014 y te quedan 49), sin síntoma hasta ver el acuse.
  · ⚠️ **El INSERT va en tandas de 5.000, y no es optimización**: Postgres corta en **65.535 parámetros por
    statement** y acá van 4 por fila, así que a partir de ~16.383 el insert fallaba entero.
  · **`RECORTE_MAX` (100.000) cubre el padrón entero a propósito**: un tope por debajo haría que la pantalla
    ofrezca «los 72.923» y el server los rechace DESPUÉS de confirmar. **Nunca recorta en silencio.**
  · **A partir de 500 hay confirmación** con la cifra escrita (`CONFIRMAR_DESDE`); el diálogo aclara que
    repartir no manda ningún mensaje (regla dura #7). El acuse muestra **cuántos habilitó el SERVER**, no
    la cifra que la pantalla tenía.
- Ver sin server: `/galeria-padron.html` (`?vendedora=1`, `?filtro=1`, `?lote=1`, `?destino=1`, `?todo=1`,
  `?todo=1&confirmar=1`, `?ficha=1`). Capturas: `docs/evidencia/padron-*.png`.

## El Dashboard es de quien lo mira (ADR 0036)

`GET /api/dashboard` servía **todo a todos** detrás de `requiereVendedora`. Con el reparto vivo, cada
vendedora veía el trabajo de las otras cuatro mezclado con el suyo. Server en
`server/src/dashboard/personal.ts`, front en `VistaDashboard.tsx`.

- **Quien NO es supervisor ve SOLO sus conversaciones asignadas**, y el recorte baja a las **cinco**
  consultas (radar · embudo · series · «qué piden» · Equipo). Recortar la lista y dejar el riel global
  daría dos respuestas a la misma pregunta en la misma pantalla. ⚠️ **`recorteDelDashboard` ya no lee
  el entorno**: recibe el ROL que `cargarRol` resolvió (§Los roles), y un `admin` ve todo igual que un
  supervisor.
- 🔴 **Es una frontera, y hay que decir DE QUÉ**: la del **Dashboard**, no la del dato. El hilo, la ficha y
  el envío siguen sirviendo cualquier conversación a cualquier token. Es la **segunda** frontera del repo;
  el resto sigue siendo **filtro, no permiso**.
- **«El negocio» es 403, no un recorte** (`no_es_supervisor`): no existe una versión personal de «cuánto
  factura cada curso». Y no como query-param, que sería la frontera a un clic de curl.
- **Lo que no tiene dueño POSIBLE se cae**: los leads de formulario y los comentarios de FB/IG no se
  reparten. Por eso la respuesta lleva `soloMisAsignadas`, y con eso la pantalla **explica el vacío**
  («todavía no tenés conversaciones asignadas», nunca «nada cayó con estos filtros», que sería falso: cayó,
  no es tuyo), **apaga** los chips de Landing/Lead Ads y rotula **«Vos»** en vez de «Equipo».
- ⚠️ **En el front el campo ausente se lee `?? true`**, y no contradice el fail-closed del server: falta en
  un server viejo y en una respuesta rehidratada del caché (ADR 0007), y con `false` por default «El
  negocio» desaparecería **para todos** en la ventana entre N4 y N5.
- 🔴 **MEDIDO EN VPS1 EL 5-AGO, Y ES LA PRECONDICIÓN PARA PRENDERLO**: el radar de 7 días tiene **213
  conversaciones y solo 83 con dueño** (`luz` 78; las cinco `ventas1X`, una cada una). Prendido así, cuatro
  vendedoras abren un Dashboard de una fila. **Hay que repartir la cola antes** — es operación, no código.
- Ver sin server: `/galeria-dashboard.html` (`?supervisor=1`, `?vacio=1`). Capturas:
  `docs/evidencia/dashboard-personal*.png`.

## El timeline se puede ESCRIBIR, y dice quién (ADR 0037)

Tenía **seis tipos de evento y los seis eran DERIVADOS**: contaba lo que las máquinas sabían y **nada de lo
que pasó en la conversación**. Server en `server/src/eventos/`, front en `src/features/eventos/`, tabla
`eventos_contacto` (migración `0018`), ruta `/api/eventos`.

- **Un evento es TIPO + dato estructurado + comentario**, nunca texto libre: un `notas LIKE '%cuotas%'` no
  se suma, no se agrupa por curso y no se cruza con la pauta. **El tipo es lo que se cuenta.** Seis:
  `pregunto_curso` · `pidio_precio` · `objecion` · `quedamos_en` · `llamada` · `otro`.
- **Tabla nueva y no `gestiones` ni `notas`**: `gestiones` tiene `etapa` NOT NULL y `notas` es **privada por
  autora** y es prosa. Acá se ve en equipo, y el `tipo` existe para poder contar.
- 🔴 **«Preguntó por un curso» ASIENTA el interés**, por el mismo seam que «+ interés». `intereses` es la
  ÚNICA fuente de verdad de «qué curso quiere»: con el curso guardado también acá habría **dos lugares
  diciendo qué quiere el lead** (#37), y sin eso la vendedora registra «preguntó por Gestión Pública» y al
  minuto Cotizado le rebota. El interés va **primero** y el evento guarda **el nombre que resolvió el
  catálogo**, no el que mandó el navegador. Es seguro porque `registrarInteres` no tira con Cerberus caído.
- **Se ve en EQUIPO, se edita por AUTORA.** 🔴 **Se compara normalizando los DOS lados** (`mismaVendedora`
  server, `esMio` front): con `Luz` vs `luz` la comparación exacta no da error, da que **Luz no ve los
  botones de sus propios eventos**.
- **Borrar es archivar** (`archivado_at`) y **el `tipo` no se edita**: cambiarlo convertiría una objeción en
  una llamada sobre la misma fila. El PATCH tampoco puede agregarle un curso a un evento que no lo tenía.
  Archivar **no des-asienta el interés**.
- ⚠️ **Un tipo desconocido se LEE, nunca tira.** `tipo` es `text` y el server acepta términos fuera de su
  lista (solo valida `^[a-z][a-z_]{0,31}$`): el front sale sin reiniciar el server, y rechazar ahí convierte
  un deploy escalonado en «no se pudo registrar». `rotuloDeTipo` lo muestra tal cual. Y **no se le inventa
  una regla**: no exige nota, no la perdona, y no asienta interés aunque traiga curso.
- **Se dice QUIÉN**, en nombre corto. El tag «MANUAL» sale **solo si no hay autor**.
- **Dos lugares, UN componente** (`RegistrarEvento`, con `variante`): **Agendar es una promesa a futuro**
  (cae en la Agenda), **registrar es un hecho del pasado** (cae en el timeline). Ninguno envía nada.
- **Los candados**: `eventos/paridad.test.ts` (catálogo del server vs. la copia del front),
  `registrarEvento.test.db.ts` (asiento del interés y normalización de grafías) y `RegistrarEvento.test.tsx`
  (jsdom) que fija **el cableado del teclado** — existe porque el defecto apareció capturando la evidencia:
  con el foco en el buscador de curso, el Escape hacía `stopPropagation()` y **no cerraba nada** (ADR 0024).
- Capturas: `docs/evidencia/eventos-*.png` (app real con un stub de ~60 líneas en `:4199`).

## El panel derecho — ordenado por lo que decide una venta (ADR 0017)

`src/features/panel/PanelDerecho.tsx` (360 px, `w-[22.5rem]`). El orden **no es temático**: es el de las
preguntas que la vendedora se hace mientras escribe. **Una pestaña guarda lo que se CONSULTA, nunca lo que
se DECIDE.**

> ⚠️ **Esta descripción es la de ADR 0017 y el rediseño dejó componentes huérfanos.** Antes de tocarlo,
> verificá contra el árbol: `docs/plan-correccion-panel-timeline.md`.

> **Vive en TRES lugares con un solo componente**: en Mensajes como columna, y en el **Pipeline** y el
> **padrón** como hoja al costado (`panel/HojaContacto.tsx`). La hoja **se superpone y no empuja**, y el
> motivo es aritmético: el `GRID` del Pipeline declara mínimos que suman **1.000 px** y a 1280 el contenido
> son ~1.180. Sin scrim a propósito. ⚠️ La tarjeta es `draggable`, así que **un arrastre no puede contar
> como clic** (guarda con ref en `TarjetaEmbudo`, con test) y el Escape de la hoja **se apaga** mientras hay
> un modal de compuerta encima — los dos escuchan en captura.

1. **Quién es** — `panel/BandaEstado`. El estado **se ve, no se lee**: filete de 3 px + fondo tenue (verde
   cliente · `--temp-frio` fría · ámbar «no se pudo saber» · gris lead nuevo). **Sin oro.** Encabeza con el
   **nombre real** (#118: **Cerberus > formulario > alias de WhatsApp**, `panel/identidad.ts`) con **la
   procedencia a la vista**. El arbitraje vive puro en `panel/estadoContacto.ts`: **un cliente que se
   enfrió sigue siendo cliente**.
2. **Qué quiere** — `panel/BloqueInteres`, **fuera de las pestañas**. 611 conversaciones con precio y 1
   interés registrado: acá se destraba. Los chips los pinta `gestion/Intereses`, el mismo componente de la
   cola/Pipeline/compuerta: este bloque **compone, no duplica**.
3. **Qué mandarle** — `DosRespuestas` (un clic manda la secuencia entera, espaciada y cancelable; tocar el
   texto lo abre en el composer) y `hechos/BloqueHechos` (#153: frases sueltas, **tocarlas NO envía**).
   ⚠️ Si no hay sugerencia clara **no se inventa una**, y **un 404 no es «no hay respuesta clara»**.
4. **El detalle**, en pestañas (`panel/pestanas.ts`, pura): Ficha · Enviar · Notas · Curso. La bandeja va
   **hundida**: el panel se lee en tres planos — blanco decide, bandeja consulta, blanco actúa.
   > 🔴 **La pestaña «Notas» es CÓDIGO MUERTO** (verificado por grep el 4-ago-2026): `pestanas.ts` la
   > declara y ningún componente la renderiza; `PanelNotas.tsx` quedó huérfano en `79b239b`. Consecuencia:
   > durante meses **no hubo ninguna forma en la app de anotar sobre una conversación**, y por eso
   > `notas_filas = 0` y `clave_general = 0` son **un solo hecho, no dos**. Decidir si se reconecta o se
   > archiva va **antes** de reconectarla. Ver `docs/plan-libreta-que-deberia-tener.md` (hipótesis C).
   > ⚠️ Desde ADR 0037 el caso que más dolía ya tiene puerta (los **eventos**), pero **no lo reemplaza**:
   > un evento es un hecho tipado y compartido. ⚠️ **`buscarNotas` ya NO está clavado a `'general'`** —
   > ADR 0046 lo cambió por el filtro de visibilidad, así que esa mitad de la deuda está pagada.
5. **Qué hago** — `panel/AccionesContacto`, al pie y **siempre visible**, con **una sola acción primaria**.
   Antes vivía dentro de la pestaña Ficha y abrir «Notas» hacía desaparecer el botón que cierra la venta.

⚠️ **El pie está clavado y el medio es un solo scroll** con la barra de pestañas pegajosa: a 1280×720 con
dos respuestas cargadas, el reparto flex empujaba «Registrar venta» fuera del panel.

⚠️ **La ficha y las sugerencias tienen techo de 12 s** (`AbortSignal.any` + `retry: false`): Cerberus a
veces deja la conexión abierta sin responder, y sin techo el panel se congela en «Buscando…» y el estado de
error no se dispara nunca.

**Quién decide las dos**: `server/src/sugerencias/estado.ts` — puro, y es **el vocabulario compartido con la
auto-respuesta nocturna**. La misma cabeza decide de día y de noche.

## Datos recomendados — la munición de una línea (#153, ADR 0017)

`server/src/hechos/` + `src/features/hechos/`. Los hechos que desbloquean la venta y casi nunca salen de
nuestro lado, medidos sobre 1.876 conversaciones: «el acceso lo tiene por todo un año» (dicho **1** vez),
«se puede pagar en cuotas» (**2**), «es para público general» (**3**).

- **`GET /api/hechos?clave=…`** devuelve como máximo **tres**, filtrados por `momentoDeVenta()` — la MISMA
  cabeza que elige las dos secuencias y el acuse nocturno. El seam que da el momento sin tocar el catálogo
  de plantillas es `estadoDeLaVenta()`: hoy en producción no hay ni una plantilla cargada y el bloque tiene
  que funcionar igual.
- **No son plantillas y no envían**: tocar un dato lo pone en el composer (#45).
- **El catálogo es editable** (tabla `hechos`, `POST`/`PUT`/`DELETE`): lo que cierra ventas cambia, y
  agregarlo no puede costar un deploy. Se siembra con `npm run hechos:sembrar -- --aplicar`. **Sin la
  migración degrada**: sirve el default y avisa que no se puede editar.
- **Se edita DESDE LA APP** (`PantallaHechos.tsx`, se abre con «Ver todos»). Lo que la pantalla hace y una
  lista no puede: **decir qué llega a verse**. Medido el 4-ago había **27 activos** con 21 sin momentos y
  las 13 frases de plata en `orden = 100` — o sea que **precio y dónde pagar no aparecían nunca**. Cada
  fila dice `n/6` o **«no se ve»**.
  · **El recorte lo calcula el SERVER** (`vistaPreviaPorMomento` en `hechos/elegir.ts`, la misma función
    que recorta en el panel) y viaja en `vistaPrevia`. **No se reimplementa en el navegador**: dos cabezas
    divergen y la pantalla afirmaría «esto se ve» sobre algo que no se ve (#37).
  · ⚠️ `GET /api/hechos/catalogo` sirve **también lo apagado** (`leerCatalogoParaEditar`), o no habría cómo
    volver a prender nada.
  · ⚠️ **La `clave` es la identidad y no se edita**: es contra lo que se estampa la procedencia de cada
    envío (`hecho:<clave>`, ADR 0022). Se propone al crear y después se congela.
- Ver sin base: `npx tsx src/scripts/imprimirHechos.ts`. La pantalla: `node scratchpad/api-hechos.mjs` +
  `VITE_API_URL=http://localhost:4199 npx vite --port 5199` → `/galeria-hechos.html`.
- **Follow-up declarado**: la objeción #1 del informe es el **aplazamiento** (13 %) y no hay mecanismo para
  capturarla. La lista de espera real es un frente propio.

## Plantillas-secuencia — «varios mensajes, con imágenes y todo en orden»

Una plantilla es una **lista ordenada de pasos** (`plantillas` + `plantilla_pasos`), no un texto: la venta
real son cuatro mensajes y el 42 % lleva imagen. UI en `src/features/plantillas/`.

- ⚠️ **No hay un endpoint que mande la secuencia entera.** `POST /api/plantillas/:id/enviar-paso` manda
  **un** mensaje por llamada; el bucle, el espaciado (1,5 s) y el cancelar viven en la pantalla
  (`useEnvioSecuencia.ts`). Si cierra la app, no queda nada mandándose solo. Todo sale por `EnvioControlado`
  vía `whatsapp/enviarYProyectar.ts` (mandar + persistir, el par que ninguna ruta puede hacer a medias).
- **Cancelar no des-envía**: el que está en vuelo sale. La máquina pura (`secuencia.ts`) distingue los dos
  momentos del corte y cuenta distinto («salieron 2 de 4» vs «1 de 4»).
- **Dos guardas**: una plantilla `propuesta` **no se manda** y un paso con imagen pendiente tampoco.
- **`{nombre}` `{curso}` `{precio}`** se resuelven en el SERVER. `{precio}` sale de Cerberus en el instante,
  por **familia de curso** (#129), y si falta la moneda queda el hueco `[precio]`. **Nunca un número
  cacheado** (el caché de IndexedDB rehidrata precios de ayer, ADR 0007).
- **Sembrar desde el histórico**: `npm run plantillas:proponer [-- --dias 14]` (dry-run) · `-- --aplicar
  <vendedoraId>` las guarda **como propuestas**. El minado propone, una persona aprueba. ⚠️ El minado
  **infiere la familia** del propio texto y **no parte el saludo por la hora del día**: «buenos días» y
  «buenas tardes» son el mismo primer paso, y separarlos era lo que impedía que la secuencia de dos pasos
  apareciera nunca (ADR 0019).
- **Las propuestas se revisan DESDE LA APP** (ADR 0019): bloque **«Para revisar»** en la pestaña Enviar
  (`plantillas/RevisionPropuesta.tsx`), con el respaldo en criollo («418 conversaciones usaron esto») y tres
  salidas: Aprobar · Editar antes · Descartar. **Se lee sin conversación abierta y sin Cerberus**: la vista
  previa con `{precio}` resuelto necesita las dos cosas, y hacer depender la revisión de eso era por qué no
  se podía aprobar nada.
  - Una propuesta minada **es del equipo**; **aprobarla es hacerse cargo** (pasa a ser suya).
  - **No se aprueba sin resolver el curso**. ⚠️ Omitir la clave en el body ≠ mandarla en `null`: lo primero
    es silencio y responde **409 `falta_familia`**. La regla es pura: `plantillas/aprobacion.ts`. Una imagen
    pendiente **no** bloquea aprobar (sí mandar).

## El lazo de resultados — de qué pieza salió y qué pasó después (#169, ADR 0022)

`envios_wa` guardaba qué se mandó y nunca **de qué pieza**, y nada guardaba **qué pasó después**: una
plantilla con 500 usos y 0 ventas se veía idéntica a una con 500 usos y 50. Server en
`server/src/procedencia/` (el hecho que se escribe) + `server/src/resultados/` (el veredicto que se deriva).
Frente 2 en **ADR 0025** (modelo aprobado, sin schema); el 3 no está.

- **La procedencia viaja en la ORDEN de envío**, no en un `update`: misma puerta (`EnvioControlado`), misma
  fila. Por eso un envío **bloqueado** también deja escrito de qué pieza iba a salir. Seis columnas armadas
  **solo** por `procedencia/pieza.ts`: `pieza_clase` · `pieza_ref` · `pieza_version` · `pieza_via` ·
  `pieza_editada` · `momento_venta`.
- **EL VOCABULARIO Y LA RECETA DE VERSIÓN VIVEN EN `server/src/piezas/`**, el mismo módulo que importa el
  catálogo que Ivi consulta. Con dos vocabularios el join da **cero filas, en silencio**, y eso se lee como
  «esa pieza no se usó nunca». ⚠️ El payload de Ivi es `{id, version, orden, gancho_id}` y **no lleva la
  clase** — punto de contrato abierto, anotado en `piezas/direccion.ts`.
- **`null` es la LÍNEA DE BASE, no un hueco**: lo que la vendedora escribió a mano es contra lo que se
  compara todo. El tipo tiene dos ramas nombradas (`A_MANO`), no `Pieza | null`, y esa fila sale **primera**
  en el reporte. Además es el **semillero de piezas nuevas**, y por eso `HechosDeUnEnvio` lleva el `texto`.
- **`(clase, ref)` es la identidad, `via` es la pantalla.** Textual y no una FK a propósito: cuando el
  frente 2 unifique los catálogos, esto se remapea y lo acumulado sigue valiendo. `via`
  (`panel-sugerencia` · `panel-secuencias` · `panel-datos` · `automatica` · **`bot`**) no la toca el frente
  2, porque unificar catálogos no cambia por dónde entró la mano.
- **La VERSIÓN es un `sha256:` + 16 hex del contenido AUTORAL, y es ahora o nunca**: sin ella, mejorar una
  frase suma los dos textos y una pieza que pasó de 12 % a 30 % se reporta 21 % para siempre. Hash y no
  contador porque un contador **se puede olvidar de incrementar**. **El texto es la plantilla SIN resolver**
  (hashear el mensaje final haría de cada destinatario una versión). **El archivo entra** (el precio vive
  adentro de la imagen); CRLF y bordes, no. El hash lo hace el **server** (hay test). `null` significa **una
  sola cosa**: no se pudo determinar el contenido.
- ⚠️ **HAY DOS PUERTAS AL MISMO `envios_wa`, y la del composer no puede calcular la versión.** Cuando la
  vendedora toca la sugerencia, la edita y manda por `POST /api/whatsapp/enviar`, el navegador solo puede
  declarar el texto **ya expandido** y nunca el nombre del archivo. Versionar con eso daba **una versión por
  destinatario y ninguna que casara con el catálogo**. Por eso una `plantilla` se versiona releyendo
  `plantilla_pasos` (`procedencia/desdeElComposer.ts`, lector inyectado) y un `hecho` por el texto de la
  caja. Sin fila que leer, `version: null` — nunca una inventada.
- **El resultado se DERIVA, nunca se guarda**: ¿contestó? · en cuánto · ¿avanzó de etapa? · ¿hubo venta
  después? El SQL **solo trae hechos crudos** (ni un `CASE`, ni una ventana, ni un umbral) y el veredicto +
  el agregado son puros. Candado: `consultarResultados.test.db.ts` — el agregado tiene que ser exactamente
  la suma de los veredictos puros.
- **LOS NOMBRES NO PROMETEN CAUSA**: `huboRespuesta` · `huboAvanceDeEtapa` · `huboVentaDespues`, y la `base`
  es `respondio_despues_de` — **nunca «efectividad»**. `medicion.test.ts` falla si alguien mete una palabra
  causal, como `plantillas.test.ts` prohíbe que un acuse se anuncie como máquina.
- **Ninguna métrica se puede serializar sin su `n` ni su `base`**: son campos requeridos de `Medicion` y
  `medir()` es el único constructor — el tipo lo impide, no una convención. Cada una lleva su **intervalo de
  Wilson al 95 %** y `muestraSuficiente` (`MUESTRA_MINIMA` = 30), porque 2/3 (67 %) **no** le gana a 180/400
  (45 %).
- **LA RESPUESTA ES DEL ÚLTIMO MENSAJE**, no de todos los anteriores. Sin esa regla, en una conversación de
  cuatro salientes la misma respuesta se cuenta cuatro veces: **22 % sembrado salía 54 %**, y el inflado
  crece con la longitud, o sea que premia a las piezas usadas donde la gente ya iba a contestar.
- ⚠️ **«¿Compró?» depende del PR #165**: `resultados/ventas.ts` es el seam. Con `conversiones_wa` vacía
  responde **`null` = «no lo sabemos», nunca `false`**.
- **Cómo se ve**: `GET /api/resultados/piezas?dias=30` y `npm run piezas:resultados [días]`, sobre el mismo
  seam. **No hay pantalla a propósito** (la vista se dibujaría dos veces cuando el frente 2 reorganice el
  catálogo). ⚠️ Las primeras semanas el corpus va a ser casi 100 % línea de base. **La primera pregunta que
  esto responde no es «¿cuál funciona?» sino «¿alguien las está usando?».**

## Interés derivado del anuncio — el lead ya llegó diciendo qué quiere

`server/src/cursos/` traduce el texto con el que llegó la persona a una **familia de curso** y lo propone en
la ficha: «📣 Inteligencia y Contrainteligencia · del anuncio [Confirmar]» (#102/#129).

- **Se deriva, no se guarda**: viaja en `derivados` dentro de `GET /api/gestiones/intereses`. **Lo único que
  escribe una fila en `intereses` es el clic humano** en `POST /api/gestiones/intereses/derivado`.
- **Precedencia** (la de #72, no se reinventa): interés registrado > curso del formulario > campaña del
  anuncio. Sin alias que matchee **no se inventa**: se muestra el título crudo, sin botón. Vive **una vez**,
  pura, en `cursos/precedencia.ts`, con su gemelo SQL en `cola/cursoSql.ts` y un **test de paridad**
  (`dashboard/curso.paridad.test.db.ts`, ADR 0019). El Dashboard **consume esos fragmentos**; hasta el
  26-jul tenía los suyos y decía «97 % sin curso identificado» mientras la cola pintaba el chip a casi todas
  las filas.
- **El diccionario vive en la base** (`alias_curso`, editable sin deploy) y nace sembrado con
  `ALIAS_SEMILLA` (idempotente, sin pisar lo editado a mano). Para sacar un alias: `activo = false`, nunca
  DELETE.
- **Hay alias por TEXTO y alias por `adId`** (ADR 0019): los anuncios genéricos («Adquiérelo ahora») no
  nombran ningún curso, y mapear esas frases le heredaría el curso equivocado al próximo anuncio con el
  mismo copy. Una fila con `ad_id` **no se busca por texto**, y un mapeo por anuncio le gana al título (lo
  afirmado sobre lo inferido).
- **La red anti-gap**: `CAMPANAS_CON_VOLUMEN` + un test que falla si una campaña con volumen se queda sin
  familia. Para encontrar los que faltan: `npm run cursos:gaps` (solo lectura).
- ⚠️ **Lo que se registra es el nombre CRUDO del producto de Cerberus** (la última edición activa, resuelta
  contra el catálogo vivo), no el nombre corto del chip: `intereses.curso` es lo que después se cotiza.
  Falla ruidoso (502/409), nunca inventa un nombre parecido.
- **La compuerta de Cotizado no se relaja, se satisface**: el modal llega con el curso preseleccionado.

## Ex-clientes en la cola — el padrón en copia local (#133)

De las 1.997 conversaciones vivas, las de gente que YA COMPRÓ se veían igual que un desconocido. El dato
existía (`cerberus/ficha.ts`) pero se pedía **por HTTP, de a una, al abrir la conversación**.

- **El padrón se SINCRONIZA**: `cd server && npm run clientes:sincronizar` (`--dry-run` no escribe). Lee
  **`icarus.contacts`** con `ICARUS_DATABASE_URL` (read-only) y guarda en **`clientes_padron`** lo MÍNIMO:
  sufijo del teléfono, código de país, compras y nivel. **Nombre, correo, DNI y monto NO se copian** (para
  eso está la ficha viva). Es derivada y descartable.
- 🔴 **`n_purchases` NO ALCANZA: se exige una venta que lo respalde** (`EXISTS` sobre `icarus.sales`). De
  **10.504** contactos con `n_purchases >= 1`, **5.805 (55 %) no tienen ni una fila en `icarus.sales`**. Ese
  contador lo copió verbatim el import de `leads_crm` y nadie lo volvió a calcular. Con el chequeo, «Ya
  compraron» pasa de **128 a ~78** y todos tienen compras que enseñar. **Sin `icarus.sales` visible
  degrada**, porque «no se pudo preguntar» no es «no hay».
- **Desmarcar es parte del trabajo**: el upsert pisa lo que sigue calificando pero **no toca lo que dejó de
  calificar**, así que `proyectarLote` devuelve `aBorrar` y `sincronizarLote` los borra. Sin eso, las 5.805
  filas ya escritas sobrevivían al arreglo. Es un DELETE acotado por id, no un TRUNCATE.
- **La jerarquía vive una vez**, pura, en `clientes/nivel.ts` (`vip` · `recompro` · `compro`) y se
  **congela** en la tabla. El SQL de la cola **no recalcula**: lee la columna (#37). El precio es que cambiar
  la regla obliga a re-sincronizar.
- **El match** (`cola/clienteSql.ts`) es el sufijo de 9 dígitos **más una guarda de país**: casi 2 de cada 3
  clientes no son peruanos (MX 1.987 · EC 1.981 · GT 393). Con largos nacionales distintos, un mexicano y un
  peruano comparten sufijo (**falso positivo**) y un guatemalteco nunca llega a 9 dígitos (**393 clientes
  invisibles**). Se normaliza a E.164 antes de sacar el sufijo (#119).
- ⚠️ **LA MARCA DE LA FILA Y LAS COMPRAS DEL PANEL SALEN DE DOS FUENTES DISTINTAS**, y por eso «dice Cliente
  pero no muestra compras» tiene **tres** causas que en pantalla se ven igual: **(A)** el número no se podía
  buscar así (la guarda de #119 se había aplicado al padrón y **no** a la búsqueda de Cerberus, que seguía
  con `slice(-9)`: para un local más corto que 9 esa cadena arranca adentro del código de país y el
  `icontains` **no puede dar verdadero nunca**) · **(B)** Cerberus tiene otro teléfono · **(C)** el padrón
  afirma de más. **Cuál pesa cuánto se mide**: `npm run clientes:auditar [-- --cerberus]` (solo lectura).
- **La partición del teléfono vive UNA vez**: `server/src/telefono/paises.ts` (`partirE164`,
  `variantesLocales`, `mismoTelefono`). `variantesLocales` termina **siempre** con el sufijo de 9, así que
  nada que hoy matchea deja de matchear; y `ficha()` **confirma el candidato** contra los `telefonos[]` del
  detalle (`mismoTelefono`, estricto: país **y** local).
- **Solo WhatsApp**: en Messenger `persona_id` es un PSID y sus últimos 9 dígitos podrían chocar.
- UI: píldora en la fila (tres pesos del **verde**, **sin oro**), chip **«Ya compraron»** con su número, y la
  banda del panel se pinta de entrada. **Degrada** sin la migración (`sinPadron`).

## Administración de números (para Cerberus)

`/api/admin/*` (`server/src/routes/admin.ts`), detrás de **`requiereServicio`**: credencial
`HERMES_ADMIN_SERVICE_TOKEN`, Bearer estático, familia aparte del HMAC de vendedora (#50/#95). Lo consume
**Cerberus**, que es la fuente de verdad del mapa número↔vendedora y lo **empuja** acá; Hermes guarda la
copia (`numeros_wa` + `numero_vendedora`) y ejecuta la vinculación (la sesión nunca deja VPS1). Endpoint
central: `PUT /api/admin/numeros/:numero` (upsert declarativo, `vendedoras[]` reemplaza el set). Contrato en
**`docs/multi-numero/`**; decisión en **ADR 0010**.

- **La cola SÍ se puede acotar a las líneas propias, y sigue siendo un FILTRO, no un permiso.** No puede ser
  un permiso porque Hermes no tiene modelo de permisos: `requiereVendedora` dice «es una vendedora», no
  «cuál», y el hilo, la ficha y el envío siguen sirviendo cualquier conversación a cualquier token. **Un
  recorte presentado como frontera sería una frontera imaginaria — peor que ninguna, porque se le cree.**
  Cómo se pide: **`GET /api/conversaciones?mias=1`** (el server resuelve `numero_vendedora`; si el front
  mandara los números habría dos lugares decidiendo cuáles son «las mías»). La regla vive pura en
  `server/src/cola/lineas.ts` y es **FAIL-OPEN**: sin filas asignadas se sirve TODO y la respuesta lo dice
  (`sinLineasPropias`), porque una vendedora que abre una cola vacía no lee «no tenés líneas», lee «se
  perdieron las conversaciones».
- **QUÉ LÍNEAS CORREN HOY (11-ago-2026): DOS.** `51984429504` «Ventas Meta» (Cloud API, es la que trae
  los leads) y `51963139984` «Betto» (whatsmeow, campaña). Las otras tres se **retiraron** ese día por
  decisión del dueño porque estaban caídas: `51986394450` «Ventas Perú» —el 62 % del universo histórico—
  sin archivo de sesión y sin un entrante desde el **28-jul**, `51941654039` «Walter» desde el **5-ago**,
  `51944531711` «Sindy» sin tráfico nunca. Re-vincular cualquiera es el mismo camino de siempre
  (`wa:vincular`, sesión propia en disco, fila en `numeros_wa`).
- 🔴 **`numeros_wa.activo` NO TIENE UN SOLO LECTOR — retirar una línea con la baja lógica es TEATRO.**
  El único lector en `server/src` es `dashboard/negocio.ts`, y ni ahí alcanza: es la segunda rama de un
  `UNION` cuya primera rama saca los números desde `interactions`, así que una línea con tráfico reciente
  sigue apareciendo aunque esté inactiva. Ni `UPDATE ... SET activo = false` ni
  `DELETE /api/admin/numeros/:numero` sacan la línea del selector ni sus conversaciones de la cola — y el
  DELETE tampoco **detiene el transporte**, contra lo que promete `docs/multi-numero/hermes.md`.
  **La palanca real es el `.env` de VPS1**: `WHATSAPP_NUMEROS` (que es lo que lee `numerosConfigurados`,
  `whatsapp/gestor.ts:41`, con `WHATSAPP_NUMERO` de respaldo) **y `BOT_LINEAS`**, que es aparte — si se
  olvida, el bot queda habilitado sobre líneas muertas y **contestaría como «Sofía Rodríguez» el día que
  alguna se re-vincule**. `WHATSAPP_CLOUD_API_NUMERO_PROPIO` es otra variable y no se toca.
  · ⚠️ **Nunca dejar `WHATSAPP_NUMEROS` vacío**: con `WHATSAPP_TRANSPORTE=whatsmeow` el server **no
    arranca** (`wiring.ts:195`) y Hermes se cae para todas.
  · ⚠️ **Nunca `?purgar=true` ni tocar `.wa-sessions/`**: es lo único irreversible del frente — recuperar
    una sesión exige el teléfono físico y escanear el QR. La baja lógica sin purgar se deshace sola.
  · ⚠️ **Cerberus las puede resucitar**: `activo` tiene `.default(true)` en el Zod del upsert, así que un
    `PUT /api/admin/numeros/:numero` que no mande el campo las reactiva sin log. Y `vendedoras` tiene
    `default([])`: un push incompleto **vacía `numero_vendedora`** de ese número.
- 🔴 **N5 SALE VERDE Y NO REINICIA SI EL SHA YA ESTÁ DESPLEGADO — así que un cambio de `.env` NO se
  aplica.** Pasó el 11-ago: se editó el `.env`, se disparó `desplegar-server.yml`, salió `success` y el
  servicio ni se movió (`ActiveEnterTimestamp` y el PID del log, idénticos). **Para un cambio de entorno,
  reiniciar a mano** (`sudo systemctl restart hermes`) y verificar con esos dos, nunca con el color del
  workflow. ⚠️ Y el auto-revert de `hermes-deploy` **no cubre esto**: revierte el CÓDIGO, no el `.env` —
  la red es el backup que hiciste antes de editar.
- ⚠️ **Con una sola línea whatsmeow, `primero()` es la de CAMPAÑA.** Las fotos de perfil, `marcarLeido`
  sin `numeroPropio` y la auto-respuesta salen por ahí (`routes/whatsapp.ts:386` y `:287`,
  `autorespuesta/reloj.ts:42`), o sea que los leads de la Escuela se consultan por la línea de un
  candidato — un cruce entre los dos planos de Goberna. **Deuda abierta**: migrar esos tres consumidores
  a `gestorWhatsapp().de(numeroPropio)`.
- **El vinculador es UNO A LA VEZ y por eso se puede soltar**: `POST .../vincular` arranca (responde
  `vinculando`, **el QR NO viene acá**: viaja en `.../vincular/estado` como `esperando_qr`) y **`DELETE
  .../vincular` cancela**. Sin esa puerta, una vinculación que nadie escaneó bloqueaba a todos los demás
  números hasta reiniciar Hermes. Cancelar es idempotente; cancelar la de OTRO número es 409, nunca un
  silencio.
- ⚠️ **El candado lo toma SOLO un pareo en vuelo** (`esPareoEnVuelo`: `esperando` · `qr`). **El que mordía
  era `conectado`**: al terminar bien, `cerrar()` suelta el cliente pero el estado se queda, así que
  **después de una vinculación EXITOSA el próximo número nuevo comía 409 para siempre**.
- **Un pareo que dejó de dar señales ya no toma el vinculador** (`VIGENCIA_QR_MS`, 60 s): whatsmeow rota el
  QR cada ~20 s mientras el canal vive; cuando se cierra, el último quedaba en pantalla para siempre
  —imposible de escanear— **y encima bloqueando**. Vale también para `esperando`. La regla vive pura en
  `numeros/dominio.ts` (`estadoVinculacionVigente`, reloj inyectado).

## La atribución de ventas — la conversación se vuelve plata

`server/src/atribucion/`. **Un solo proyector** (`proyectarVenta`) y tres caminos que lo llaman: el webhook
de Cerberus (`webhook/ruta.ts`), la venta que la vendedora registra desde el chat (`asentarVentaEnEmbudo`) y
el **puente temporal** (`npm run ventas:sincronizar`). Detalle y el pedido a Cerberus:
**`docs/atribucion-de-ventas.md`** (#161).

- **La llave es determinista, no un match**: la conversación viaja dentro del `venta_request_key`, se guarda
  en `Venta.idempotency_key` y **vuelve** en el webhook (`atribucion/llave.ts`). ⚠️ Techo duro de **64
  caracteres**; si no entra, cae a la llave vieja — **nunca truncada**. Adivinar por teléfono es el
  respaldo, con techo medido: **2,1 %**.
- **Cascada etiquetada**: `llave` › `telefono_e164` › `telefono_sufijo`. El sufijo de 9 es **débil** (#119):
  de 143 matches, 29 tienen otro E.164. Queda marcado aparte a propósito.
- **Nada se pierde y nada se infla**: lo atribuido va a `conversiones_wa`, lo que no, a
  **`ventas_no_atribuidas`** con su motivo. Tabla aparte porque `conversiones_wa` la cuentan entera como
  ventas tres consultas vivas — meter ahí las 6.800 ventas del ERP convertiría el panel de la vendedora en
  el reporte de Cerberus.
- ⚠️ **`ontologia.conversiones` NO es un schema muerto**: es el outbox del CAPI y `lazo/worker.ts:87` lo
  consulta para no mandar dos veces el mismo `Purchase`. Se queda donde está.
- **El puente es temporal y se apaga solo**: lee `icarus.cerberus_events` (read-only) y pasa los payloads por
  el MISMO camino que el webhook. El día que Cerberus haga fan-out se deja de correr el script.
  🚨 **Nunca repuntar `ICARUS_CERBERUS_WEBHOOK_URL`**: eso rompe producción de un cliente. Fan-out.

## «Es la misma persona que…» — la unificación de contactos

La misma persona escribe desde dos números, o desde WhatsApp y desde Instagram. La vendedora lo afirma desde
la ficha y **se une la FICHA, no los hilos**: la clave `conv:<canal>:<persona>:<numeroPropio>` no se toca, la
cola no cambia. Server en `server/src/identidad/`, UI en `src/features/identidad/`, ruta `/api/enlaces`.
Decisión en **ADR 0017** (puente clave↔persona); #58.

- **El puente** es `identidadDeClave` (`identidad/clave.ts`, puro): la clave del CRM se traduce a una
  identidad de canal **`wa_id` / `ig_user` / `psid`** (DÉBIL), nunca a `email`/`telefono`. ⚠️ **El número
  propio de Goberna se cae del identificador**: quien le escribe a dos números nuestros es un solo humano. Un
  comentario suelto (`int:<id>`) **no es enlazable**.
- **La persona se crea perezosamente**, al enlazar. **Leer una ficha JAMÁS escribe en el grafo.**
- Enlazar es una **estrella**: simetría, idempotencia y «sin ciclos» salen de la forma del grafo, no de
  código defensivo. Techo de 10 identidades por persona. **Deshacer revoca, no borra** (`revocado_*` + índice
  parcial `vinculos_identidad_activo_uq`).
- ⚠️ **El rebuild de `ontologia/poblarIdentidad.ts` ya NO borra los enlaces manuales** (era una bomba
  anunciada en su propio comentario): borra `WHERE regla <> 'manual'` y el derivado **cede** ante lo que una
  persona afirmó. Fijado por `poblarIdentidad.test.db.ts`.

## Deploy

**VPS1** (`deploy@161.132.39.165`), en `/srv/hermes`: servicio systemd `hermes` (PORT=4110), Postgres propio
`hermes_db` (127.0.0.1:5438), API pública **`https://hermes-api.goberna.us`** (nginx + certbot
dns-cloudflare; el 4110 no se expone).
⚠️ **Acá decía «número 51986394450 vinculado ALLÁ» y quedó viejo**: esa línea se retiró el 11-ago-2026
(sin sesión desde el 28-jul). Hoy corren **`51963139984` por whatsmeow y `51984429504` por Cloud API** —
ver §«Administración de números» para cómo se retira una línea de verdad.

### El entorno de PRUEBAS y la rama `desarrollo`

```
feature/* --PR--> desarrollo --(N3)--> pruebas.hermes.goberna.us  +  pruebas.app.goberna.us
                      |
                     PR
                      v
                    main   --(N4/N5)--> producción
```

Detalle y el mapa cruzado con Cerberus: **`docs/entorno-de-pruebas.md`**.

- **N3 es el MISMO entorno con dos propósitos**: en `desarrollo` es donde se previsualiza; en `main`
  sigue siendo el ensayo que **gatea N4**. N4 y N5 siguen clavados a `main`.
- 🔴 **Lo peligroso de pruebas no es el código, es la BASE: es una COPIA de producción.** Los teléfonos
  y las conversaciones de adentro son de gente real y son correctos — un envío de prueba no rebota, llega.
  Lo único que lo evita es el `.env`, y el inventario vive en **`deploy/vps1/env.pruebas.example`**
  (🔴 apagada · 🟡 distinta · ⚪ igual). **Al agregar una variable de entorno nueva, decidí a qué grupo
  pertenece y anotala ahí**, o el próximo que monte el entorno no puede saberlo.
- 🔴 **Y hasta el 18-ago-2026 staging apuntaba a Cerberus de PRODUCCIÓN** (`CERBERUS_BASE_URL=
  https://app.goberna.us`): registrar una venta en el ensayo la escribía en el ERP. Ahora apunta a
  `pruebas.app.goberna.us`.
- 🔴 **El candado es el `listen` de nginx, no una contraseña**: los vhosts escuchan solo en la IP de
  Tailscale (`100.85.119.49` VPS1, `100.87.97.7` VPS2) y el DNS público apunta a esa `100.x`, que no se
  rutea desde internet. Si Tailscale se cae, pruebas queda **inalcanzable**, no abierto. Lo que reabre el
  agujero es cambiar un `listen` a `0.0.0.0`. Cert por **DNS-01** obligatoriamente (HTTP-01 necesitaría
  que Let's Encrypt alcance el :80 desde afuera, y no puede).
- ⚠️ **El front de pruebas se compila con `VITE_API_URL=https://pruebas.hermes.goberna.us`.** Con el
  `127.0.0.1:4111` de antes el bundle solo servía abierto DENTRO de VPS1 — que era por qué staging existía
  y no se podía mirar.
- ⚠️ **La app de escritorio NO puede apuntar a pruebas**: `URL_PROD` está clavada en `lib.rs` sin override
  por env. Pruebas se mira en el navegador; para la cáscara, `npm run dev:app`.
- **Refrescar datos**: `deploy/vps1/refrescar-datos-pruebas.sh` (dry-run por default). Restaura producción
  y **después** corre las migraciones de `desarrollo` encima, así cada refresco ensaya la migración
  pendiente contra datos reales. A pedido, nunca por cron: pisaría lo que alguien esté probando.

**Hay CD, en cinco niveles** (`docs/despliegue-continuo.md`; ADR 0021 y 0022). Corre en **dos hosts, y
la división es deliberada** (18-ago-2026):

- **N1, N2, N2b y el resumen → `hermes-ci`**, dos runners en **VPS2**. Son jobs autocontenidos
  (`actions/checkout` + su propio `docker-compose.test.yml`) y no tocan disco de producción.
- **N3, N4 y N5 → `vps1-hermes`**, el runner de siempre en **VPS1**. Despliegan: escriben en
  `/srv/hermes-staging` y `/srv/hermes`. Ese trabajo es local al host y no se puede mover.

Antes los seis pedían `vps1-hermes` y lo servía UN runner, así que se serializaban aunque N2 y N2b
estén escritos para ir en paralelo. Medido el 18-ago: **el 47 % de los jobs esperaba más de un minuto
en cola, p90 de 9 min, picos de 20** — y competían por CPU con producción, con VPS1 en load 23 sobre
8 núcleos. Ver ADR 0038 de `goberna-infra`.
🔴 **Un merge a `main` YA NO cancela al anterior** (18-ago-2026). GitHub guarda **un solo run
en espera** por grupo de concurrencia: cuando llega otro, al que esperaba **lo cancela**, y
`cancel-in-progress: false` protege al que corre, no al que espera. Con el grupo compartido
`ci-${{ github.ref }}`, dos merges seguidos dejaban al del medio en `cancelled` **sin ejecutar un
solo job** — pasó dos veces el 18-ago. Ahora el grupo lleva el SHA en main, así que cada commit
tiene su cola de uno. Lo que impide dos deploys pisándose son los candados **por job**
(`desplegar-staging`, `desplegar-produccion`), que no se tocaron, más las guardias de
«no retroceder» de N3 y N4: si lo desplegado ya CONTIENE el commit del run, el job se saltea con
un `::notice::` en vez de hacer `checkout --force` de un árbol viejo sobre producción.

⚠️ **Antes de cambiar un label, el runner que lo publica tiene que existir.** GitHub no falla cuando
nadie ofrece un label: deja el job encolado para siempre, sin error. `gh api
repos/Goberna-Lab/hermes/actions/runners`.

| | Qué | Cuándo |
|---|---|---|
| **N1** | lint · typecheck · journal monótono · migraciones expand-only | toda corrida |
| **N2 / N2b** | build · tests puros · secretos · tests con base | toda corrida |
| **N3** | **pruebas** (`/srv/hermes-staging`, `:4111`, base en `:5440`): despliega, migra, smoke | push a **`desarrollo`** y a `main` |
| **N4** | front a producción, sin restart — cero downtime | solo si N3 pasó |
| **N5** | server a producción: respalda, migra, reinicia, smoke, revierte solo si falla | **botón** |

N5 es un botón por prudencia: desde ADR 0027 reiniciar ya **no** tira las sesiones de Cerberus, pero un
restart en horario de venta sigue mereciendo un humano mirando. El trabajo lo hace
**`deploy/vps1/hermes-deploy.sh`** —versionado, no YAML— y es la misma pieza que corre por SSH:
`ssh … 'sudo hermes-deploy --dry-run | --rollback'`. `tauri-windows.yml` sigue aparte (host Windows).

**El server corre un BUILD compilado, no `tsx watch`** (16-ago-2026). Hasta acá `hermes.service` y
`hermes-staging.service` arrancaban `npm run dev` en producción — el proceso de DESARROLLO, 24/7:
cuatro procesos (`npm`→`sh`→`tsx`→`node`) con un file-watcher que ahí no observa nada, porque el único
momento en que el código cambia es un restart, y ese restart ya lo dispara el deploy. Medido: un solo
proceso `node dist/index.js` contra los cuatro de antes, con menos RSS total.
- `hermes-deploy.sh` (N5) y el paso inline de N3 compilan el server **antes** de cada restart, con el
  mismo patrón que el front: build a un directorio aparte y `mv` atómico, para que un build roto nunca
  toque el `dist/` que el proceso viejo tiene en memoria. `revertir()` deshace el swap igual que con el
  front (`server/dist.roto`).
  ⚠️ **`npm run build` (`tsc -b`) no sirve acá**: no admite `--outDir` (TS5094), así que el deploy
  compila con `tsc` SIN `-b` — mismo output, verificado a mano contra `tsc -b` (680 archivos
  idénticos, porque el proyecto no tiene project references). `npm run build`/`npm start` siguen
  funcionando igual para probar esto en una máquina local.
- Los unit files viven versionados en **`deploy/vps1/hermes.service`** y
  **`deploy/vps1/hermes-staging.service`** —mismo criterio que `hermes-deploy.sh`: se instalan desde el
  repo, no se editan en el servidor (`sudo install -m 0644 deploy/vps1/hermes.service
  /etc/systemd/system/hermes.service && sudo systemctl daemon-reload`).
  🔴 **Instalar el `.service` nuevo es un paso MANUAL aparte, y sin él el cambio no hace nada**: el
  pipeline compila `server/dist/` en cada deploy pase lo que pase, pero si el unit instalado en VPS1
  sigue diciendo `ExecStart=npm run dev`, ese `dist/` nunca se ejecuta — el servidor sigue en modo
  desarrollo aunque el deploy salga verde y compile. Verificar qué hay corriendo:
  `systemctl status hermes` (mirar `Main PID`: `npm run dev` = viejo, `node dist/index.js` = nuevo) o
  `ps aux | grep tsx` en VPS1 (si aparece, sigue en modo dev).
- **Desarrollo local no cambia**: `npm run dev` (tsx watch) sigue siendo el comando de
  `docs/…§Correr en local`. Esto es solo producción/staging.

🔴 **EL CI DE `main` ROJO CON *SOLO* N4 ROJO NO ES UN BUG: ES DRIFT EN `/srv/hermes`.** N4 aplica la regla
dura #6 y se niega a tocar producción si el checkout tiene cambios locales sin commitear
(`::error::/srv/hermes tiene cambios locales sin commitear. No toco nada.`), y por el gate del job «Resumen»
eso pone **roja la corrida entera**. Medido el 8-ago-2026: dos archivos **rastreados** borrados del working
tree bloquearon **dos merges seguidos** y **nadie lo vio, porque N4 solo corre en push a `main` y el PR se
ve verde igual**.
· Mirarlo: `ssh deploy@161.132.39.165 'cd /srv/hermes && git status --porcelain -uno'`.
· Arreglarlo: `git checkout -- <rutas>` **después** de verificar que esos archivos existen en `main` y que
  ningún commit los borró. ⚠️ **Nunca `reset --hard` ni `checkout .` a ciegas**: eso pisaría una edición
  hecha a mano, que es justo lo que la regla #6 protege.
· N5 comparte el runner `vps1-hermes` con N3 y N4, y ese runner **es uno solo y serializa**:
  puede quedar encolado detrás de un deploy en curso. **Encolado ≠ colgado.** Desde el 18-ago-2026
  espera bastante menos, porque N1/N2/N2b se mudaron al label `hermes-ci` en VPS2 y ya no le compiten
  por el turno — pero sigue siendo una cola de uno.

🔴 **El smoke verifica los ASSETS, no solo el bundle** (`deploy/vps1/verificar-assets.sh`, en N4 y N5).
Comparar el hash del `index-*.js` no mueve un asset que falta. **Y no alcanza con mirar el código HTTP**: el
fallback SPA devuelve `index.html` con **200** para cualquier ruta, así que un `curl -f` a un archivo
inexistente PASA — se compara **content-length contra el disco**, con una ruta inventada como control. El
script **falla si no verificó ningún asset** (su primera versión usaba `find -printf`, que no existe en
macOS, y daba «0 verificados · 0 fallos» en verde: el mismo falso verde que viene a atrapar).

⚠️ **N4 termina en `success` TAMBIÉN cuando decide NO desplegar** (porque el cambio toca `server/`). Desde el
7-ago el Resumen lo distingue: **«⏭️ no aplica (toca server/: va por N5)»**. Consecuencia que no es obvia:
**un PR que toca `server/` deja el FRONT sin desplegar también**, y hace falta N5 para las dos mitades.

**El schema va en migraciones versionadas**, no en `db:push` (ADR 0021). Al tocar `src/db/*.ts`:
`npm run db:generate` → `goberna-journal-set-when` → commitear `server/drizzle/` completo. Cómo y por qué:
**`docs/migraciones.md`**. Runbook: **`docs/deploy-vps1.md`**.

**La app de las vendedoras se EMPAQUETA**, no se clona: `env VITE_API_URL=https://hermes-api.goberna.us npm
run empaquetar:mac` → `src-tauri/target/release/bundle/dmg/`. **El `.exe` NO sale de acá**: lo hace
`tauri-windows.yml` en un runner Windows, a mano.

## Flujo de trabajo

`main` es **producción**: no se commitea ni se pushea directo. El camino es **rama + PR + CI verde**, y el
merge va con **rebase** (historia lineal, se preservan los commits del PR).

**`desarrollo` es la rama paralela**: los PRs de features caen ahí y se despliegan solos al entorno de
pruebas. Promover es un PR **`desarrollo` → `main`**. Tampoco se pushea directo.

- **Ramas**: `feat/`, `fix/`, `chore/`, `docs/` + descripción corta.
- **Commits por unidad de trabajo**: cada uno se lee solo y explica *por qué*, no *qué*.
- **Tracker**: GitHub Issues de `Goberna-Lab/hermes`. Labels `vista:*` (dashboard · pipeline · contactos ·
  mensajes · correos · agenda), `transversal`, `rediseño`, `infra`, `datos`, más los de triage.
- **`git push` a `main` está bloqueado** por `.githooks/pre-push`. No es protección de rama: la org está en
  plan **free** y el repo es privado, así que los rulesets dan 403. El hook se instala solo (`npm install`
  corre `prepare`). Emergencia real: `git push --no-verify`.

## Agent skills

- **Issue tracker**: GitHub Issues de `Goberna-Lab/hermes` vía `gh`; los issues se escriben en español y los
  cierra el PR con `Closes #N`. Ver `docs/agents/issue-tracker.md`.
- **Triage labels**: los cinco roles canónicos ya existen en el repo. Ver `docs/agents/triage-labels.md`.
- **Domain docs**: `CONTEXT.md` en la raíz + `docs/adr/`. Ver `docs/agents/domain.md`.

## Secretos y config (env)

Solo en `server/.env` (gitignored). **Se referencian por nombre, jamás se pegan** (regla dura #1):
`DATABASE_URL`, `META_ACCESS_TOKEN`, `CERBERUS_BASE_URL`, `HERMES_SESSION_SECRET`, `WHATSAPP_TRANSPORTE`,
`WHATSAPP_NUMERO`/`WHATSAPP_NUMEROS`, `WHATSAPP_APP_SECRET` (firma del webhook — sin él todo POST a
`/webhook/whatsapp` es 403), `IVI_URL`, `IVI_SERVICE_TOKEN`, `HERMES_ADMIN_SERVICE_TOKEN`,
`HERMES_CATALOGO_SERVICE_TOKEN` (el de Ivi — **otro secreto**, a propósito), `AUTO_RESPUESTA` (+ sus
`AUTO_RESPUESTA_*`), `ICARUS_DATABASE_URL` (read-only al Postgres de icarus: el padrón de #133 **y** los
72.923 contactos de ADR 0035), `HERMES_SUPERVISORES` (quién ve el padrón entero **y el Dashboard entero** —
**no es un secreto, es una lista de `vendedora_id`**, pero fail-closed: sin ella nadie es supervisor y
**todas ven solo lo suyo**; desde la tabla `equipo` es el **respaldo**, no la fuente) y **`HERMES_ADMINS`**
(el break-glass: entra como `admin` aunque la base no conteste — tampoco es un secreto, y vacía = nadie).
Correos (ADR 0058): `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (el buzón de
compatibilidad, el que se usa mientras no haya ningún remitente dado de alta) y
`SMTP_DOMINIOS_VERIFICADOS` (**no es un secreto**: la lista de dominios que SES ya aceptó, default
`goberna.us`). ⚠️ En SES el `SMTP_USER` es un **Access Key ID de IAM**, no un buzón: no sirve de
`From` y no puede viajar al navegador.
Ver `server/.env.example` (solo nombres).

## Reglas duras (Goberna)

1. **Secretos**: por nombre, nunca pegados en prompts/archivos/docs.
2. **Verificación antes de "listo"**: ningún cambio de UI o deploy se reporta terminado sin screenshot
   (Playwright, o la galería de la pieza) o `curl` a la URL viva.
3. **Toda reescritura documenta qué reemplaza** (ADR en `docs/adr/`) y archiva al predecesor.
4. **latin1 de Cerberus**: el enemigo son los **emojis**, no los acentos (á/é/ñ pasan; el emoji revienta el
   INSERT en MySQL). Sanitizar en el borde: **`server/src/cerberus/latin1.ts`** (#108). Todo POST a Cerberus
   se arma con `cuerpoParaCerberus` — nunca a mano, campo por campo. El login es la única excepción, y el
   porqué está escrito en `auth.ts`.

## Gotchas

- **`db:push` se RETIRÓ de prod y staging** (ADR 0021): el schema viaja en el PR como `.sql` versionado y el
  deploy lo aplica solo. **Sigue siendo lo correcto para las bases efímeras de test** (`montarBase.ts`).
- 🔴 **El `when` del journal de migraciones es un contador monótono, y falla en SILENCIO**: si una migración
  queda con un `when` menor al máximo ya aplicado, drizzle la **saltea sin error** y el deploy sale verde con
  la tabla sin crear. Pasa al mergear dos ramas que generaron una migración cada una. Arreglo:
  `JOURNAL_FILE=server/drizzle/meta/_journal.json goberna-journal-set-when`. `journal.test.ts` lo atrapa en
  N1, y `db:adoptar` lo verifica también contra la base.
- **El transporte falso repite ids entre reinicios** (`falso-1`, `falso-2`…): reprocesar colisiona con la
  idempotencia y el mensaje no entra. Para demos limpias, borrar los `external_id LIKE 'wa:falso-%'`.
- **whatsmeow trae binario Go por plataforma**: en el deploy linux, `npm install` baja el binario linux.
- 🔴 **`consultarCola` MATERIALIZA `todo` UNA VEZ POR PEDIDO, EN UNA TABLA TEMPORAL.** Las tres
  consultas —página, conteos de los chips y desglose del embudo— arrancaban con el MISMO
  `conTodo(...)`, o sea tres veces el hash join de 13.195 interacciones contra `events`, el sort de
  10 MB que cae a disco y ~20 agregados con regex. Medido en producción el 11-ago-2026: 1.645 +
  1.310 + 1.193 ms, y la primera página —la única que el front pide— tardaba **5,6 s** contra 1,8 s
  de la segunda. Con la tabla temporal: **4.797 → 1.632 ms**, y el Pipeline pasa de 18 pasadas a 6.
  · ⚠️ **La transacción va ADENTRO del `try` del loop de degradación.** Al revés, el primer error de
    tabla ausente aborta la transacción y los cuatro reintentos contestan «current transaction is
    aborted»: la cola dejaría de degradar y se caería.
  · ⚠️ **La tabla se llama `todo`, igual que la CTE que reemplaza**, porque varias CTEs de esas
    consultas leen `FROM todo` y **una CTE no puede ver un alias del `FROM`**. Con otro nombre
    revientan con `relation "todo" does not exist`.
  · 🔴 **El desglose mira OTRO universo** (arma su `todo` con `pins = null`: una conversación fijada
    y vieja sube a la cola pero no entra a la foto del embudo). Comparte la tabla gracias a
    `en_ventana` —«¿habría entrado sin el pin?»— en los tres brazos del UNION. Y
    `contarPorEtapaEfectiva` (el embudo del Dashboard) entra SIN transacción y sin tabla, así que
    sigue armándose el suyo: lo pide el flag `desdeTablaCompartida`. Candado:
    `consultarCola.desglosePins.test.db.ts`.
  · ⚠️ **Lo que NO era**: `work_mem` 4→64 MB **empeora** (4,1 → 4,5 s con el seam real; aislado en un
    `.sql` da al revés porque ahí Postgres paraleliza y adentro de la consulta grande no), y
    `shared_buffers` no tiene nada que ganar (100 % de aciertos, cero lecturas de disco). **Para
    medir un cambio, corré el SEAM COMPLETO contra datos reales** — hay un A/B listo en
    `server/scratchpad/medir-cola.ts`, que va por un túnel SSH a la base de producción.
- ⚠️ **`err.message` de una consulta de drizzle NO dice por qué falló: dice el SQL.** postgres.js lo
  arma como «Failed query: …» y guarda la causa en `err.cause`. Por eso el webhook escupió **96 «no
  se pudo aplicar el recibo» en una hora sin explicar ninguno**. Para loguear un `catch` de base va
  `porQueFallo()` (`server/src/lib/porQueFallo.ts`), no `err.message`.
- **La cola sirve conversaciones, no filas** (`/api/conversaciones`, no `/api/interactions`): los mensajes se
  agrupan por `(canal, persona, número propio)`; los comentarios siguen individuales.
- **Backticks dentro de un comentario SQL cierran el `` sql`` `` template**: TS1005 en cascada. Un comentario
  que nombra una columna no puede llevar backticks.

## Estado

**La foto de hoy vive en `docs/estado.md`** — este archivo no la lleva, porque envejece más rápido que todo
lo demás. La bitácora de cómo se llegó: `docs/sesion-2026-07-21-crm-definitivo.md`.

⚠️ **Antes de asumir que el código de `main` es lo que corre**:
`ssh deploy@161.132.39.165 'cd /srv/hermes && git log --oneline -1'`.

> 🔴 **La auto-respuesta está APAGADA a propósito** (interruptor de base en `apagada`, 27-jul 01:10). Se
> prendió esa noche y se apagó a los siete minutos: los 40 borradores estaban mal de **siete formas**, tres
> graves. **No la prendas sin leer el issue #166.** Nada salió — las 40 quedaron en `preparada`.

> 📌 **Regla del dueño (27-jul-2026): el lead todavía NO puede saber que hay un automatismo detrás.**
> Invierte lo que `autorespuesta/plantillas.ts` documentaba como decisión de diseño deliberada. Si tocás
> plantillas o sugerencias, ese es el marco.

**Tres cosas que este archivo decía rotas y ya no lo están**: la auth partida (resuelta por perímetro,
ADR 0011 — deuda abierta: CORS en `*` #94 y credencial de servicio para el SDK #95), la urgencia
implementada dos veces (#37, ADR 0009) y el nivel VENCIDO que no se disparaba (#38). Detalle y evidencia en
`docs/arquitectura.md` §8.
