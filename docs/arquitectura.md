# Arquitectura de Hermes

> Cómo está hecho, por qué, y qué NO hace. Complementa a los otros tres:
> **`CONTEXT.md`** es el glosario del negocio · **`docs/estado.md`** es la foto de hoy ·
> **`docs/adr/`** son las decisiones con su fundamento. Este documento es el **mapa**.
>
> Verificado contra el código el **2026-07-22**. Cuando algo acá contradiga al código, gana el
> código — y hay que corregir esto en el mismo PR.

---

## 1. Qué es

Una app de escritorio donde **una vendedora de la Escuela de Goberna atiende, desde una sola
pantalla, a toda la gente que levantó la mano** por WhatsApp, comentarios de Facebook/Instagram y
Messenger; mueve el embudo, agenda seguimientos, llama, manda correos y registra la venta contra
Cerberus.

La unidad de trabajo es la **conversación**, no el mensaje. La identidad que atraviesa todo el
sistema es la **clave de conversación**: `conv:<canal>:<persona>:<numero>` (o `int:<id>` para un
comentario, `lead:<id>` para un formulario). De ella cuelgan etiquetas, intereses, gestiones,
recordatorios y correos.

---

## 2. El mapa: este repo tiene DOS MITADES

Es lo primero que hay que entender, y no está en ningún otro lado.

Hermes se **extrajo de meta-escuela preservando historia git** (ADR 0001). La extracción se llevó el
árbol entero, así que el repo contiene el CRM que se usa **y** el dashboard de pauta publicitaria del
que salió. Las dos mitades comparten proceso Express y base de datos.

| | **La mitad viva** (~39 archivos) | **La mitad heredada** (~45 archivos) |
|---|---|---|
| Qué es | El CRM de conversaciones | El dashboard de pauta de meta-escuela |
| Módulos | `whatsapp` · `auth` · `cerberus` · `cola` · `realtime` · `db/schema.ts` | `analisis` · `canales` · `decisions` · `pauta` · `ontologia` · `fuentes` · `sdk` |
| Routers | 13 de 27 | 14 de 27 |
| Último trabajo | del 21-jul en adelante | 19-jul o antes |
| ¿La alcanza la vendedora? | **Sí** | **No. Ninguna acción de la app la toca.** |

**La mitad heredada no está rota: está desconectada.** Compila, está montada en Express y responde si
la llamás — pero el front no la llama nunca. Importa no confundirse en ninguna de las dos
direcciones: leerla como código muerto tiraría trabajo caro y correcto (`dominio/estadosVenta.ts`,
`lazo/evento.ts`, `fuentes/mysqldump.ts` son piezas buenas); leerla como código vivo haría creer que
Hermes hace cosas que no hace.

> ⚠️ **`server/src/index.ts` miente por omisión.** Sus comentarios describen la arquitectura de
> meta-escuela. `/api/overview` dice ser «el BFF: una sola llamada con todo lo que la home
> necesita» — esa home se podó. Quien lea `index.ts` de arriba a abajo va a creer que 14 routers
> muertos son el corazón del producto.

**Los 13 routers vivos**: `auth` · `contactos` · `agenda` · `gestiones` · `dashboard` · `correos` ·
`venta` · `conversaciones` · `responder` · `persona` · `stream` · `whatsapp` · `interactions` (solo
`/frescura`; sus otros dos endpoints están muertos).

**El único puente entre las mitades** es `webhook/ruta.ts`: Cerberus avisa una venta, Hermes la
espeja, y —si `LAZO_RELOJ` estuviera encendido, que no lo está— se la contaría a Meta.

---

## 3. La forma

### Front (`src/`) — React 19 + Vite 8 + Tailwind 4

**Sin router** (ADR 0002): un espacio con **9 vistas conmutadas por estado** en `App.tsx`
(Dashboard · Pipeline · Contactos · Mensajes · Correos · Agenda · Entrenar bot · **Libreta** ·
**Navegador**). El riel vertical izquierdo navega; ⌘1..⌘9 también. Agregar una vista es tocar
`VISTAS` en `App.tsx` y nada más: **el rango del atajo se DERIVA de ese array**
(`e.key <= String(VISTAS.length)`), así que el punto de falla silenciosa que este párrafo describía
—un `'6'` escrito a mano que dejaba a ⌘7 sin hacer nada mientras la Cabina anunciaba el atajo— ya no
existe.

⚠️ Si alguien vuelve a clavar el número, **el candado tiene que apuntar a la ÚLTIMA vista**: con un
`'8'` a mano andarían las ocho primeras y solo la novena quedaría muerta, así que un test sobre ⌘8
seguiría verde. Por eso `App.test.tsx` prueba ⌘9, y hay que moverlo al agregar la décima.

Qué entra al riel no es un número sino un criterio (**ADR 0034**, que enmienda 0002 y regulariza las
tres vistas que entraron sin hacerlo): un **LUGAR** donde se está un rato (ADR 0016), con una
**acción primaria nombrable**. Lo que se consulta y se cierra —la Cabina (`?`), Ivi (`i`)— no entra.

**Mensajes está SIEMPRE montada** (oculta con `hidden`, nunca desmontada): el borrador del composer y
el hilo abierto sobreviven a pasear por otras vistas. Las demás vistas se montan y desmontan, con
animación direccional según la posición en el riel.

Layout de Mensajes: cola `w-[25rem]` · conversación flexible · `aside w-72` que muestra
`FichaContacto` (WhatsApp) o `PanelContexto` (resto).

### Capa de datos (`src/lib/datos/`) — una sola puerta

Todo pasa por `api()` en `cliente.ts`: un único `fetch`, que adjunta el Bearer y **termina en
`res.json()`** (por construcción no puede consumir streams). Encima, TanStack Query con
`staleTime: 30s`.

Tres reglas, escritas en el módulo:

1. **Estado del servidor → caché.** Nunca `localStorage`: si dos personas atienden, tienen que verse.
2. **Preferencias de UI → `localStorage`** (`useLocalStorage`). Nunca al servidor.
3. **Lo derivable no se guarda.** `respondida` no es un estado: es `status !== 'nuevo'`.

**El caché sobrevive al cierre** (ADR 0007): se persiste en IndexedDB y se **restaura antes del
primer render** (`main.tsx`), así la app abre con el último estado conocido en vez de un spinner. Lo
viejo se marca «hace 14 horas» hasta que llega lo fresco. Lista blanca de dos consultas: radar y
cola.

### Tiempo real (`tiempoReal.ts` + `routes/stream.ts`)

SSE en `/api/stream`. **Es un bus de señales, no de datos**: el evento dice «algo cambió» y el front
traduce eso a invalidaciones de react-query. El payload nunca llega a la UI — por eso el stream no
necesita auth.

### Cáscara (`src-tauri/`) — una sola desde ADR 0039

**Tauri v2**, 3 MB. Solo abre `https://hermes-api.goberna.us` — la UI viaja **OTA**: actualizar el
VPS actualiza a todas al abrir la app, **sin reinstalar**. Fallback a `dist/` local si no hay red.
Windows se compila en Actions (`tauri-windows.yml`); Tauri no cross-compila.
`electron/` **se archivó el 7-ago-2026** (ADR 0039): existía solo por el webview de WhatsApp Web, que
D13 dejó sin uso.

Esa decisión condiciona a las demás: **nada de la UI puede depender de APIs de la cáscara**, porque
la ataría a un instalador nuevo por cada cambio y la rompería en el navegador (ver ADR 0007).

🔴 **Y el OTA tiene una consecuencia que muerde a cualquiera que agregue un comando nativo**: en
release la ventana `main` **navega** a la URL de producción, así que la UI corre en un origen
**REMOTO** y Tauri le exige permiso declarado —también a los comandos propios de la app—. Sin
declararlo en `src-tauri/permissions/*.toml` y en **las dos** capabilities, el comando anda en
`dev:app` (origen local) y se rechaza en la máquina de la vendedora. El único que existe hoy es
`abrir_navegador` (ADR 0040), con sus tests fijando esa ruta.

### Server (`server/src/`) — Express 4 + Drizzle + Postgres 17

27 routers montados en `index.ts`. Event store append-only + proyecciones. Dos relojes de fondo
(`pauta`, `lazo`), los dos efectivamente apagados (§7).

---

## 4. El flujo de un mensaje, de punta a punta

Lo más útil para ubicarse:

```
WhatsApp del cliente
      ↓  whatsmeow (binario Go, subprocess)
TransporteWhatsmeow          ← JIDs mueren acá; arriba solo hay teléfonos
      ↓  MensajeWhatsapp
whatsapp/ingesta.ts          ← PURA: habla con un puerto, no con Postgres
      ↓  RepositorioInteracciones
whatsapp/repositorioDrizzle  ← INSERT en events (append-only) + interactions (proyección)
      ↓  emite señal
realtime (EventEmitter)  →  /api/stream (SSE)  →  invalidateQueries(['conversaciones'])
      ↓
/api/conversaciones          ← agrupa por (canal, persona, número propio), ventana de 30 días
      ↓
ColaUnificada → ConversacionActiva → HiloWhatsapp
```

Y en sentido inverso, para enviar: la UI llama `/api/whatsapp/enviar` → **`EnvioControlado`** (§5.2)
→ transporte → WhatsApp. No hay otro camino: las rutas nunca tocan `transporte.enviarTexto`.

---

## 5. Los patrones de la casa

### 5.1 `TransporteWhatsapp` — la costura que habla teléfonos, no JIDs

`whatsapp/transporte.ts`. Una interfaz con dos implementaciones reales (`whatsmeow` y `falso`; el
`cloud-api` del union está declarado y **no existe todavía**), elegidas por `WHATSAPP_TRANSPORTE`.

Tres cosas la hacen la mejor costura del repo:

- **El vocabulario del proveedor muere ahí.** `MensajeWhatsapp.telefono` es un teléfono normalizado,
  jamás un JID. Si ves un JID arriba de esa línea, la costura falló.
- **Lo que la interfaz NO tiene es la política.** No hay `enviarMasivo` ni `enviarA(lista)`. Que no
  haya envío masivo no es una regla en un doc: es la forma del código.
- **Los estados que duelen están en el tipo.** `EstadoSesion` incluye `baneado`, con código y
  expiración. El `temporary_ban` se muestra siempre; nunca se esconde.

### 5.2 `EnvioControlado` — la única puerta hacia enviar

`whatsapp/envioControlado.ts`. El **orden de las guardas** es la convención:

1. Validación dura **sin auditar** — una orden malformada no ensucia el registro.
2. `registrarIntento` **antes** de tocar el transporte — el intento existe pase lo que pase.
3. Corta-corriente (gana sobre todo).
4. Estado de sesión — baneado o desconectado ⇒ rechazo con motivo visible, **cero reintentos**.
5. `try/catch` con TOCTOU explícito: un ban que llega entre el chequeo y el envío queda como fallido
   auditado, nunca como un saliente fantasma.

### 5.3 Función pura + wrapper con IO

El patrón más consistente del repo. La lógica va en un módulo puro que no toca la base, no habla con
nadie y no mira el reloj; el IO va en un archivo aparte.

| Puro | Con IO |
|---|---|
| `cola/urgencia.ts` | `cola/radar.ts` → `routes/dashboard.ts` |
| `whatsapp/proyectar.ts`, `whatsapp/ingesta.ts` | `whatsapp/repositorioDrizzle.ts` |
| `lazo/evento.ts` | `lazo/worker.ts` |
| `webhook/cerberus.ts` | `webhook/ruta.ts` |

Hay una razón mecánica además de la estética: **`db/client.ts` lanza al importarse si falta
`DATABASE_URL`**. Por eso existen los imports perezosos (`analisis/tasas.ts`) y los archivos
partidos. Si agregás un `import { db }` a un módulo que un test importa, rompés el test sin tocar el
test.

### 5.4 El fracaso se declara, no se lanza

En los bordes, uniones discriminadas en vez de excepciones. No es aspiracional: hay siete.

`Ficha` (`cliente | nuevo | error`) · `ResultadoAuth` (con `caido` para dar 503 y no 401) ·
`ResultadoControlado` · `Resultado` del lazo · `Resultado` del SDK · `ResultadoProyeccion` ·
`EstadoSesion`.

El caso que explica todo, en `cerberus/ficha.ts`: *«Cerberus no respondió» NO es lo mismo que «no es
cliente» — son opuestos.* Colapsarlos en un `null` es lo que hace que una pantalla mienta.

En el SDK, el código HTTP **sale del motivo**: `no_existe → 404`, `entrada_invalida → 400`,
`fallo_ejecucion → 500`.

> No se aplica en las rutas de la mitad heredada, ni en `routes/whatsapp.ts` — donde
> `GET /conversacion/:telefono`, la ruta más caliente del CRM, **no tiene try/catch**.

### 5.5 Las Herramientas del SDK

`sdk/tipos.ts` + `sdk/registro.ts`. La regla: **una Herramienta no tiene lógica, es una declaración
sobre lógica que ya existe.** Si un envoltorio empieza a calcular, ese cálculo va a `analisis/`,
`dominio/` o `canales/`.

Zod es la fuente única: valida en runtime, tipa en compilación y **genera el JSON Schema** del
catálogo con `z.toJSONSchema()`. Nadie escribe el schema a mano. Los nombres están regulados
(`/^governa\.[a-z]+\.[a-zA-Z]+$/`) y registrar dos veces lanza a propósito.

### 5.5b El cierre de un popover (`src/lib/teclado/`)

El shell (`App.tsx`) escucha `keydown` en **burbuja** y se adueña del Escape: cierra la libreta, la
cabina, la conversación abierta. Para cerrarse sin arrastrar lo de atrás, un popover tiene que
ganarle — escuchar en **captura** (que por el DOM corre siempre antes que la burbuja) y cortar el
evento ahí. Ese acuerdo estaba copiado a mano en nueve componentes y **cuatro copias ya habían
divergido** (#12): dos escuchaban en burbuja sin cortar (cerraban el popover *y* la conversación),
tres no oían Escape en absoluto, y una se olvidó la guarda de campos, así que Escape mientras se
escribía el nombre de una etiqueta cerraba el modal y se llevaba lo tipeado.

Hoy la decisión vive **una vez**, como función pura, y los dos wrappers la comparten:

| Puro | Con IO |
|---|---|
| `teclado/escapeDePopover.ts` (`reaccionDelPopover`, `SELECTOR_CAMPOS`) | `teclado/usePopover.ts` (popover con overlay) · `teclado/useEscape.ts` (modal) |

- **`usePopover(abierto, cerrar, { z })`** — para lo que flota sobre la pantalla: registra el listener
  solo mientras está abierto y devuelve `propsOverlay`, la capa invisible del clic-afuera. El
  z-index lo pone cada sitio (conviven tres escalas: menús 20/30, avisos 30/40, cabeceras 40/50).
- **`useEscape(onCerrar)`** — para modales, que traen su propio scrim visible y solo se montan abiertos.
- **`SELECTOR_CAMPOS`** es la guarda única de «¿estoy escribiendo?», también para el shell. Con el
  foco en un campo, Escape es del campo.

### 5.6 Métricas derivadas en consulta, nunca precalculadas

El Dashboard tiene **dos lecturas**: el radar de la vendedora («¿a quién atiendo ahora?») y el panel
del negocio («¿qué curso rinde y dónde se pierde?», `dashboard/negocio.ts` + `GET
/api/dashboard/negocio`, #128/#126). La segunda **no agrega ni una tabla de métricas, ni un job, ni
un backfill**: sale de los mismos hechos que ya viven en `interactions` + `events` + `leads` +
`gestiones`, agrupados de otra manera al leer.

Es la misma decisión que la etapa efectiva (ADR 0013) por el mismo motivo: **una métrica
materializada es una segunda copia del dato, y las segundas copias divergen**. Derivar al leer
cuesta un escaneo —el panel se pide cuando alguien lo mira, no en cada refresco de la cola— y a
cambio nunca puede contradecir a la cola.

De ahí la regla que gobierna el módulo: **no redefine nada que ya exista**. `respondida` viene de
`cola/urgenciaSql.ts`, la etapa efectiva de `cola/etapaEfectivaSql.ts`, el corte de día y la hora de
Lima de `lib/horaLimaSql.ts`, y el sufijo de match teléfono↔lead de `gente/leadDeTelefono.ts` (que
lo exporta como fragmento justamente para esto). Lo poco que sí define —«primera respuesta»,
«precio mencionado», «el curso de un lead»— lo define **una vez, ahí**, con el porqué escrito al
lado.

Corolario para la pantalla: donde el dato no alcanza, **se dice**. Las conversaciones que no cruzan
con ningún formulario viajan como `sin_atribuir` y se muestran en su propia fila; el subregistro de
cotizaciones (611 con precio contra 3 asentadas) se declara arriba de la tabla, no se maquilla.

### 5.7 Cómo se testea

**285 casos en el server** (`node:test` vía `tsx --test`) + **18 en el front** (vitest, entorno
`node`, sin DOM). CI en el runner self-hosted de VPS1.

Las convenciones, mejor mostradas en `cola/urgencia.test.ts`:

- **El instante se inyecta**, nunca `new Date()` adentro del código: `claveUrgencia(item, ahora)`.
- **Constructores cortos con `Partial<T>`**: `const msg = (over) => ({...defaults, ...over})`.
- **Dobles en memoria, no mocks**: `TransporteFalso` es una implementación real de la interfaz.
- **El comentario del test explica la decisión de negocio**, no el código.
- **Ningún test necesita Postgres.** Eso es lo que sostiene el patrón puro+wrapper.

---

## 6. Los datos

### Append-only (fuentes de verdad)

- **`events`** — el event store. Idempotencia por `UNIQUE(source, external_id)`. **Es la tabla más
  grande y más caliente.** Cada consulta de la cola le hace JOIN solo para leer
  `payload->>'numeroPropio'`, un campo que no está indexado ni promovido a columna; sin cota de
  tiempo el planner escanea 111 mil filas de JSON (medido: 482 ms → 3,4 ms con la ventana puesta).
- **`gestiones`** — append-only por diseño: **la etapa actual es la de la última fila**.
- `fuentes.registro` (espejo crudo de Cerberus) · `webhooks_recibidos` · `hechos` · `pauta_serie`.

### Proyecciones

`leads` e `interactions` se derivan de `events` — pero **el reconstructor no existe**. El comentario
del schema dice «si se corrompe se reconstruye desde `events`»; ese código no está escrito. Se
escriben inline en los ingestores.

Las de la ontología (`cliente`, `producto`, `venta`…) sí se rehacen: truncate+insert en una
transacción, por `npm run cerberus:proyectar`. La de identidad es la excepción: **UPSERT, nunca
delete+recreate**, porque un rebuild cambiaba el id de la persona y rompía los links.

### Tablas que no se llenan

`identidades_bloqueadas` (cero escritores, a propósito: «se llena cuando la realidad la llene») ·
`rag.documentos` (**no pertenece a Hermes** — es de Ivi, pero el schema la declara y la migración la
crea igual, por el glob del `drizzle.config.ts`) · `pauta_snapshots`, `configuracion`, `pauta_serie`
(sus escritores están detrás de rutas que nadie llama).

### ~~Migraciones: no hay~~ — las hay, desde el 2026-07-24 (ADR 0021)

> Lo que decía acá: «`db:push` de drizzle-kit, cero migraciones versionadas. Deuda heredada y
> declarada en ADR 0001. Al tocar `db/schema.ts`, push contra la base.»

El schema vive en `server/drizzle/`, un `.sql` por cambio, revisable en el PR que lo introduce. Un
cambio de `src/db/*.ts` sin su migración **no pasa CI** (la paridad de N2b lo atrapa). `db:push`
queda solo para las bases efímeras de test. El cómo: **`docs/migraciones.md`**.

---

## 7. Los bordes externos

### Cerberus (ERP Django, `app.goberna.us`) — cuatro bordes, cuatro auths distintas

| Borde | Auth |
|---|---|
| Login de vendedora | **Scraping del `LoginView`**: GET para el `csrftoken` + el `csrfmiddlewaretoken` del HTML, POST con credenciales, Referer y Origin |
| Ficha del contacto | **Ninguna** — endpoints JSON públicos. Busca por los **últimos 9 dígitos**, porque Cerberus guarda el número local sin prefijo |
| Crear venta | **La cookie de la vendedora**, guardada en un `Map` **en memoria** |
| Webhook de ventas | Token en querystring, comparado con `===` (así es el contrato real de Cerberus) |

El webhook es el contrato más delicado: **Cerberus es fire-and-forget, 10 s de timeout, sin
reintentos**. Por eso: guardar el crudo → responder 200 → procesar en background. Y la deduplicación
es por `external_sale_id`, **nunca por `event_id`** — el de Cerberus lleva microsegundos y cambia en
cada reenvío de la misma venta.

**latin1**: el enemigo son los **emojis**, no los acentos (á/é/ñ pasan; el emoji revienta el INSERT en
MySQL). Se sanitiza en el borde — **`cerberus/latin1.ts`** (#108; hasta entonces esta línea decía lo
mismo sobre código que no existía). `aLatin1` normaliza a **NFC antes de filtrar**: sin eso una `ñ`
descompuesta pierde la tilde y «Muñoz» sale «Munoz». `cuerpoParaCerberus` lo aplica a **todos** los
campos del POST, no a los que uno se acuerda, así el campo que se agregue mañana nace cubierto.

> El **login queda afuera a propósito** (`auth.ts`): sanear la contraseña no protege ningún INSERT
> —Django la hashea— y la corrompería en silencio. El saneo va donde se escribe, no donde se
> autentica.

### Meta

- **Graph API (lectura)**: la regla dura es **ninguna pantalla llama a Meta, nunca** — se consulta en
  un job y el resultado va a un snapshot. Tiene dos excepciones vivas: `resolverAnuncio` en el camino
  de render del hilo, y `routes/persona`/`responder`.
- **Conversions API (escritura)**: `lazo/`. **Arranca apagado a propósito** — «la pauta LEE de Meta,
  esto le ESCRIBE; un `git pull` no puede empezar a mandarle compras a Meta porque sí».

### WhatsApp — whatsmeow, cliente de protocolo no oficial

Versión pineada, binario Go por plataforma (en el deploy linux, `npm install` baja el de linux). La
sesión **se vincula aparte del app** (decisión D13): `npm run wa:vincular`. La sesión vive en
`server/.wa-sessions/` — **es la credencial de la cuenta, nunca se commitea**.

**No hay ventana de 24 h**: el número está vinculado como dispositivo de un teléfono real, no como
cuenta de negocio.

Acople aceptado a propósito: `lidMap.ts` lee en **solo lectura** una tabla interna del store de
whatsmeow con `node:sqlite`, porque el wrapper no expone esa función. Si el schema cambia, degrada al
descarte — **nunca se inventa un teléfono**.

### Los tres webhooks entrantes

`cerberus` (token en query) · `landing` de Bravo (token en la ruta, `timingSafeEqual`, y genera su
propia clave de idempotencia porque Bravo no manda id) · `whatsapp` Cloud API (**construido y nunca
conectado**; su POST no verifica firma).

> Hay **dos WhatsApp** en el repo y no comparten nada: `whatsapp/` es whatsmeow, el canal real de la
> vendedora. `webhook/whatsapp.ts` es la Cloud API, para capturar clicks de anuncios, esperando un
> evento que todavía no llega.

---

## 8. Deuda y trampas

Lo que un recién llegado pisa. Ordenado por lo que más duele.

### 8.1 🟡 Auth: cerrada por perímetro (era 🔴, cerrado en #36 / ADR 0011)

Desde el ADR 0011, **todo `/api/*` exige el Bearer de una vendedora por defecto**:
`app.use(perimetroApi)` (`auth/perimetro.ts`) va delante de todos los routers, y las excepciones
(`/api/auth`, rutas de dev que solo se montan fuera de producción) viven enumeradas en una sola
lista con su porqué. La media se consume con fetch+blob (`src/lib/datos/blobAutenticado.ts`) y el
stream SSE con fetch+parser propio (`src/lib/datos/sse.ts`), porque `<img>` y EventSource no mandan
headers.

Lo que **sigue abierto, a sabiendas** (detalle en el ADR 0011):

- **`/vincular`** — la consola del operador no tiene auth propia y nginx la proxya. Contenerla es
  decisión aparte (auth de operador o bloqueo en nginx).
- **El SDK exige token de vendedora**, pero sus consumidores reales (kos, Ivi, MCP) son máquinas:
  falta una credencial de servicio (#95).
- **CORS en `*`** — con Bearer obligatorio ya no expone datos; acotarlo es defensa en profundidad
  pendiente, sin romper la cáscara Tauri ni Vite dev (#94).

### 8.2 ✅ El orden de la cola está implementado dos veces — resuelto con paridad verificada (#37)

Era: `cola/urgencia.ts` con 6 niveles y el SQL de la cola con 4, renumerados — un «espejo a
mantener a mano» que divergió sin que CI dijera nada. Ahora la urgencia vive UNA vez en `cola/`:
la función pura (`urgencia.ts`) y su proyección SQL (`urgenciaSql.ts`) lado a lado, y el test de
paridad (`urgencia.paridad.test.db.ts`, harness ADR 0008) corre las dos contra los mismos datos y
falla en CI si vuelven a decir cosas distintas. Decisión y alternativas: ADR 0009.

### 8.3 ✅ El nivel VENCIDO no se disparaba nunca — resuelto (#38)

Era: `claveUrgencia` solo devolvía nivel 1 si el item traía `seguimientoEn`, y nadie se lo pasaba —
`FilaRadar` ni tenía el campo y el radar no consultaba `recordatorios`. Ahora la consulta del radar
vive en el seam `cola/consultarRadar.ts` (inyectable, testeable contra la base) y trae el pendiente
más viejo de la agenda por clave (`seguimientosPendientesSql`, el mismo que usa la cola); el módulo
decide si venció. Los tests de `consultarRadar.test.db.ts` fijan el **cableado**, no solo el
cálculo — el hueco por el que esto pasó inadvertido.

### 8.4 El corta-corriente no está cableado

`EnvioControlado` acepta un tercer argumento para parar todo en seco. `wiring.ts` lo omite, así que
cae al default `() => false`. No hay env, ni ruta, ni flag. **La única palanca real hoy es apagar el
proceso** — y los tests lo ejercitan, lo que hace que el patrón parezca cableado.

### 8.5 Nombres que engañan

- `server/package.json` se llama todavía **`meta-escuela-server`**.
- `server/.env.example` apunta a `meta_escuela` en el puerto 5434; producción es `hermes_db` en 5438.
  Un dev nuevo que copie el ejemplo apunta a la base del otro producto.
- `deploy/vps1/README.md` es el runbook **de meta-escuela**. El de Hermes es `docs/deploy-vps1.md`.
- `webhook/firma.ts` se llama «firma del webhook» y **ningún webhook la usa**.
- `conversiones_wa` (qué vendedora convirtió a quién) vs `ontologia.conversiones` (lo que le decimos a
  Meta): nombres casi idénticos, semánticas ortogonales.
- `normalizarTelefono` existe **dos veces** con reglas distintas, y no se conocen entre sí.

### 8.6 Fugas menores

- `cerberus/sesionStore.ts` guarda las sesiones en un `Map` de proceso: **un `systemctl restart`
  desloguea a todas de la creación de ventas** (el token de Hermes dura 14 días; la cookie de
  Cerberus no sobrevive el restart). El síntoma es un 409 en `/api/venta/formulario`.
- `pauta/reloj.ts` usa `setInterval` sin corrida inicial: el primer refresco sería 6 h después.
- `analisis/tasas.ts` devuelve `null` en silencio si no hay dump reciente, y todos los ROAS quedan
  incompletos sin que nadie lo note.
- **El transporte falso repite ids entre reinicios** (`falso-1`, `falso-2`…): reprocesar colisiona con
  la idempotencia y el mensaje no entra. Para demos limpias, borrar los `external_id LIKE 'wa:falso-%'`.

### 8.7 Producción no es `main`

Verificado el 22-jul: VPS1 está **26 commits atrás**. Deploy manual, sin CD. **Cualquier lectura de
este código como «lo que corre» es incorrecta** — ver `docs/estado.md`.

---

## 9. Cómo se despliega

**VPS1** (`deploy@161.132.39.165`), `/srv/hermes`, systemd `hermes` en el 4110 (no expuesto), nginx +
certbot delante en `https://hermes-api.goberna.us`, Postgres propio `hermes_db` en 127.0.0.1:5438.

El deploy es **manual**: `git pull && npm ci && npm run build && systemctl restart hermes`. **CI sí
hay** (lint · typecheck · build · tests de front y server) en el runner self-hosted de VPS1, en cada
PR y cada push a `main`.

`main` es producción: no se commitea ni se pushea directo (hay un `pre-push` que lo bloquea). El
camino es **rama → PR → CI verde → merge con rebase**.

Runbook completo: **`docs/deploy-vps1.md`**.
