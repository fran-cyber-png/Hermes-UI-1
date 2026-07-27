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
  Contactos · Mensajes · Correos · Agenda. Marca Goberna en `src/index.css` (azul + dorado, Montserrat; el dorado significa
  **tiempo que se acaba**, nada más). El norte de producto: `docs/plan-crm-definitivo.md`.
  El **caché de consultas se persiste en IndexedDB** y se restaura antes del primer render, así la
  app abre con el último estado conocido en vez de un spinner (ADR 0007, `src/lib/datos/`).
- **Escritorio** (`src-tauri/`): **Tauri v2** — la cáscara solo abre `https://hermes-api.goberna.us`
  (OTA; fallback al dist local). Windows se compila en Actions (`tauri-windows.yml`), no cross-compila.
  `electron/` convive hasta paridad verificada y después se archiva (ADR 0003).
- **Server** (`server/`): Express 4 + Drizzle ORM + Postgres 17 (imagen pgvector, puerto **5434** en
  local) + Zod 4. Event store append-only + proyecciones.
- **WhatsApp**: `@whatsmeow-node/whatsmeow-node` (cliente de protocolo no oficial, binario Go vía
  subprocess). Ver §WhatsApp.

## Correr en local

```bash
docker compose up -d --wait                       # Postgres (event store), en la raíz del repo
cd server && npm install && npm run dev            # API en :4100 (necesita server/.env)
npm install && npm run dev:app                     # Vite :5173 + la app de escritorio (Electron)
```

- `npm run dev` (sin `:app`) abre el front en el navegador: la cola y la conversación nativa funcionan;
  solo el viejo webview no (y ese está retirado, ver §WhatsApp).
- **Tests**: server `cd server && npm test` (node:test, puros salvo checks en vivo); front `npm test`
  (vitest, entorno `node` — módulos puros, sin DOM). **Typecheck**: front
  `npx tsc --noEmit -p tsconfig.app.json`, server `cd server && npx tsc --noEmit`.
- **Tests con base (SQL)** (ADR 0008): para el SQL de la cola/radar/proyecciones, contra una Postgres
  efímera. `docker compose -f docker-compose.test.yml up -d --wait`, luego `cd server && npm run
  test:db`. Para escribir uno: archivo `*.test.db.ts` (el glob puro no lo toma), `const db = await
  baseDePrueba(t)` (`src/pruebas/base.ts`) te da una base aislada por test; sembrás con
  `src/pruebas/sembrar.ts` y le pasás **ese `db`** al seam (`consultarRadar(db)`…), nunca al singleton.
  Ejemplo vivo: `src/pruebas/humo.test.db.ts`. Guardia hard-fail anti-prod (5439, nunca 5438/5434).
- **Refrescar datos de Meta**: `cd server && npm run ingest:interactions` (polling manual, read-only).
  Captura comentarios FB/IG + DMs de Messenger de **todas las Páginas que el token puede ver** (`me/accounts`).

## WhatsApp — la costura y la vinculación

- **Todo pasa por la interfaz `TransporteWhatsapp`** (`server/src/whatsapp/transporte.ts`). Habla
  **teléfonos, nunca JIDs**. Tres implementaciones: `falso` (dev/tests), `whatsmeow` (real), `cloud-api`
  (futuro respaldo de Meta). Se elige por env `WHATSAPP_TRANSPORTE`. Si un JID aparece arriba de esa
  línea, la costura falló (la conversión vive en `identidadWa.ts`).
- **Vincular un número** = server-side, aparte de la app (decisión **D13**): `cd server && npm run
  wa:vincular -- <numero>`. Da un código de 8 dígitos para poner en el teléfono (WhatsApp → Dispositivos
  vinculados → Vincular con número). La sesión queda en `server/.wa-sessions/` (**gitignored: es la
  credencial de la cuenta, NUNCA se commitea**). La app de la vendedora **no vincula, solo ve**.
- **El webview viejo** (`src/features/whatsapp/PanelWhatsapp.tsx`) está **retirado** por D13. No se usa;
  archivar con ADR cuando se limpie.
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

## Auth

Login de vendedoras **contra Cerberus** (Django, sin API REST): `cerberus/auth.ts` hace el handshake
CSRF + POST a `/ingresar/`. Éxito → Hermes emite un **token HMAC Bearer** (`auth/sesion.ts`). El
`vendedoraId` = username de Cerberus. Middleware `requiereVendedora` delante de todo lo que envía o
atribuye a una vendedora.

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
`groundingOk`, `edadDelDato`), validado con Zod.

- **Body**: `{ pregunta: string, historial?: {rol,texto}[] }`, con tope de tamaño (4000
  caracteres la pregunta y cada turno, 30 turnos de historial — sin eso, amplificaba sin límite
  lo que Hermes le reenvía a Ivi). El `usuario` sale del token (la vendedora), no del body — no
  se puede suplantar.
- **FAIL-CLOSED y RUIDOSO**: cualquier fallo es un **502 con `codigo`**, los ocho de
  `CODIGO_ERROR_IVI` (`cliente.ts`): `falta_config` sin `IVI_URL`/`IVI_SERVICE_TOKEN`,
  `config_hermes` en 401, `ivi_no_configurado` en 503, `timeout` (30s, incluye timeout leyendo el
  body de la respuesta, no solo conectando), `red`, `respuesta_invalida`, `http_inesperado` (otro
  estado no esperado) y `desconocido` (un error que no es `ErrorIvi` — bug, no una clase conocida
  de problema). **Nunca** se muestra un fallo como «Ivi no encontró datos». Cada `ErrorIvi` deja
  rastro en los logs del server, con la causa original si la hay.
- **Env**: `IVI_URL` + `IVI_SERVICE_TOKEN` (solo nombres en `.env.example`). Del lado geografo,
  `POST /api/preguntar` puede **no estar vivo aún**: hasta entonces la ruta responde 502 honesto.

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

## El panel derecho — ordenado por lo que decide una venta (ADR 0017)

`src/features/panel/PanelDerecho.tsx` (360 px, `w-[22.5rem]` en `App.tsx`). El orden **no es
temático**: es el de las preguntas que la vendedora se hace mientras escribe. **Una pestaña guarda lo
que se CONSULTA, nunca lo que se DECIDE.**

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
- Ver el catálogo que se serviría, sin base ni red: `npx tsx src/scripts/imprimirHechos.ts`.
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

De las **1.997 conversaciones vivas, 140 (7%) son de gente que YA COMPRÓ** (11 VIP), y hasta ahora se
veían igual que un desconocido. El dato existía —`cerberus/ficha.ts`— pero se pedía **por HTTP, de a
una, al abrir la conversación**: 1.997 llamadas para pintar un listado, contra un Cerberus que a veces
se cuelga (de ahí el techo de 12 s del panel). Por eso nunca estuvo en la fila.

- **El padrón se SINCRONIZA**: `cd server && npm run clientes:sincronizar` (`--dry-run` no escribe).
  Lee **`icarus.contacts`** —icarus recibe el webhook de Cerberus en cada venta— con la conexión
  read-only `ICARUS_DATABASE_URL`, y guarda en **`clientes_padron`** lo MÍNIMO: sufijo del teléfono,
  código de país, compras y nivel. **Nombre, correo, DNI y monto NO se copian** (para eso está la
  ficha viva). Es derivada y descartable: se puede truncar y volver a sincronizar.
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
`vendedoras[]` reemplaza el set). El mapa es **solo etiqueta/atribución**: la cola NO se filtra por
vendedora. Contrato de los dos lados en **`docs/multi-numero/`**; decisión en **ADR 0010**. El ruteo
multi-número real (N transportes vivos) es el Frente A, **issue #50**, todavía pendiente.

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

N5 es un botón porque reiniciar tira las sesiones de Cerberus de las vendedoras. El trabajo lo hace
**`deploy/vps1/hermes-deploy.sh`** —versionado, no YAML— y es la misma pieza que corre por SSH:
`ssh … 'sudo hermes-deploy --dry-run | --rollback'`. `tauri-windows.yml` sigue aparte: necesita host
Windows.

**El schema va en migraciones versionadas**, no en `db:push` (ADR 0021). Al tocar `src/db/*.ts`:
`npm run db:generate` → `goberna-journal-set-when` → commitear `server/drizzle/` completo. Cómo y por
qué: **`docs/migraciones.md`**. Runbook del server: **`docs/deploy-vps1.md`**.

**La app de las vendedoras se EMPAQUETA**, no se clona: `env VITE_API_URL=https://hermes-api.goberna.us
npm run build && npm run empaquetar:mac` (o `:win`) → `release/Hermes-*.dmg|.exe`.

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
`WHATSAPP_TRANSPORTE`, `WHATSAPP_NUMERO`, `IVI_URL`, `IVI_SERVICE_TOKEN`,
`HERMES_ADMIN_SERVICE_TOKEN`, `AUTO_RESPUESTA` (+ sus `AUTO_RESPUESTA_*`, todos con default
sensato). Ver `server/.env.example` (solo nombres).

## Reglas duras (Goberna)

1. **Secretos**: por nombre, nunca pegados en prompts/archivos/docs.
2. **Verificación antes de "listo"**: ningún cambio de UI o deploy se reporta terminado sin screenshot
   (Playwright/Electron) o `curl` a la URL viva.
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
