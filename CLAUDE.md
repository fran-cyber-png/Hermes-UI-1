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

Los cuatro documentos: `CONTEXT.md` glosario del negocio · **`docs/arquitectura.md` el mapa (leelo
antes de tocar arquitectura)** · `docs/estado.md` la foto de hoy · `docs/adr/` las decisiones.

> ⚠️ **Este repo tiene DOS MITADES.** La extracción se trajo el árbol entero de meta-escuela, así que
> conviven el CRM que se usa (~39 archivos: `whatsapp` `auth` `cerberus` `cola` `realtime`, 13 de 27
> routers) y el dashboard de pauta del que salió (~45 archivos: `analisis` `canales` `decisions`
> `pauta` `ontologia` `fuentes` `sdk`, 14 routers). **Ninguna acción de la vendedora alcanza la
> segunda mitad.** No está rota, está desconectada — y los comentarios de `server/src/index.ts`
> describen la arquitectura vieja, así que engañan. Ver `docs/arquitectura.md` §2.

## Stack

- **Front** (`src/`): React 19 + Vite 8 (React Compiler), Tailwind 4, TanStack Query, lucide-react.
  **Sin router** — un espacio con vistas conmutadas por estado (ADR 0002): Dashboard · Pipeline ·
  Contactos · Mensajes · Correos · Agenda · Entrenar bot · Libreta · Navegador (⌘1..⌘9).
  ⚠️ **El rango se DERIVA de `VISTAS`**: agregar una vista es tocar ese array y nada más, y el candado
  que importa es el de la ÚLTIMA — un número clavado dejaría andando a todas menos esa.
  Qué entra al riel es un criterio, no un número (**ADR 0034**, enmienda 0002): un **LUGAR** con
  **acción primaria nombrable**; lo que se consulta y se cierra —Cabina `?`, Ivi `i`— no entra.
  Marca en `src/index.css` (azul + dorado, Montserrat; **el dorado significa tiempo que se acaba**,
  nada más). Norte de producto: `docs/plan-crm-definitivo.md`. El **caché de consultas se persiste en
  IndexedDB** y se restaura antes del primer render (ADR 0007, `src/lib/datos/`).
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
  Guardia hard-fail anti-prod (5439, nunca 5438/5434).
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
  commitea**. La app de la vendedora **no vincula, solo ve**.
  ⚠️ **Y esa credencial no va en una laptop**: el 29-jul se encontró la línea de VENTAS en el checkout
  de desarrollo. El `.gitignore` cubre **el nombre exacto** `.wa-sessions/`, así que renombrar ese
  directorio deja 43 MB de credencial a la vista de git. Para desarrollo va `WHATSAPP_TRANSPORTE=falso`.
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
  en el runner de VPS1, que no tiene Rust; los de la cáscara viven en `tauri-windows.yml`, que es
  `workflow_dispatch`. Medido el 9-ago-2026: **el último build verde de Windows es del 4-ago**, y hoy
  falla en «Tests de la cáscara» con `STATUS_ENTRYPOINT_NOT_FOUND` (`0xc0000139`) — el binario de test
  compila y no arranca, así que **no hay `.exe`**. Es de **ADR 0040**, no de 0043 (verificado disparando
  el workflow sobre `6803145`). Pista: falta `WebView2Loader.dll` al lado del `.exe` de test.
  ⚠️ **El frente que toca `cargo test` de `src-tauri/` tiene que disparar `tauri-windows.yml` a mano en
  su PR** — si no, los está escribiendo a ciegas.
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

## Abrir un chat lo marca leído — y NO lo mueve de lugar

- **El bug**: `POST /api/whatsapp/leido/:telefono` mandaba los ticks azules al lead y **no tocaba
  `estado_conversacion.leido_hasta`**. Ahora la misma ruta hace las dos cosas — aparte, porque son dos
  destinatarios distintos y que uno falle no puede llevarse al otro.
- **Y BAJA.** El orden es `fijada → fijada_at → no_leido DESC → nivel → antigüedad`
  (`bandaPinOrdenSql`). Decisión del dueño del 7-ago. ⚠️ **Lo que cuesta**: un chat leído y urgente queda
  debajo de uno sin leer que no lo es.
- 🔴 **La red que hace aceptable eso ya existía: el chip «Sin responder»**, que filtra por `NOT
  respondida` —sin mirar el cursor de lectura— y lleva su número. **Sin ese chip la decisión escondería
  deuda.** `cola/abrirMarcaLeido.test.db.ts` lo verifica explícitamente.
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
- 🔴 **LA SEÑAL SE DICE EN POSITIVO Y NO PUEDE DEJAR DE ESTARLO.** El plazo es duro **solo en la línea de
  la Cloud API**; en las tres líneas whatsmeow Meta **no rechaza nada** (el riesgo ahí es el ban). Un «ya
  no le podés escribir» sería falso en tres de cuatro líneas. **Una ventana cerrada no dibuja NADA.**
  Misma forma que `limitesMedia`: el plazo lo impone el transporte.
- La regla vive **una vez**, pura, en `cola/ventana.ts`, con su gemelo `ventanaCierraSql` y
  `ventana.paridad.test.db.ts` de candado — que verifica **el instante** del cierre, no solo el sí/no.
  ⚠️ **`ventanaDiasSql` NO se toca**: es el contrato de `EXPIRA`, vale solo para comentarios y tiene su
  propio test. Se comparte la **constante**, no la expresión.
- **El oro vuelve a significar tiempo que se acaba**: solo abajo de `UMBRAL_ORO_MS` (3 h). El front lee
  `ventana_cierra` como **opcional** y conserva la marca vieja de respaldo (N4 va solo, N5 es un botón).
- ⚠️ **La barra de filtros pasa a DOS PISTAS**: arriba qué cola (la línea), abajo el recorte. Con las
  cuatro líneas en una sola pista, **«Sin responder» quedaba detrás de un scroll invisible** — y ese chip
  es la red de «abrir marca leído». Cada pista lleva **su propio** estado de sombra y navegación por
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

### Cómo se LLAMA cada etapa (ADR 0049)

El nombre dice **el hecho, en pasado y del lado del comprador** — la misma regla que ADR 0044 usa
para derivar. `Te esperan → Nunca contestaron → Contestaron → Saben el precio → Compraron`, y
`Dijeron que no` al costado.

- 🔴 **EL RÓTULO VIVE UNA VEZ: `ETAPA_ROTULO` en `src/lib/etapas.ts`.** Vivía en **cinco** lugares
  —`vistas/tablero.ts`, `gestion/BarraGestion.tsx`, **dos `ETAPA_LABEL` privados e idénticos** en
  `FormularioVenta.tsx` y `RegistrarGestion.tsx`— y el Dashboard no tenía ninguno: pintaba **el
  identificador crudo** con un `capitalize` de CSS. Con ids de una palabra eso se veía bien **de
  casualidad**, y por eso nadie lo vio. Si agregás una pantalla que nombre etapas, leé de ahí.
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
- 🔴 **FALTA LA PRIMERA COLUMNA Y ES LA MÁS GRANDE**: `leads` tiene **26.175** filas y **25.386
  (97,5 %) nunca tuvieron una conversación**, así que el Pipeline ordena el **2,5 %** del negocio.
  **No es «Te esperan»** (ahí hay hilo abierto y contestar es gratis): un lead de landing exige
  **abrir en frío**, y eso es un problema de canal antes que de código. Va primera y se llama
  «Llenaron el formulario». ⚠️ Obliga a **rehacer la cuenta del grid** y arrastra la virtualización.
  Medido el 10-ago-2026; el último lead entró **ese mismo día** con el caño de WhatsApp cerrado.
- Captura: `docs/evidencia/embudo-rotulos-claros.png`.

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
- **Quién es supervisor sale de `HERMES_SUPERVISORES`** (CSV de `vendedora_id`), no de una tabla.
  **Fail-closed**, y la pantalla lo **dice** (`sinSupervisores`) en vez de mostrar una lista vacía. Se
  compara normalizando los dos lados. **No se edita desde la app**, igual que la rueda del reparto.
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
  daría dos respuestas a la misma pregunta en la misma pantalla. Supervisor sale de `HERMES_SUPERVISORES`.
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
- ✅ **El ruteo multi-número YA ESTÁ VIVO** (medido el 29-jul-2026): **tres líneas vinculadas y corriendo**.
  `WHATSAPP_NUMEROS` es el CSV que las levanta; `WHATSAPP_NUMERO` quedó como el singular viejo. **Agregar una
  cuarta línea no es infraestructura nueva** — es el mismo camino (`wa:vincular`, sesión propia en disco,
  fila en `numeros_wa`).
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
dns-cloudflare; el 4110 no se expone), número 51986394450 vinculado ALLÁ.

**Hay CD, en cinco niveles** (`docs/despliegue-continuo.md`; ADR 0021 y 0022). Todo corre en el **runner
self-hosted de VPS1** (label `vps1-hermes`), que es uno solo: los jobs se serializan.

| | Qué | Cuándo |
|---|---|---|
| **N1** | lint · typecheck · journal monótono · migraciones expand-only | toda corrida |
| **N2 / N2b** | build · tests puros · secretos · tests con base | toda corrida |
| **N3** | **staging** (`/srv/hermes-staging`, `:4111`, base en `:5440`): despliega, migra, smoke | push a `main` |
| **N4** | front a producción, sin restart — cero downtime | solo si N3 pasó |
| **N5** | server a producción: respalda, migra, reinicia, smoke, revierte solo si falla | **botón** |

N5 es un botón por prudencia: desde ADR 0027 reiniciar ya **no** tira las sesiones de Cerberus, pero un
restart en horario de venta sigue mereciendo un humano mirando. El trabajo lo hace
**`deploy/vps1/hermes-deploy.sh`** —versionado, no YAML— y es la misma pieza que corre por SSH:
`ssh … 'sudo hermes-deploy --dry-run | --rollback'`. `tauri-windows.yml` sigue aparte (host Windows).

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
· El runner es **uno solo y serializa**: N5 puede quedar 15+ min encolado. **Encolado ≠ colgado.**

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
**todas ven solo lo suyo**). Ver `server/.env.example` (solo nombres).

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
