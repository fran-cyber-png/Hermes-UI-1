# Hermes — reglas para Claude

**Hermes es el CRM de la Escuela**: una app de escritorio (Tauri; la UI vive en el server — OTA) donde una vendedora de Goberna
atiende, desde una sola pantalla, a toda la gente que levantó la mano por **Facebook, Instagram,
Messenger y WhatsApp** — con la ficha del contacto al lado del chat, y registrando la venta contra
Cerberus. Negocio: la **Escuela** de Goberna (formación política, LATAM).

Extraído de `meta-escuela` preservando historia git (ver `docs/adr/0001`). El **plan y las decisiones**
viven en `docs/plan-hermes-mvp.md`. El concepto en `docs/concepto.md`.

**Antes de tocar arquitectura, leé `docs/arquitectura.md`** — el mapa: cómo está hecho, los patrones
de la casa, los bordes externos y la deuda. Los cuatro documentos y para qué sirve cada uno:
`CONTEXT.md` glosario del negocio · `docs/arquitectura.md` el mapa · `docs/estado.md` la foto de hoy ·
`docs/adr/` las decisiones con su fundamento.

> ⚠️ **Este repo tiene DOS MITADES.** La extracción se trajo el árbol entero de meta-escuela, así que
> conviven el CRM que se usa (~39 archivos: `whatsapp` `auth` `cerberus` `cola` `realtime`, 13 de 27
> routers) y el dashboard de pauta del que salió (~45 archivos: `analisis` `canales` `decisions`
> `pauta` `ontologia` `fuentes` `sdk`, 14 routers). **Ninguna acción de la vendedora alcanza la
> segunda mitad.** No está rota, está desconectada — y los comentarios de `server/src/index.ts`
> describen la arquitectura vieja, así que engañan. Ver `docs/arquitectura.md` §2.

## Stack

- **Front** (`src/`): React 19 + Vite 8 (React Compiler), Tailwind 4, TanStack Query, lucide-react.
  **Sin router** — un espacio con vistas conmutadas por estado (ADR 0002): Dashboard · Pipeline ·
  Contactos · Mensajes · Correos · Agenda · Entrenar bot · Libreta · **Navegador** (⌘1..⌘9; el rango
  **se deriva de `VISTAS`**, agregar una vista es tocar ese array y nada más — y el candado que
  importa es el de la ÚLTIMA: un número clavado dejaría andando a todas menos esa). Qué entra al riel es un criterio y no
  un número (**ADR 0034**, que enmienda 0002): un **LUGAR** con **acción primaria nombrable**; lo que
  se consulta y se cierra —Cabina `?`, Ivi `i`— no entra. La **Libreta** (`n` o ⌘8) es la octava desde
  el 4-ago: la herramienta existía entera desde #47 y `notas` tenía **cero filas** en producción.
  Marca Goberna en `src/index.css` (azul + dorado, Montserrat; el dorado significa
  **tiempo que se acaba**, nada más). El norte de producto: `docs/plan-crm-definitivo.md`.
  El **caché de consultas se persiste en IndexedDB** y se restaura antes del primer render, así la
  app abre con el último estado conocido en vez de un spinner (ADR 0007, `src/lib/datos/`).
- **Escritorio** (`src-tauri/`): **Tauri v2** — la cáscara solo abre `https://hermes-api.goberna.us`
  (OTA; fallback al dist local). Windows se compila en Actions (`tauri-windows.yml`), no cross-compila.
  **Electron se archivó el 7-ago-2026 (ADR 0039)**: la cáscara es una sola. `dev:app` es `tauri dev`
  (arranca Vite solo por `beforeDevCommand`) y `empaquetar:mac` es `tauri build`.
  ⚠️ **`base: './'` en `vite.config.ts` NO se saca** aunque su comentario hablara de Electron: el
  fallback local carga el build sin server detrás, y con rutas absolutas abre en blanco —
  o sea que el defecto aparecería **solo durante una caída**.
  🔴 **Un comando propio de Tauri necesita permiso declarado o anda en dev y falla en producción.**
  La ventana `main` navega a un origen **remoto** (`hermes-api.goberna.us`) y Tauri chequea el ACL
  para todo pedido no local. Se declara en `src-tauri/permissions/*.toml` y se referencia en las
  **dos** capabilities (`default.json` y `remote.json`) — declarar uno propio prende el manifiesto
  ACL de la app y cierra también el camino local. Los tests de `lib.rs` lo fijan invocando por el
  IPC real con la URL de origen de producción (ADR 0040 §5.3).
- **Server** (`server/`): Express 4 + Drizzle ORM + Postgres 17 (imagen pgvector, puerto **5434** en
  local) + Zod 4. Event store append-only + proyecciones.
- **WhatsApp**: `@whatsmeow-node/whatsmeow-node` (cliente de protocolo no oficial, binario Go vía
  subprocess). Ver §WhatsApp.

## Correr en local

```bash
docker compose up -d --wait                       # Postgres (event store), en la raíz del repo
cd server && npm install && npm run dev            # API en :4100 (necesita server/.env)
npm install && npm run dev:app                     # la cáscara Tauri (arranca Vite :5173 sola)
```

- `npm run dev` (sin `:app`) abre el front en el navegador: la cola y la conversación nativa funcionan;
  solo el viejo webview no (y ese está retirado, ver §WhatsApp).
- **Tests**: server `cd server && npm test` (node:test, puros salvo checks en vivo); front `npm test`
  (vitest, entorno `node` por default — módulos puros). **Typecheck**: front
  `npx tsc --noEmit -p tsconfig.app.json`, server `cd server && npx tsc --noEmit`.
- **Tests de COMPONENTE (con DOM)**: archivo `*.test.tsx` con `// @vitest-environment jsdom` en
  la **primera línea** (por archivo, no global: meter los ~40 tests puros en jsdom los haría más
  lentos sin ganar nada). El andamio —raíz de React, `QueryClientProvider`, un `keydown` que
  viaja de verdad, los remiendos de jsdom— vive en `src/pruebas/dom.tsx`: `montar(<X/>)`,
  `teclear('Escape')`, `await reposar()`. Existen porque **una regresión de teclado no la puede
  ver ningún test puro**: la decisión (`escapeDePopover.ts`) estaba testeada hasta el hueso y la
  app perdió igual el Escape global, porque el defecto estaba en el CABLEADO (ADR 0024).
- **Tests con base (SQL)** (ADR 0008): para el SQL de la cola/radar/proyecciones, contra una Postgres
  efímera. `docker compose -f docker-compose.test.yml up -d --wait`, luego `cd server && npm run
  test:db`. Para escribir uno: archivo `*.test.db.ts` (el glob puro no lo toma), `const db = await
  baseDePrueba(t)` (`src/pruebas/base.ts`) te da una base aislada por test; sembrás con
  `src/pruebas/sembrar.ts` y le pasás **ese `db`** al seam (`consultarRadar(db)`…), nunca al singleton.
  Ejemplo vivo: `src/pruebas/humo.test.db.ts`. Guardia hard-fail anti-prod (5439, nunca 5438/5434).
- **Refrescar datos de Meta**: `cd server && npm run ingest:interactions` (polling manual, read-only).
  Captura comentarios FB/IG + DMs de Messenger de **todas las Páginas que el token puede ver** (`me/accounts`).
  ⚠️ **Desde el 7-ago-2026 NO es el camino principal**: lo es el webhook (§Instagram y Facebook).
  Este queda como red de seguridad y como lo único que puede traer lo VIEJO.

## WhatsApp — la costura y la vinculación

- **Todo pasa por la interfaz `TransporteWhatsapp`** (`server/src/whatsapp/transporte.ts`). Habla
  **teléfonos, nunca JIDs**. **DOS implementaciones, no tres**: `falso` (dev/tests) y `whatsmeow`
  (real). Se elige por env `WHATSAPP_TRANSPORTE` y `wiring.ts` no conoce ninguna otra. Acá decía que
  había un tercero, `cloud-api` («futuro respaldo de Meta»), y **no existe** — verificado el
  29-jul-2026: no hay archivo de transporte ni rama en el wiring. Lo que sí existe de la Cloud API es
  **la mitad que RECIBE**: `server/src/webhook/whatsapp.ts` + `firma.ts` (#107, con validación HMAC).
  Falta la que manda. Importa para cualquier discusión de mover el bot a otro runtime: mientras el
  canal sea whatsmeow, el envío vive **atado a VPS1** —un proceso Go largo con la sesión en
  `.wa-sessions/<numero>.db`—, y eso no se puede mudar a un edge sin cambiar antes de canal.
  Si un JID aparece arriba de esa línea, la costura falló (la conversión vive en `identidadWa.ts`).
- **Vincular un número** = server-side, aparte de la app (decisión **D13**): `cd server && npm run
  wa:vincular -- <numero>`. **Se vincula por QR** — acá decía «un código de 8 dígitos» y es falso:
  `vincular.ts:47-56` renderiza el QR a un PNG en `$TMPDIR/hermes-wa-qr.png` y lo rota cada ~20 s
  hasta que se escanea, con el porqué escrito al lado («el pairCode por número devolvía 400 en este
  número»). Se escanea desde WhatsApp → Dispositivos vinculados. La sesión queda en
  `server/.wa-sessions/` (**gitignored: es la credencial de la cuenta, NUNCA se commitea**).
  La app de la vendedora **no vincula, solo ve**.
  > ⚠️ **Y esa credencial no va en una laptop.** El 29-jul se encontró `.wa-sessions/51986394450.db`
  > —la línea de VENTAS— en el checkout de desarrollo, con un `whatsmeow` local reintentando contra
  > la cuenta de producción y el `.env` apuntando al Cerberus vivo. Se archivó fuera del repo. Ojo
  > con el detalle que lo hace peor de lo que parece: el `.gitignore` cubre **el nombre exacto**
  > `.wa-sessions/`, así que renombrar ese directorio dentro del repo deja 43 MB de credencial a la
  > vista de git. Para desarrollo va `WHATSAPP_TRANSPORTE=falso`; para probar con una línea real
  > está el banco de pruebas (`docs/plan-banco-de-pruebas.md`) con un **número de prueba**.
- **El webview viejo ya no existe**: `PanelWhatsapp.tsx` —retirado por D13— **se borró el 7-ago-2026
  con ADR 0039**, junto con `cuentas.ts`, `whatsapp/tipos.ts` y los tres preloads de `electron/`.
  Era el único consumidor del preload, y no lo importaba nadie.
- **LLAMADAS DE VOZ — habilitadas en la línea del bot, y todavía NO se puede llamar.** Estado
  medido el 3-ago-2026 en `51984429504` (phone number id `1293736303812393`, WABA
  `1545885483579508`): `calling.status = ENABLED` con **`call_icon_visibility = DISABLE_ALL`**.
  El ícono va oculto **a propósito**: sin WebRTC ni SIP no hay con qué atender, y un botón de
  llamar que nadie contesta se paga caro — 2 llamadas seguidas sin responder restringen y 4
  revocan el permiso. Tres cosas que conviene saber antes de tocar esto:
  · **Primero el webhook, después el switch.** Meta rechaza habilitar el calling mientras la app
    no esté suscrita al campo `calls` (error **138018**, «technical pre-requisites are not met»).
    Es al revés del orden intuitivo y costó un intento fallido descubrirlo.
  · **No se puede llamar en frío**: hace falta permiso explícito de la persona, pedido con el
    interactivo `call_permission_request` (`npm run wa:permiso-llamada -- <numero>`, **dry-run por
    default**). Techo de 1 pedido por día y 2 por semana por persona, y exige la ventana de 24 h
    abierta. **Ese permiso es la variable que decide si el frente entero vale la pena**, y se mide
    sin escribir una línea de audio.
  · Las **líneas de las vendedoras no entran acá**: son whatsmeow, y whatsmeow no puede iniciar ni
    aceptar llamadas (solo rechazarlas). Ahí la respuesta es WhatsApp Desktop vinculado al celular
    de la línea, no la Calling API.
  Los eventos de `calls` se guardan crudos en `events` (`source='meta_wa_call'`); la clave de
  idempotencia vive pura en `webhook/llamadas.ts` y **lleva el evento**, porque una llamada manda
  varios webhooks con el mismo `id` y con la clave a secas se perdía el `terminate` — el único que
  trae `duration`. Falta el audio, y eso es una decisión de infraestructura (SIP a un softphone es
  bastante más barato que WebRTC adentro de Hermes), no una tarea pendiente.
- **Nada de automatización, con UNA excepción escrita**: no envío masivo, no warmup, **no anti-ban**.
  Un envío = una acción humana, por `EnvioControlado` (la única puerta hacia `enviarTexto`). El
  `temporary_ban` **se muestra siempre**, nunca se esconde.
  La excepción es la **auto-respuesta fuera de horario** (#125, **ADR 0015** + **0016** + **0018** +
  **0020**), y es del
  tamaño exacto del agujero que tapa: 44% de los leads llega fuera de horario y el 44% de esos nunca
  recibe respuesta. Solo puede mandar **un acuse de una plantilla registrada** a quien **escribió
  primero**, **fuera de la franja de atención**, tras **30 min sin respuesta humana**, **una vez por
  día**, y **nunca a quien dijo que no**. Nada de eso se negocia en un `if`: vive en
  `server/src/autorespuesta/`.
  - **La franja se pregunta DOS veces, y la que importa es sobre el MENSAJE** (#166, ADR 0020).
    `dentroDe(ahora)` responde «¿hace falta?» (adentro contesta la vendedora);
    `dentroDe(ultimoEntranteEn)` responde «¿corresponde?» — el acuse es para quien escribió con la
    puerta cerrada. Con una sola pregunta, a la 1 AM calificaba todo el mundo: 25 de los 40
    borradores del 27-jul eran de gente que había escrito a las 9, a las 10, a las 4 de la tarde, y a
    esa gente «estamos fuera del horario» le es falso. Motivo `escribio_en_horario`.
  - **Hay techo de antigüedad, no solo piso**: `AUTO_RESPUESTA_MAX_ESPERA_H` (12 h). Las 40 del
    27-jul esperaban entre 57 y 72 horas: un «gracias por escribirnos» a los tres días confirma que
    nadie miró. Motivo `espera_excesiva`.
  - **Ninguna plantilla dice que es automática** — decisión del dueño del 27-jul que **revierte ADR
    0015**: el lead todavía no puede saber que hay un automatismo detrás. No es un disfraz: el
    mensaje deja de hablar de sí mismo, no empieza a fingir una conversación, y solo promete lo que
    controlamos (se fue también «una asesora te responde personalmente a las 9»). `plantillas.test.ts`
    ahora **prohíbe** «automático», «bot» y «sistema» — el test que los exigía se dio vuelta con la
    decisión.
  - **Una despedida no es una consulta esperando respuesta** (motivo `conversacion_cerrada`): si ya le
    escribimos y su último mensaje es un cierre («agradezco mucho la atención prestada»), no hay acuse.
    Las tres formas de decir que no viven en `rechazo.ts`: el **explícito** y el **no con motivo**
    («no me es de mucha utilidad») en `huboRechazo` —el segundo cede si el mensaje pide algo—, y el
    **cierre cortés** en `esDespedida`, que mira solo el último. **«gracias» a secas NO es una
    despedida**, y `PIDE_ALGO` no puede llevar una palabra que aparezca dentro de una frase de
    rechazo («necesito» rompería «no es lo que necesito»).
  - **DOS MODOS: apagada · supervisada** (ADR 0018). **Hermes no manda solo: siempre hay una persona
    aprobando.** El tercer modo, `automatica`, **se retiró de la UI y de la API**: `PUT /modo` con
    `automatica` responde **409 `modo_retirado`**, y `PUT /interruptor {encendida:true}` —la puerta
    trasera— ahora deja **supervisada** (apagar, para lo único que esa ruta existe, no cambió). El
    valor sigue siendo **representable** a propósito (`MODOS` lo tiene, `MODOS_ELEGIBLES` no): una
    fila vieja puede tenerlo y `leerModo` debe devolverlo tal cual, o la pantalla diría «apagada»
    mientras el despachador manda. Un server que quedó ahí se ve como **«modo RETIRADO»** en rojo,
    con las dos salidas a un click.
    La garantía del modo supervisado sigue siendo una sola línea: lo preparado queda en estado
    `preparada`, y `EN_COLA_DE_ENVIO` (`autorespuesta/estados.ts`) no lo incluye — el despachador
    **no lo ve**. La máquina de estados y el salto prohibido (`preparada → enviada` no existe) viven
    ahí, con su test.
  - **El MODO REVISIÓN pasa DENTRO del chat** (ADR 0018) — ya no es una hoja encima de la app
    (`BandejaRevision.tsx` está archivada). Es la vista **Mensajes** filtrada: a la izquierda
    `ColaRevision.tsx` (la fila, agrupada por campaña; la cabecera de cada grupo dice **«Revisar 8 ›»**
    y abre la primera —**aprobar en lote se retiró en ADR 0020**: un envío = una acción humana, y el
    grupo que lo demostró se llamaba «Sin campaña» con un «Aprobar 32»—), al centro
    **la conversación real sin tocar**, a la derecha `PorQueEstaSugerencia.tsx` **arriba** de la
    ficha, y el **borrador en el composer**, editable y marcado. El botón dice **Aprobar**, no
    Enviar: acá no se manda, se programa.
    Se entra por el **renglón del chip** (que ES la puerta: «12 esperando tu OK →») o con la tecla
    **`a`**. Teclado: **`⌘↵`** aprobar y seguir · **`⌘D`** descartar y seguir · **`⌘↓`/`⌘↑`** saltar ·
    **`Esc`** salir. Todos acordes porque el foco vive en el composer (una tecla suelta escribiría).
    Ojo con dos cosas: la sugerencia **no** se guarda en el Map de `borradorComposer.ts` (ese es el
    texto de la vendedora), y en revisión **Enter no manda** (en el composer normal sí).
    El estado del modo vive en `useModoRevision.ts`; el «a cuál voy» al resolver es puro y con tests
    (`revision.ts`). Lo aprobado NO sale junto: se reparte con el MISMO `programar.ts`. Lo que nadie
    aprueba **caduca solo** (3 h de gracia desde su turno, nunca cruza el día — `caducidad.ts`).
  - **Apagada por default y con dos llaves**: `AUTO_RESPUESTA=on` (entorno) **y** el interruptor de la
    base (`auto_respuesta_estado.modo`), que es el **kill-switch sin deploy** —
    `PUT /api/autorespuesta/modo` con el Bearer de cualquier vendedora (la ruta vieja
    `/interruptor`, booleana, sigue viva para un `curl` de emergencia; desde ADR 0018 prende en
    supervisada). Se maneja desde el **chip de la cabecera**, al lado del semáforo de WhatsApp:
    **los dos segmentos a la vista** (apagar cuesta UN click desde donde estés), apagada discreta ·
    supervisada delineada. Frenada sale en rojo con el motivo, el modo retirado también, y sin
    la migración aplicada dice «falta la migración» en vez de un estado falso.
  - **La plantilla depende de la CAMPAÑA** (`autorespuesta/campana.ts`): interés asentado > formulario
    que llenó > anuncio del que vino — la MISMA precedencia del chip de curso de la cola (#72), para que
    la fila y el mensaje no digan dos cosas distintas. Lo que cambia por campaña es una frase
    (`FAMILIAS[].gancho`), no una plantilla por curso. **Cuál de los tres eslabones ganó se GUARDA**
    (`campana_fuente`, ADR 0018): es el «por qué» que el panel derecho muestra, y sin él una
    recomendación no se puede supervisar, solo obedecer.
  - **El ritmo es el contrato**: un envío a la vez, 60–240 s entre uno y otro, lo de la madrugada
    sale recién a partir de las 7:30, techos de 20/hora y 60/día por número. Freno TOTAL ante
    `temporary_ban`, error de envío o desconexión; cancelación si la vendedora responde antes; la
    cola se cancela entera al empezar el horario.
  - **Antes de prenderla, siempre**: `cd server && npm run auto:simulacro` — imprime el plan de
    despacho real **sin mandar nada**, y cada renglón empieza por **la hora local en que escribió la
    persona** y **cuánto lleva esperando** (#166): el plan del 27-jul se veía impecable y estaba mal
    de siete formas porque mostraba la hora de SALIDA y nunca la de llegada. Las descartadas se
    listan de a cinco por motivo con lo mismo. `--hora 03:00` mueve el reloj; `--demo` corre sin base
    y **siembra los tres casos del issue** (la que escribió 10:47 en horario, la de hace tres días,
    la que ya se había despedido).
  - Los envíos automáticos quedan marcados en `envios_wa.automatico` y **se ven en la burbuja** del
    hilo — y desde ADR 0016 la burbuja distingue **«Automático»** (salió solo) de **«Aprobado · ana»**
    (lo autorizó una persona). **Lo que sigue prohibido**: generar texto libre, iniciar conversaciones
    y cualquier mecanismo cuyo fin sea que el tráfico no se detecte (ADR 0015 §«Lo que
    deliberadamente no se hizo»).

## El navegador vive ADENTRO de la mesa — webview hijo (ADR 0043, enmienda 0040)

La vendedora sale a la web con la **sesión de trabajo**, separada de su Chrome personal, y desde el
8-ago-2026 **sin salir de Hermes**: `src/features/navegador/` (vista ⌘9) + los comandos
`navegador_*` en `src-tauri/src/navegador.rs`. Pedido del dueño: «que pueda enlazar tu cuenta de
Google, por ejemplo entrar al ChatGPT».

- **Por qué NO un `<iframe>`** — medido el 7-ago-2026 y confirmado el 8: `app.goberna.us` (Cerberus)
  manda `X-Frame-Options: DENY`, igual que Meta Business; Mattermost y Google, `SAMEORIGIN`;
  `web.whatsapp.com`, `frame-ancestors *.whatsapp.com`. Y los **dos destinos que motivaron el
  frente** tampoco: `chatgpt.com` manda `SAMEORIGIN` y `accounts.google.com`, `DENY`.
- 🔴 **MEDIDO ANTES DE CONSTRUIR, y era la precondición del frente**: Google **no bloquea** el
  webview embebido — `accounts.google.com` muestra el formulario real, sin el
  «este navegador puede no ser seguro» (`disallowed_useragent`). Si rebotaba, «enlazar tu cuenta»
  era imposible. ⚠️ **Medido en macOS/WKWebView; Windows/WebView2 sigue SIN verificar**, y las
  vendedoras usan Windows. Tampoco se probó el login completo ni que la sesión sobreviva al reinicio.
- 🔴 **UN WEBVIEW HIJO ES UNA CAPA DEL SO ENCIMA DEL DOM**, y ese era el motivo por el que ADR 0040
  lo descartó. Sigue siendo cierto: tapa lo que caiga en su rectángulo. Ahora se paga con código —
  la vista lo **esconde** cuando hay algo encima (`tapado = cabina || ivi` en `App.tsx`) y al
  desmontarse. La costura vive en UN lugar (`useNavegadorEmbebido.ts`), con test de DOM. **Una capa
  nueva sobre la mesa hay que sumarla a `tapado`**; el síntoma de olvidarse es que aparece detrás.
- 🔴 **LAS CAPABILITIES ACOTAN POR `webviews`, NO POR `windows` — y esto es seguridad, no estilo.**
  El ACL resuelve con un **O** (`ipc/authority.rs:459`): con `"windows": ["main"]`, el webview hijo
  matchea por su VENTANA, o sea que `chatgpt.com` corriendo adentro de la mesa quedaba a **un solo
  candado** (el origen) de la API nativa. Con `"webviews": ["main"]` quedan los dos candados
  independientes: label y origen. `el_navegador_embebido_no_alcanza_ningun_comando` lo fija con el
  caso paranoico (el hijo pidiendo con NUESTRO origen) y **se verificó que se pone rojo** al
  devolverle `"windows"`.
- 🔴 **DOS GUARDAS CON DOS SUJETOS DISTINTOS, y no se colapsan.** `validar()` juzga **lo que la
  vendedora pide**: solo `https`. `navegacion_permitida()` juzga **a dónde el sitio se lleva al
  webview solo**, y es lista NEGRA (`file:`, `javascript:`, `tauri:`, `data:`). Endurecer la segunda
  copiando la primera **rompe el login de Google** —salta por `about:blank`— y media web que
  redirige de `http` a `https`. Hay test de las dos mitades.
- **La ventana aparte de ADR 0040 NO se archiva**: es el peldaño del medio de una escalera de tres
  (embebido → ventana aparte → navegador del sistema). Ver el punto de la cáscara, más abajo.
- **Atrás/adelante van por `history` y están siempre habilitados**: Tauri no expone el historial del
  webview (solo `reload`), así que no se puede saber si hay a dónde volver. Que a veces no hagan
  nada es el costo honesto de no inventar un dato.
- **La barra de direcciones SONDEA** `navegador_donde` 1×/s en vez de escuchar un evento: el front no
  tiene `@tauri-apps/api` a propósito (la UI se sirve por OTA y anda en un navegador común), así que
  el puente expone `invoke` y nada más. Y hay que preguntar: media navegación de un login la hace el
  sitio solo.
- **Sin almacén propio para el hijo**, a propósito: `data_store_identifier` es macOS ≥ 14 y
  `data_directory` abre un segundo entorno de WebView2 en Windows. La promesa —«separada de tu Chrome
  personal»— ya la da correr en otro motor; lo que hace falta es que persista entre reinicios, y el
  almacén por default persiste.
- Ver la UI sin server: `npx vite --port 5199` → `/galeria-navegador.html` (`?sistema=1` el caso
  fuera de Tauri, `?basura=1` el recorte de `interpretar`). ⚠️ **El webview embebido NO se puede
  fotografiar desde un navegador común** —es una capa del SO—: hay que apuntar el `devUrl` de
  `tauri dev` a esa galería con `?ir=<sitio>`. Para eso existe `HERMES_DEV_EVIDENCIA=1`, que planta
  la ventana en 40,40 y la deja arriba; sin eso `screencapture` fotografía la app INSTALADA, porque
  las dos son el proceso `app` (en dev el título dice «Hermes — dev» justamente por esto).
  Capturas en `docs/evidencia/navegador-embebido-*.png` y `navegador-*.png`.
- ⚠️ Los tests de la cáscara **no son gate de PR**: `ci.yml` corre en el runner de VPS1, que no tiene
  Rust. Viven en `tauri-windows.yml`, que es `workflow_dispatch`.
- 🔴 **LA CÁSCARA Y LA UI SE DESPLIEGAN POR CAMINOS DISTINTOS, y eso rompió el frente el día 1.**
  Reportado al desplegar: «Command abrir_navegador not allowed by ACL». **No era la config** —los 9
  tests de Rust pasan, incluido el que invoca por el IPC real con la URL de producción—: la UI viaja
  por **OTA** y llega a las cuatro máquinas en el acto, pero el `.dmg`/`.exe` se compila aparte y se
  **reinstala a mano**, así que ninguna cáscara instalada tenía el comando. §5.3 protege contra
  «me olvidé de declarar el permiso»; esto es el de al lado: **el permiso está, en una versión que
  nadie tiene**. Ahora un rechazo de «no tengo ese comando» **cae al peldaño de abajo**
  (`navegador/cascara.ts`, puro y con tests) y la pantalla lo dice. ⚠️ Un rechazo de
  `validar()` NO cae al fallback —abrir igual sería saltarse la única guarda—, y lo que separa los
  dos casos es que **nuestros mensajes están en castellano y los de Tauri en inglés**; hay un test
  que lo fija. **El frente sigue incompleto hasta que se compile y reparta una cáscara nueva**: hasta
  entonces abre en el Chrome personal, justo lo que el ADR quería evitar.
  🔴 **Con ADR 0043 esto vale DOBLE y la escalera pasa a tener TRES peldaños**: (1) cáscara con el
  embebido → el viewport de adentro; (2) cáscara vieja, con `abrir_navegador` → la ventana aparte de
  0040; (3) fuera de Tauri o más vieja → el navegador del sistema. **El peldaño se decide con el
  PRIMER INTENTO REAL, nunca preguntando si estamos en Tauri** —adentro de una cáscara vieja el
  puente existe y el comando no—; la única excepción es no tener puente, que se sabe en el primer
  render, y ahí la pantalla no puede prometer «se abre acá adentro». **Hasta que se reparta una
  cáscara nueva, las cuatro máquinas ven exactamente ADR 0040.**
## Instagram y Facebook — no se desconectaron, nunca se enchufó el caño (ADR 0042)

Reportado el 7-ago-2026: «teníamos el sistema conectado con IG y Facebook, ¿qué pasó?». Medido capa
por capa en VPS1, la respuesta es que **del lado de Hermes nunca llegó a estar conectado**.

- **El token está VIVO** y es de *system user*, **no expira** (`expires_at: 0`): ve **12 Páginas** y
  **9 cuentas de Instagram**. **La UI existe y está cableada** (`App.tsx` → `ConversacionActiva` →
  `HiloMessenger` + `ResponderPanel` con `QuePuedoHacer`) — no es código muerto. **La cola sabe
  ordenarlos** (nivel 2 `EXPIRA`). **Y en la base había CERO** eventos `meta_comment_fb`,
  `meta_comment_ig` y `meta_message_fb`: `interactions` tenía 12.895 filas y **todas de WhatsApp**.
- **La causa**: la captura era un script manual (`ingest:interactions`) que **nadie corría** —ni cron
  ni timer en VPS1— y **no había webhook**. Las 12 Páginas tenían **`subscribed_apps` vacío**.
  🔴 **La lección**: `docs/estado.md` afirmaba «Cola unificada 4 canales · Messenger read-only» y era
  cierto del CÓDIGO y falso de la REALIDAD. **Antes de afirmar que un canal anda, contá filas en la
  base — no leas componentes.**
- **Ahora hay webhook**: `POST /webhook/meta` (objetos `page` e `instagram`), receptor en
  `server/src/webhook/meta.ts` (cableado) + `metaPayload.ts` (la traducción, **pura**: el handler
  importa `db`, así que sin separarlos un test de los payloads de Meta exigiría `DATABASE_URL`).
  Misma firma HMAC y **el mismo `WHATSAPP_APP_SECRET`**: es el App Secret de la MISMA app de Meta
  (`1958308695630264`), no algo de WhatsApp. Ack primero — Meta desactiva la suscripción si no ve 200.
- 🔴 **LOS DOS CAMINOS CONVIVEN, y de eso depende poder dejar el polling andando.** Escriben con la
  MISMA función (`meta/proyectarInteraccion.ts`) y con el MISMO `external_id` — el `mid` del webhook
  de Messenger es el id de `conversations{messages{id}}`, y el `comment_id` de `feed` es el `id` de
  `posts{comments{id}}`. Si alguien renombra un `source` de un solo lado, el comentario entra DOS
  veces y **no hay error ni log**: la clave `(source, external_id)` es distinta. Los candados:
  `meta/caminos.paridad.test.ts` **lee el archivo del polling** (patrón de `limitesMedia.paridad`) y
  `meta/caminos.test.db.ts` escribe por los dos caminos, en los dos órdenes, contra una base real.
- **Los tres casos que mal leídos guardan una fila razonable y mienten en la pantalla**:
  · **`is_echo` es NUESTRO mensaje** (Meta devuelve lo que la Página manda, incluso desde Business
    Suite) — como entrante, la cola contaría como deuda lo que ya respondimos.
  · **`feed` trae TODO el muro** (posts, reacciones, compartidos): sin recorte cada reacción entra
    como si alguien hablara. `verb: remove`/`hide` no es contenido — guardarlo vacío es el fantasma
    del fix #70.
  · **El webhook de comentarios de IG NO manda hora**: con 0 la fila cae en 1970, o sea **fuera de la
    ventana de 30 días de la cola** — se guarda y no aparece en ninguna pantalla. `momento()` usa la
    del `entry` y distingue segundos de milisegundos, que Meta mezcla entre campos.
- ⚠️ **FALTA LA MITAD QUE NO ES CÓDIGO, y en silencio deja todo igual**: declarar el callback
  `https://hermes-api.goberna.us/webhook/meta` para los objetos `page` e `instagram` en el dashboard
  de la app, y después `cd server && npm run meta:suscribir` (**dry-run por default**, `-- --aplicar`
  suscribe). Sin lo primero, el script dice ✅ y no llega nada. **Verificá contando filas en `events`,
  nunca por un 200.** No hace falta revisión de app: los permisos ya estaban concedidos.

## Adjuntos: el tope es de la LÍNEA, y un video que no entra se achica acá

**El tope de un adjunto NO es de Hermes, es del transporte de esa línea**
(`server/src/whatsapp/limitesMedia.ts`). Cloud API: imagen **5 MB** (solo JPEG/PNG) · video
**16 MB** (H.264+AAC) · audio 16 MB — verificado contra la doc de Meta el 5-ago-2026. Las líneas
whatsmeow **no** tienen esos topes: el único es el de `express.raw({ limit: '64mb' })`, y
aplicarles los de Meta rechazaría envíos que hoy salen bien. Por eso el límite lo declara el
transporte (`TransporteWhatsapp.nombre`), no una tabla suelta.

- Se verifica **antes** de escribir a disco y de subir a Meta → **409 `adjunto_muy_pesado`** con
  las dos cifras («pesa 17,9 MB y por esta línea entran hasta 16 MB»); con una sola no se puede
  decidir qué hacer. `GET /api/whatsapp/sesion` publica `transporte` + `limitesMedia` para que la
  app frene antes de subir — eso es conveniencia, la garantía es el 409.
  ⚠️ El front lee `limitesMedia` como **opcional**: un server viejo no lo manda y ahí no frena,
  que es como se comportaba antes. **Sin N5 el arreglo no existe.**
- `server/src/whatsapp/limitesMedia.paridad.test.ts` lee el archivo del front y falla si las dos
  redacciones divergen (la lección de #37).
- **⌘V pega adjuntos en el composer** (`pegarAdjunto.ts`). El `preventDefault` va **solo cuando
  hay archivo**: uno de más rompe pegar texto y eso no se ve ni en un test de DOM ni en una
  captura. El nombre genérico (`image.png`, que es como TODOS los navegadores llaman a la captura
  del portapapeles) se renombra por fecha; el de un archivo copiado del explorador **se conserva**,
  porque entra en la versión de la pieza (ADR 0022).
- **Un video que no entra se achica en la app** (**ADR 0038**): `planDeCompresion.ts` (puro) decide
  y `comprimirVideo.ts` ejecuta con ffmpeg.wasm. **Bitrate primero, resolución solo cuando el
  bitrate ya no alcanza** — el video del reporte perdía 11 % y se salvó **sin bajar de 1080p**.
  Nunca devuelve un plan por debajo del mínimo de su resolución: un 1080p a 200 kbps *entra* y es
  basura. El resultado **se mira antes de mandarlo** (pegar no envía, comprimir tampoco).
  · 🔴 **El core lo copia el plugin `goberna:ffmpeg-core` de `vite.config.ts`, dentro del build**
    (a `public/ffmpeg/`, gitignored, 32 MB). **NO un hook de npm**: estaba en `"prebuild"` y no
    corrió nunca en producción, porque el pipeline invoca `npx vite build` DIRECTO (`ci.yml`,
    `hermes-deploy.sh`) y npm no dispara el hook. El deploy salió VERDE con la compresión rota, y
    encima invisible: **el fallback SPA de Express devuelve `index.html` con 200** para una ruta
    que no existe, así que un `curl` al core daba 200 (`text/html`, 487 bytes, idéntico a
    `/no-existe.wasm`). Al verificar un estático en prod, mirá **content-type y tamaño**, nunca el
    status. `coreEnElBuild.test.ts` falla si la copia vuelve a depender de npm. Tiene que ser el build **ESM**: el worker de
    `@ffmpeg/ffmpeg` es `type: "module"` siempre, así que termina en `import(coreURL)` y pide un
    `export default` que el UMD no tiene. No se puede importar con `?url` — Vite lo pre-bundlea y
    deja de devolver una URL. Y **sin `toBlobURL`**: es para CDNs cross-origin, y con blob el core
    pierde su `import.meta.url`.
  · El motor entra con `import()` diferido: 32 MB solo para quien adjunta un video pesado.
  · **Medido**: 199 s para 2:13 de video (ffmpeg.wasm single-thread). Se anuncia antes de empezar.
    Bajarlo pide COOP/COEP (multi-hilo) o WebCodecs con feature-detection — ninguna urgente.
- ⚠️ **«Mandarlo como documento» NO es una salida — MEDIDO**, no supuesto
  (`cd server && npm run wa:cloud-api:limites`, 5-ago-2026 contra la línea de producción; sube
  archivos de ceros y **no manda ningún mensaje**; el CONTROL va primero y **frena la conclusión**
  si la credencial no sirve). Con el control en verde: `video/mp4` 17,9 MB **rechazado** ·
  `application/pdf` 17,9 MB **aceptado** · `application/pdf` 70 MB **aceptado** · `image/png` 9 MB
  rechazado. O sea: **el tope se aplica en la SUBIDA y sale del MIME declarado** — el mismo peso que
  rebota como video entra como documento, así que la opción existiría solo mintiendo el mime, y al
  lead le llegaría un adjunto que WhatsApp no sabe reproducir.
  · **Los 100 MB de documento son reales**: ahí el que corta en 64 somos NOSOTROS con `express.raw`.
    Si hace falta mandar un PDF más gordo, se sube ese `limit` y `LIMITES_CLOUD_API.documento`.

## Las reacciones — 👍 al flyer, y por qué estuvieron invisibles

Un 👍 es la señal de compra más barata que existe y la vendedora no la veía. **No era un bug de
dibujo: la ingesta las descartaba enteras.** `whatsapp/contenido.ts` las tiene en
`CLAVES_SIN_CONTENIDO` desde el fix #70, cuando entraban a `interactions` como cualquier entrante y
la UI las pintaba como una burbuja vacía que decía «(no es texto)» — un contacto que solo había
reaccionado aparecía con un mensaje fantasma. Server en `server/src/reacciones/`, tabla
`reacciones_wa` (migración **0019**), UI en la burbuja de `HiloWhatsapp.tsx`.

- 🔴 **`tieneContenido` sigue diciendo que NO es contenido, y tiene que seguir diciéndolo.** La
  reacción se rescata **arriba** de ese descarte (`esSoloReaccion`), no relajándolo: si alguien
  saca `reactionMessage` de la lista, vuelve el fantasma. `reacciones/cicloCompleto.test.ts` cruza
  los dos módulos y falla si el acuerdo se rompe.
- **Una reacción no es un mensaje**: no ocupa un renglón, **cuelga** del mensaje al que reacciona.
  Por eso tabla propia y no una fila en `interactions`, y por eso `onReaccion` es un canal aparte
  de `onMensaje` en la interfaz del transporte (opcional: el falso no la emite).
- **La PK es `(mensaje, persona)` — es un ESTADO, no un historial.** Reaccionar de nuevo
  **reemplaza**; el emoji **vacío QUITA** (borra la fila), que es como WhatsApp desreacciona y
  llega por el mismo camino. Con historial, un mensaje mostraría 👍❤️😮 de la misma persona.
- **`mensaje_external_id` es texto y no una FK**, a propósito: una reacción puede llegar **antes**
  que el mensaje (reordenamiento del webhook) y una FK la rechazaría; y el hilo solo trae 200
  mensajes, pero la reacción a uno más viejo sigue siendo cierta. El JOIN va por el mismo `wa:<id>`
  de la proyección — un test lee `proyectar.ts` para que ese prefijo no cambie en silencio.
- **Los dos canales, una sola forma**: `reaccionDeCloudApi` (`type:'reaction'`) y
  `reaccionDeWhatsmeow` (`reactionMessage`) producen el mismo objeto, con test de paridad. En
  whatsmeow gana el **sello propio** de la reacción sobre el del sobre: con el server caído un rato,
  el de llegada agruparía todas en el mismo instante.
- **Degrada, no tumba**: sin la migración, `guardar` avisa por log y `porMensaje` devuelve vacío —
  un hilo sin un 👍 sigue siendo el hilo. Es lo contrario del catálogo de piezas (ADR 0023) y por el
  mismo criterio: acá el consumidor es una persona mirando, no un índice que cachea.
- En la UI: píldora colgada del borde inferior, agrupada por emoji con su cuenta («🙌 2»), y la
  **nuestra delineada en navy** — el color que ya significa «tuyo» en la cola. **Sin oro.** La
  burbuja con reacción lleva `pb-2`: con el `space-y-2` normal la píldora queda a mitad de camino y
  se lee como del mensaje de abajo.
- **Y se puede reaccionar NOSOTROS** (`reacciones/enviar.ts`, `POST /api/whatsapp/reaccionar`):
  hover sobre la burbuja del lead → los seis emojis de WhatsApp en su orden. Tocar el que ya está
  puesto lo QUITA (así funciona WhatsApp, y sin eso no habría cómo sacarla). Solo en los
  **entrantes** —reaccionar a lo propio no le dice nada al lead— y solo con la sesión viva.
  · 🔴 **NO pasa por `EnvioControlado`, y no es un descuido**: `envios_wa` es el registro de
    MENSAJES con su pieza y su versión (ADR 0022), y una reacción no tiene ninguna de las dos —
    llenaría de filas vacías la tabla que mide qué contenido funciona. Peor: **contaría contra el
    ritmo** (20/hora, 60/día), o sea que reaccionar le robaría cupo a los envíos de verdad. Lo que
    sí conserva es la guarda de línea equivocada y el freno por sesión caída o `temporary_ban`.
  · El botón está **siempre en el DOM**, invisible hasta el hover: montarlo al pasar por encima
    haría que el primer clic caiga en la nada.
  · La mutación es **optimista** — reaccionar es el gesto más liviano del chat y medio segundo de
    espera lo hace sentir roto. Si el server rechaza, se deshace.
- Ver sin server: `npx vite --port 5199` → `/galeria-composer.html`. Capturas en
  `docs/evidencia/reacciones-en-el-hilo.png` y `reaccionar-*.png`.

## Abrir un chat lo marca leído — y NO lo mueve de lugar

Reportado el 7-ago-2026: «veo el chat, salgo, y sigue arriba del todo, no pasa abajo como leído».
Al investigarlo eran **dos cosas y solo una era un bug**.

- **El bug**: `POST /api/whatsapp/leido/:telefono` mandaba los ticks azules al lead y **no tocaba
  `estado_conversacion.leido_hasta`** — el cursor de lectura de la vendedora. El mecanismo estaba
  entero (columna, `noLeidoSql`, ruta `PATCH /api/conversaciones`) y solo se disparaba desde el
  menú `···` de la fila, así que **abrir el chat no apagaba el punto azul**. Ahora la misma ruta
  hace las dos cosas — aparte, porque son dos destinatarios distintos (el lead y la cola de ella) y
  que uno falle no puede llevarse al otro.
- **Y BAJA.** El orden es `fijada → fijada_at → **no_leido DESC** → nivel → antigüedad`
  (`bandaPinOrdenSql`): lo leído queda debajo de todo lo que no se leyó. Decisión del dueño del
  7-ago. El argumento contrario —«leer no es atender», el lead que espera sigue esperando— sigue
  siendo cierto, y perdió por el costo diario: abrir un chat para ver qué decía lo dejaba clavado
  arriba y había que saltearlo a mano una y otra vez.
  ⚠️ **Lo que cuesta**: un chat leído y urgente queda debajo de uno sin leer que no lo es.
- 🔴 **La red que hace aceptable eso ya existía: el chip «Sin responder»**, que filtra por
  `NOT respondida` —sin mirar el cursor de lectura— y lleva su número. Todo lo leído y no
  contestado sigue ahí, a un clic. **Sin ese chip la decisión escondería deuda**; con él, solo la
  ordena distinto. `cola/abrirMarcaLeido.test.db.ts` lo verifica explícitamente: es la condición
  que hace aceptable a la otra mitad.
- **Leer cambia el ORDEN, no la URGENCIA.** El nivel de `urgencia.ts` no se toca: si mañana se
  saca este orden, la escala sigue diciendo la verdad sobre quién está esperando. Meter «leído»
  adentro de la regla la habría contaminado — es la misma que comparte con el radar del Dashboard,
  con su test de paridad.
- 🔴 **EL CURSOR VA PRIMERO Y LOS TILDES DESPUÉS** (7-ago-2026). Al revés tardaba **3 segundos**:
  el endpoint hacía `await transporte.marcarLeido()` —una llamada de RED al subprocess de
  whatsmeow— **antes** de tocar el cursor, así que apagar el punto de la cola de la vendedora
  esperaba a que WhatsApp le acusara los tildes al LEAD. Reportado como «tengo que quedarme unos
  3 segundos en el chat para que lo tome como leído»; no era eso, era que el marcado tardaba
  3 segundos y quien volvía antes no lo veía. Ahora: cursor → `res.json()` → tildes
  fire-and-forget. **Dos destinatarios distintos, ninguno bloquea al otro.**
- **Y el front es OPTIMISTA**: el punto se apaga en el caché al instante (`onMutate` con
  `setQueriesData` sobre TODAS las variantes de la cola — la queryKey lleva los filtros, y con una
  sola, cambiar de filtro lo mostraría encendido otra vez). Si el server falla, **se vuelve a
  encender**: un punto apagado sobre algo que nadie marcó es una conversación que se pierde de
  vista sin haberse leído. ⚠️ **No se reordena en el navegador**: el orden es del server
  (`bandaPinOrdenSql`) y reimplementarlo acá sería la misma regla en dos lados (#37) — la fila baja
  con el refetch, que ahora tarda milisegundos.
- ⚠️ **Sin `numeroPropio` el cursor no se toca.** `estado_conversacion` se indexa por la clave
  completa `conv:whatsapp:<tel>:<linea>`: sin la línea no se puede saber cuál marcar, y apagar la
  marca de otra conversación es peor que no apagar ninguna.
- **El cursor es POR VENDEDORA**: la cola es compartida pero que una abra no le apaga el punto a la
  otra. Con test.

## Los ✓✓ — «¿le llegó?» vs «¿no me contestó?»

Sin esto la vendedora **no distingue «no me contestó» de «no le llegó»**, y son dos conversaciones
distintas: a una se la persigue, a la otra se la reintenta por otro lado. WhatsApp mandaba el dato
por los dos canales y lo tirábamos — el webhook solo miraba `messages` y `calls`.
Server en `server/src/entrega/`, columnas `envios_wa.estado_entrega{,_en}` (migración **0021**,
expand-only), UI en la línea de la hora de cada saliente.

- **La escala es MONÓTONA**: `enviado → entregado → leido`, más `fallido` aparte (que gana siempre y
  no se resucita). Los recibos llegan **desordenados** —un `delivered` de un segundo dispositivo
  puede aparecer después del `read`— así que pisar con «el último que llegó» mostraría como no
  leído algo que el lead ya vio.
- 🔴 **El avance se hace EN LA BASE, no leyendo y escribiendo.** `SELECT` + decidir + `UPDATE` desde
  Node tiene una carrera obvia con dos recibos simultáneos. El `UPDATE` lleva su propio `WHERE` con
  el orden de la escala, así que la base arbitra. La regla vive igual en `entrega/dominio.ts` (pura,
  con tests) y **`entrega/paridad.test.ts` cruza las dos** para TODO par de estados — el patrón de
  `cola/urgencia.ts` + `urgenciaSql.ts` (ADR 0009).
- 🔴 **En whatsmeow, `ReceiptTypeDelivered` es la CADENA VACÍA** (verificado contra
  `go.mau.fi/whatsmeow/types`). Tratar `''` como «desconocido» —el reflejo— perdería **todos los
  entregados**, o sea el ✓✓ gris, que es el estado más frecuente.
- ⚠️ **`read-self` y `played-self` NO son del destinatario**: son otro dispositivo tuyo marcando lo
  que vos mandaste. Contarlos pintaría el ✓✓ azul porque la vendedora abrió su propio WhatsApp.
- **Un recibo abarca VARIOS mensajes** (`ids[]`): WhatsApp agrupa, sobre todo el «leído» cuando
  alguien abre un chat con diez pendientes. El UPDATE los mueve de una.
- **Los dos canales por caminos distintos**: whatsmeow por `onRecibo` (evento `message:receipt`),
  Cloud API por `statuses[]` en el webhook. Misma escala, mismo repositorio.
- **Ausente ≠ `enviado`**: los mensajes anteriores a este frente no tienen estado y **no se dibuja
  nada** — sus recibos pasaron cuando no los escuchábamos, y no hay backfill posible. Un ✓ inventado
  es peor que un hueco.
- En la UI: ✓ / ✓✓ / ✓✓ **azul**, el vocabulario que la vendedora ya trae de su teléfono — cualquier
  variación «mejorada» habría que explicarla. `fallido` rompe el molde (triángulo rojo) porque es lo
  único que pide una acción. Captura en `docs/evidencia/entrega-tildes.png`.

## Auth

Login de vendedoras **contra Cerberus** (Django, sin API REST): `cerberus/auth.ts` hace el handshake
CSRF + POST a `/ingresar/`. Éxito → Hermes emite un **token HMAC Bearer** (`auth/sesion.ts`). El
`vendedoraId` = username de Cerberus. Middleware `requiereVendedora` delante de todo lo que envía o
atribuye a una vendedora.

**La sesión de Cerberus se PERSISTE** (#106, ADR 0027): la cookie con la que Hermes actúa como la
vendedora vive en `sesiones_cerberus` (TTL 14 días, decidido al leer) con el `Map` como caché del
proceso — un deploy ya no desloguea a las tres a la vez. El store (`cerberus/sesionStore.ts`) es un
seam inyectable (`crearSesionStore(base)`) y **degrada, nunca tumba**: sin la tabla migrada se
comporta como el `Map` de antes y lo dice por el log. Un solo store compartido a propósito: dos
cachés servirían una cookie vieja tras un re-login.

En el cliente, la sesión **se cree el token antes de preguntar** (ADR 0007): si hay uno guardado que
no venció, la app se pinta ya y `/api/auth/yo` valida por detrás — si no, el caché persistido queda
tapado por un skeleton durante todo el viaje a VPS1. La firma la verifica el server en cada request
igual, y un 401 real echa y borra el caché.

## Ivi — el puente al cerebro RAG (proxy)

La app de la vendedora le pregunta a **Ivi** (el cerebro RAG en **geografo**) a través de Hermes,
nunca directo: **`POST /api/ivi/preguntar`** (`server/src/routes/ivi.ts`), **detrás de
`requiereVendedora`**. El server reenvía la pregunta a `IVI_URL/api/preguntar` con
`Authorization: Bearer IVI_SERVICE_TOKEN` (token de servicio que la vendedora **jamás** ve;
referenciado por nombre, regla dura #1). El cliente vive en `server/src/ivi/cliente.ts`
(`preguntarleAIvi`); el contrato de vuelta es `RespuestaIvi` (`texto`, `tipo`, `fuentes`,
`groundingOk`, `numerosNoVerificados`, `edadDelDato`), validado con Zod.

- **Body**: `{ pregunta: string, historial?: {rol,texto}[] }`, con tope de tamaño (4000
  caracteres la pregunta y cada turno, 30 turnos de historial — sin eso, amplificaba sin límite
  lo que Hermes le reenvía a Ivi). El `usuario` sale del token (la vendedora), no del body — no
  se puede suplantar.
- **La costura habla el dialecto de Ivi** (ADR 0021): hacia afuera `snake_case` y el historial como
  `[{q,a}]` —`{rol,texto}` se lee como cadena vacía y el follow-up se pierde **en silencio**—;
  hacia adentro, camelCase. Las dos traducciones (`aCamelCase`, `aParesQA`) viven en `cliente.ts` y
  en ningún otro lado. **Nada de `.strict()`**: Ivi solo agrega campos, y cerrarlo convertiría cada
  campo nuevo en un 502. Lo único que rompe es renombrar, y de eso se defiende el fixture literal
  `CUERPO_REAL_DE_IVI` (copia de `contrato_hermes()` de ivi-cerebro).
- **Un `200` con `tipo: SIN_EVIDENCIA` NO es un error** (ADR 0021): Ivi funcionó y no sabe, y eso es
  una respuesta que la app muestra. La contracara de «un 404 no es "no hay respuesta clara"». **Y no
  se reintenta**: Ivi ya decidió. El vocabulario de
  `tipo` (`TIPO_IVI`: `HECHO` · `CONTEXTO` · `SIN_EVIDENCIA`) está publicado para que la UI
  ramifique, pero el schema **no lo cierra**: un tipo nuevo cae en la rama conservadora, nunca en
  `HECHO` ni en un throw.
- **`reintentable` mira el `codigo` Y el estado HTTP** (`esReintentable`), y el 502 lo dice para que
  la app no reimplemente la tabla. `timeout` y `red` siempre; config y contrato roto nunca (dan el
  mismo error un minuto después). El caso que obliga a mirar el estado es **`http_inesperado`, que
  es un cajón de sastre**: adentro caen el `404` de «todavía no lo desplegaron» (permanente) **y**
  el `500` propio de Ivi —su `except Exception`: pgvector caído, Bedrock sin credenciales— y los
  `502/504` de nginx/tailnet, que son transitorios. Marcarlos a todos `false` afirmaba «permanente»
  sobre algo que a los 10 s ya andaba. **El código decide primero**: un `503` es
  `ivi_sin_token_configurado`, config y no caída, y ser 5xx no lo vuelve transitorio.
  **El front LO LEE, y le gana a su propia tabla** (#175): `ErrorApi` lleva `reintentable` y
  `lecturaDeError()` lo prefiere cuando viene. La tabla de `errores.ts` queda como **respaldo**
  para un 502 de un server viejo que todavía no manda el campo — las dos tienen que existir, y
  por eso lo que se fija con test es la **relación** entre ellas, no una sola implementación:
  `server/src/ivi/paridad-front.test.ts` falla si divergen para el mismo `(codigo, estado)`.
  Solo un booleano cuenta como opinión del server: `null` o una cadena quedan en `undefined` y
  decide la tabla — «no se pronunció» tiene que ser distinguible de «no».
- **Los campos informativos degradan, no tumban**: `numerosNoVerificados` acepta ausente, `null` y
  hasta una forma inesperada (se ignora y se loguea) — un campo accesorio no puede convertir una
  respuesta buena en un 502. Los tres que cargan el peso (`texto`, `tipo`, `groundingOk`) **sí**
  son estrictos: ahí el fail-closed no se negocia.
- **`traza_id`**: cada pregunta lleva uno (`hermes-<uuid>`, generado acá) y vuelve a la app en el
  éxito **y en el 502**. ⚠️ **Hoy no cierra ningún lazo**: verificado contra `ivi-cerebro@1e5d2f3`,
  `responder()` no acepta `traza_id` ni `superficie` y `rag/traza.py` no existe — el uuid nace,
  viaja y **se descarta en los dos extremos**, sin error que lo delate. En el árbol de trabajo *sin
  commitear* de ese repo las dos cosas ya están. Se manda igual porque no se puede reconstruir
  después. **Al afirmar algo sobre otro repo, decí contra qué snapshot lo verificaste**: acá se
  mezclaron dos fotos una vez y el ADR terminó prometiendo un lazo que no existía.
- **FAIL-CLOSED y RUIDOSO**: cualquier fallo es un **502 con `codigo`**, los ocho de
  `CODIGO_ERROR_IVI` (`cliente.ts`): `falta_config` sin `IVI_URL`/`IVI_SERVICE_TOKEN`,
  `config_hermes` en 401, `ivi_no_configurado` en 503, `timeout` (30s, incluye timeout leyendo el
  body de la respuesta, no solo conectando), `red`, `respuesta_invalida`, `http_inesperado` (otro
  estado no esperado) y `desconocido` (un error que no es `ErrorIvi` — bug, no una clase conocida
  de problema). **Nunca** se muestra un fallo como «Ivi no encontró datos». Cada `ErrorIvi` deja
  rastro en los logs del server, con la causa original si la hay.
- **`200` + `SIN_EVIDENCIA` NO es un error**: Ivi funcionó y no sabe. Sale por el camino normal,
  no se reintenta (no es transitorio: Ivi ya decidió) y llega a la app como respuesta. Fijado con
  test en el cliente y en la ruta.
- **Env**: `IVI_URL` + `IVI_SERVICE_TOKEN` (solo nombres en `.env.example`). Del lado geografo,
  `POST /api/preguntar` puede **no estar vivo aún**: hasta entonces la ruta responde 502 honesto.
  Al 27-jul da **404**, así que lo que una vendedora ve hoy es el `http_inesperado`.

### La superficie en la app (#169, **ADR 0024**)

`src/features/ivi/`. Se abre con la tecla **`i`** o el botón de la barra, desde cualquier vista:
es una **hoja a la derecha, encima de la mesa** — el molde de `LibretaPersonal`, no una pestaña
del panel. El porqué está en el ADR: el panel derecho es de **esa persona**, Ivi es del
**negocio**, y a 360 px un hilo de preguntas compite por alto con «Registrar venta».

- ⚠️ **`App.tsx` la monta SIEMPRE**, abierta o cerrada, y por eso le pasa `abierta` a
  `useEscape`. Sin esa guarda, el listener en captura que la hoja usa para cerrarse sin
  arrastrar la conversación de atrás se come el Escape de **toda la app** mientras Ivi está
  cerrado: dejan de andar cerrar la conversación en Mensajes, cerrar la Cabina y cerrar la
  libreta. Si montás un modal que vive montado, pasale la condición.
- **El botón de mandar y `⌘↵` consultan la MISMA función** (`motivoParaNoPreguntar` en
  `ivi.ts`, pura). Separadas divergían: el acorde se saltaba el tope de 4000 y la pantalla
  reportaba «se rompió algo que nadie previó» en vez de «te pasaste 500 caracteres».

- **Los tres tipos cambian de FORMA, no de color** (un color se aprende, una forma se reconoce
  sin leer): `HECHO` filete sólido + blanco · `CONTEXTO` filete punteado + hundido (la bandeja de
  ADR 0017) · `SIN_EVIDENCIA` sin relleno y punteado entero. **Sin oro** — el oro es tiempo que se
  acaba. Un **`tipo` desconocido cae en `CONTEXTO`**, lo conservador, y lo dice: nunca `HECHO`,
  nunca un throw.
- **La regla vive fuera del JSX**, pura y con test: `presentacion.ts`. Un `switch` adentro de un
  componente no se puede interrogar sobre el tipo que todavía no existe — y ese es el caso que
  importa, porque el enum de Ivi crece sin coordinar releases con Hermes.
- **`grounding_ok: false`** marca **las cifras** de `numerosNoVerificados` dentro del texto y no
  descarta la respuesta. **`edad_del_dato: null` es NO MEDIDO, no «fresco»**: se dice siempre
  (ámbar en un `HECHO`, donde la edad decide si el número sirve). El silencio ahí es lo que dejó
  pasar un dato de 12 días como si fuera de hoy.
- **Los ocho códigos tienen lectura propia** (`errores.ts`): qué pasó, de quién es y si
  reintentar sirve — «Reintentar» solo aparece en lo transitorio. Un test recorre los ocho y
  falla si alguna lectura se puede confundir con «Ivi no encontró datos».
- ⚠️ **No hay puente al composer, a propósito.** Lo que sale hacia un lead viene del catálogo
  (ADR 0015); esto es prosa de un LLM. Se copia, pero el botón «poner en la caja» no existe.
- **Ver los estados sin server ni red**: `npx vite --port 5199` →
  `http://localhost:5199/galeria-ivi.html` (entry aparte, **fuera** del bundle de la app).
  Capturas en `docs/evidencia/169-ivi-*.png`.
- **Pendiente**: `traza_id` (la llave del lazo de aprendizaje de Ivi) todavía no viaja, y el
  ensamblado (`POST /api/ensamblar`) es otra superficie y otro contrato.

## El catálogo de piezas — lo que Ivi lee para poder ELEGIR sin inventar (ADR 0023)

**Ivi ARMA, no inventa**: devuelve **ids, nunca texto**, y Hermes compone con su texto ACTUAL. De ahí
sale la propiedad que hace segura la integración — *un índice viejo del lado de Ivi degrada la
**calidad** de la selección, nunca la **corrección** de lo que se manda*. Para elegir, necesita ver el
catálogo: `server/src/catalogo/` + `routes/catalogo.ts`, **solo lectura**.

- **`GET /api/catalogo/piezas`** — todo lo que se puede decir, en una lista plana. Cada pieza se
  direcciona con **`{clase, id}`** (`plantilla` · `hecho` · `acuse` · `gancho`) y trae `version`,
  `estado` (`vigente` | `borrador` | `retirada`), `texto`, `momentos`, `familia`, `alcance` +
  `propietario`, `placeholders` y `enviable`. `?clase=` y `?vendedora=` filtran.
  **`clase` es semántica, no la tabla**: hoy son cuatro catálogos separados (`plantillas` +
  `plantilla_pasos`, `hechos`, los acuses y los ganchos, estos dos **en código**), y unificarlos —que
  es otro frente— no puede romperle el contrato a Ivi. Un **paso** no tiene id propio:
  `plantilla_pasos.id` se reescribe en cada edición, así que viaja dentro de su plantilla con su
  `orden` **y con su propia `version`** — que es lo que el lazo estampa como `plantilla:12#3`.
- **Si el catálogo no se puede servir: ERROR, jamás una lista vacía.** Es una cicatriz de Ivi (su ADR
  0002: un `{"ok": true}` con ceros les costó semanas). Base caída → **503 `catalogo_indisponible`**
  y el cuerpo **sin `piezas`**; cero piezas → **500 `catalogo_vacio`** (las de código existen
  siempre); un filtro que no deja nada → 200 con `filtrado: true`. Por eso `catalogo/repositorio.ts`
  **no degrada** como `hechos/repositorio.ts`: la degradación honesta para una persona que lee el
  aviso es una mentira para un índice que cachea. Ni siquiera se sirve medio catálogo.
- **EL DIRECCIONAMIENTO Y LA RECETA DE VERSIÓN VIVEN EN `server/src/piezas/`**, el **mismo módulo
  que importa el lazo de resultados** (ADR 0022) para estampar la pieza en `envios_wa`. No son dos
  implementaciones que coinciden: es una. Ivi devuelve `{id, version}` en cada pieza del ensamblado
  **para que el join cierre**, y con dos recetas ese join da **cero filas en silencio** — que se lee
  como «esa pieza no se usó nunca». `piezas/direccion.ts` define `{clase, id, orden?}` y su forma
  textual; `piezas/version.ts` es la única receta (`sha256:` + 16 hex).
  **Entra el texto que sale Y EL ARCHIVO** —cambiar `flyer-julio.jpg` por
  `flyer-agosto-PRECIO-NUEVO.jpg` es versión nueva, porque el precio vive adentro de la imagen—;
  **NO entra el rótulo**, porque renombrar no es un texto nuevo. Hash y no contador: funciona igual
  para los catálogos que viven en código, no se puede olvidar de subir y no pide `db:push`.
  **Los candados**: `piezas/vectores.ts` fija versiones y refs **literales** que los dos frentes
  afirman desde su lado (`catalogo/paridad.test.ts` acá), y `piezas/receta-unica.test.ts` falla si
  aparece un `createHash` nuevo sin justificar.
- **Nadie arma una `Pieza` fuera de `catalogo/armar.ts`.** El repositorio traduce filas a argumentos
  y `codigo.ts` traduce constantes; los dos llaman a la misma función pura. Si cada origen se armara
  la suya, cada origen calcularía su versión — y volveríamos a tener dos recetas, adentro del mismo
  módulo.
- **Va detrás de una credencial de servicio PROPIA** (`HERMES_CATALOGO_SERVICE_TOKEN`,
  `requiereServicioDeCatalogo` en `auth/servicio.ts`): Ivi es una máquina, no una vendedora, y darle
  el token de `/api/admin` para leer una lista le daría de yapa re-apuntar números y borrar sesiones.
  Sin el secreto configurado responde **503 `falta_config`** (distinto del 401 de credencial
  equivocada — si no, una falla de config se disfraza de token mal mandado).
- **`GET /api/catalogo/vocabulario`** (y el mismo objeto dentro de `/piezas`) publica los
  **momentos de venta como dato**: Ivi es Python y no puede importar `sugerencias/estado.ts`. Se
  **deriva** de `MOMENTOS_DE_VENTA` en cada request — nada de un JSON que alguien tiene que acordarse
  de actualizar. Tres guardas: la derivación, el `Record` `DESCRIPCION_MOMENTO` (agregar un momento
  sin describirlo **no compila**) y un test que compara contra **la copia a mano del front**
  (`src/features/hechos/hechos.ts`), que era la desincronización que ya existía.
- **Un momento desconocido viaja tal cual, nunca se filtra**: en `hechos`, `momentos: []` significa
  «vale para todos», así que descartar un valor nuevo **ensancharía** la pieza en vez de acotarla.

## «Se le puede hablar» — la ventana de conversación (ADR 0041)

La cola ordena la DEUDA (quién espera). Esta es la otra pregunta: **¿a quién todavía se le puede
escribir?** Meta cierra la puerta sola y de los dos plazos Hermes modelaba **uno solo**.

- **24 h desde el último ENTRANTE** en un chat (WhatsApp/Messenger) · **7 días** desde un comentario
  de FB/IG. Lo segundo ya existía (`ventanaDiasSql`, que alimenta el nivel 2 `EXPIRA`); lo primero
  **no se calculaba en ningún lado** — `ventanaDiasSql` devuelve `NULL` para todo lo que no sea
  `facebook`/`instagram`, o sea que en WhatsApp, que es donde Goberna vende, no había ventana.
- **Y había un filtro que decía hacerlo**: la intención `puedo-escribirle` era
  `(ventana_abierta OR tipo = 'mensaje')`, **siempre verdadera para un chat** — devolvía la cola
  entera. Era compat de la cola vieja; se retiró su chip en #49 y nadie notó que además mentía.
- 🔴 **NO es una etapa del embudo, y como etapa habría sido destructivo**: una conversación tiene UNA
  etapa, así que marcar «abierto» **borraría `cotizado`** y el embudo perdería la cuenta de la venta —
  y cuando la ventana se cierra sola tres horas después, no hay a dónde volver. Es una **señal
  derivada** (ADR 0016, como «Cotizado» y «Se enfrió»): no se guarda, se deriva en cada consulta, y
  sale como chip con su número + marca en la fila. El embudo no se toca.
- 🔴 **DESDE EL ÚLTIMO ENTRANTE, nunca desde lo último que pasó.** La ventana la abre quien escribe y
  nuestra respuesta no la extiende. Con `referencia` (que salta al máximo global al contestar),
  responder a las 23 h se leería como «te quedan 24 h más».
- 🔴 **LA SEÑAL SE DICE EN POSITIVO Y NO PUEDE DEJAR DE ESTARLO.** El plazo es duro **solo en la línea
  de la Cloud API** (`51984429504`): ahí Meta rechaza el texto libre y solo entra plantilla aprobada.
  En las **tres líneas whatsmeow** de las vendedoras Meta **no rechaza nada** (el riesgo ahí es el
  ban). Un «ya no le podés escribir» sería falso en tres de cuatro líneas, y esa mentira cuesta una
  venta que nadie intenta. **Una ventana cerrada no dibuja NADA.** Misma forma que `limitesMedia`:
  el plazo lo impone el transporte, así que Hermes solo afirma lo que vale para todas.
- La regla vive **una vez**, pura, en `cola/ventana.ts`, con su gemelo SQL `ventanaCierraSql`
  (`urgenciaSql.ts`) y `ventana.paridad.test.db.ts` de candado — que verifica **el instante** del
  cierre, no solo el sí/no: un booleano igual puede salir de dos plazos distintos.
  **`ventanaDiasSql` NO se toca**: es el contrato de `EXPIRA`, vale solo para comentarios y tiene su
  propio test de paridad. Se comparte la **constante**, no la expresión.
- **El oro vuelve a significar tiempo que se acaba**: antes toda ventana abierta salía dorada —
  incluida una de 6 días—, así que el oro terminaba queriendo decir «comentario». Ahora solo abajo de
  `UMBRAL_ORO_MS` (3 h). El front lee `ventana_cierra` como **opcional** y conserva la marca vieja de
  respaldo: N4 va solo y N5 es un botón, así que hay una franja con el front nuevo y el server viejo.
- **La barra de filtros pasa a DOS PISTAS** (rescatado del PR #304, que se cerró): arriba se elige
  **qué cola** (la línea), abajo se recorta **dentro**. Con las cuatro líneas vivas en una sola
  pista el segmentado se comía los 336 px y **«Sin responder» quedaba detrás de un scroll
  invisible** — y desde que lo leído baja, ese chip **es la red** que devuelve la deuda entera. Un
  chip más lo empeoraba. Cada pista lleva **su propio** estado de sombra y su navegación por teclado
  (con un `ref` compartido, el degradado de una mentiría sobre la otra), y **lo encendido se trae a
  la vista tocando solo `scrollLeft`**: con `scrollIntoView({block:'nearest'})` los chips activos
  arrastraban **la página entera** y la cola aparecía empezada por la mitad.
- **Y EN EL PIPELINE** (pedido del dueño: «los que están en la ventana de poder hablarles **sin
  costo**»): un tercer chip de recorte en Contactados —`Todas · Con precio N · **En ventana N**`, un
  solo eje con tres posiciones— y **la píldora en la tarjeta, en TODAS las columnas**. Las dos cosas
  hacen falta: el chip solo existe en Contactados, y el caso más valioso del tablero es un
  **Cotizado con la ventana abierta** (sabe el precio Y se le puede escribir gratis), que vive en una
  columna sin recorte. El número sale de una dimensión nueva del desglose (`FilaDesglose.ventana`) y
  `ventana.paridad.test.db.ts` fija que sea **exactamente** lo que devuelve `?ventana=1`.
  ⚠️ `precio` y `ventana` **no se derivan una de la otra**: de las 611 con precio, 12 están en
  ventana. Capturas en `docs/evidencia/ventana-en-el-pipeline.png`.
- Ver sin server: `npx vite --port 5199` → `/galeria-ventana.html` y `/galeria-embudo.html`. Capturas
  en `docs/evidencia/ventana-de-conversacion.png` y `ventana-en-el-pipeline.png`.

## El embudo se DERIVA, no se declara (8-ago-2026)

Medido en producción: `gestiones` tiene **39 filas en toda la base**, y de ahí salían los «22
Cotizados» del Pipeline — 22 gestiones, de 2 personas, todas del mismo día. **El embudo no medía el
negocio: medía cuánto se acordó alguien de tocar un botón.** Y la contradicción estaba dibujada en la
propia pantalla: al lado de «22 Cotizados», el chip decía **«Con precio 2.906»**.

- 🔴 **`etapaEfectivaSql` deriva ahora TRES peldaños**: `sin_respuesta` (le escribimos y nunca
  contestó) debajo de todo, y `precio_enviado → cotizado` por encima de `respondida → contactado`.
  Sobre los mismos datos el embudo pasa de `3.450 · 22 · 0 · 0` a **Sin respuesta 2.580 ·
  Interesados 378 · Contactados 217 · Cotizados 798**.
- 🔴 **`sin_respuesta` existe porque `precio_enviado` promovía a gente que nunca dijo una palabra.**
  Sin ningún entrante, `respondida` da **true** (el último saliente le gana a un `-infinity`), así
  que una difusión caía en `contactado` — y si llevaba precio, en `cotizado`. Medido el 8-ago-2026:
  **2.252 de los 3.050 Cotizados (74 %) nunca habían escrito**; el 5-ago salieron 1.139 mensajes
  contra 49 entrantes y ese blast los promovió a todos. La derivación ahora pide `hablo` (hay algún
  entrante), y quien no lo tiene cae en su propia columna, que es **la más grande del tablero: 2.580
  de 3.973 conversaciones (65 %)**.
  · **Se deriva y NO se declara**: no está en `ETAPAS` (ni server ni front), no se puede arrastrar
    ahí (`compuertas.ts`) y **deja de ser cierta sola** en cuanto la persona escribe. Está en el
    fondo de `ESCALA_ETAPAS`, así que cualquier gestión asentada le gana.
  · ⚠️ **Contrato**: quien consuma `etapaEfectivaSql` ahora tiene que emitir **`hablo`** y
    **`ya_le_hablamos`** además de `respondida`/`precio_enviado`. El Dashboard las emite calculadas
    aunque su `HAVING` exija un primer entrante (o sea que ahí `hablo` es siempre true): el día que
    ese HAVING cambie, el embudo no empieza a mentir en silencio.
- **Sigue siendo un PISO**: solo empuja hacia arriba. Lo declarado más avanzado gana, `perdido` es
  terminal humano y el precio **no resucita** una conversación descartada (con test). La compuerta
  del arrastre no se toca: acá no se declara nada, se lee un hecho — y el hecho es más fuerte que el
  clic, porque la persona REALMENTE recibió un precio.
- ⚠️ **CONTRATO**: quien consuma `etapaEfectivaSql` tiene que emitir `precio_enviado`. El Dashboard lo
  llamaba `precio_mencionado` **y lo calculaba con un regex PROPIO más pobre** (sin pasarelas ni
  instrucciones de pago): la misma conversación contaba como cotizada en Mensajes y no en el
  Dashboard. Se unificó contra `cola/precio.ts` — con dos criterios, cada pantalla arma un embudo
  distinto (#37).
- ⚠️ **El «subregistro» del Dashboard cuenta lo ASENTADO A MANO**, no la etapa efectiva. Con la
  derivación, leer la efectiva haría que el hueco diera **0 siempre** — la clase de número que miente
  y que este frente vino a sacar.
- **El chip «Con precio» desaparece solo de Contactados**: esas conversaciones ahora viven en
  Cotizados, así que el conteo da 0 y la regla «un recorte que daría cero no se ofrece» lo esconde.
  Captura en `docs/evidencia/embudo-derivado.png`.
- **EL RECORTE ES POR COLUMNA, y cada una lleva el suyo** (`tablero.ts`, `recortesDeColumna` puro).
  El eje nuevo es **«Para seguir»** (silencio nuestro + entre 3 y 14 días en la etapa,
  `cola/tiempoEnEtapa.ts`): medido, es el ÚNICO de los tres que recorta de verdad — sobre 3.051
  Cotizados, «en ventana» dejaba **1** y «sin respuesta» **2.928**, y éste deja **82**. La cabecera
  muestra **las dos cifras** («82 · de 3.051»): con una sola, o se esconde el montón o el número no
  describe lo que hay abajo.
  · **La regla del cero tiene DOS mitades**: un recorte que daría cero no se ofrece **y uno que
    daría el total, tampoco** — «Con precio 3.051» sobre una columna de 3.051 es un botón que no
    cambia nada. La excepción, para las dos: **el chip activo se ofrece siempre**, o no hay cómo
    apagarlo. Lo encontró la captura de evidencia, no un test.
  · Cierre y Perdidos no llevan recorte: Perdidos es archivo, y el que Cierre merece —vendido y
    todavía sin registrar— depende del lazo de ventas, que es otro frente.
- **Y cada tarjeta dice cuánto lleva en su columna** (`canales/antiguedad.ts`, `etapa_desde` del
  server). **Sin oro**: el oro es tiempo que se ACABA y acá no corre ningún plazo. Se calla abajo de
  un día, y también cuando repetiría lo que el reloj de arriba ya dice — que es el caso más común.
  Capturas en `docs/evidencia/pipeline-recorte-por-columna.png`, `pipeline-para-seguir.png` y
  `pipeline-sin-respuesta.png`.
- ⚠️ **La quinta columna dejó el GRID ajustado**: a 1280 los mínimos suman 1.020 sobre ~1.256 px de
  contenido, con el gap bajado a 8 px. Agregar otra columna **obliga a rehacer esa cuenta**, no a
  sumar un `minmax`.
- 🔴 **Y «Cierre» sigue dependiendo de que Hermes SEPA de la venta.** Medido: **417 ventas reales en
  30 días, 0 webhooks recibidos**. El puente `ventas:sincronizar` —que no depende de Cerberus—
  rechazaba el **99,6 %** de los payloads porque el esquema pedía `telefonos: string[]` y Cerberus
  manda objetos. Arreglado: de **0 a 1.565 ventas atribuidas** sobre los mismos 8.032 eventos. Ver
  `atribucion/payload.ts`.

## Señales automáticas — «Cotizado» y «Se enfrió»

`server/src/senales/` calcula, sobre el hilo, dos cosas que hoy nadie ve: si a esa persona ya le
mandaron el **precio** y si **se enfrió** después. `GET /api/senales?claves=a,b,c`
(`routes/senales.ts`, detrás de `requiereVendedora`, solo lectura).

- **No se guardan** (ADR 0016): no hay fila, no hay job. Se derivan en cada consulta, como la etapa
  efectiva (0013) y `no_leido` (0014). Conviven con las **categorías manuales** (#48) sin ser una:
  la manual es píldora de **borde**, la automática de **fondo** tenue; misma paleta `--cat-*`, sin oro.
- **El criterio vive UNA vez**, puro: `senales/cotizacion.ts` (monto con moneda plausible, veto a la
  instrucción de pago) y `senales/enfriamiento.ts` (cotizada + sin respuesta + N días, con reloj
  inyectado). El SQL de `consultarSenales.ts` solo hace un **prefiltro superconjunto** y el veredicto
  lo da la función pura — así no hay segunda implementación que pueda divergir (lección de #37).
- **Umbral**: `SENALES_DIAS_ENFRIAMIENTO` (default 3; un valor inválido se ignora).
- **Medir la precisión sobre datos reales**: `cd server && npm run medir:cotizaciones [días]`
  (read-only) — imprime ingenuo vs. detector vs. corroboradas y la muestra de falsos positivos evitados.

## Lo que el bot dijo, EN LA COLA — el lector que `bot_calificaciones` no tenía

El bot comercial escribía su veredicto en `bot_calificaciones` y **esa tabla no tenía un solo
lector**. El 1-ago-2026 escaló tres conversaciones de leads que estaban por comprar: escalar lo
silencia a propósito (`bot_pausas`, 2 h de gracia) y del otro lado no había nadie. Se salvaron porque
el dueño estaba mirando la sala a mano — o sea que **el bot solo servía mientras alguien lo vigilaba**.

- **Se deriva en la consulta de la cola**, no en un job ni en una columna nueva: `cola/botSql.ts`
  (LEFT JOIN por `clave`, que ya es la misma) y tres columnas en cada fila — `bot_escalada`,
  `bot_temperatura`, `bot_motivo`. Va en el LISTADO y no en la ficha porque la pregunta que responde
  es «¿a quién atiendo AHORA?», y esa se hace **antes** de abrir la conversación.
- **NO toca el orden de la cola.** La urgencia vive una vez (`cola/urgencia.ts` + `urgenciaSql.ts`)
  con su test de paridad contra el radar: una escalada se encuentra por el **chip de filtro** —que
  trae su número—, no empujando filas.
- **Dos filtros, no uno**: `?intencion=bot-escalada` (el bot se frenó y espera a una persona) y
  `?intencion=bot-caliente` (pidió precio/cuotas/forma de pago). Se atienden distinto —una hay que
  ENTRARLA, la otra MIRARLA— y juntarlas enterraría las 3 urgentes entre las 14 calientes.
- **Los dos chips solo se dibujan con conteo > 0** (el activo siempre, para poder apagarlo). El bot
  corre en UNA línea de cuatro: en las otras tres serían chips muertos comiéndose el ancho. El efecto
  buscado es que **el chip apareciendo ES el aviso**.
- En la fila: píldora de **fondo tenue** con ícono de bot (señal automática, como «Cotizado» —
  **sin oro**), rojo la escalada y naranja la caliente. Ocupa el mismo lugar que el chip de curso y
  le gana; el precio de eso está escrito en `FilaConversacion.tsx`. `tibio`/`frio` no se dibujan
  (serían 50 de 66 filas). La lectura de los seis motivos vive pura en `src/features/canales/bot.ts`,
  y un motivo que el front no conoce cae en «Pidió ayuda», nunca en un throw ni en un motivo parecido.

## El reparto de leads — de quién es cada conversación cuando varias comparten una línea

Hasta el 4-ago-2026 cada vendedora tenía SU número. Desde ese día **varias personas comparten
uno**: la línea del bot `51984429504`. Sin reparto pasan las dos cosas de siempre —**dos
contestan al mismo lead** y **nadie contesta a otro**—, porque la fila se ve igual para todos.
Server en `server/src/reparto/`, plan y decisiones en `docs/plan-reparto-de-leads.md`.

> ✅ **VIVO EN PRODUCCIÓN desde el 4-ago-2026** (PR #273, prod en `9f33b5e`). La rueda de
> `51984429504` tiene **5 vendedoras** —`ventas10@grupogoberna.com` … `ventas14@…`, el username
> de Cerberus **es el correo completo**— y Luz queda afuera a propósito (ve la cola entera, no
> recibe asignados). Al prenderlo había **91 conversaciones sin dueño**: las anteriores al
> reparto **no se reparten solas**, les toca dueño cuando vuelvan a escribir.
> Para auditar: `ssh deploy@161.132.39.165 'cd /srv/hermes/server && npm run reparto:rueda'`.

- **Round-robin, y se elige por CARGA, no con un puntero** (`reparto/rueda.ts`, puro): se le da
  **al que menos tiene**. Un puntero se desincroniza —alguien entra, otro sale, se borra una
  asignación— y queda apuntando a quien ya no está, sin que nadie lo note. Elegir por carga es
  equivalente desde cero y **se auto-corrige**: quien se suma tarde recibe hasta emparejar.
  La propiedad que se le promete al equipo y que fija el test: **entre el que más y el que menos
  recibe nunca hay más de 1**. Al azar, 10 leads entre 6 pueden caer 4 y 0, y esa varianza **se
  lee como favoritismo** aunque sea mala suerte.
- **Dos tablas** (`db/reparto.ts`, migración `0015`): `reparto_rueda` (quiénes participan, por
  línea) y `conversacion_asignada` (de quién es cada `clave`). La rueda **no se deriva de
  `numero_vendedora`** a propósito: ese mapa responde «¿quién atiende este número?», no «¿entre
  quiénes se reparte?» — y como lo empuja Cerberus, derivarla movería el reparto en silencio.
- **Se asigna en el webhook de Cloud API** (`webhook/whatsapp.ts`), después de persistir el
  mensaje y **después** de notificar al bot: el despachador es lo único de ese bloque con una
  persona esperando. **Fail-open**: sin tabla o sin rueda no asigna y devuelve `null` — un lead
  perdido por un fallo del reparto es infinitamente peor que un lead sin repartir.
- **Es un FILTRO, no un permiso**, como «Las mías» y por lo mismo: `requiereVendedora` dice «es
  una vendedora», no «cuál», y el hilo, la ficha y el envío siguen sirviendo cualquier
  conversación a cualquier token. Cualquiera abre y pasa cualquier cosa; lo que hay es **rastro**
  (`asignada_por`).
- 🔴 **`?mios=1` NO es `?mias=1`.** Una vocal de diferencia, la misma ruta, y confundirlos **no
  rompe nada visible: devuelve otra cola**. `mias` = mis LÍNEAS (`cola/lineas.ts`); `mios` = mis
  CONVERSACIONES asignadas (`cola/asignadaSql.ts`). Adentro se llaman `misLineas` y `misAsignadas`,
  se leen juntos en la ruta y un test los cruza (`consultarCola.mios.test.db.ts`).
- **«Míos» recorta el UNIVERSO**, no una columna: con el filtro puesto, «Piden info · 12» dice 12
  *de las mías*, y el desglose también. Su propio chip se cuenta **con el filtro apagado**, que es
  cuando se lo mira. **No es fail-open** (a diferencia de «Las mías»): cero asignadas es un hecho
  verdadero, y lo que evita la cola vacía sin explicación es que el chip **lleva su número**. Lo
  único que se apaga solo es sin la migración (`sinAsignacion`), donde el 0 mentiría del motivo.
- ⚠️ **El join proyecta DOS columnas, no la tabla**: `conversacion_asignada.numero_propio` choca
  con el de la cola y un `LEFT JOIN conversacion_asignada` a secas rompe la consulta entera con
  `42702`. Lo atrapó el test con base.
- **En la fila, el dueño va en el RENGLÓN 1**, junto a la marca de ex-cliente (`canales/dueno.ts`,
  puro): «Vos» en navy —el color que ahí ya significa «tuyo»— y el nombre de la otra persona en
  neutro. **Sin dueño no se dibuja nada** (sería ruido en 1.900 filas) y **dentro de «Míos»
  tampoco se rotula lo propio** (lo dice el filtro). Abajo NO entra: con el chip del bot al lado
  el preview quedaba en «Bue…», y el bot corre justo en la línea que se reparte.
- **El destino de una reasignación se VERIFICA** (`reparto/destino.ts`, puro). `vendedora_id` es
  el username de Cerberus y **Hermes no tiene padrón**: un dedazo escribe una fila válida y la
  conversación desaparece de la cola de todos, sin un solo síntoma. Un destino que no está ni en
  la rueda (aun inactiva) ni en `numero_vendedora` es **409 enumerando a quién sí se puede**.
  Con la lista vacía rechaza a todos: fail-open ahí reabriría el agujero entero.
- 🔴 **EL MISMO HUMANO TIENE DOS GRAFÍAS VIVAS EN PROD.** Medido en VPS1 el 4-ago-2026:
  `numero_vendedora` dice **`Luz`** (lo empuja Cerberus) y `sesiones_cerberus` dice **`luz`** (lo
  que se tipea al entrar, que es de donde sale el `vendedoraId` del token); en `gestiones`
  conviven `Usuario1` y `luz`. Con comparación exacta, una conversación asignada como `Luz` es
  **invisible para su propia dueña**. Se compara normalizando **de los DOS lados** —`lower()` en
  `cola/asignadaSql.ts`, `mismaVendedora` en `reparto/destino.ts` y en `canales/dueno.ts`— y se
  **guarda la grafía que vino** (reescribirla rompería el cruce con `gestiones` y
  `estado_conversacion`). Lo que reabre el agujero es normalizar de UN lado, no normalizar.
- **El `vendedora_id` de las vendedoras nuevas ES el correo completo** (`ventas10@grupogoberna.com`),
  verificado en el panel de Cerberus el 4-ago: el usuario se llama así y no tiene email registrado.
  Las viejas son cortas (`luz`, `alan`, `Usuario1`). En la fila se lee «Ventas10»: `nombreCorto()`
  corta en el `@`.
- **La rueda se carga con `cd server && npm run reparto:rueda`** (dry-run por default), nunca con
  SQL a mano. `--agregar a,b,c` · `--sacar x` · sin flags imprime cómo va y **verifica la
  propiedad**. Sacar a alguien es **baja lógica**: conserva lo que tenía. La ruta `/api/reparto`
  solo LEE la rueda y pasa conversaciones — quiénes entran al reparto no puede estar a un clic de
  cualquier token de vendedora.
- **Ver la UI sin server ni base**: `npx vite --port 5199` → `http://localhost:5199/galeria-reparto.html`.
  Captura en `docs/evidencia/reparto-cola.png`.

## El padrón de contactos — los 72.923 que NUNCA escribieron (ADR 0035)

La cola ordena por urgencia a quien **ya escribió**. El padrón responde la otra pregunta: **¿a
quiénes les hablamos ahora?** Son los contactos de **`icarus.contacts`**, que hasta el 4-ago-2026 no
estaban en ninguna pantalla. Vive en la vista **Contactos**, primera solapa (`src/features/padron/`,
server en `server/src/padron/` + `routes/padron.ts`).

Medido en VPS1 el 4-ago-2026: **72.923** contactos · 71.341 con teléfono usable (97,8 %) · 72.770 con
nombre · 61.298 con correo.

- 🔴 **ACÁ EL RECORTE ES UNA FRONTERA, NO UN FILTRO** — y es la única de Hermes. Todo lo demás
  («Las mías» `cola/lineas.ts`, «Míos» `cola/asignadaSql.ts`) es explícitamente un filtro, porque la
  cola es compartida y presentar un recorte como frontera sería una frontera imaginaria. Acá la
  decisión del dueño es la contraria: **la vendedora no ve el padrón, ve lo que le habilitaron**. Por
  eso el recorte está en el `WHERE` de la ruta y **no** en un `if` del navegador — un recorte dibujado
  en el front no existe: los datos ya viajaron. Lo que NO cambia: el resto de Hermes sigue sin modelo
  de permisos.
- **Quién es supervisor sale de `HERMES_SUPERVISORES`** (CSV de `vendedora_id`), no de una tabla:
  Hermes no tiene padrón de usuarios donde colgar un rol. **Fail-closed** — sin la variable nadie es
  supervisor y nadie ve el padrón, y la pantalla lo **dice** (`sinSupervisores`) en vez de mostrar una
  lista vacía. Se compara normalizando los dos lados (`ventas10@…` == `Ventas10@…`): el `vendedora_id`
  es lo que se TIPEA al entrar, y un supervisor con una mayúscula distinta no vería un error, vería su
  pantalla vacía. **No se edita desde la app**, igual que la rueda del reparto.
- **El reparto se guarda en Hermes** (`contacto_habilitado`, migración `0017`), nunca en icarus: la
  conexión fuerza `default_transaction_read_only=on` y **icarus sirve a un cliente real de
  consultoría**. ⚠️ `icarus.contacts.assigned_to` **parece** esto y no lo es: sus cinco valores son
  **números de línea** (`+51944531711`, `+51986394450`…), o sea «por qué línea pasó», no «de quién es».
- ⚠️ **Dos bases, sin JOIN**: los ids se leen de `hermes_db` y las filas se piden a icarus
  (`= ANY(...)::bigint[]`). Por eso hay tope de página duro, y por eso con icarus caído la lista **no
  se puede servir** — ahí va un error que lo dice, jamás una lista vacía (cicatriz de ADR 0023).
- 🔴 **«Compró» se pregunta a `icarus.sales`, NUNCA a `n_purchases`**: 10.564 contactos dicen haber
  comprado y solo **4.783** tienen una venta que lo respalde (el mismo 55 % de #133, por otra puerta).
  Con el contador, más de la mitad de un lote de «clientes» nunca compró nada. En la tabla los tres
  estados se distinguen: verde **Sí** con venta real · gris **sin respaldo** cuando icarus afirma sin
  nada detrás · `—`.
- **Un contacto, una dueña**: `contacto_id` es PRIMARY KEY. Habilitar el mismo a dos personas es el
  defecto que el reparto existe para evitar. Re-habilitar **pisa** (vacaciones, bajas).
- **El destino se VERIFICA** contra la rueda + `numero_vendedora` (`padron/destinos.ts` reusa
  `destinosPosibles`): un dedazo escribe una fila válida y los contactos **no le aparecen a nadie**.
  409 enumerando a quién sí se puede.
- **Repartir NO manda nada.** Lo que sigue —plantilla + escribirle a alguien que nunca escribió— es
  outbound en frío y tiene un problema de canal antes que de código: las líneas de las vendedoras son
  whatsmeow y abrir en frío es el camino corto al ban. La línea del bot es Cloud API y puede abrir con
  **plantilla aprobada por Meta**. Es otro frente.
- **El buscador por teléfono no se archivó**: quedó en la segunda solapa. Pregunta a **Cerberus en
  vivo** y trae folios y montos por venta; el padrón es una copia de icarus y no los tiene.
- **Un clic en la fila abre la ficha al costado** (5-ago): el mismo `PanelDerecho` de Mensajes. La
  tabla dice lo que icarus guardó; la hoja pregunta a **Cerberus en vivo**, que es donde se ve si
  el «sin respaldo» de la fila tiene folios detrás. La `Conversacion` se **sintetiza** del teléfono
  (`canales/conversacionNueva.ts`, la fábrica que estaba suelta dentro de `escribirA`): timeline,
  señales e intereses vienen **vacíos**, y eso es la verdad —el padrón son los que nunca
  escribieron—, mientras que todo lo que se busca por teléfono responde igual. Sin teléfono usable
  la fila no se abre: una hoja vacía se leería como «no es cliente» y lo que pasa es que no se lo
  pudo preguntar.
- **MULTIFILTROS con facetas**: cinco dimensiones **multivalor** (país · curso · etapa · nivel ·
  fuente), **OR adentro de cada una y AND entre ellas** — «(peruanos o mexicanos) Y que ya
  compraron». Cada opción llega con **su conteo** (`GET /api/padron/facetas`), y ese número **es**
  el total que el filtro después devuelve (fijado con test): sin él, un desplegable de 62 países es
  una lista de nombres y filtrar se vuelve tantear. ⚠️ **Cada dimensión se cuenta SIN su propio
  filtro** (`donde.ts` con `omitir`): si se contara con él, tildar «Perú» reduciría la lista a Perú
  y no habría forma de AGREGAR México. Las opciones **se derivan de los datos**, nunca de una lista
  a mano: `stage`/`source`/`country` los escribe icarus y una constante nuestra envejecería en
  silencio. El `WHERE` vive UNA vez en `padron/donde.ts`, compartido por la lista y las facetas —
  con dos, la pantalla ofrecería «México · 11.646» y devolvería otra cosa (#37).
- 🔴 **«Curso» y «qué compró» son DOS DATOS DISTINTOS, y la tabla los mezclaba.** `course`/
  `last_course` los llena **la landing** con lo que la persona DIJO que le interesaba; lo que
  **pagó** vive en `sales` → `sale_items` → `products`. Medido el 4-ago: de los 19.776 de `landing`,
  19.405 tienen curso y solo 1.086 compraron; y los **477 que entran por el webhook de `cerberus`
  tienen venta en el 100 % de los casos y curso en NINGUNO**. Por eso la tabla se leía al revés
  —filas con curso que decían «no compró» al lado de filas sin curso que decían «Sí»— y las dos
  eran correctas. Ahora viajan separados (`curso` · `comprado`) y se dibujan distinto: lo pagado con
  peso, lo declarado en cursiva tenue. El producto sale por **LATERAL** (venta más reciente, ítem
  más caro: «Certificado» y «Certificado con Portadiploma» son el #2 y #3 del catálogo por volumen);
  un JOIN plano multiplicaría la fila e inflaría el total con el que se reparte.
- **SE PUEDE REPARTIR TODO LO FILTRADO, no solo la página**: con la página entera tildada aparece
  «Elegir los 17.014 de este filtro». Ahí la selección **cambia de forma** (`seleccion.ts`, puro y
  con tests): deja de ser una lista de ids y pasa a ser `{modo:'recorte', excluidos}` — «todo lo
  filtrado menos estos». **Viaja el FILTRO, no los ids** (`POST /api/padron/habilitar-recorte`): 72.923
  ids son ~700 KB en cada sentido para algo que el server resuelve con una consulta, y el recorte es
  lo que el supervisor quiso decir, no su fotografía.
  · ⚠️ **Destildar en modo recorte NO rompe el modo** — volver a `lista` con los ids de la página
    sería el bug clásico (destildás uno de 17.014 y te quedan 49), sin síntoma hasta ver el acuse.
  · ⚠️ **El INSERT va en tandas de 5.000, y no es optimización**: Postgres corta en **65.535
    parámetros por statement** y acá van 4 por fila, así que a partir de ~16.383 el insert fallaba
    entero. Desde que se puede repartir un recorte completo dejó de ser hipotético.
  · **`RECORTE_MAX` (100.000) cubre el padrón entero a propósito**: un tope por debajo haría que la
    pantalla ofrezca «los 72.923» y el server los rechace DESPUÉS de confirmar. Cuando se topa, el
    error dice el número y pide acotar — **nunca recorta en silencio**.
  · **A partir de 500 hay confirmación** con la cifra escrita (`CONFIRMAR_DESDE`). No bloquea —
    repartir 17.014 es decisión del supervisor— pero deja de ser un clic suelto (regla dura #7). El
    diálogo aclara que **repartir no manda ningún mensaje**.
  · El acuse muestra **cuántos habilitó el SERVER**, no la cifra que la pantalla tenía: el recorte se
    resuelve de nuevo allá y pueden haber entrado contactos nuevos.
- **Ver la UI sin server ni base**: `npx vite --port 5199` → `/galeria-padron.html`
  (`?vendedora=1` la vista de quien no reparte, `?filtro=1` las facetas abiertas, `?lote=1` la barra
  de reparto, `?destino=1` el desplegable con la carga, `?todo=1` el recorte entero elegido,
  `?todo=1&confirmar=1` la confirmación, **`?ficha=1` la hoja del contacto abierta**). Capturas en
  `docs/evidencia/padron-*.png` y `docs/evidencia/sidebar-padron.png`. El Pipeline tiene la suya:
  `/galeria-embudo.html` (`?ficha=1`) → `docs/evidencia/sidebar-pipeline*.png`.

## El Dashboard es de quien lo mira (ADR 0036)

`GET /api/dashboard` servía **todo a todos** —radar, embudo, series y las filas de las cinco
vendedoras— detrás de `requiereVendedora`, que dice «es una vendedora», no «cuál». Con el reparto
vivo desde el 4-ago, cada una abría Hermes y veía el trabajo de las otras cuatro mezclado con el
suyo. Server en `server/src/dashboard/personal.ts`, front en `VistaDashboard.tsx`.

- **Quien NO es supervisor ve SOLO sus conversaciones asignadas**, y el recorte baja a las **cinco**
  consultas: radar · embudo · series de 14 días · «qué piden» · el cuadro Equipo (una sola fila).
  Recortar la lista y dejar el riel global daría dos respuestas a la misma pregunta en la misma
  pantalla. Quién es supervisor sale de `HERMES_SUPERVISORES` — el mismo mecanismo del padrón.
- 🔴 **Es una frontera, y hay que decir DE QUÉ**: la del **Dashboard**, no la del dato. El hilo, la
  ficha y el envío siguen sirviendo cualquier conversación a cualquier token (Hermes no tiene modelo
  de permisos). Lo que cambia es qué pantalla te arma la mañana. Es la **segunda** frontera del repo
  —la primera es el padrón— y el resto sigue siendo **filtro, no permiso**.
- **«El negocio» es 403, no un recorte** (`no_es_supervisor`, mismo nombre que `/api/padron`): no
  existe una versión personal de «cuánto factura cada curso». Y no como query-param, que sería la
  frontera a un clic de curl.
- **Lo que no tiene dueño POSIBLE se cae**: los leads de formulario y los comentarios de FB/IG no se
  reparten (la clave de un comentario es `int:<id>`). Por eso la respuesta lleva `soloMisAsignadas`,
  y con eso la pantalla **explica el vacío** —«todavía no tenés conversaciones asignadas», nunca
  «nada cayó con estos filtros», que sería falso: cayó, no es tuyo—, **apaga** los chips de
  Landing/Lead Ads (serían ceros permanentes) y rotula **«Vos»** en vez de «Equipo».
- ⚠️ **En el front el campo ausente se lee `?? true`**, y no es una contradicción con el fail-closed
  del server: falta en un server viejo y en una respuesta rehidratada del caché (ADR 0007), y con
  `false` por default «El negocio» desaparecería **para todos, incluido el supervisor**, en la
  ventana entre N4 (front, sin restart) y N5 (server, a botón).
- 🔴 **MEDIDO EN VPS1 EL 5-AGO, Y ES LA PRECONDICIÓN PARA PRENDERLO**: el radar de 7 días tiene
  **213 conversaciones y solo 83 con dueño** (`luz` 78; las cinco `ventas1X`, **una cada una**).
  Prendido así, cuatro vendedoras abren un Dashboard de una fila. **Hay que repartir la cola antes**
  — es operación, no código, y no hay línea que tocar.
- **Ver la UI sin server ni base**: `npx vite --port 5199` → `/galeria-dashboard.html`
  (`?supervisor=1` lo que ve quien reparte, `?vacio=1` sin nada asignado). Capturas en
  `docs/evidencia/dashboard-personal*.png`.

## El timeline se puede ESCRIBIR, y dice quién (ADR 0037)

El timeline del panel derecho tenía **seis tipos de evento y los seis eran DERIVADOS** (la
compra que afirma Cerberus, la llegada de Meta, el nombre, el interés, el enfriamiento, la
cotización). Contaba lo que las máquinas sabían de esa persona y **nada de lo que pasó en la
conversación**. Server en `server/src/eventos/`, front en `src/features/eventos/`, tabla
`eventos_contacto` (migración `0018`), ruta `/api/eventos`.

- **Un evento es TIPO + dato estructurado + comentario**, nunca texto libre: un
  `notas LIKE '%cuotas%'` no se suma, no se agrupa por curso y no se cruza con la pauta (el
  mismo argumento que `db/schema.ts` ya tiene escrito sobre `conversiones_wa`). El comentario
  es el matiz; **el tipo es lo que se cuenta**. Seis: `pregunto_curso` · `pidio_precio` ·
  `objecion` · `quedamos_en` · `llamada` · `otro`.
- **Tabla nueva y no `gestiones` ni `notas`**: `gestiones` tiene `etapa` NOT NULL —anotar un
  hecho obligaría a declarar una etapa y a pasar las compuertas— y `notas` es **privada por
  autora** y es prosa. Acá se ve en equipo, y el `tipo` existe para poder contar.
- 🔴 **«Preguntó por un curso» ASIENTA el interés**, por el mismo seam que el botón «+ interés».
  `intereses` es la ÚNICA fuente de verdad de «qué curso quiere» (la consultan la compuerta de
  Cotizado, el chip de la cola, la ficha y el Pipeline): con el curso guardado también acá
  habría **dos lugares diciendo qué quiere el lead** (#37). Y sin eso la vendedora registra
  «preguntó por Gestión Pública» y al minuto Cotizado le rebota con «no se sabe qué curso le
  interesa». El interés va **primero** y el evento guarda **el nombre que resolvió el catálogo**,
  no el que mandó el navegador — si no, el timeline dice uno y el chip de la cola otro. Es
  seguro porque `registrarInteres` no tira con Cerberus caído: degrada y devuelve el motivo.
- **Se ve en EQUIPO, se edita por AUTORA.** La conversación es compartida (Hermes no tiene
  modelo de permisos), pero un evento es una AFIRMACIÓN de quien lo escribió. El error nombra a
  la dueña. 🔴 **Se compara normalizando los DOS lados** (`mismaVendedora` server, `esMio`
  front): con `Luz` vs `luz` la comparación exacta no da error, da que **Luz no ve los botones
  de sus propios eventos**.
- **Borrar es archivar** (`archivado_at`) y **el `tipo` no se edita**: cambiarlo convertiría una
  objeción en una llamada sobre la misma fila y el mismo timestamp. El PATCH tampoco puede
  agregarle un curso a un evento que no lo tenía. Archivar **no des-asienta el interés**.
- **Un tipo desconocido se LEE, nunca tira.** `tipo` es `text` y no un enum, y el server acepta
  términos fuera de su lista (solo valida la forma `^[a-z][a-z_]{0,31}$`): el front sale sin
  reiniciar el server (N4 va solo, N5 es un botón) y rechazar ahí convierte un deploy escalonado
  en «no se pudo registrar». `rotuloDeTipo` lo muestra tal cual, nunca como otro tipo. Y **no se
  le inventa una regla**: no exige nota, no la perdona, y no asienta interés aunque traiga curso.
- **Se dice QUIÉN**, en nombre corto (`ventas10@grupogoberna.com` → «Ventas10»). Antes
  `EventoLinea` calculaba `fuente` y **no la dibujaba en ningún lado** — lo que afirmó Cerberus
  se leía igual que lo que dedujo una señal. El tag «MANUAL» ahora sale **solo si no hay autor**:
  «MANUAL · por Luz» es la misma cosa dos veces en 360 px.
- **Dos lugares, UN componente** (`RegistrarEvento`, con `variante`): el chip **«Registrar»** al
  lado de «Agendar» en la `BarraGestion` y el botón al pie del timeline. **Agendar es una promesa
  a futuro** (cae en la Agenda), **registrar es un hecho del pasado** (cae en el timeline).
  Ninguno de los dos envía nada, y el pie del popover lo dice.
- **Los candados**: `eventos/paridad.test.ts` cruza el catálogo del server con **la copia a mano
  del front** y falla si divergen (mismo mecanismo que `hechos.ts`); `registrarEvento.test.db.ts`
  fija el asiento del interés y la normalización de grafías; y
  `src/features/eventos/RegistrarEvento.test.tsx` (jsdom) fija **el cableado del teclado** —
  existe porque el defecto real apareció capturando la evidencia: con el foco en el buscador de
  curso, el Escape hacía `stopPropagation()` y **no cerraba nada**. Ningún test puro lo veía
  (ADR 0024, otra vez).
- **Ver la UI**: no hay galería — se capturó la app REAL con un stub de ~60 líneas en `:4199` y
  `VITE_API_URL` apuntándole. Capturas en `docs/evidencia/eventos-*.png`.

## El panel derecho — ordenado por lo que decide una venta (ADR 0017)

`src/features/panel/PanelDerecho.tsx` (360 px, `w-[22.5rem]` en `App.tsx`). El orden **no es
temático**: es el de las preguntas que la vendedora se hace mientras escribe. **Una pestaña guarda lo
que se CONSULTA, nunca lo que se DECIDE.**

> **Y desde el 5-ago vive en TRES lugares, con un solo componente**: en Mensajes como columna, y en
> el **Pipeline** y el **padrón** como hoja al costado (`panel/HojaContacto.tsx`) — un clic en la
> tarjeta o en la fila. Antes, saber quién era esa persona costaba **irse a Mensajes** y volver.
> La hoja **se superpone y no empuja**, y el motivo es aritmético, no estético: el `GRID` del
> Pipeline declara mínimos que suman **1.000 px** y a 1280 el contenido son ~1.180 — empujando
> quedarían ~810 px para el tablero y aparecería scroll horizontal, que en esta app no existe.
> Sin scrim a propósito: se toca otra tarjeta y la hoja cambia de persona sin cerrarse.
> ⚠️ La tarjeta es `draggable`, así que **un arrastre no puede contar como clic** (guarda con ref en
> `TarjetaEmbudo`, con su test de componente) y el Escape de la hoja **se apaga** mientras hay un
> modal de compuerta encima — los dos escuchan en captura y una sola tecla cerraría las dos cosas.

1. **Quién es** — `panel/BandaEstado`. El estado **se ve, no se lee**: filete de 3 px + fondo tenue,
   verde cliente · `--temp-frio` conversación fría · ámbar «no se pudo saber» · gris lead nuevo.
   **Sin oro** (el oro es tiempo que se acaba). Encabeza con el **nombre real** —decisión cerrada del
   dueño, #118: **Cerberus > formulario > alias de WhatsApp** (`panel/identidad.ts`)— con **la
   procedencia a la vista** («del formulario · en WhatsApp: javier»); el alias no se pierde, es como
   se llama en el chat. Nombre en dos líneas, no truncado. La cifra de compras va en la misma línea
   que la pastilla «Cliente». El arbitraje entre «quién es» y «cómo va el hilo» vive puro en
   `panel/estadoContacto.ts`: **un cliente que se enfrió sigue siendo cliente**. Cierra con
   `FranjaEtiquetas` (automáticas de fondo tenue ADR 0015 + categorías manuales de borde #48; el
   dibujo las distingue, y son solo lectura — se editan en la `BarraGestion`).
2. **Qué quiere** — `panel/BloqueInteres`, **fuera de las pestañas**. 611 conversaciones con precio
   enviado y 1 interés registrado: acá se destraba. Es **progresivo** y da contexto a todo, así que
   va segundo y lleva su lectura en una línea (`panel/resumenInteres.ts`, pura). Los chips —
   registrados y **la propuesta del anuncio/formulario con «Confirmar»** (#102)— los pinta
   `gestion/Intereses`, el mismo componente de la cola/Pipeline/compuerta: este bloque **compone, no
   duplica**.
3. **Qué mandarle** — dos calibres de la misma pregunta:
   - `DosRespuestas`: **dos** respuestas listas, un clic manda la secuencia entera (espaciada, con
     progreso, cancelable); tocar el texto lo abre en el composer para editarlo.
     `GET /api/sugerencias?clave=…`. Si no hay sugerencia clara **no se inventa una**, y si la
     consulta falla se dice el fallo (un 404 **no** es «no hay respuesta clara»).
   - `hechos/BloqueHechos` (#153): los **datos que cierran ventas y casi nunca se dicen** —«se puede
     en 2 cuotas» se dijo 2 veces en 1.876 conversaciones; «el acceso es por todo un año», 1—.
     Frases sueltas, **no secuencias**, y **tocarlas NO envía**: caen en el composer.
     `GET /api/hechos?clave=…`. Ver §Datos recomendados.
4. **El detalle**, en pestañas (`panel/pestanas.ts`, pura): Ficha · Enviar · Notas · Curso. Pestañas y
   no acordeón: con 360 px, el acordeón obliga a plegar y scrollear; la barra cuesta 30 px fijos.
   La bandeja va **hundida** (`bg-muted/60`): el panel se lee en tres planos —blanco decide, bandeja
   consulta, blanco actúa.
   > 🔴 **La pestaña «Notas» de esa lista es CÓDIGO MUERTO.** Verificado el 4-ago-2026 por grep:
   > `pestanas.ts` la declara y **ningún componente la renderiza** (a `pestanas.ts` solo lo importa
   > su propio test). `PanelNotas.tsx` —el que dejaba anotar sobre una conversación— tiene un único
   > consumidor, `canales/PanelContexto.tsx`, y a ése **no lo importa nadie**: quedó huérfano en
   > `79b239b`, cuando el panel derecho se reescribió por ADR 0017.
   > Consecuencia: durante meses **no hubo ninguna forma en la app de anotar sobre una
   > conversación.** Todo lo que se escribe va a `clave='general'` (la Libreta). Por eso
   > `notas_filas = 0` y `clave_general = 0` son **un solo hecho, no dos** — la nota pegada al
   > contacto no fue rechazada por nadie: nunca estuvo disponible. Es la hipótesis C de
   > `docs/plan-libreta-que-deberia-tener.md`, y decidir si se reconecta o se archiva va **antes**
   > de tocar `buscarNotas`, que sigue clavado a `'general'` (`server/src/notas/notas.ts:191`).
   >
   > ⚠️ **Desde el 5-ago (ADR 0037) el caso que más dolía ya tiene puerta**, y no es ésta: los
   > **eventos del contacto** (`eventos_contacto`) se registran desde el chip «Registrar» de la
   > barra y desde el pie del timeline. **No los reemplaza**: un evento es un hecho tipado y
   > compartido; `PanelNotas` era prosa libre y privada. La pestaña muerta sigue muerta y la
   > decisión sobre `PanelNotas` sigue abierta — lo que cambió es que ya no es urgente.
5. **Qué hago** — `panel/AccionesContacto`, al pie y **siempre visible**, con **una sola acción
   primaria** según el estado. Antes vivía dentro de la pestaña Ficha y abrir «Notas» hacía
   desaparecer el botón que cierra la venta.

**El pie está clavado y el medio es un solo scroll** con la barra de pestañas pegajosa: a 1280×720
con dos respuestas cargadas, el reparto flex empujaba «Registrar venta» fuera del panel.

**La ficha y las sugerencias tienen techo de 12 s** (`AbortSignal.any` + `retry: false`). Cerberus a
veces deja la conexión abierta sin responder: sin techo el panel se congela en «Buscando…» y el
estado de error —cuidadosamente dibujado— no se dispara nunca.

**Quién decide las dos**: `server/src/sugerencias/estado.ts` — puro, y es **el vocabulario compartido
con la auto-respuesta nocturna** (#125): su `ContextoPlantilla` es este mismo tipo. Al mergear esa
rama, `autorespuesta/plantillas.ts` importa de acá y borra el suyo. La misma cabeza decide de día
(sugerencia) y de noche (auto-respuesta).

## Datos recomendados — la munición de una línea (#153, ADR 0017)

`server/src/hechos/` + `src/features/hechos/`. Los hechos que **desbloquean la venta en el acto** y
que casi nunca salen de nuestro lado, medidos sobre 1.876 conversaciones: «el acceso lo tiene por
todo un año» (dicho **1** vez), «se puede pagar en cuotas» (**2**), «es para público general» (**3**),
«este es nuestro canal oficial» (**1**).

- **`GET /api/hechos?clave=…`** devuelve como máximo **tres**, ya filtrados por `momentoDeVenta()` —
  la MISMA cabeza que elige las dos secuencias y el acuse nocturno. El seam que da el momento sin
  tocar el catálogo de plantillas es `estadoDeLaVenta()` (`sugerencias/consultarSugerencias.ts`):
  hoy en producción no hay ni una plantilla cargada y el bloque tiene que funcionar igual.
- **No son plantillas y no envían**: tocar un dato lo pone en el composer (regla de #45). El botón no
  dice «Mandar» a propósito.
- **El catálogo es editable** (tabla `hechos`): `POST`/`PUT`/`DELETE` sobre `/api/hechos`. Lo que
  cierra ventas cambia, y agregarlo no puede costar un deploy. `hechos/catalogo.ts` es el punto de
  partida medido; se siembra con `cd server && npm run hechos:sembrar -- --aplicar` (sin `--aplicar`
  es dry-run). **Sin la migración aplicada degrada**: sirve el default y avisa que no se puede editar.
- **Y desde el 4-ago se edita DESDE LA APP**: `src/features/hechos/PantallaHechos.tsx`, que se abre
  con **«Ver todos»** en el bloque del panel — la puerta va donde está el anuncio (ADR 0016). Acá
  decía solo «`POST`/`PUT`/`DELETE`» y era la verdad entera: la API existía desde #153 con **cero
  consumidores en el front**, así que el catálogo se mantenía por SQL a mano.
  Lo que la pantalla hace y una lista no puede: **decir qué llega a verse**. El panel muestra
  `TOPE_HECHOS` (3) por momento, y medido el 4-ago en prod había **27 activos** con 21 sin momentos
  y las 13 frases de plata en `orden = 100` (el default del schema) — o sea que **precio y dónde
  pagar no aparecían nunca**, y mirando la lista eso no se ve. Cada fila dice `n/6` o **«no se ve»**.
  · El recorte lo calcula el SERVER (`vistaPreviaPorMomento` en `hechos/elegir.ts`, la misma función
    que recorta en el panel) y viaja en `vistaPrevia`. **No se reimplementa en el navegador**: dos
    cabezas divergen y la pantalla afirmaría «esto se ve» sobre algo que la vendedora no ve (#37).
  · `GET /api/hechos/catalogo` sirve **también lo apagado** (`leerCatalogoParaEditar`), o no habría
    cómo volver a prender nada: «borrar es apagar» y `leerCatalogo` filtra por `activo`.
  · La **`clave` es la identidad y no se edita**: es contra lo que se estampa la procedencia de cada
    envío (`hecho:<clave>`, ADR 0022). Se propone desde el rótulo al crear y después se congela.
- Ver el catálogo que se serviría, sin base ni red: `npx tsx src/scripts/imprimirHechos.ts`.
  Y la pantalla, sin base ni Cerberus: `node scratchpad/api-hechos.mjs` +
  `VITE_API_URL=http://localhost:4199 npx vite --port 5199` → `/galeria-hechos.html`.
- **Follow-up declarado**: la objeción #1 del informe es el **aplazamiento** (13%, «avisame para la
  próxima edición») y no hay mecanismo para capturarla. Acá solo entra la frase; la lista de espera
  real es un frente propio.

## Plantillas-secuencia — «varios mensajes, con imágenes y todo en orden»

Una plantilla es una **lista ordenada de pasos** (tablas `plantillas` + `plantilla_pasos`), no un
texto: la venta real son cuatro mensajes (flyer → seguimiento → temario → duración) y el 42 % lleva
imagen. UI en `src/features/plantillas/`, colgada del `···` («Mensajes predeterminados»).

- **No hay un endpoint que mande la secuencia entera.** `POST /api/plantillas/:id/enviar-paso` manda
  **un** mensaje por llamada; el bucle, el espaciado (1,5 s) y el botón de cancelar viven en la
  pantalla de la vendedora (`useEnvioSecuencia.ts`). Si cierra la app, no queda nada mandándose solo.
  Todo sale por `EnvioControlado` vía `whatsapp/enviarYProyectar.ts` (mandar + persistir el saliente,
  el par que ninguna ruta puede hacer a medias).
- **Cancelar no des-envía**: el que está en vuelo sale. La máquina pura (`secuencia.ts`) distingue los
  dos momentos del corte y cuenta distinto («salieron 2 de 4» vs «1 de 4»). Decir de más sería mentir.
- **Dos guardas**: una plantilla `propuesta` **no se manda** (alguien la aprueba primero) y un paso con
  imagen pendiente tampoco (no se manda medio mensaje).
- **`{nombre}` `{curso}` `{precio}`** se resuelven en el SERVER al preparar/enviar. `{precio}` sale de
  Cerberus en el instante, por **familia de curso** (#129: prefijo de SKU → última edición activa), y
  si falta la moneda queda el hueco `[precio]`. Nunca un número cacheado (el caché de IndexedDB
  rehidrata precios de ayer, ADR 0007).
- **Sembrar desde el histórico**: `cd server && npm run plantillas:proponer [-- --dias 14]` (dry-run) ·
  `-- --aplicar <vendedoraId>` las guarda **como propuestas**. El minado propone, una persona aprueba.
  El minado **infiere la familia de curso** del propio texto (el flyer dice de qué diploma habla) y
  **no parte el saludo por la hora del día**: «buenos días» y «buenas tardes» son el mismo primer
  paso, y separarlos era lo que impedía que la secuencia de dos pasos —saludo, después flyer—
  apareciera nunca (ADR 0019).
- **Las propuestas se revisan DESDE LA APP** (ADR 0019): bloque **«Para revisar»** arriba de la
  pestaña Enviar del panel derecho (`plantillas/RevisionPropuesta.tsx`), con el respaldo en criollo
  («418 conversaciones usaron esto»), los pasos tal como están guardados y tres salidas: **Aprobar ·
  Editar antes · Descartar**. Se lee **sin conversación abierta y sin Cerberus**: la vista previa con
  `{precio}` resuelto necesita las dos cosas, y hacer depender la revisión de eso era por qué no se
  podía aprobar nada.
  - Una propuesta minada **es del equipo**, no de la vendedora bajo cuyo id corrió el script (verla
    es seguro: no se puede mandar). **Aprobarla es hacerse cargo**: pasa a ser suya. Una aprobada de
    otra vendedora sigue siendo privada.
  - **No se aprueba sin resolver el curso**: confirmar la familia inferida, elegir otra, o marcar
    «sirve para cualquier curso» a propósito. Omitir la clave en el body ≠ mandarla en `null` — lo
    primero es silencio y responde **409 `falta_familia`**. La regla es pura: `plantillas/aprobacion.ts`.
    Una imagen pendiente **no** bloquea aprobar (sí mandar).

## El lazo de resultados — de qué pieza salió y qué pasó después (#169, ADR 0022)

`envios_wa` guardaba qué se mandó y nunca **de qué pieza**, y nada guardaba **qué pasó después**: una
plantilla con 500 usos y 0 ventas se veía idéntica a una con 500 usos y 50. Server en
`server/src/procedencia/` (el hecho que se escribe) + `server/src/resultados/` (el veredicto que se
deriva). **Frente 1 de la épica #169**; el frente 2 (un catálogo con bases y deltas) tiene su diseño
en **ADR 0025** —aprobado el modelo, sin schema todavía— y el 3 (el puente con Ivi) no está.

- **La procedencia viaja en la ORDEN de envío**, no en un `update`: misma puerta (`EnvioControlado`),
  misma fila. Por eso un envío **bloqueado** también deja escrito de qué pieza iba a salir. Seis
  columnas nuevas en `envios_wa`, armadas **solo** por `procedencia/pieza.ts`: `pieza_clase`
  (`plantilla`·`hecho`·`acuse`·`gancho`) · `pieza_ref` · `pieza_version` · `pieza_via` ·
  `pieza_editada` · `momento_venta`.
- **EL VOCABULARIO Y LA RECETA DE VERSIÓN VIVEN EN `server/src/piezas/`**, no acá — es el **mismo
  módulo que importa el catálogo que Ivi consulta** (PR #173). Ivi recomienda una pieza del
  catálogo y el valor de todo el frente está en encontrar esa pieza en `envios_wa`:
  con dos vocabularios el join da **cero filas, en silencio**, y eso se lee como «esa pieza no se
  usó nunca». (`hecho:cuotas@sha256:…` es cómo la nombra Hermes en un reporte; el payload de Ivi es
  `{id, version, orden, gancho_id}` y **no lleva la clase** — que Ivi la devuelva es un punto de
  contrato todavía abierto, anotado en `piezas/direccion.ts`.)
  `piezas/direccion.ts` define `{clase, id, orden?}` y su forma textual (`12#3` es el
  paso 3 de la plantilla 12: el paso se direcciona **dentro** de su secuencia porque
  `plantilla_pasos.id` no es estable); `piezas/version.ts` es la única receta.
  **Los candados**: `piezas/vectores.ts` fija versiones y refs **literales** que los dos frentes
  afirman desde su lado (`procedencia/paridad.test.ts`), y `piezas/receta-unica.test.ts` falla si
  aparece un `createHash` nuevo sin justificar — la lección de #37, aplicada antes de pagarla.
- **`null` es la LÍNEA DE BASE, no un hueco**: lo que la vendedora escribió a mano es contra lo que se
  compara todo. El tipo tiene dos ramas nombradas (`A_MANO`), no `Pieza | null`, y esa fila sale
  **primera** en el reporte. Además es el **semillero de piezas nuevas** —«se puede en 2 cuotas» la
  improvisó una persona, no salió de ninguna plantilla— y por eso `HechosDeUnEnvio` lleva el `texto`:
  el corpus del frente 3 puede salir sin tocar el schema.
- **`(clase, ref)` es la identidad, `via` es la pantalla.** Textual y no una FK **a propósito**:
  cuando el frente 2 unifique los catálogos, esto se remapea y lo acumulado sigue valiendo. `via`
  (`panel-sugerencia`·`panel-secuencias`·`panel-datos`·`automatica`·**`bot`**, esta última desde F3:
  el bot conversacional eligiendo la pieza solo — separada de `automatica`, que es del acuse
  nocturno, para poder preguntar «¿el bot elige mejor o peor que una persona?») no la toca el frente 2, porque
  unificar catálogos no cambia por dónde entró la mano. Sin las dos, una de estas dos preguntas
  queda sin respuesta: «¿la secuencia 12 funciona?» y «¿las dos respuestas del panel sirven?».
- **La VERSIÓN es un `sha256:` + 16 hex del contenido AUTORAL**, y es ahora o nunca: sin ella,
  mejorar una frase suma los dos textos y una pieza que pasó de 12 % a 30 % se reporta 21 % para
  siempre. Hash y no contador porque un contador **se puede olvidar de incrementar** y el bump que
  falta mezcla dos textos en silencio. **El texto de la pieza es la plantilla SIN resolver**
  (`{nombre}`/`{precio}` se resuelven por contacto: hashear el mensaje final haría de cada
  destinatario una versión). **El archivo entra** —cambiar `flyer-julio.jpg` por
  `flyer-agosto-PRECIO-NUEVO.jpg` es versión nueva, porque en Goberna el precio vive adentro de la
  imagen y el 42 % de la secuencia lleva una—; CRLF y bordes, no. El hash lo hace el **server** —
  del navegador no viaja ningún hash, y hay un test que lo verifica.
  `null` significa **una sola cosa**: no se pudo determinar el contenido. Un contenido vacío tiene
  versión.
- ⚠️ **HAY DOS PUERTAS AL MISMO `envios_wa`, y la del composer no puede calcular la versión.**
  `POST /api/plantillas/:id/enviar-paso` estampa desde la fila; pero cuando la vendedora toca la
  sugerencia, la edita en la caja y manda por `POST /api/whatsapp/enviar`, lo único que el navegador
  puede declarar es el texto **ya expandido** con el `{nombre}`/`{precio}` de esa persona, y nunca
  el nombre del archivo (la API le manda `conImagen: boolean`). Versionar con eso daba **una versión
  por destinatario y ninguna que casara con el catálogo** — cero filas, en silencio, justo para el
  paso del flyer. Por eso una `plantilla` se versiona releyendo `plantilla_pasos`
  (`procedencia/desdeElComposer.ts`, lector inyectado) y un `hecho` sigue versionándose por el texto
  de la caja, que ahí ES el del catálogo. Sin fila que leer, `version: null` — nunca una inventada.
- **El resultado se DERIVA, nunca se guarda** (como ADR 0013/0014/0015): ¿contestó? · en cuánto ·
  ¿avanzó de etapa? · ¿hubo venta después? El SQL **solo trae hechos crudos** (ni un `CASE`, ni una
  ventana, ni un umbral) y el veredicto + el agregado son puros: no hay segunda implementación que
  pueda divergir. El candado es `consultarResultados.test.db.ts` — el agregado tiene que ser
  exactamente la suma de los veredictos puros.
- **LOS NOMBRES NO PROMETEN CAUSA.** Que una venta siga a un mensaje no dice que la causó.
  `huboRespuesta` · `huboAvanceDeEtapa` · `huboVentaDespues`, y la `base` de cada medición es
  `respondio_despues_de` — **nunca «efectividad»**. `medicion.test.ts` falla si alguien mete una
  palabra causal, como `plantillas.test.ts` prohíbe que un acuse se anuncie como máquina.
- **Ninguna métrica se puede serializar sin su `n` ni su `base`**: son campos requeridos de
  `Medicion` y `medir()` es el único constructor — el tipo lo impide, no una convención. Cada una
  lleva su **intervalo de Wilson al 95 %** y `muestraSuficiente` (`MUESTRA_MINIMA` = 30), porque 2/3
  (67 %) **no** le gana a 180/400 (45 %).
- **LA RESPUESTA ES DEL ÚLTIMO MENSAJE**, no de todos los anteriores. Sin esa regla, en una
  conversación de cuatro salientes la misma respuesta se cuenta cuatro veces: medido sobre un corpus
  con la forma real, **22 % sembrado salía 54 %** — y el inflado crece con la longitud de la
  conversación, o sea que premia a las piezas usadas donde la gente ya iba a contestar.
- **«¿Compró?» depende del PR #165** y todavía no está: `resultados/ventas.ts` es el seam. Con
  `conversiones_wa` vacía responde **`null` = «no lo sabemos», nunca `false`**. Cuando #165 entre,
  cambia el `WHERE` de una consulta en ese archivo y nada más.
- **Cómo se ve**: `GET /api/resultados/piezas?dias=30` (detrás de `requiereVendedora`) y
  `cd server && npm run piezas:resultados [días]` (read-only), los dos sobre el mismo seam. **No hay
  pantalla a propósito**: la procedencia se acumula recién desde este deploy y el frente 2 va a
  reorganizar el catálogo — la vista se dibujaría dos veces. Ojo con la lectura: las primeras semanas
  el corpus va a ser casi 100 % línea de base, y las cuatro frases de #153 no llegan solas a muestra
  decidible (a 2 de cada 1.876 conversaciones, `n = 30` pide ~28.000). **La primera pregunta que esto
  responde no es «¿cuál funciona?» sino «¿alguien las está usando?».**

## Interés derivado del anuncio — el lead ya llegó diciendo qué quiere

`server/src/cursos/` traduce el texto con el que llegó la persona (la campaña del anuncio de
Click-to-WhatsApp, el curso del formulario que llenó) a una **familia de curso** y lo propone en la
ficha: «📣 Inteligencia y Contrainteligencia · del anuncio [Confirmar]» (#102/#129).

- **Se deriva, no se guarda**: la propuesta se calcula en cada consulta y viaja en `derivados` dentro
  de `GET /api/gestiones/intereses` — misma decisión que las señales (ADR 0015). **Lo único que
  escribe una fila en `intereses` es el clic humano** en `POST /api/gestiones/intereses/derivado`.
- **Precedencia** (la de #72, no se reinventa): interés registrado > curso del formulario > campaña
  del anuncio. Sin alias que matchee **no se inventa**: se muestra el título crudo, sin botón.
  Vive **una vez**, pura, en `cursos/precedencia.ts`, con su gemelo en SQL en `cola/cursoSql.ts` para
  las consultas que agrupan — y un **test de paridad** que falla si se separan
  (`dashboard/curso.paridad.test.db.ts`, ADR 0019). El Dashboard por curso **consume esos
  fragmentos**; hasta el 26-jul tenía los suyos y decía «97 % sin curso identificado» mientras la
  cola le pintaba el chip a casi todas las filas.
- **El diccionario vive en la base** (`alias_curso`, editable sin deploy) y nace sembrado con
  `ALIAS_SEMILLA` (`cursos/alias.ts`, idempotente y sin pisar lo editado a mano). Para sacar un alias
  de circulación: `activo = false`, nunca DELETE.
- **Hay alias por TEXTO y alias por `adId`** (ADR 0019). Los anuncios genéricos —«Adquiérelo ahora»,
  «No lo dejes pasar», «FORMA PARTE»— no nombran ningún curso, y mapear esas frases le heredaría el
  curso equivocado al próximo anuncio con el mismo copy: se mapean por su `adId`
  (`origen.adId`), que es lo único que los identifica. Una fila con `ad_id` **no se busca por texto**,
  y un mapeo por anuncio le gana al título (lo afirmado sobre lo inferido).
- **La red anti-gap**: `CAMPANAS_CON_VOLUMEN` (medido contra prod) + un test que falla si una campaña
  con volumen se queda sin familia. Para encontrar los que faltan: `cd server && npm run cursos:gaps`
  (solo lectura; lista anuncios y campañas sin mapear, con su `adId` listo para cargar).
- **Lo que se registra es el nombre CRUDO del producto de Cerberus** (la última edición activa de la
  familia, resuelta contra el catálogo vivo al confirmar), no el nombre corto del chip: `intereses.curso`
  es lo que después se cotiza. Falla ruidoso (502/409), nunca inventa un nombre parecido.
- **La compuerta de Cotizado no se relaja, se satisface**: el modal llega con el curso preseleccionado
  y confirmar completa el arrastre.

## Ex-clientes en la cola — el padrón en copia local (#133)

De las **1.997 conversaciones vivas**, las de gente que YA COMPRÓ se veían igual que un desconocido.
El dato existía —`cerberus/ficha.ts`— pero se pedía **por HTTP, de a una, al abrir la conversación**:
1.997 llamadas para pintar un listado, contra un Cerberus que a veces se cuelga (de ahí el techo de
12 s del panel). Por eso nunca estuvo en la fila.

> ⚠️ **Las cifras de 140 / 7% que este archivo traía eran del contador heredado, no de ventas
> reales.** Medido el 27-jul-2026 contra Cerberus, de las 128 marcadas **78 tenían compras** y 49
> tenían ficha con cero ventas. Ver el punto de `n_purchases` más abajo.

- **El padrón se SINCRONIZA**: `cd server && npm run clientes:sincronizar` (`--dry-run` no escribe).
  Lee **`icarus.contacts`** —icarus recibe el webhook de Cerberus en cada venta— con la conexión
  read-only `ICARUS_DATABASE_URL`, y guarda en **`clientes_padron`** lo MÍNIMO: sufijo del teléfono,
  código de país, compras y nivel. **Nombre, correo, DNI y monto NO se copian** (para eso está la
  ficha viva). Es derivada y descartable: se puede truncar y volver a sincronizar.
- 🔴 **`n_purchases` NO ALCANZA: se exige una venta que lo respalde** (`EXISTS` sobre `icarus.sales`).
  Medido el 27-jul-2026: de **10.504** contactos con `n_purchases >= 1`, **5.805 (55%) no tienen ni
  una fila en `icarus.sales`** — y 5.466 de ésos son `crm_import` **sin `goberna_app_id`**, o sea que
  ni siquiera están vinculados a un cliente de Cerberus. Ese contador lo copió verbatim el import de
  `leads_crm` (`apps/api/scripts/import-contacts.ts` del repo icarus) y nadie lo volvió a calcular:
  `refreshContactPurchaseStats` sólo corre cuando entra una venta por webhook. Cerberus lo confirma
  desde el otro lado — de 50 conversaciones marcadas así, **49 tenían ficha con `ventas_count: 0`**,
  varias marcadas **VIP con 5 compras**. Por eso la vendedora veía «Cliente» sin una sola compra que
  mostrarle (49 de 128). Con el chequeo, el chip «Ya compraron» pasa de **128 a ~78** y todos los que
  quedan tienen compras que enseñar. **Sin `icarus.sales` visible degrada** (se comporta como antes y
  lo dice), porque «no se pudo preguntar» no es «no hay».
- **Desmarcar es parte del trabajo**: el upsert pisa lo que sigue calificando pero **no toca lo que
  dejó de calificar**, así que `proyectarLote` devuelve `aBorrar` con los `cliente_id` que perdieron
  el respaldo y `sincronizarLote` los borra. Sin eso, las 5.805 filas ya escritas sobrevivían al
  arreglo. Es un DELETE acotado por id, no un TRUNCATE: no reabre la ventana de ceguera.
- **La jerarquía vive una vez**, pura, en `clientes/nivel.ts` (`vip` · `recompro` · `compro`) y se
  **congela** en la tabla al sincronizar. El SQL de la cola **no recalcula**: lee la columna. No hay
  segunda escritura que pueda divergir (la lección de #37) — el precio es que cambiar la regla obliga
  a re-sincronizar.
- **El match** (`cola/clienteSql.ts`) es el sufijo de 9 dígitos de siempre (`sufijoTelefonoSql`) **más
  una guarda de país**: el sufijo asume que todos son peruanos y casi 2 de cada 3 clientes no lo son
  (MX 1.987 · EC 1.981 · GT 393). Con largos nacionales distintos, un mexicano de Veracruz y un
  peruano comparten sufijo (**falso positivo**) y un guatemalteco guardado en local nunca llega a 9
  dígitos (**393 clientes invisibles**). Se arregla normalizando a E.164 antes de sacar el sufijo y
  exigiendo que el teléfono de la conversación empiece con el código de país del padrón. Sin país
  conocido, el match es el de siempre y el script **imprime cuántas filas quedaron así** (#119).
- ⚠️ **LA MARCA DE LA FILA Y LAS COMPRAS DEL PANEL SALEN DE DOS FUENTES DISTINTAS**, y por eso «dice
  Cliente pero no muestra compras» tiene **tres** causas que en pantalla se ven igual. La fila cruza
  contra `clientes_padron` (padrón de icarus, sufijo + guarda de país); el panel le pregunta a
  **Cerberus en vivo** (`cerberus/ficha.ts`, `buscar/?q=` → `telefonos__numero__icontains`).
  **(A)** el número no se podía buscar así: la guarda de #119 se había aplicado al padrón y **no** a
  la búsqueda de Cerberus, que seguía con `slice(-9)` — para un local más corto que 9 (GT 8, BO 8,
  PA 8…) esa cadena arranca adentro del código de país y el `icontains` **no puede dar verdadero
  nunca**. **(B)** Cerberus tiene a esa persona con otro teléfono. **(C)** el padrón afirma de más:
  `icarus.contacts.n_purchases` se deriva de `icarus.sales` sólo cuando corre
  `refreshContactPurchaseStats`; para las 59k filas del import de `leads_crm` viene **verbatim del
  dump viejo**, sin venta de Cerberus que lo respalde.
  **Cuál pesa cuánto se mide, no se supone**: `cd server && npm run clientes:auditar [-- --cerberus]`
  (solo lectura) reparte las conversaciones marcadas entre las tres.
- **La partición del teléfono vive UNA vez**: `server/src/telefono/paises.ts` (`partirE164`,
  `variantesLocales`, `mismoTelefono`). La tabla de países era privada de `clientes/padron.ts` —de
  ahí que el otro lado de la comparación no pudiera usarla—. `variantesLocales` termina **siempre**
  con el sufijo de 9, así que nada que hoy matchea deja de matchear; y como ensanchar la búsqueda
  sin verificar cambiaría el falso negativo por un falso positivo, `ficha()` **confirma el candidato**
  contra los `telefonos[]` del detalle antes de darlo por bueno (`mismoTelefono`, estricto: compara
  país **y** local, y ahí el mexicano de Veracruz deja de ser el peruano del mismo sufijo).
- **Solo WhatsApp**: en Messenger `persona_id` es un PSID y sus últimos 9 dígitos podrían chocar con
  un teléfono real.
- En la UI: píldora en la fila (tres pesos del **verde** que ya significa cliente en el panel, ADR
  0017 — **sin oro**), chip **«Ya compraron»** en la barra de filtros con su número, y la banda del
  panel se pinta de entrada («Ya te compró. Confirmando con Cerberus…») en vez de un spinner.
- **Degrada** si la migración no está aplicada: la cola se sirve sin la marca y lo dice (`sinPadron`).

## Administración de números (para Cerberus)

`/api/admin/*` (`server/src/routes/admin.ts`), detrás de **`requiereServicio`**
(`server/src/auth/servicio.ts`): credencial de servicio `HERMES_ADMIN_SERVICE_TOKEN`, Bearer estático,
familia aparte del HMAC de vendedora (issues #50/#95). Lo consume **Cerberus** (el panel), que es la
fuente de verdad del mapa número↔vendedora y lo **empuja** acá; Hermes guarda la copia (`numeros_wa` +
`numero_vendedora`) que necesita para etiquetar/rutear, y ejecuta la vinculación (el QR sale por acá; la
sesión nunca deja VPS1). Endpoint central: `PUT /api/admin/numeros/:numero` (upsert declarativo,
`vendedoras[]` reemplaza el set). Contrato de los dos lados en **`docs/multi-numero/`**; decisión en
**ADR 0010**.

> ⚠️ **Acá decía «el mapa es solo etiqueta/atribución: la cola NO se filtra por vendedora», y desde
> el 1-ago-2026 la cola SÍ se puede acotar a las líneas propias.** Lo que NO cambió es la naturaleza
> de la decisión de Estephano del 24-jul: sigue siendo **un FILTRO, no un permiso**. La cola es una
> sola pantalla compartida y cualquier vendedora puede ver cualquier conversación; «Las mías» acota
> lo que se MIRA, no lo que se puede mirar.
> **Y no puede ser un permiso**, porque Hermes no tiene modelo de permisos: `requiereVendedora` dice
> «es una vendedora», no «cuál», y el hilo, la ficha y el envío siguen sirviendo cualquier
> conversación a cualquier token. Un recorte de cola presentado como frontera sería una frontera
> imaginaria — peor que ninguna, porque se le cree.
> Cómo se pide: **`GET /api/conversaciones?mias=1`** (el server resuelve `numero_vendedora` para el
> token; si el front mandara los números habría dos lugares decidiendo cuáles son «las mías»). La
> regla vive pura en `server/src/cola/lineas.ts` y es **FAIL-OPEN**: sin filas asignadas se sirve
> TODO y la respuesta lo dice (`sinLineasPropias`), porque una vendedora que abre una cola vacía no
> lee «no tenés líneas», lee «se perdieron las conversaciones». En la UI es una opción más del
> segmentado de línea (`BarraFiltros`), y **solo aparece si el mapa le asigna alguna** —
> `GET /api/whatsapp/lineas` trae `mias` por línea.

> ✅ **El ruteo multi-número YA ESTÁ VIVO** — acá decía «issue #50, todavía pendiente» y es falso.
> Medido en VPS1 el 29-jul-2026: **tres líneas vinculadas y corriendo** (`.wa-sessions/` tiene un
> `.db` por número y `numeros_wa` tiene sus tres filas), y prod corre justamente un fix de #50
> («una línea que no arranca ya no se lleva puesto el proceso entero»). `WHATSAPP_NUMEROS` es el CSV
> que las levanta; `WHATSAPP_NUMERO` quedó como el singular viejo.
> Consecuencia práctica, y por eso se escribe acá: **agregar una CUARTA línea de prueba no es
> infraestructura nueva** — es el mismo camino que ya levantó las tres (`wa:vincular`, una sesión
> propia en disco, una fila en `numeros_wa`). Lo que un banco de pruebas sí tiene que resolver es lo
> OTRO: que esa línea no comparta ni la base ni el Cerberus de producción.

- **El vinculador es UNO A LA VEZ y por eso se puede soltar**: `POST .../vincular` arranca (responde
  `vinculando`, **el QR NO viene acá**: viaja en el polling de `.../vincular/estado` como
  `esperando_qr`) y **`DELETE .../vincular` cancela**. Sin esa puerta, una vinculación que nadie
  escaneó bloqueaba a todos los demás números hasta reiniciar Hermes — o sea tirando las sesiones de
  las vendedoras para destrabar un QR. Cancelar es idempotente (`cancelada: false` si no había nada)
  y cancelar la de OTRO número es 409, nunca un silencio.
- **El candado lo toma SOLO un pareo en vuelo** (`esPareoEnVuelo`: `esperando` · `qr`). Los tres
  terminales no: su cliente ya está cerrado o muerto, e `iniciar()` arranca cerrando. **El que
  mordía era `conectado`** — al terminar bien, `cerrar()` suelta el cliente pero el estado se queda
  ahí, así que **después de una vinculación EXITOSA el próximo número nuevo comía 409 para
  siempre**. El éxito bloqueaba tanto como la falla, y se veía como «no puedo vincular números
  nuevos».
- **Un pareo en vuelo que dejó de dar señales ya no toma el vinculador** (`VIGENCIA_QR_MS`, 60 s):
  whatsmeow rota el QR cada ~20 s mientras el canal de pareo vive; cuando se cierra, deja de llegar
  y el último se quedaba en pantalla para siempre —imposible de escanear— **y encima bloqueando**.
  Vale también para `esperando`, porque un `client.init()` colgado no deja ni un QR que envejecer.
  La regla vive pura en `numeros/dominio.ts` (`estadoVinculacionVigente`, reloj inyectado), no
  adentro del vinculador: el caso que importa es el minuto que todavía no pasó.

## La atribución de ventas — la conversación se vuelve plata

`server/src/atribucion/`. **Un solo proyector** (`proyectarVenta`) y tres caminos que lo llaman: el
webhook de Cerberus (`webhook/ruta.ts`), la venta que la vendedora registra desde el chat
(`asentarVentaEnEmbudo`) y el **puente temporal** (`npm run ventas:sincronizar`). El detalle
completo, lo medido y el pedido a Cerberus: **`docs/atribucion-de-ventas.md`** (issue #161).

- **La llave es determinista, no un match**: la conversación viaja a Cerberus dentro del
  `venta_request_key`, se guarda en `Venta.idempotency_key` y **vuelve** en el webhook
  (`atribucion/llave.ts`). Techo duro de **64 caracteres**; si no entra, cae a la llave vieja —
  nunca truncada. Adivinar por teléfono es el respaldo, y tiene techo medido: **2,1 %** histórico.
- **Cascada etiquetada**: `llave` › `telefono_e164` › `telefono_sufijo`. El sufijo de 9 dígitos es
  **débil** (#119): de 143 matches, 29 tienen otro E.164. Queda marcado aparte a propósito.
- **Nada se pierde y nada se infla**: lo atribuido va a `conversiones_wa` (lo que el CRM lee), lo que
  no, a **`ventas_no_atribuidas`** con su motivo. Tabla aparte porque `conversiones_wa` la cuentan
  entera como ventas tres consultas vivas — meter ahí las 6.800 ventas del ERP convertiría el panel
  de la vendedora en el reporte de Cerberus.
- **`ontologia.conversiones` NO es un schema muerto**: es el outbox del CAPI y `lazo/worker.ts:87`
  lo consulta para no mandar dos veces el mismo `Purchase`. Se queda donde está.
- **El puente es temporal y se apaga solo**: lee `icarus.cerberus_events` (read-only) y pasa los
  payloads por el MISMO camino que el webhook. **icarus no es el espejo de Cerberus** — es la
  plataforma multi-tenant de los clientes de consultoría y sirve a un cliente real. El día que
  Cerberus haga fan-out se deja de correr el script; no hay una línea que tocar.
  🚨 **Nunca repuntar `ICARUS_CERBERUS_WEBHOOK_URL`**: eso rompe producción de un cliente. Fan-out.

## «Es la misma persona que…» — la unificación de contactos

La misma persona escribe desde dos números, o desde WhatsApp y desde Instagram. La vendedora lo
afirma desde la ficha y **se une la FICHA, no los hilos**: la clave `conv:<canal>:<persona>:<numeroPropio>`
no se toca, la cola no cambia. Server en `server/src/identidad/`, UI en `src/features/identidad/`,
ruta `/api/enlaces` (`GET` grupo · `POST` enlazar · `DELETE` deshacer), detrás de `requiereVendedora`.
Decisión completa en **ADR 0017**; issue #58.

- **El puente** es `identidadDeClave` (`identidad/clave.ts`, puro): la clave del CRM se traduce a una
  identidad de canal **`wa_id` / `ig_user` / `psid`** (DÉBIL), nunca a `email`/`telefono`. El **número
  propio de Goberna se cae del identificador**: quien le escribe a dos números nuestros es un solo
  humano y su ficha se une sola. Un comentario suelto (`int:<id>`) **no es enlazable**.
- **La persona se crea perezosamente**, al enlazar. Leer una ficha JAMÁS escribe en el grafo.
- Enlazar es una **estrella** (dos identidades → una persona): simetría, idempotencia y «sin ciclos»
  salen de la forma del grafo, no de código defensivo. Techo de 10 identidades por persona.
- **Deshacer revoca, no borra** (`revocado_*` + índice parcial `vinculos_identidad_activo_uq`).
- ⚠️ **El rebuild de `ontologia/poblarIdentidad.ts` ya NO borra los enlaces manuales** (era una bomba
  anunciada en su propio comentario). Borra `WHERE regla <> 'manual'`, borra identidades por orfandad,
  y el derivado **cede** ante lo que una persona afirmó. Además los dos mundos usan espacios de nombres
  disjuntos, así que no hay fila que los dos quieran escribir. Fijado por `poblarIdentidad.test.db.ts`.
- **No hay cambio de schema**: `db/ontologia.ts` no se tocó y esas tablas ya existen en VPS1 (vacías).

## Deploy

**VPS1** (`deploy@161.132.39.165`), en `/srv/hermes`: servicio systemd `hermes` (PORT=4110), Postgres
propio `hermes_db` (127.0.0.1:5438), API pública **`https://hermes-api.goberna.us`** (nginx + certbot
dns-cloudflare; el 4110 no se expone), número 51986394450 vinculado ALLÁ.

**Hay CD, en cinco niveles** (`docs/despliegue-continuo.md`; ADR 0021 y 0022). Todo corre en el
**runner self-hosted de VPS1** (label `vps1-hermes`, servicio
`actions.runner.Goberna-Lab-hermes.vps1-hermes`, dir `~deploy/actions-runner-hermes`), que es uno
solo: los jobs se serializan.

| | Qué | Cuándo |
|---|---|---|
| **N1** | lint · typecheck · journal monótono · migraciones expand-only | toda corrida |
| **N2 / N2b** | build · tests puros · secretos · tests con base | toda corrida |
| **N3** | **staging** (`/srv/hermes-staging`, `:4111`, base propia en `:5440`): despliega, migra y corre el smoke funcional | push a `main` |
| **N4** | front a producción, sin restart — cero downtime | solo si N3 pasó |
| **N5** | server a producción: respalda, migra, reinicia, smoke, revierte solo si falla | **botón** en Actions |

N5 es un botón por prudencia: desde ADR 0027 reiniciar ya **no** tira las sesiones de Cerberus
(persisten en `sesiones_cerberus`), pero un restart en horario de venta sigue mereciendo un humano
mirando. El trabajo lo hace
**`deploy/vps1/hermes-deploy.sh`** —versionado, no YAML— y es la misma pieza que corre por SSH:
`ssh … 'sudo hermes-deploy --dry-run | --rollback'`. `tauri-windows.yml` sigue aparte: necesita host
Windows.

**El smoke del deploy verifica los ASSETS, no solo el bundle**
(`deploy/vps1/verificar-assets.sh`, corre en N4 y N5). Comparar el hash del `index-*.js` prueba que
el bundle nuevo está y nada más: un asset que falta no lo mueve. El 7-ago-2026 la compresión de
video salió sin sus 32 MB de wasm y el deploy estuvo verde. 🔴 **Y no alcanza con mirar el código
HTTP**: el fallback SPA devuelve `index.html` con **200** para cualquier ruta, así que un `curl -f`
a un archivo inexistente PASA — se compara **content-length contra el disco**, con una ruta
inventada como control. El script **falla si no verificó ningún asset**: su primera versión usaba
`find -printf` (que no existe en macOS) con `2>/dev/null` y daba «0 verificados · 0 fallos» en
verde, o sea el mismo falso verde que viene a atrapar.

⚠️ **N4 termina en `success` TAMBIÉN cuando decide NO desplegar** (porque el cambio toca `server/`).
Es correcto no desplegar, pero se lee igual que haber desplegado — confundió dos deploys seguidos.
Desde el 7-ago el Resumen lo distingue: **«⏭️ no aplica (toca server/: va por N5)»**. Consecuencia
que no es obvia: **un PR que toca `server/` deja el FRONT sin desplegar también**, y hace falta N5
para las dos mitades.

**El schema va en migraciones versionadas**, no en `db:push` (ADR 0021). Al tocar `src/db/*.ts`:
`npm run db:generate` → `goberna-journal-set-when` → commitear `server/drizzle/` completo. Cómo y por
qué: **`docs/migraciones.md`**. Runbook del server: **`docs/deploy-vps1.md`**.

**La app de las vendedoras se EMPAQUETA**, no se clona: `env VITE_API_URL=https://hermes-api.goberna.us
npm run empaquetar:mac` (que es `tauri build`, y corre el build del front solo por
`beforeBuildCommand`) → `src-tauri/target/release/bundle/dmg/`. **El `.exe` NO sale de acá**: Tauri
no cross-compila y lo hace `tauri-windows.yml` en un runner Windows, a mano.

## Flujo de trabajo

`main` es **producción**: no se commitea ni se pushea directo. El camino es **rama + PR + CI verde**,
y el merge va con **rebase** (historia lineal, se preservan los commits del PR).

- **Ramas**: `feat/`, `fix/`, `chore/`, `docs/` + descripción corta.
- **Commits por unidad de trabajo**: cada uno se lee solo y explica *por qué*, no *qué*.
- **Tracker**: GitHub Issues de `Goberna-Lab/hermes`. Labels `vista:*` (dashboard · pipeline ·
  contactos · mensajes · correos · agenda), `transversal`, `rediseño`, `infra`, `datos`, más los de
  triage (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`).
- **`git push` a `main` está bloqueado** por `.githooks/pre-push`. No es protección de rama: la org
  está en plan **free** y el repo es privado, así que los rulesets de GitHub dan 403. El hook se
  instala solo (`npm install` corre `prepare`, que fija `core.hooksPath`); es una red local, no una
  garantía del servidor. Emergencia real: `git push --no-verify`.

## Agent skills

### Issue tracker

GitHub Issues de `Goberna-Lab/hermes`, vía la CLI `gh`; los issues se escriben en español y los
cierra el PR con `Closes #N`. Ver `docs/agents/issue-tracker.md`.

### Triage labels

Los cinco roles canónicos con sus nombres por defecto — ya existen los cinco en el repo, no hay
que crearlos. Ver `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` en la raíz (todavía no existe, se crea cuando `/domain-modeling` lo
gane) + `docs/adr/` con los ADR 0001–0005. Ver `docs/agents/domain.md`.

## Secretos y config (env)

Solo en `server/.env` (gitignored). **Se referencian por nombre, jamás se pegan** (regla dura #1):
`DATABASE_URL`, `META_ACCESS_TOKEN`, `CERBERUS_BASE_URL`, `HERMES_SESSION_SECRET`,
`WHATSAPP_TRANSPORTE`, `WHATSAPP_NUMERO`, `WHATSAPP_APP_SECRET` (firma del webhook Cloud API,
#107 — sin él todo POST a `/webhook/whatsapp` es 403), `IVI_URL`, `IVI_SERVICE_TOKEN`,
`HERMES_ADMIN_SERVICE_TOKEN`, `HERMES_CATALOGO_SERVICE_TOKEN` (el de Ivi para leer el catálogo de
piezas — **otro secreto**, a propósito), `AUTO_RESPUESTA` (+ sus `AUTO_RESPUESTA_*`, todos con default
sensato), `ICARUS_DATABASE_URL` (read-only al Postgres de icarus: el padrón de clientes de #133 **y**
los 72.923 contactos de ADR 0035), `HERMES_SUPERVISORES` (quién ve el padrón entero **y el Dashboard
entero** — ADR 0035 + 0036; **no es un secreto, es una lista de `vendedora_id`**, pero fail-closed:
sin ella nadie es supervisor, y entonces **todas ven solo lo suyo**).
Ver `server/.env.example` (solo nombres).

## Reglas duras (Goberna)

1. **Secretos**: por nombre, nunca pegados en prompts/archivos/docs.
2. **Verificación antes de "listo"**: ningún cambio de UI o deploy se reporta terminado sin screenshot
   (Playwright, o la galería de la pieza) o `curl` a la URL viva.
3. **Toda reescritura documenta qué reemplaza** (ADR en `docs/adr/`) y archiva al predecesor.
4. **latin1 de Cerberus**: el enemigo son los **emojis**, no los acentos (á/é/ñ pasan; el emoji revienta
   el INSERT en MySQL). Sanitizar en el borde: **`server/src/cerberus/latin1.ts`** (#108). Todo POST a
   Cerberus se arma con `cuerpoParaCerberus`, que sanea cada campo — nunca a mano, campo por campo.
   El login es la única excepción, y el porqué está escrito en `auth.ts`.

## Gotchas

- **`db:push` se RETIRÓ de prod y staging** (ADR 0021). Era el que dejaba la lista de «pendientes de
  push» que este archivo llevaba a mano —y que se olvidaba—: `clientes_padron`, `hechos`,
  `alias_curso` + `ad_id`, las columnas del modo supervisado. Ahora el schema viaja en el PR como
  `.sql` versionado y el deploy lo aplica solo. `db:push` **sigue siendo lo correcto para las bases
  efímeras de test** (`montarBase.ts`): no hay datos que preservar ni historia que registrar.
  > Lo que decía acá y ya no aplica, para que nadie lo repita: que `db:push` **pregunta y sin TTY se
  > muere a mitad** (para `alias_curso.ad_id` ofrecía *truncar la tabla*, y la respuesta correcta era
  > **No**), y que **el gate de schema del workflow no se podía satisfacer** corriendo `db:push`,
  > porque comparaba el sha de `~/.hermes-despliegue/server` contra `main` y migrar la base no
  > cambiaba ese diff. Las dos cosas eran ciertas hasta el 27-jul; las dos desaparecen con las
  > migraciones versionadas, y son la mitad del motivo por el que se hicieron.
- **El `when` del journal de migraciones es un contador monótono, y falla en SILENCIO**: si una
  migración queda con un `when` menor al máximo ya aplicado, drizzle la **saltea sin error** y el
  deploy sale verde con la tabla sin crear. Pasa al mergear dos ramas que generaron una migración
  cada una. Arreglo: `JOURNAL_FILE=server/drizzle/meta/_journal.json goberna-journal-set-when`.
  `journal.test.ts` lo atrapa en N1, y `db:adoptar` lo verifica también contra la base.
- **El transporte falso repite ids entre reinicios** (`falso-1`, `falso-2`…): reprocesar colisiona con la
  idempotencia (`wa:falso-N` ya existe) y el mensaje no entra. Para demos limpias, borrar los
  `external_id LIKE 'wa:falso-%'` primero. El transporte real usa ids reales de WhatsApp (únicos).
- **whatsmeow trae binario Go por plataforma**: en el deploy linux, `npm install` baja el binario linux.
- **La cola sirve conversaciones, no filas** (`/api/conversaciones`, no `/api/interactions`): los
  mensajes se agrupan por `(canal, persona, número propio)`; los comentarios siguen individuales.

## Estado (2026-07-27)

En `main`, Hermes es un CRM completo: Dashboard radar · Pipeline con compuertas (cotizado exige
interés; cierre solo vía venta) · chat multicanal con media completa y BarraGestion · Contactos ·
Correos (falta SMTP) · Agenda-calendario.

> ✅ **Producción está al día** (verificado 27-jul, madrugada): VPS1 corre `db4aa00`, front y server
> alineados, y **el schema aplicado** (ver Gotchas). Sigue sin haber CD — el deploy es manual—, así
> que esto envejece rápido: antes de asumir que el código de `main` es lo que corre, verificalo con
> `ssh deploy@161.132.39.165 'cd /srv/hermes && git log --oneline -1'`.

**Lo que entró esa madrugada**: los 126 ex-clientes marcados en la cola (#133, con el padrón local
de 10.468 sincronizado desde icarus) · los 56 alias de curso, Foro de Estado incluido · la pantalla
para aprobar plantillas propuestas · la paridad cola↔Dashboard del chip de curso · `IVI_URL` cargada
en el entorno de prod (Ivi todavía no desplegó su endpoint, así que la ruta responde su 502 honesto).

> 🔴 **La auto-respuesta está APAGADA a propósito** (interruptor de base en `apagada`, 27-jul 01:10).
> Se prendió esa noche y se apagó a los siete minutos: los 40 borradores que preparó estaban mal de
> **siete formas** distintas, tres graves. **No la prendas sin leer el issue #166.** Nada salió —
> las 40 quedaron en `preparada`, que el despachador no ve. Lo esencial: la condición de la franja
> se evaluaba sobre `ahora` en vez de sobre cuándo escribió la persona, así que a la 1 AM calificaba
> cualquiera (25 de 40 habían escrito **dentro** del horario de atención, y todos esperaban entre 57
> y 72 horas); y las plantillas se presentaban como «un mensaje automático», contra la regla nueva
> del dueño.

> 📌 **Regla del dueño (27-jul-2026): el lead todavía NO puede saber que hay un automatismo detrás.**
> Invierte lo que `autorespuesta/plantillas.ts` documentaba como decisión de diseño deliberada. Si
> tocás plantillas o sugerencias, ese es el marco.

**La foto completa, los pendientes y el contexto: `docs/estado.md`**; la bitácora de cómo se llegó:
`docs/sesion-2026-07-21-crm-definitivo.md`.

### Tres cosas rotas que conviene saber antes de tocar nada

1. ~~Auth partida por la mitad~~ **Resuelto (#36): cerrada por perímetro** (ADR 0011):
   todo `/api/*` exige el Bearer de una vendedora por defecto — `app.use(perimetroApi)` en
   `server/src/auth/perimetro.ts`, las excepciones se enumeran ahí. Deuda trackeada: CORS sigue
   en `*` (#94) y el SDK necesita credencial de servicio máquina-a-máquina (#95).
2. ~~El orden de la cola está implementado dos veces y divergió~~ **Resuelto (#37, ADR 0009)**: la
   urgencia vive una vez en `cola/` (función pura + proyección SQL en `urgenciaSql.ts`) y el test
   de paridad `urgencia.paridad.test.db.ts` falla en CI si vuelven a divergir.
3. ~~El nivel VENCIDO no se dispara nunca~~ **Resuelto (#38)**: el radar consulta los recordatorios
   pendientes por clave (seam `cola/consultarRadar.ts`) y la agenda sube los vencidos al nivel 1;
   los tests con base fijan el cableado, no solo el cálculo.

Detalle y evidencia en `docs/arquitectura.md` §8.
