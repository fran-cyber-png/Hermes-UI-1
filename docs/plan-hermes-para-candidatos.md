# Hermes para candidatos — mapeo total y planteo

> **Qué es esto.** El pedido fue: *«un mapeo total del proyecto; agarrar y hacer un Hermes para los
> candidatos que esté dentro de Centurión como servicio»*. Este documento hace las dos mitades: el
> **mapa medido** de Hermes y de Centurión al **10-ago-2026**, y el **planteo** de cómo se construye
> la cosa sin romper las dos reglas que ya están escritas ([`dos-planos.md`](dos-planos.md) §4 y el
> `MICROSERVICE-CONTRACT.md` de Centurión).
>
> **Cómo leerlo.** Lo que dice un número **está medido** (se dice contra qué). Lo que es propuesta
> dice **PROPUESTA**. Lo que necesita al dueño está en §7 y en ningún otro lado.
>
> **Qué NO reemplaza.** [`dos-planos.md`](dos-planos.md) sigue siendo el marco: éste es su primera
> aplicación concreta y en tres puntos lo **actualiza** (§2.4).

---

## 0. Qué es y qué no es

**Es**: la superficie donde el **comando de campaña** de un candidato atiende, desde una sola
pantalla, a la gente que levantó la mano por WhatsApp / Instagram / Facebook — con la ficha del
vecino al lado del chat, y registrando **el compromiso** en vez de la venta.

**No es**:

- ❌ **No es Hermes con otro logo.** El 100 % de lo que Hermes sabe hacer *bien* está atado a que
  **Cerberus registra la venta el mismo día** (§4.2). En una campaña no hay Cerberus, y el resultado
  llega **una vez, al final, y es secreto**. Ese hueco es la decisión de diseño más importante de
  todo el frente, no un detalle de integración.
- ❌ **No es «el servicio de WhatsApp de Goberna» sirviendo a la Escuela y a los candidatos.**
  `dos-planos.md` §4 lo nombra literalmente como *«la peor idea disponible»*. Se comparte **código
  versionado**, jamás un proceso corriendo.
- ❌ **No es un blaster.** Hermes no tiene `enviarMasivo` y eso **no es un olvido**
  (`whatsapp/transporte.ts:16-21`). En una campaña la presión para difundir es 100× la de la Escuela,
  y el canal de un candidato baneado a dos semanas de la elección **es un juicio, no un ticket**.
  Ver la tensión comercial medida en §2.5.

---

## 1. EL MAPA — Hermes hoy, medido

Medido sobre el checkout canónico `~/goberna/hermes`, rama `feat/libreta-mover-y-link`, 10-ago-2026.

### 1.1 En números

| | |
|---|---|
| Server | **612** archivos `.ts` · **99.121** líneas · **229** tests |
| Front | **298** archivos `.ts/.tsx` · **50.879** líneas · **84** tests |
| Base | **54** tablas · **24** migraciones versionadas |
| Vistas | **9** en el riel (`VISTAS`, `App.tsx:85`) |
| Routers montados | **46** en `index.ts` |

### 1.2 Hermes tiene TRES mitades, no dos

`CLAUDE.md` avisa de dos (el CRM que se usa y el dashboard de pauta desconectado). Medido el grafo de
imports, son **tres**, y la tercera es la que decide este frente:

| Mitad | Módulos | Líneas aprox. | Qué pasa con ella |
|---|---|---|---|
| **MOTOR** — sirve a los dos planos | `whatsapp` `piezas` `procedencia` `resultados` `catalogo` `autorespuesta` `cola` `entrega` `reacciones` `numeros` `reparto` `identidad` `telefono` `espacios` `notas` `eventos` `realtime` `auth` | **~27.000** | **Se lleva.** Es el activo |
| **ADAPTADOR ESCUELA** — jamás sale de acá | `cerberus` `cursos` `clientes` `hechos` `plantillas` `negocio` `padron` `icarus` `atribucion` `gestiones` `sugerencias` `campana` `dashboard` `corridas` | **~17.000** | **Se reescribe** para campaña (§5) |
| **DEUDA** — el dashboard de pauta del que salió | `analisis` `canales` `decisions` `pauta` `ontologia` `fuentes` `sdk` `lazo` `meta` | **~11.000** | **No entra.** Ni se mira |
| **BOT** — caso aparte | `bot` (54 archivos) | **12.718** | El más valioso **y** el más contaminado (§5) |

### 1.3 🟢 La línea todavía se puede dibujar: **16 imports**

`dos-planos.md` §2.3 propuso *«prohibir por test que el motor importe del adaptador»* y advirtió que
sin eso, «en seis meses `EnvioControlado` va a saber qué es una venta de Cerberus». **Se midió**: hoy
el motor cruza la línea **16 veces, en 11 pares de módulos** — y ninguna es estructural.

```
procedencia -> sugerencias   3    momento.ts, pieza.ts        ← el vocabulario MOMENTOS_DE_VENTA
cola        -> gestiones     2    etapaEfectivaSql, tiempoEnEtapa
cola        -> dashboard     2    consultarCola, consultarRadar
whatsapp    -> bot           2    wiring.ts (notificarEntrante, configDesdeEnv)
autorespuesta -> sugerencias 1    plantillas.ts
resultados  -> gestiones     1    loQuePaso.ts
catalogo    -> sugerencias   1    vocabulario.ts
eventos     -> gestiones     1    registrarEvento.ts
eventos     -> cerberus      1    registrarEvento.ts (productos.ts)
whatsapp    -> campana       1    transporteCloudApi.ts (estadoDePlantilla)
pruebas     -> clientes      1    sembrar.ts
```

**Lectura**: el contaminante principal es **uno solo** —`sugerencias/estado.ts`, que define
`EstadoDeVenta` con `curso`, `cotizada`, `precio`— y se lo importan `procedencia`, `catalogo` y
`autorespuesta`, o sea el corazón del kernel. **Ese archivo es la frontera.** Parametrizarlo (el
«momento» como dato del tenant, no como enum de la Escuela) desbloquea 5 de los 16 cruces.

> 🔴 **Esto es una ventana que se cierra sola.** 16 imports es una tarde de trabajo. La misma medición
> dentro de seis meses no va a dar 16.

### 1.4 El front está más limpio que el server

De 26 features, **solo 5 tocan `cerberus`**: `panel` (×8), `venta`, `identidad`, `canales`, `vistas`.
El resto —`whatsapp`, `canales`, `agenda`, `notas`, `navegador`, `autorespuesta`, `reparto`— habla de
conversaciones y no sabe qué se vende. **La mesa de trabajo (cola + hilo + panel) se lleva casi
entera**; lo que se reescribe es el contenido del panel derecho.

### 1.5 Lo que el motor ya garantiza y no habría que volver a construir

Esto es lo que se compra al reusar Hermes, y es todo lo que un CRM nuevo tarda dos años en aprender:

- `TransporteWhatsapp` habla **teléfonos, nunca JIDs** → cambiar de proveedor no toca nada de arriba.
- `EnvioControlado`: **una sola puerta** al envío, con el ritmo y los frenos afuera del razonamiento.
- `procedencia/` + `resultados/`: **de qué pieza salió y qué pasó después**, con `n`, base e intervalo
  de Wilson, y un test que falla si alguien mete una palabra causal.
- El patrón de degradación (**error explícito, jamás una lista vacía**) y el de **paridad**
  (regla pura + SQL, con test que falla si divergen).
- La ventana de 24 h, los ✓✓, los adjuntos con el tope **de la línea**, las reacciones, el reparto
  round-robin por carga, la libreta con espacios.

---

## 2. EL OTRO LADO — Centurión hoy, medido

Medido el **10-ago-2026** contra `goberna_web_dev` (`161.132.39.165:55433`), read-only.

### 2.1 El contrato ya existe, y responde la pregunta del pedido

`MICROSERVICE-CONTRACT.md` §2 decide **módulo vs. microservicio**. Un CRM de conversaciones cumple
**tres** de los cuatro criterios de microservicio: corre **siempre** (webhooks de Meta entrantes),
tiene **runtime propio** (drivers de mensajería), y **escala distinto** al login/UI.

> **Veredicto, y no es opinión: es un MICROSERVICIO SATÉLITE + un MÓDULO UI LIVIANO en Centurión.**
> Es literalmente la «regla de oro» del §1 del contrato. No hay que inventar la forma: está escrita.

### 2.2 La flota real

| | Medido |
|---|---|
| Candidaturas (**el tenant key**) | **69** |
| Políticos · usuarios `auth` | 69 · 33 |
| Subservicios en catálogo · selecciones | 18 · **272** |
| Schemas de módulo **con tablas** | `territorio` 14 · `formularios` 10 · `agentes_campo` 7 · `path_to_victory` 4 |

### 2.3 🔴 El funnel ya lleva gente al WhatsApp del comando — y ahí se termina el sistema

El módulo `captacion` existe en el repo desde julio: QR impreso → `GET /w/$codigo` → **302 a
`wa.me/<número del comando>`** con `[CODIGO]` prellenado, que es la atribución territorial. Su propio
README dice qué falta:

> *«Cuando exista la WhatsApp Cloud API del comando, el webhook podrá parsear `[CODIGO]` de los
> mensajes entrantes y **cerrar el loop automáticamente (escaneo → chat → contacto CRM)**; este módulo
> ya deja la métrica lista.»*

**El «contacto CRM» de esa frase es exactamente lo que este documento plantea.** El frente no empieza
en cero: empieza en la mitad que ya está impresa en papel.

⚠️ **Pero medido: `captacion` NO TIENE NI UNA TABLA en la base.** Su migración crea tres
(`numero_whatsapp`, `qr`, `escaneo`) y **nunca se aplicó**; el subservicio tampoco está en el catálogo
de `fase_3`. Es **la cicatriz de ADR 0042 otra vez**: el código dice que el canal anda y la base dice
que no existe. **Antes de construir encima, hay que prenderlo y contar filas.**

### 2.4 Tres cosas que `dos-planos.md` daba por faltantes y YA ESTÁN

Este documento **actualiza** al marco en tres puntos verificados:

1. **El brigadista existe.** `dos-planos.md` §3.7 decía «no existe el brigadista». Hoy hay
   `territorio.brigadista` (**35 filas**), `territorio.sesion`, `territorio.codigo_acceso` y JWT con
   `aud` propio. **El mecanismo para principals no-humanos —el que va a necesitar un agente actuando
   bajo una candidatura— ya está construido y probado.**
2. **La entidad ciudadano existe.** `territorio.contacto` (nombre, teléfono, notas, lat/lng, foto) es
   la libreta de canvassing del brigadista, con backend server-side. ⚠️ **Tiene 0 filas**: existe la
   tabla, no el dato. Y `territorio.visita` tiene **1**.
3. **El transporte Cloud API existe.** `CLAUDE.md` afirma —y era cierto el 29-jul— que *«`cloud-api`
   NO existe como transporte»*. **Ya no**: `whatsapp/transporteCloudApi.ts` (16 KB) está escrito y
   cableado en `wiring.ts:75-89`, como **spike con un número de prueba**, montado *además* de lo que
   elija `WHATSAPP_TRANSPORTE` y nunca en su lugar. `dos-planos.md` §3.5 llama a esa pieza *«el único
   cimiento legal del plano B»*: **el cimiento está vaciado, falta la casa.** (Corregir `CLAUDE.md`.)

El único módulo con uso real es **`formularios`: 696 respuestas**. Lo demás es superficie sin dato.

### 2.5 ⚠️ La ranura comercial ya está vendida — y su nombre contradice el producto

El catálogo `fase_3.subservicios` tiene precio por subservicio. Medido:

| Subservicio | Precio | Candidaturas activas | ¿Tiene software? |
|---|---:|---:|---|
| Agentes de Campo | 3.000 | 15 | ✅ `agentes_campo` |
| Path To Victory | 500 | 14 | ✅ |
| Encuestas Estratificadas | 8.000 | 11 | ❌ |
| **Alcance masivo digital y mensajería** | **2.500** | **9** | ❌ **ninguno** |
| Cuarto de Guerra | 1.500 | 10 | ❌ |
| Agentes Digitales | 2.000 | 10 | ❌ |
| Formularios · Mapeo de actores · Estudio de Realidad | 500–3.000 | 10 · 10 · 8 | ✅ |

**Nueve candidaturas ya pagan «mensajería» y no reciben ningún software por eso.** Ésa es la ranura
—no hace falta inventar un ítem comercial nuevo: hace falta darle `codigo` a la fila que ya existe.

🔴 **Y ahí está la tensión que hay que resolver ANTES de escribir código**: la ranura se llama
**«Alcance masivo»** y Hermes existe, entre otras cosas, para **no poder** mandar masivo. Vender un
producto y entregar su contrario es peor que no entregar nada. **Es la decisión D3 de §7.**

---

## 3. LA FORMA — cómo se construye

### 3.1 La topología

```
   apolo / deck-form  ──── activa el subservicio por candidatura (fase_3) ────┐
                                                                              │
   ┌──────────────────────────────────────────────────────────────────────────▼───┐
   │  CENTURIÓN (monolito)   identidad (cn_token) · entitlement · launcher /app    │
   │      └─ módulo UI liviano `mensajeria/`  ← la mesa: cola · hilo · ficha       │
   └───────────────────────────────┬──────────────────────────────────────────────┘
                                   │ service token JWT (aud='svc-mensajeria') + id_candidatura
   ┌───────────────────────────────▼──────────────────────────────────────────────┐
   │  SATÉLITE «mensajería»  (una instancia POR CANDIDATURA)                      │
   │   webhook Meta · TransporteCloudApi · EnvioControlado · cola · procedencia   │
   │   base propia  ·  credenciales Meta del comando  ·  loopback + nginx         │
   └──────────────────────────────────────────────────────────────────────────────┘
                                   ▲
                    kernel-hermes@x.y.z  (librería versionada, NUNCA un servicio)
```

### 3.2 PROPUESTA — **una instancia por candidatura**, y el costo dicho en voz alta

`dos-planos.md` §3.2 clasifica el dato por clase, y **una conversación con un vecino es «identificable
de ciudadano»: grado mínimo = base o nodo por tenant.** Además hay un argumento que no es teórico:

> **La frontera de credencial YA es por candidato.** Cada comando tiene su propio WABA, su
> `phone_number_id` y su token de Meta. Un proceso que sostiene los tokens de N campañas rivales es un
> único punto donde una fuga cruza una elección entera.

**El costo honesto**: aprovisionar N contenedores, migrar N bases, juntar observabilidad de N, y
distribuir doctrina a N lugares. Con **N = 9** (los que ya pagan) eso es barato. **Con N = 69 se
vuelve el problema principal** — por eso el aprovisionamiento es parte del producto desde el peldaño 1
y no una tarea de infra para después.

**La alternativa más barata, con lo que cede**: un proceso, **una base por tenant**, conexión resuelta
por entitlement. Ahorra contenedores; **conserva el riesgo de 1** (una credencial de proceso, un bug
de ruteo, un incidente de seguridad alcanzan a todos). Aceptable **solo** si se decide que Goberna
nunca trabaja para dos candidatos de la misma elección (**D2**, §7).

### 3.3 Cómo viaja el código: `kernel-hermes`, librería versionada

Ya es el estilo de la casa (`piezas/` con sus vectores literales y tests de paridad). El paquete
lleva: `TransporteWhatsapp` + `TransporteCloudApi`, `EnvioControlado`, `piezas/`, `procedencia/`,
`resultados/`, la ventana de 24 h, la escala de entrega, `limitesMedia`, el reparto por carga.

**Prohibiciones que viajan con él, y son tests, no comentarios**: sin `enviarMasivo`; una regla que
existe dos veces tiene test de paridad; una dependencia caída da **error con código, jamás una lista
vacía**; ningún nombre de métrica promete causa.

### 3.4 Cloud API y solo Cloud API — y el carril B no se toca

`GOBERNA-TERRITORIO-x-DIGITAL.md` §3 ya fijó los dos carriles y este servicio **es enteramente el
carril A**: número **WhatsApp Business del comando**, Cloud API oficial, todo lo automatizado vive
ahí. El **número personal del candidato es carril B: conversación humana, cero software.** El satélite
no debe siquiera poder configurarlo.

Consecuencia dura: **whatsmeow no se despliega en el plano B, nunca** (política 2026-07-03). Y como el
tope de adjuntos es **del transporte** (`limitesMedia.ts`), en Cloud API rigen los de Meta —imagen
5 MB, video 16 MB— con el 409 `adjunto_muy_pesado` y la compresión de ADR 0038 haciendo su trabajo.

---

## 4. EL DICCIONARIO — qué se traduce y qué no tiene traducción

### 4.1 La tabla

| Hermes (Escuela) | Campaña | Nota |
|---|---|---|
| Vendedora | **Operador del comando** | Mismo modelo: `reparto` round-robin por carga, sin favoritismo |
| Lead | **Vecino / ciudadano** | La entidad ya existe: `territorio.contacto` |
| Curso (interés) | **Tema / demanda** (agua, seguridad, pistas) | Mismo seam `intereses`: **una sola fuente de verdad** |
| Precio / cotización | **—** | No hay. `senales/cotizacion.ts` no se traduce: se retira |
| Venta | **Compromiso** (§4.3) | 🔴 No es el mismo tipo de hecho |
| Cerberus (verdad) | **🔴 no existe** | §4.2 |
| Padrón de clientes (icarus) | **Padrón electoral / territorio** | Otra fuente, misma forma de frontera |
| Línea de WhatsApp | **Número del comando** | 1 WABA por candidatura |
| Campaña de anuncio | **Punto de captación (QR)** | `captacion.qr` ya trae `[CODIGO]` = de qué mercado vino |
| Momento de venta | **Momento de contacto** | Es `sugerencias/estado.ts`: hay que parametrizarlo (§1.3) |

### 4.2 🔴 Lo que NO tiene traducción: **Cerberus. Y por eso el lazo no cierra igual**

Todo el valor demostrado de Hermes cuelga de una propiedad del plano A: **la venta se registra el
mismo día, con monto, contra la misma persona**. Eso es lo que hace que `resultados/` pueda decir «esta
pieza vende y aquella no» con `n` y base.

En una campaña:

- **El resultado llega una vez, al final, y es secreto.** No hay evento por persona. La ONPE da un
  agregado por mesa, meses después, y el voto no se puede atribuir a una conversación **ni debe
  poder**.
- Sin un sustituto declarado, `resultados/` mediría **cero**, y el CRM del candidato sería exactamente
  lo que `dos-planos.md` §7 llama *«narrativa con decimales»*.

**PROPUESTA — el compromiso observable como sustituto, declarado y con su base.** Hechos que sí
ocurren, se ven y se pueden fechar:

| Compromiso | Cómo se observa | Fuente |
|---|---|---|
| **Contestó** | primer entrante | el hilo (ya está) |
| **Dio su dato** | teléfono/DNI/dirección confirmados | ficha |
| **Vino** | asistió a un evento/mitín | check-in por QR (`captacion` ya lo hace) |
| **Trajo a alguien** | refirió un contacto | el `[CODIGO]` del QR compartido |
| **Se puso la camiseta** | voluntario / brigadista | `territorio.brigadista` |
| **Dejó poner el cartel** | permiso de fachada | `territorio.visita` |

**La regla que se hereda intacta de ADR 0022 y hay que gritar acá**: *los nombres no prometen causa*.
«Los vecinos contactados con la secuencia A se ofrecieron de voluntarios 3× más» es decible.
«La secuencia A gana votos» **no lo es, nunca**, y el test que prohíbe palabras causales viaja con el
kernel.

### 4.3 El embudo del candidato — se deriva de lo que hizo el VECINO

ADR 0044 es la lección más cara del repo y se traslada tal cual: *las condiciones de salida de una
etapa se definen por **acciones del comprador**, no por actividades del vendedor*. Ahí se descubrió
que **2.252 de 3.050 «Cotizados» (74 %) nunca habían escrito una palabra**: era difusión disfrazada
de embudo.

En campaña el error sería idéntico y **peor**, porque el volumen de difusión es mayor. Las columnas:

```
Sin respuesta  →  Contestó  →  Se identificó  →  Se comprometió  →  Activo
(le hablamos,     (hay un      (dio su dato     (vino / se ofreció  (milita, trae
 nada volvió)      entrante)    y su tema)       / dejó el cartel)   gente)
```

**`Sin respuesta` es la columna más grande y tiene que estar a la vista** (en la Escuela es el 65 %).
Es la que impide que el tablero se vea lleno mientras el caño está cerrado.

---

## 5. VEREDICTO POR MÓDULO — qué se lleva, qué se reescribe, qué se tira

| Módulo | Veredicto | Por qué |
|---|---|---|
| `whatsapp/` (transporte, `EnvioControlado`, ingesta, `limitesMedia`) | 🟢 **Se lleva** | Menos `wiring→bot` (2 imports) |
| `piezas/` `procedencia/` `resultados/` | 🟢 **Se lleva** | El libro de decisiones. Solo se cambia el sustituto de «venta» (§4.2) |
| `cola/` (urgencia, ventana 24 h, filtros, orden) | 🟢 **Se lleva** | Menos `→gestiones` y `→dashboard` (4 imports) |
| `entrega/` `reacciones/` `numeros/` `reparto/` `identidad/` `telefono/` | 🟢 **Se lleva** | Genéricos, con sus tests de paridad |
| `espacios/` `notas/` `eventos/` | 🟢 **Se lleva** | La libreta y el timeline escribible sirven igual a un comando |
| `autorespuesta/` | 🟡 **Se lleva la MÁQUINA, se tiran las plantillas** | La máquina de estados, el ritmo, los dos modos y la caducidad son oro. Las plantillas son de la Escuela |
| `catalogo/` | 🟡 **Se lleva parametrizado** | Hoy importa `sugerencias/estado.ts`. El vocabulario tiene que ser **dato del tenant** |
| `bot/` (12.718 líneas) | 🟠 **El más valioso y el más contaminado** | Guardrails, frenos, claim, reenganche y traza son genéricos; `piezaAMandar`, `contexto` y el prompt hablan de cursos y precios. **No entra al peldaño 1** (§6) |
| `sugerencias/estado.ts` | 🔴 **Se parametriza — es LA frontera** | Desbloquea 5 de los 16 cruces (§1.3) |
| `cerberus/` `cursos/` `clientes/` `hechos/` `plantillas/` `negocio/` `atribucion/` `gestiones/` `padron/` `icarus/` `campana/` `dashboard/` `corridas/` | ❌ **No van** | Adaptador de Escuela. Su equivalente se escribe contra el core de Centurión |
| `analisis/` `canales/` `decisions/` `pauta/` `ontologia/` `fuentes/` `sdk/` `lazo/` `meta/` | ❌ **Ni se miran** | Deuda de meta-escuela |
| Front: `canales` `whatsapp` `panel`(esqueleto) `notas` `agenda` `eventos` `reparto` `autorespuesta` | 🟢 **Se lleva** | La mesa de trabajo. Se reescribe el **contenido** del panel, no su forma |
| Front: `cerberus` `venta` `padron` `campana` `hechos` `plantillas` `entrenamiento` `dashboard` | ❌ **No va** | Escuela |
| `src-tauri/` (la cáscara) | ❌ **No va, y no es discutible hoy** | El build de Windows está roto desde el 4-ago y no es gate de PR. Un comando de campaña usa **el navegador** |

---

## 6. EL PLAN — peldaños con gate, no fases

Cada peldaño **termina en un hecho medible**. Ninguno empieza sin que el anterior haya dado su número.

### Peldaño 0 — Prender lo que ya está (días, cero código nuevo)

1. Aplicar la migración de `captacion` y dar de alta el subservicio en `fase_3` (lo hace apolo).
2. Poner un QR real en un punto real de una candidatura piloto.
3. **GATE**: `select count(*) from captacion.escaneo` **> 0**. Sin eso, no hay funnel que instrumentar
   y todo lo demás es especulación. *(Hoy: la tabla no existe.)*

### Peldaño 1 — La línea en Hermes (1 sprint, todo del lado Escuela, sin riesgo)

1. **Test de dependencia en CI**: el motor no importa del adaptador. Arranca con los **16** cruces
   medidos como allowlist explícita y con fecha de caducidad.
2. **Parametrizar `sugerencias/estado.ts`**: el «momento» pasa a ser dato, no enum.
3. Extraer `kernel-hermes@0.1.0` con lo verde de §5 + sus tests.
4. **GATE**: la allowlist llega a **0** y la Escuela sigue andando con el kernel importado.

### Peldaño 2 — El satélite mudo (recibe y guarda; no manda nada)

1. Contenedor + base propia + `service.manifest` (`codigo: 'mensajeria'`, `aud: 'svc-mensajeria'`).
2. Identidad contra el core de Centurión (**sin login paralelo**), entitlement por candidatura, todo
   scopeado por `id_candidatura` **de la identidad, nunca del cliente**.
3. Webhook de Meta con firma HMAC + idempotencia. **Parsea `[CODIGO]`** y ata el chat al punto del
   territorio: eso cierra el loop de `captacion`.
4. **GATE — el de ADR 0042, literal**: *contá filas en `events`, nunca leas componentes*. Sin filas,
   el peldaño no está hecho aunque la UI se vea.

### Peldaño 3 — La mesa (módulo UI en Centurión)

Cola + hilo + ficha del vecino, con la ventana de 24 h y los ✓✓. Envío **1 a 1 por
`EnvioControlado`**, con su ritmo y sus frenos. Nada de plantillas todavía.
**GATE**: un operador real atiende un día entero sin volver a WhatsApp Web.

### Peldaño 4 — El embudo del vecino y el compromiso

Las cinco columnas de §4.3 derivadas, `Sin respuesta` incluida. `procedencia` + `resultados` con el
**compromiso** como sustituto declarado.
**GATE**: la primera pregunta no es «¿cuál funciona?» sino **«¿alguien las está usando?»**.

### Peldaño 5 — Recién acá: plantillas aprobadas y auto-respuesta supervisada

Plantillas de Meta (las de Cloud API se aprueban, no se inventan) y el modo **supervisado** de
ADR 0018: **el comando no manda solo, siempre hay una persona aprobando**.
**GATE**: el simulacro (`auto:simulacro`) imprime el plan real sin mandar nada y **cada renglón
empieza por la hora local en que escribió la persona** (la lección de #166).

### Nunca — el bot autónomo del candidato

No hasta que existan los peldaños 0–5 con números, un banco de pruebas propio y una decisión escrita
del dueño. **Un LLM contestando en nombre de un candidato en campaña es una declaración pública.**

---

## 7. LO QUE HAY QUE DECIDIR — dueño, no arquitecto

| # | Decisión | Por qué bloquea |
|---|---|---|
| **D1** | **¿Instancia por candidatura, o una sola con base por tenant?** (§3.2) | Define costo operativo, precio y postura de seguridad. **Ninguna otra decisión se puede tomar antes.** Es la #1 de `dos-planos.md` §11, aterrizada |
| **D2** | **¿Goberna trabaja para dos candidatos de la misma elección?** | Si es «sí», el aislamiento duro deja de ser opcional **y hay que poder demostrarlo, no afirmarlo** |
| **D3** | **La ranura vendida dice «Alcance masivo» y el producto no manda masivo** (§2.5) | Nueve candidaturas ya pagan. O se renombra la ranura, o se entrega otra cosa, o se define qué significa «masivo» dentro de lo que Meta permite (plantillas aprobadas, opt-in) |
| **D4** | **¿De quién es el dato del vecino** que carga un brigadista, y qué pasa el día después de la elección? | Sin export + borrado verificable escritos, es materia de protección de datos y de normativa electoral peruana |
| **D5** | **¿Quién paga el WABA y quién es el dueño de la cuenta de Meta?** | Si es de Goberna, un bloqueo cruza campañas. Si es del candidato, el onboarding es más lento y más seguro |
| **D6** | **El nombre.** «Hermes» es de la Escuela | PROPUESTA: `codigo = 'mensajeria'` (le da software a la fila que ya existe en `fase_3`); nombre de producto a elección — **Heraldo** es hermano semántico de Hermes |

---

## 8. Cómo se falsifica este planteo

- **Si el peldaño 0 no da escaneos.** Si el QR en la calle no produce chats, el funnel territorial no
  existe y esto es un CRM buscando un problema. *Prueba: `captacion.escaneo` a los 30 días.*
- **Si el compromiso no se puede observar.** Si en una campaña piloto ninguno de los seis hechos de
  §4.2 se registra con volumen, `resultados/` no tiene qué medir y el activo diferencial de Hermes no
  se transfiere. *Prueba: cuántos compromisos por vecino contactado en 60 días.*
- **Si la doctrina no generaliza.** Si del candidato 1 al 2 hay que reescribir el 80 % de las piezas,
  no hay activo transversal: hay consultoría con buen tooling. *Prueba: % de piezas reusadas sin código
  nuevo (el gate de generalización de `dos-planos.md` §11.5).*
- **Si la línea no se puede dibujar.** Si el peldaño 1 no baja la allowlist a 0 en un sprint, el motor
  no era un motor y hay que decirlo antes de vender la extracción. *Prueba: el número del test de
  dependencia.*

---

*Mapeo medido el 10-ago-2026: Hermes contra el checkout canónico; Centurión contra `goberna_web_dev`
(read-only, solo conteos). Marco: [`dos-planos.md`](dos-planos.md). Contratos:
`apolo/centurion/MICROSERVICE-CONTRACT.md` y `MODULE-CONTRACT.md`. Política de carriles:
`GOBERNA-TERRITORIO-x-DIGITAL.md` §3.*
