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
  La excepción es la **auto-respuesta fuera de horario** (#125, **ADR 0015** + **ADR 0016**), y es del
  tamaño exacto del agujero que tapa: 44% de los leads llega fuera de horario y el 44% de esos nunca
  recibe respuesta. Solo puede mandar **un acuse de una plantilla registrada** a quien **escribió
  primero**, **fuera de la franja de atención**, tras **30 min sin respuesta humana**, **una vez por
  día**, y **nunca a quien dijo que no**. Nada de eso se negocia en un `if`: vive en
  `server/src/autorespuesta/`.
  - **TRES MODOS, no un booleano** (ADR 0016): **apagada** (el default) · **supervisada** (la cola
    prepara igual —misma decisión, mismo ritmo— pero **nada sale sin el OK de una persona**) ·
    **automática** (lo de ADR 0015: prepara y manda sola). La garantía del modo supervisado es una
    sola línea: lo preparado queda en estado `preparada`, y `EN_COLA_DE_ENVIO` (`autorespuesta/estados.ts`)
    no lo incluye — el despachador **no lo ve**. La máquina de estados completa y el salto prohibido
    (`preparada → enviada` no existe) viven ahí, con su test.
  - **La bandeja de revisión** (`src/features/autorespuesta/BandejaRevision.tsx`) es una **hoja sobre
    la app**, no una vista del riel: se abre desde el chip o con la tecla **`a`**, agrupa por campaña,
    muestra el texto una vez por grupo y **aprobar en lote es de primera clase**. Lo aprobado NO sale
    junto: se reparte con el MISMO `programar.ts` del modo automático. Lo que nadie aprueba **caduca
    solo** (3 h de gracia desde su turno, nunca cruza el día — `autorespuesta/caducidad.ts`).
  - **Apagada por default y con dos llaves**: `AUTO_RESPUESTA=on` (entorno) **y** el interruptor de la
    base (`auto_respuesta_estado.modo`), que es el **kill-switch sin deploy** —
    `PUT /api/autorespuesta/modo` con el Bearer de cualquier vendedora (la ruta vieja
    `/interruptor`, booleana, sigue viva para un `curl` de emergencia). Se maneja desde el **chip de la
    cabecera**, al lado del semáforo de WhatsApp: **tres segmentos a la vista** (apagar cuesta UN click
    desde cualquier modo), apagada discreta · supervisada delineada · automática sólida con punto vivo;
    frenada sale en rojo con el motivo, y sin `db:push` dice «falta la migración» en vez de un estado
    falso.
  - **La plantilla depende de la CAMPAÑA** (`autorespuesta/campana.ts`): interés asentado > formulario
    que llenó > anuncio del que vino — la MISMA precedencia del chip de curso de la cola (#72), para que
    la fila y el mensaje no digan dos cosas distintas. Lo que cambia por campaña es una frase
    (`FAMILIAS[].gancho`), no una plantilla por curso.
  - **El ritmo es el contrato**: un envío a la vez, 60–240 s entre uno y otro, lo de la madrugada
    sale recién a partir de las 7:30, techos de 20/hora y 60/día por número. Freno TOTAL ante
    `temporary_ban`, error de envío o desconexión; cancelación si la vendedora responde antes; la
    cola se cancela entera al empezar el horario.
  - **Antes de prenderla, siempre**: `cd server && npm run auto:simulacro` — imprime el plan de
    despacho real (a quién, qué plantilla, a qué hora) **sin mandar nada**. `--hora 03:00` mueve el
    reloj; `--demo` corre sin base.
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

- **No se guardan** (ADR 0015): no hay fila, no hay job. Se derivan en cada consulta, como la etapa
  efectiva (0013) y `no_leido` (0014). Conviven con las **categorías manuales** (#48) sin ser una:
  la manual es píldora de **borde**, la automática de **fondo** tenue; misma paleta `--cat-*`, sin oro.
- **El criterio vive UNA vez**, puro: `senales/cotizacion.ts` (monto con moneda plausible, veto a la
  instrucción de pago) y `senales/enfriamiento.ts` (cotizada + sin respuesta + N días, con reloj
  inyectado). El SQL de `consultarSenales.ts` solo hace un **prefiltro superconjunto** y el veredicto
  lo da la función pura — así no hay segunda implementación que pueda divergir (lección de #37).
- **Umbral**: `SENALES_DIAS_ENFRIAMIENTO` (default 3; un valor inválido se ignora).
- **Medir la precisión sobre datos reales**: `cd server && npm run medir:cotizaciones [días]`
  (read-only) — imprime ingenuo vs. detector vs. corroboradas y la muestra de falsos positivos evitados.

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

**VPS1** (`deploy@161.132.39.165`), en `/srv/hermes` — **EJECUTADO 2026-07-21**: servicio systemd
`hermes` (PORT=4110), Postgres propio `hermes_db` (127.0.0.1:5438), API pública
**`https://hermes-api.goberna.us`** (nginx + certbot dns-cloudflare; el 4110 no se expone), número
51986394450 vinculado ALLÁ. Actualizar: `ssh … 'cd /srv/hermes && git pull && sudo systemctl
restart hermes'`. **El deploy sigue siendo manual** (no hay CD). Runbook: **`docs/deploy-vps1.md`**.
**CI sí hay**: `.github/workflows/ci.yml` corre lint · typecheck · build del front · tests del front ·
tests del server en cada PR y en cada push a `main`, sobre el **runner self-hosted de VPS1** (label `vps1-hermes`,
servicio `actions.runner.Goberna-Lab-hermes.vps1-hermes`, dir `~deploy/actions-runner-hermes`) —
así no gasta minutos de GitHub. `tauri-windows.yml` es la excepción: necesita host Windows.
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

- **Drizzle sin migraciones versionadas**: el schema se aplica con `npm run db:push` (drizzle-kit). Al
  tocar `server/src/db/schema.ts`, push contra la DB. Pendiente de push hoy: las dos tablas de la
  auto-respuesta (`auto_respuestas_pendientes`, `auto_respuesta_estado`), `envios_wa.automatico`
  (#125) y las cinco columnas del modo supervisado (`auto_respuesta_estado.modo` +
  `auto_respuestas_pendientes.aprobada_por/.aprobada_at/.editada/.campana`, ADR 0016) — sin el push
  esas funciones **degradan** (hilo sin marca, ruta del interruptor en 503, bandeja vacía con el
  motivo escrito), no rompen —; y `plantillas` + `plantilla_pasos` (plantillas-secuencia), sin las
  cuales `/api/plantillas` **no funciona** en un server ya desplegado.
- **El transporte falso repite ids entre reinicios** (`falso-1`, `falso-2`…): reprocesar colisiona con la
  idempotencia (`wa:falso-N` ya existe) y el mensaje no entra. Para demos limpias, borrar los
  `external_id LIKE 'wa:falso-%'` primero. El transporte real usa ids reales de WhatsApp (únicos).
- **whatsmeow trae binario Go por plataforma**: en el deploy linux, `npm install` baja el binario linux.
- **La cola sirve conversaciones, no filas** (`/api/conversaciones`, no `/api/interactions`): los
  mensajes se agrupan por `(canal, persona, número propio)`; los comentarios siguen individuales.

## Estado (2026-07-22)

En `main`, Hermes es un CRM completo: Dashboard radar · Pipeline con compuertas (cotizado exige
interés; cierre solo vía venta) · chat multicanal con media completa y BarraGestion · Contactos ·
Correos (falta SMTP) · Agenda-calendario.

> ⚠️ **`main` ≠ producción.** Verificado el 22-jul: VPS1 está en `17648e4`, **26 commits atrás**. Lo
> que las vendedoras usan NO incluye el rediseño «Cierre de edición», la urgencia de 6 niveles, la
> ventana de 30 días de la cola ni el caché persistente. El deploy es manual y no hay CD, así que
> **leer este código como «lo que corre» es incorrecto**. El comando de deploy y el rollback están
> en `docs/estado.md`.

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
