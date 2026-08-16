# El Hermes de campaña — plan de implementación

> **Qué es esto.** Cómo se construye, paso por paso, el entorno de campaña separado del Hermes de la
> Escuela. Escrito el **12-ago-2026**, con **53 días** hasta la elección (4-oct-2026).
>
> **Qué NO reemplaza.** [`plan-hermes-para-candidatos.md`](plan-hermes-para-candidatos.md) sigue
> siendo **el mapa** (qué se lleva, qué se reescribe, las decisiones D1–D6) y
> [`plan-de-ataque-hermes-candidatos.md`](plan-de-ataque-hermes-candidatos.md) **el orden de los tres
> carriles**. [`dos-planos.md`](dos-planos.md) sigue siendo el marco. Este documento es lo que falta:
> **la ejecución**, después de que la integración de emergencia del 11-ago cambió el punto de partida.
>
> **Cómo leerlo.** Lo que dice un número **está medido** y dice contra qué. Lo que es propuesta dice
> **PROPUESTA**. Lo que necesita al dueño está en §2 y en ningún otro lado. Cada paso termina en un
> **GATE**: un número contra una fila de la base, nunca una sensación.
>
> **Origen de los números.** `hermes_db` en VPS1 (read-only, solo `SELECT`), 12-ago-2026, contra
> `origin/main = 5f3571f`, que es el mismo SHA que corre en `/srv/hermes`. Once agentes de medición y
> cinco refutadores adversarios; donde el refutador corrigió a la sonda, va el número corregido.

---

## 0. La decisión, en una frase

**El entorno de campaña es una segunda instancia del mismo código, con base propia, `.env` propio y
servicio propio** — no una columna de tenant, no un recorte más, y no el satélite de Centurión, que
no llega al 4 de octubre y decir que llega es exactamente cómo se produjo el 11-ago.

El argumento entero cabe en una línea:

> **En un nodo de un solo tenant, «no recortar» y «recortar bien» dan el mismo resultado.**

Los ~25 endpoints que hoy sirven cualquier conversación a cualquier token, el broadcast del SSE, el
chip de curso, la píldora «Cliente», las plantillas de la Escuela, Correos, el `default('escuela')` de
`proposito` y el bug de la mayúscula **desaparecen solos** el día que la campaña tiene su propia base.
Ninguno hay que arreglarlo. Ese es el 100 % del valor de esta decisión.

---

## 0.5 ESTADO AL 13-AGO-2026 — leé esto primero

> **Para quien retoma.** Esto es lo que cambió DESPUÉS de escribir el plan, ejecutándolo. Donde este
> bloque contradiga al resto del documento, **gana este bloque**: el resto se midió el 12-ago y varias
> de sus afirmaciones se falsificaron al intentar aplicarlas.
>
> **Quedan 52 días** hasta el 4-oct-2026.

### 1 · Lo que YA está aplicado en producción (VPS1)

| qué | cómo quedó | con qué se verificó |
|---|---|---|
| **§0.1 rebasar el checkout** | al día con `origin/main` | `HEAD..origin/main` = **0** · `tsc --noEmit` verde en front **y** server |
| **§0.3 la línea fuera de `BOT_LINEAS`** | `BOT_LINEAS=51984429504` | el arranque anuncia `[bot] 1 línea(s) habilitada(s): 51984429504` |
| **§0.2 el corte de whatsmeow** | `WHATSAPP_TRANSPORTE=falso` | `grep -c 51963139984` en el journal desde el corte = **0** — la sesión del candidato **no se monta** |
| la línea que factura | `51984429504` (Cloud API) | `[wa estado] 51984429504: conectado` después de cada reload |

Respaldos en VPS1: `server/.env.bak-12ago-1553` y `server/.env.bak-corte-whatsmeow-1602`. **Revertir es
una línea y un restart.**

⚠️ **Por qué el corte de whatsmeow no costó nada**: la Escuela ya corría con **una sola** línea viva y
es la Cloud API, que monta **aparte y siempre** (`wiring.ts:215`), independiente de
`WHATSAPP_TRANSPORTE`. Las otras tres whatsmeow se habían retirado el 11-ago. O sea que whatsmeow en el
server de Goberna era peso muerto cuyo único efecto vivo era tener la cuenta de un candidato adentro.

> 🔴 **Y el corte tiene un efecto colateral MEDIDO que arregla el fix de código, no otro parche.**
> `TransporteFalso` **sí** implementa `fotoDePerfil` y, estando «conectado», devuelve `null` — que la
> ruta cachea como **«no tiene foto», una respuesta real**. Van **31 filas** así, y el caché dura
> **7 días** (`FOTO_FRESCA_MS`, `routes/whatsapp.ts:411`). **No es fuga** —nada salió por la cuenta del
> candidato— es basura en el caché, y sale de la misma causa raíz que §0.2.

### 2 · Las tres correcciones al documento, encontradas ejecutándolo

1. 🔴 **El «camino rápido» del §0.2 no existía.** Ver el §0.2, ya reescrito: sus dos formas fallan en
   direcciones opuestas y el plan nombraba **una sola** de las **dos** variables que tienen el número.
2. 🔴 **`POST /leido/:telefono` YA lleva `numeroPropio`** (query, `routes/whatsapp.ts:279`) y ya
   resuelve `gestorWhatsapp().de(numeroPropio)`. El §0.2 lo listaba como si no lo llevara. Lo único que
   queda ahí es el `else` de `:320`. **La fuga real es `GET /foto/:telefono`, y es UNA línea:
   `routes/whatsapp.ts:428`, `whatsapp().transporte`.**
3. ⚠️ **`fotoDePerfil` NO existe en el transporte Cloud API** (`whatsapp/transporte.ts:294-319`: la
   tienen whatsmeow y el falso, no cloud-api). Pasarle `numeroPropio` a `/foto` **no alcanza**: con la
   línea de la Escuela el método queda `undefined`, y hay que decidir explícitamente que eso **no se
   cachea como «no tiene foto»**. Es el mismo defecto que acaba de escribir las 31 filas.

### 3 · Las decisiones del dueño (13-ago)

| # | decisión | qué cierra |
|---|---|---|
| **D1** | **Instancia por candidatura** — un producto, N instancias: base, `.env`, servicio y dominio propios | la Fase 1 entera. **Descarta la columna de tenant** (opción D del §3) |
| **D2** | **Sí, varios candidatos.** Y por eso la instancia: entre rivales el aislamiento no puede ser un `WHERE` | la forma de D1 |
| destino | **Hermes-candidato vive DENTRO de Centurión** (el satélite, carril 3). **B es el puente, no el destino** | reabre el reloj del plan de integración §8 |
| auth | **No hay microservicio de auth central** — un seam con proveedores, y para campaña el proveedor **es Centurión** | ver §4 acá abajo |
| alta de operadores | **el admin candidato crea y administra los agentes digitales DESDE Centurión** | el Hermes de campaña **no necesita tabla de usuarios** |
| la línea de Betto | se puede desvincular y re-vincular libremente | habilitó el corte de whatsmeow |

**Por qué NO un auth central, en una línea**: sería **un servicio corriendo compartido entre los dos
planos**, que es exactamente lo que `dos-planos.md` §4 llama *«la peor idea disponible»*; y no sacaría
una dependencia, agregaría un salto — las vendedoras existen en **Cerberus** porque es el ERP donde son
empleadas, y los agentes digitales existen en **Centurión** porque ahí viven la candidatura y el
entitlement. Un central tendría que sincronizar de los dos, y una sincronización es una segunda copia
de la verdad (#37).

### 4 · 🔴 EL SSO DE CENTURIÓN YA ESTÁ CONSTRUIDO Y MERGEADO — esto cambia la Fase 2

`c7d797a` + `cc7375b`, vivos en `main`. **Lo que el plan estimaba en 2,5–3 días (la tabla `operadores`
local) probablemente no haya que escribirlo nunca.**

- **`POST /api/auth/centurion`** verifica un JWT HS256 corto (**120 s**, `aud: 'hermes'`) que Centurión
  firma. `server/src/auth/centurion.ts`, HMAC de `node:crypto`, **cero dependencias nuevas**: Hermes solo
  **verifica**, nunca firma.
- 🔴 **El secreto es NUEVO (`CENTURION_SSO_SECRET`), jamás el `JWT_SECRET` del core de Centurión** — y
  esto **corrige al plan de integración §3.1**, que proponía compartir el del core. El motivo está en
  `centurion.ts:10-12`: compartirlo *«le daría a Hermes la llave para falsificar cualquier sesión de
  Centurión, no solo un login»*. **Si tocás el plan de integración, actualizá ese §3.1.**
- **La identidad vive namespaced: `centurion:<usuario>`** (`vendedoraIdDeCenturion`), para que **nunca**
  pueda chocar con un username de Cerberus. Es #37 resuelto por construcción: dos formas de nombrar a
  la misma persona no se desincronizan si una lleva un prefijo que la otra no usa jamás.
- **Apagado por default**: sin `CENTURION_SSO_SECRET` → **503 `sso_no_configurado`**, y `verificarToken`
  no valida nada ni por accidente. Nace pensado para el `.env` del entorno de campaña.
- 🔴 **Sin línea asignada, 403 `sin_linea_asignada`** (`cc7375b`) — y el porqué está **medido**: el
  catálogo de subservicios de Centurión es **COMPARTIDO y 9 candidaturas ya tienen «mensajería»
  contratada**. El día que ese catálogo se complete, el botón aparece **para las 9 a la vez**; sin el
  candado, la primera que hiciera clic vería **la cola entera de la Escuela**. `cola/lineas.ts` es
  fail-open a propósito para vendedoras de Cerberus (personal interno); una identidad de Centurión es
  lo opuesto — una persona **ajena** al negocio.
- ✅ **Y responde la duda que este plan tenía abierta**: `centurion.ts:7-8` dice que es *«el reverso
  exacto de `service-token.ts` del lado de Centurión, el mecanismo servicio↔servicio que ya existe ahí
  para `svc/mensajeria`»*. **Centurión ya sabe emitir para un servicio externo.**

**Falta la otra mitad, y es del otro repo**: Centurión firmando el token + el botón del sidebar
(PR aparte en `Goberna-Lab/centurion`).

> 🔴 **EL BLOQUEO QUE ESTO DESTAPA, Y ES EL PRÓXIMO FRENTE REAL.** El alta de un agente digital son
> **dos pasos en dos sistemas**: (1) la cuenta en Centurión y (2) **una línea en `numero_vendedora`**,
> sin la cual el 403 lo rechaza. Y lo **único** que escribe `numero_vendedora` es
> `PUT /api/admin/numeros/:numero`, cuyo dueño es **Cerberus** — que en el entorno de campaña **no va a
> existir**. O sea: **en el entorno de campaña, hoy, TODA identidad de Centurión comería 403 y el SSO
> sería inusable.** Lo que lo destraba es el **CLI gemelo del alta de números** — que el plan tenía
> como Fase 2 · paso 4, ahí descrito como accesorio, y ahora **es la precondición del login**.

### 5 · Por dónde sigue la sesión nueva

1. **El CLI gemelo de `numero_vendedora`** (Fase 2 · paso 4). Es el bloqueo de arriba: sin él el SSO ya
   construido no se puede usar en campaña. **Empezar por acá.**
2. **`GET /foto/:telefono` con `numeroPropio`** (§0.2 «correcto»), + no cachear falso-negativo cuando el
   transporte no tiene `fotoDePerfil`. Limpia además las 31 filas.
3. **El test de dependencia motor↔adaptador** (#338, §5 de este plan) — independiente de todo lo demás.
4. **D5 por escrito** (§0.4). Sigue abierta, y es lo que destraba el trámite de Meta, que es el camino
   crítico del satélite y **no es código**: *«si no empieza esta semana, el satélite no arranca en
   noviembre: arranca en enero»* (plan de integración §8).
5. **La Fase 1** con la forma de D1 (instancia), ya sabiendo que la identidad sale de Centurión.

⚠️ **Y una deuda de tenancy que hoy no muerde y mañana sí**: el token trae `candidatura`, pero
`centurion.ts:35` dice **«Hoy es solo informativo»**. Con una instancia por candidatura eso está bien
—el proceso entero *es* el tenant—. **En un proceso compartido sería la frontera**, y es justo lo que
D1 decidió no hacer.

---

## 1. El punto de partida, medido

### 1.1 Lo que hay que mudar es chico. Lo enredado es el runtime

| | medido |
|---|---:|
| Filas del candidato en `hermes_db` | **738** de 56.824 (**1,3 %**), en 13 tablas |
| Personas · mensajes | **26** · 243 |
| Archivos en `.wa-media` | 35 (~38 MB de un directorio de 12,3 GB) |
| Sesión de whatsmeow | **un SQLite de 368 KB** |
| Tablas con dato de campaña y **sin** discriminador | 2 (`reacciones_wa` con 0 filas, `fotos_perfil`) |
| Filas en `gestiones` · `intereses` · `conversacion_asignada` de esa línea | **0 · 0 · 0** |
| Envíos con pieza estampada | **0 de 80** (100 % línea de base) |

**La mudanza no va a ser más barata que hoy**, y la línea está caída desde el 12-ago 03:01
(`sin-vincular` desde las 13:42). La ventana está abierta.

Lo enredado es lo otro: **un `systemd`, un `hermes-deploy.sh` con `SERVICIO=hermes` clavado, un vhost,
una base, un journal, 20 respaldos sin cifrar, una cuenta de Bedrock, y un padrón de usuarios que es
Cerberus.**

### 1.2 Las cinco fugas que están abiertas hoy

Ninguna es teoría: las cinco están medidas en producción, con fecha.

1. 🔴 **`WHATSAPP_NUMEROS=51963139984`.** La **única** línea whatsmeow del servidor de producción de la
   Escuela es la del candidato, así que `whatsapp()` (= `primero()`) resuelve a su cuenta: **salieron
   205 consultas de foto de perfil por el WhatsApp de Betto, 180 de ellas sobre leads de la Escuela.**
   El riesgo de ban lo genera la Escuela y lo paga el candidato.
2. 🔴 **El bot mandó 49 mensajes reales firmados como el candidato** (11-ago 13:19–16:38 Lima, 19
   vecinos). Hoy está frenado por **dos** compuertas coincidentes (`BOT_MODO=sombra` en el `.env` y la
   fila de `bot_estado` puesta a las 16:43 por `estephano-via-cli`), pero `BOT_LINEAS` **sigue
   incluyendo la línea**: el bot razona sobre cada mensaje de vecino, y en sombra **igual escribe** —
   `paso15Ejecutar` no mira el modo, y ya hay 5 calificaciones y 5 pausas de vecinos en tablas de la
   Escuela.
3. 🔴 **El prompt de campaña nunca llegó al modelo.** `orquestador.ts:549` le pasa al agente
   `CATALOGO_POR_DEFECTO` —cuotas, campus por un año, «el diplomado es para público general»— y **no**
   los 4 hechos de Betto. El `ctx.systemPrompt` que sí usa el perfil **no lo lee nadie**. El test que
   debía atraparlo (`perfiles.test.ts`) está **verde porque arma el prompt a mano**, con una
   combinación que el pipeline nunca produce.
4. 🔴 **El recorte de `4acf831` está inerte en las dos direcciones.** `luz`, `alan` y `Usuario1` no
   tienen fila en `numero_vendedora` (la que existe dice `Luz`), así que `soloSusLineas` nunca se
   activa: **`alan` abrió conversaciones del candidato el 12-ago 17:14**, con el commit desplegado. Y
   el operador del comando abrió 4 de la Escuela.
5. 🔴 **Un deploy de la Escuela tira la línea del candidato.** Medido el 12-ago: `tsx watch` recargó
   sobre el `git checkout --force` del deploy **antes del `npm ci`** → **41 s de API muerta con
   systemd reportando `active (running)`** (`Restart=always` nunca se disparó porque el padre npm
   siguió vivo), y la línea quedó `sin-vincular`. Es asimétrico por construcción: la Cloud API es HTTP
   sin estado y cruza cualquier restart; whatsmeow carga sesión de disco y no.

### 1.3 Y una trampa que decide el orden de todo lo demás

🔴 **El server ya levanta hoy sin `CERBERUS_BASE_URL`, y eso es el problema, no el alivio.** Nada la
valida al arranque y **los 7 sitios que la leen tienen `?? 'https://app.goberna.us'` hardcodeado**. O
sea: un entorno de campaña al que se le "corta Cerberus" borrando la variable **no falla — le consulta
el ERP de la Escuela en silencio**, con el teléfono de cada vecino.

Por eso el paso 1 del corte no es sacar código: es **convertir ese fallo mudo en un fallo ruidoso**.

---

## 2. Lo que hay que decidir antes de escribir código

La integración de emergencia **ya tomó cinco de las seis decisiones de
[`plan-hermes-para-candidatos.md`](plan-hermes-para-candidatos.md) §7**. Ninguna se escribió. Este
plan supone las respuestas de la columna «recomendación»; si alguna cambia, cambia el plan.

| # | Decisión | Cómo quedó tomada de hecho | Recomendación | Bloquea |
|---|---|---|---|---|
| **D5** | ¿de quién es la cuenta de WhatsApp y con qué transporte se opera? | Por elusión: no hay WABA; se vinculó el número por QR con **whatsmeow**, que la regla dura #7 prohíbe para clientes | **Escribir un ADR corto que diga cuál de las dos**: (a) se asume el riesgo por escrito hasta el 4-oct y se contiene con el entorno propio, o (b) se retira la línea (opción E de §3). **No hay tercera** | Todo. Es lo primero |
| **D1** | ¿instancia por candidatura o base por tenant? | Ni una ni otra: misma base, sin columna de tenant, con **una celda** (`numeros_wa.proposito`) de marcador | **Instancia propia** (§3) | La ejecución entera |
| **D1b** | ¿de quién es el vecino? | De la Escuela, custodio Cerberus: `bot/contexto.ts:87` le pide la ficha por teléfono en cada turno | **Del entorno de campaña.** Y decidirlo **antes** del primer enlace: `ontologia.personas` tiene **0 filas**, y un clic de «es la misma persona que…» funde a un vecino con un lead de diplomados y eso no se deshace, se revoca | El perfil (§7) |
| **D2** | ¿dos candidatos de la misma elección? | Por omisión, «no puede»: el segundo arranca hablando como Sofía Rodríguez (el default de `PERFIL_POR_LINEA`) y cae en la misma base | **Hoy, no.** Y decirlo antes de vender el segundo | La forma de D1 |
| **D3** | la ranura vendida dice «Alcance masivo» y el producto no manda masivo | Al revés de la política: se automatizó | Ver §7.4: hay un número medido (**17×**) que convierte D3 en una decisión con evidencia | La venta, no el código |
| **D4** | ¿de quién es el dato del vecino y qué pasa el 5 de octubre? | De Goberna-Escuela: en 2 respaldos **sin cifrar**, un `.env` **0664** legible por los 14 runners de Actions, y un journal con teléfonos | **Export + borrado verificable escritos antes del primer piloto** (§7.5). Hoy no existen | El contrato |
| **D6** | el rótulo que el candidato lee | No hay: la palabra «campaña» aparece **0 veces** en `src/` | Elegir la palabra. Es media hora y desbloquea el alta | El front (§6) |

> 🔴 **La que ni figuraba.** El plan del 10-ago tiene una sección titulada **«Nunca — el bot autónomo
> del candidato»**: *«Un LLM contestando en nombre de un candidato en campaña es una declaración
> pública.»* Duró **3 h 19 min**. Prender el bot de campaña otra vez necesita una decisión escrita,
> no una fila de `bot_estado`.

---

## 3. La arquitectura elegida, y las cuatro que se descartan

| | **A** recortes | **B** instancia propia | **C** satélite Centurión | **D** columna tenant | **E** retirar la línea |
|---|---|---|---|---|---|
| Costo | ~15 frentes chicos | **3 días infra + 1 mudanza** | 1 trimestre + trámite Meta | semanas + RLS que nadie hará | horas |
| Riesgo | fail-open mudo (ya falló ×2) | migración de datos | apurarlo = catástrofe | igual que A, ×25 call-sites | ninguno |
| Deploy de la Escuela | **la tira** | **no la toca** | no la toca | **la tira** | N/A |
| Ban de la línea | la Escuela lo **causa** | aislado en ambos sentidos | Cloud API, con soporte | igual que A | vuelve al comando |
| ¿Llega al 4-oct? | sí | **sí** | **no** | no | sí |

**Se elige B.** A y D no se recomiendan en ningún escenario: **A no toca el daño medido** (runtime y
cuenta de WhatsApp), y **D paga el precio de multi-tenant sin comprar el aislamiento de runtime**, que
es donde está el daño. C es el destino correcto y **no compite con B**: B es el puente que deja el
dato ya separado y la calibración hecha, para que C se construya en noviembre sobre algo en vez de
sobre cero. **E sigue vivo como salida** si D5 se decide por (b).

**Lo que B NO arregla, y hay que decirlo:** el transporte sigue siendo whatsmeow (D5 intacta); los 20
respaldos viejos que ya contienen la campaña hay que purgarlos aparte; el runner de Actions sigue
siendo uno y serializa; y el nudo con Centurión —QR, formularios, territorio— sigue sin existir.

**Mismo VPS u otro.** Mismo VPS resuelve proceso, base, deploy y ban; **no** resuelve el journal
compartido, el `.env` legible por los runners ni el backup común. Otro VPS resuelve eso por un VPS, un
certbot y un runner más. Para **un** candidato y 53 días, mismo VPS con usuario propio y `.env` 0600
es defendible. **Para dos candidatos rivales no lo es** (D2).

---

## FASE 0 — Hoy, antes de una línea de código

> Nada de esta fase es un frente: son cuatro cosas que sacan el pie del acelerador. **Ninguna necesita
> que se decida la arquitectura.**

### 0.1 Rebasar el checkout (paso cero literal)

🔴 El checkout local está **45 commits atrás de `origin/main`** y **no compila**: `src/App.tsx` tiene
ediciones sin commitear que importan `features/routing/` y `features/vistas/acceso.ts`, que llegaron en
esos 45 commits. Todo lo medido en este documento sale de `origin/main`.

**GATE:** `git rev-list --count HEAD..origin/main` = **0** y `npx tsc --noEmit -p tsconfig.app.json`
pasa.

### 0.2 Cerrar la fuga de la cuenta de WhatsApp del candidato

Hoy `whatsapp()` resuelve a `primero()` y la primera es la del candidato.

> 🔴 **CORRECCIÓN DEL 12-ago, medida en VPS1: el «camino rápido» que este plan proponía NO EXISTE, y
> sus dos formas fallan en direcciones opuestas.** Decía *«sacar `51963139984` de `WHATSAPP_NUMEROS`
> (la línea ya está caída, no se pierde nada)»*. Lo que pasa de verdad:
>
> | qué hacés | qué pasa |
> |---|---|
> | `WHATSAPP_NUMEROS=` (vacío) | **la API de la Escuela se cae**: `''` no es nullish, así que `??` no cae al fallback → `numeros = []` → `wiring.ts:196` lanza → `Restart=always` en bucle |
> | borrar la línea entera del `.env` | **la fuga sigue idéntica y en silencio**: cae a `WHATSAPP_NUMERO`, que en producción **también vale `51963139984`** |
>
> La causa es `server/src/whatsapp/gestor.ts:41` — `env.WHATSAPP_NUMEROS ?? env.WHATSAPP_NUMERO ?? ''` —
> más el hecho, que este plan no había registrado, de que **el número del candidato está en LAS DOS
> variables**. Cualquier plan que nombre una sola de ellas está incompleto.

Queda **un** camino de `.env`, y **el** camino correcto:

- **`.env`, verificado**: `WHATSAPP_TRANSPORTE=falso`. La línea Cloud API monta **aparte y siempre**
  (`wiring.ts:215`), así que la Escuela no pierde la línea que trae los leads; la ruta de dev que
  inyecta entrantes está **doble-candada** (`NODE_ENV !== 'production'` **y** `hayFalso`, `index.ts:170`)
  y en VPS1 `NODE_ENV=production` viene del unit; y `TransporteFalso` no genera nada solo. Cuesta que
  la sesión whatsmeow del candidato **no se pueda abrir en este server** — decisión del dueño, no del
  código.
- **correcto**: darle su `numeroPropio` a `GET /foto/:telefono` y a `POST /leido/:telefono`, que hoy
  no lo llevan.

⚠️ **Y no hace falta un restart caliente.** Medido el 12-ago 15:50 Lima: la línea está `sin-vincular`
desde el reinicio de las 13:43, y **desde ese reinicio se escribieron 0 filas en `fotos_perfil`**
(contra 205 en las 24 h previas). **La fuga está dormida, no sangrando: se reactiva en el instante en
que alguien re-vincule la línea, y no antes.** Eso permite que el arreglo viaje por un N5 normal en vez
de un `systemctl restart` en hora de venta. **Lo que sí es urgente es no re-vincular la línea hasta que
el arreglo esté desplegado.**

**GATE:** filas nuevas en `fotos_perfil` de teléfonos que **no** son de la campaña, escritas por esa
cuenta, **con la línea del candidato vinculada y viva** = **0**. (Sin esa condición el gate da 0 por la
línea caída, no por el arreglo — un falso verde.)

### 0.3 Sacar la línea de `BOT_LINEAS`

En sombra el bot **no manda pero sí escribe**, y escribe en tablas de la Escuela. Además `registrar_interes`
sale por HTTP a Cerberus con el teléfono del vecino.

**GATE:** `bot_respuestas` de esa línea deja de crecer (hoy 96) y `bot_calificaciones` queda en 5.

### 0.4 Escribir D5, en un ADR corto

Regla dura #3. Sin esto, todo lo demás es configuración sin dueño.

**GATE:** el archivo existe en `docs/adr/` con fecha y dice cuál de las dos opciones se eligió.

---

## FASE 1 — El entorno propio (3 días de infra + 1 de mudanza)

### 1.1 El servicio

El unit es mínimo y clonable — `hermes-campana.service` es `hermes.service` con tres valores
cambiados:

```ini
[Service]
User=campana                       # usuario propio, no `deploy`
WorkingDirectory=/srv/hermes-campana/server
ExecStart=/usr/bin/npm run start   # ⚠️ NO `npm run dev`
Environment=NODE_ENV=production
Restart=always
```

🔴 **`ExecStart=/usr/bin/npm run dev` es lo que produce el defecto de §1.2.5**: `tsx watch` recarga
sobre el `git checkout --force` del deploy y deja **41 s de API muerta con systemd reportando
`active (running)`**. `server/package.json` ya tiene `build` y `start` escritos y sin usar. El entorno
nuevo nace con `start`. *(Cambiar el de la Escuela es otro frente, y conviene.)*

**GATE:** `systemctl restart hermes` (la Escuela) y `journalctl -u hermes-campana | grep -c Restarting`
= **0**.

### 1.2 La base

El patrón ya existe en la máquina: `hermes_db` (pgvector pg17, 127.0.0.1:**5438**) y `hermes_staging_db`
(:**5440**) son el mismo contenedor duplicado. `hermes_campana_db` en :**5441** es copiar la receta.
Disco: 370 G libres de 630 G — no es restricción.

⚠️ **No existe forma de correr un subconjunto de migraciones**: `db:migrate` es `drizzle-kit migrate` y
aplica el journal entero en orden; el baseline `0000` crea 42 tablas de un saque mezclando `events` con
`ontologia.venta`. **La base de campaña nace con las 69 tablas y usa 18.** Eso es feo y es barato: 23
de las 25 tablas que no se mudan tienen **0 filas**. Podar el schema es un frente propio y va después
del 4-oct.

**GATE:** `drizzle.__drizzle_migrations` = **27 filas** en la base nueva, y `npm run db:estado --
--exigir-coherencia` pasa.

### 1.3 El deploy

`deploy/vps1/hermes-deploy.sh` **ya está parametrizado en forma, no en valor**: `RAIZ`, `USUARIO`,
`SERVICIO`, `API_PUBLICA`, `SALUD`, `CONTENEDOR_DB`, `DIR_RESPALDOS`, `ESTADO` y el `flock` son
variables en las líneas 33-56, todas con el valor clavado. Sacarlas a un archivo de config por
instancia (`deploy/vps1/hermes.conf` · `hermes-campana.conf`) es **media hora**, no un refactor.

⚠️ **El `flock` tiene que ser distinto por instancia** o un deploy de la Escuela bloquea el de la
campaña — que es justamente lo que este frente viene a evitar.

**GATE:** `sudo hermes-campana-deploy --dry-run` imprime el plan sin tocar `/srv/hermes`.

### 1.4 El vhost y el respaldo

Un `server_name` propio + certbot (el patrón de los ~37 sitios que ya viven en ese nginx) y
`DIR_RESPALDOS` propio.

🔴 **Y una tarea que no es del entorno nuevo**: los **20 respaldos** de `/srv/respaldos-hermes/`
(`deploy:hermes 0640`, **sin cifrar**), de los cuales **2 ya contienen la campaña**, hay que auditarlos
y purgarlos. Esto se hace en cualquier opción, incluso en E.

### 1.5 La mudanza del dato

738 filas / 13 tablas + 35 archivos / 38 MB + 1 SQLite de 368 KB. Un día.

⚠️ **Los dos lugares donde la separación por dato NO es limpia**, y hay que tratarlos explícitamente:

- **`events`** (40.041 filas, 57 MB) no tiene columna de línea: el discriminador vive en
  `payload->>'numeroPropio'` **sin índice**. Las 243 filas del candidato solo salen con un seq scan.
- **`fotos_perfil`** tiene PK por **teléfono**, no por (teléfono, línea). Medido: de los 13 archivos
  `pfp-*` de contactos de la campaña, **4 son de personas que también escribieron a líneas de la
  Escuela**. Esos 4 **no se reparten: se duplican**. Decidilo al hacerlo, no lo descubras.

**GATE:** `interactions` de la línea = **0** en `hermes_db` y = **243** en la base nueva; y archivos
referenciados por el nuevo `events` que no existan en el nuevo `.wa-media` = **0**.

---

## FASE 2 — El corte de Cerberus

### 2.1 El inventario real, y es más chico de lo que se teme

| | medido |
|---|---:|
| Líneas de import hacia `cerberus/` | **27**, desde **24** archivos |
| …de las cuales `import type ProductoCatalogo` | **12** (casi la mitad: es una interfaz de 8 campos) |
| Puertas HTTP hacia Cerberus | **4** (`auth` · `ficha` · `productos` · `venta`) + 2 URLs armadas a mano |
| Puerta de entrada | 1 (`POST /webhook/cerberus`) + el puente por `icarus.cerberus_events` |
| Imports del **front** hacia `cerberus`/`venta` | **14**, en 11 archivos |
| Imports de la mesa de trabajo (cola · hilo · notas · agenda · reparto · autorespuesta) | **0** |

**La mayoría ya degrada honestamente hoy**: la ficha devuelve `{estado:'error'}` con 200,
`resolverCurso` devuelve `null` y deja el hueco `[precio]`, `registrarInteres` guarda igual con motivo
`catalogo_caido`, el bot conversa sin nombre. **Lo único que TUMBA es el login.**

### 2.2 El orden

**Paso 1 — convertir el fallo mudo en ruidoso.** Sacar el `?? 'https://app.goberna.us'` de los 7
sitios y validar la env al arranque. **Es el primer paso porque sin él «cortar Cerberus» significa
consultarlo en silencio** (§1.3). *Trivial.*

**GATE:** el server de campaña arranca sin `CERBERUS_BASE_URL` y **lo dice**; y `grep -c
"app.goberna.us" server/src/` = **0**.

**Paso 2 — el login local.** Es el único bloqueante real. La buena noticia: **`auth/sesion.ts`
(`firmarSesion` HMAC + `verificarSesion` + `requiereVendedora`) y `auth/perimetro.ts` no tocan Cerberus
y se conservan enteros.** Cerberus decide **una** cosa: qué string se firma. Y el repo ya emite
identidades que nunca pasaron por Cerberus, con volumen: **1.679 de 1.963 filas de `envios_wa` (85,5 %)**
están firmadas por `campana`, `goberna-admin` o `bot`.

- Tabla `operadores` (usuario, hash, salt, activo) + **scrypt + `timingSafeEqual` de `node:crypto`**
  (cero dependencias nuevas: el server no trae bcrypt ni argon2).
- `POST /api/auth/login` ramifica por `AUTH_PROVEEDOR` (**default `cerberus`**, para que la Escuela no
  cambie una línea).
- CLI `npm run operadores` con el molde de `reparto:rueda`: **dry-run por default**, baja lógica.
- 🔴 **Normalizar el `vendedoraId` AL EMITIR.** Medido: `sesiones_cerberus` tiene **11 filas y CUATRO
  pares duplicados por mayúscula** (`Usuario1`/`usuario1`, `Usuario2`/`usuario2`, `luz` contra el `Luz`
  de `numero_vendedora`). La causa es `cerberus/auth.ts:101`, que firma el string tipeado. Con
  identidad local el problema **deja de existir** en vez de mitigarse con `lower()` en seis lugares.

*Tamaño: **2,5–3 días.*** (0,5 `auth/local.ts` puro con test · 0,5 la rama del router · 0,5 el CLI ·
0,5 el front · 0,25 el smoke · 0,25 la normalización.)

**GATE:** el operador entra sin que Cerberus exista, y `select count(*) from operadores` ≥ 1. *Contá
filas, no leas la pantalla.*

**Paso 3 — el smoke del deploy.** 🔴 `pruebas/humoE2E.ts:117-133` **exige que Cerberus conteste 401**
(«contestó y rechazó»); un 503 lo marca como fallo y `hermes-deploy.sh:405-406` dispara `revertir`.
**En un entorno nuevo no hay versión anterior a la que volver: la primera instalación no puede
completar un deploy.** El check se ramifica por proveedor. El mismo archivo ya sabe firmar un token sin
Cerberus (`:137`). *Trivial, y bloquea la instalación.*

**Paso 4 — `HERMES_ADMIN_SERVICE_TOKEN`.** 🔴 **No se puede retirar**: `auth/servicio.ts:17-21` tira al
importarse si falta y `NODE_ENV=production`. Y su API (`PUT /api/admin/numeros/:numero`) es **lo único
que escribe `numero_vendedora`**, que es el mapa del que cuelga el aislamiento de la línea. Se
**re-apunta**: pasa a ser la credencial de aprovisionamiento del entorno, con `req.servicio` como dato y
no como constante — el molde está en `requiereServicioDeCatalogo`. Falta el **CLI gemelo** del alta de
números (la rueda ya se carga sin Cerberus). *Un día.*

`HERMES_CATALOGO_SERVICE_TOKEN` **se retira limpio**: su consumidor es Ivi, que es Escuela, y además
**no está configurado en producción hoy**.

**Paso 5 — retirar el dominio de la venta.** 172 archivos y 25.381 líneas de adaptador Escuela (25 %
del server) + 71 archivos y 10.382 líneas de deuda. **No es urgente y no bloquea nada**: en el entorno
propio esas tablas quedan vacías y esos endpoints no los llama nadie. Va después del 4-oct, con el
kernel (§8).

---

## FASE 3 — El dominio de campaña

> Síntesis de tres diseños independientes medidos contra la línea real. **El embudo viene del diseño
> «derivado», el perfil del diseño «perfil», y la disciplina de medición del diseño «compromiso».** Los
> tres se falsifican a sí mismos en su última sección; esas pruebas están en §9.

### 3.1 El embudo: cinco columnas, derivadas de lo que hizo el VECINO

```
Nunca contestaron → Te esperan → Conversaron → Se identificaron → Se comprometieron
 (le hablamos,      (escribió y   (ida y vuelta,  (dijo QUIÉN es o   (hizo algo que le
  silencio)          la pelota     la pelota es    DE DÓNDE, en       cuesta: tiempo,
                     es nuestra)   de ellos)       esta conversación)  cara, fachada)

                                       Dijeron que no ← terminal humano, fuera del grid
```

ADR 0044 se conserva **entero** y vale el doble acá, por un motivo que no es retórico: en la Escuela el
embudo inflado chocaba contra una columna de «Cierre» que no crecía —ese choque **produjo** ADR 0044—.
**En campaña ese corrector externo no existe**: el resultado llega una vez, al final, es agregado y es
secreto. Si el embudo se deriva mal, **nada lo desmiente antes del 4 de octubre**.

El `CASE` conserva la trampa resuelta del original — el orden del `CASE` **no** es el orden de la
escala, y `no_contesto` se pregunta **antes** que los dos peldaños de arriba:

```sql
CASE
  WHEN cp.compromiso_at IS NOT NULL   THEN 'se_comprometio'
  WHEN NOT hablo AND ya_le_hablamos   THEN 'no_contesto'
  WHEN id.identificado_at IS NOT NULL THEN 'se_identifico'
  WHEN respondida                     THEN 'converso'
  ELSE                                     'nos_escribio'
END
```

Y **la posterioridad va en el `ON` del join, no en un `WHERE` suelto**. Sin ese `>=`, «Se
comprometieron» del día 1 sería **el padrón de militantes del partido** — el equivalente exacto de los
947 clientes que en la Escuela habían comprado *antes* de que les escribiéramos.

**Medido hoy en la línea de Betto**, aplicando la derivación real: `contactado 21 · interesado 4 ·
sin_respuesta 1 · cotizado 0 · cierre 0`. Dos de las cinco columnas de la Escuela **están en cero por
definición**, no por falta de trabajo.

**El pronóstico que hay que tener escrito antes de la primera difusión** (medido en la Escuela, 30
días, excluyendo campaña): de las conversaciones **que abrimos nosotros, el 89,2 % nunca contesta**
(2.574 de 2.885). Contra 0 % de las que abre la persona. **«Nunca contestaron» es el recibo de la
difusión**, y es el freno más barato al blaster que Hermes puede tener: ya está implementado.

**Lo que NO puede ser columna** (el criterio de ADR 0050: una conversación tiene UNA etapa):

| candidato | por qué no | qué es en cambio |
|---|---|---|
| **«Simpatizante / indeciso / opositor»** | La va a pedir todo el mundo y es la peor: no es un acto observable, **borraría el hecho para dejar la opinión**, nada la corrige nunca, y la opinión política es dato sensible (Ley 29733) | Categoría declarada con su autora, jamás una etapa derivada |
| **El estado del bot** (`saludo → identificando → calificando`) | 🔴 **Avanza cuando hablamos NOSOTROS** (`bot_respondio` promueve; `lead_respondio` no cambia nada). Es ADR 0044 reencarnado, **ya poblado en la línea del candidato** con nombres perfectos | Chip de filtro |
| **«En ventana» (24 h)** | Cruza todas las etapas y mediría bien (12 de 26), que es lo que la hace peligrosa: un vecino **comprometido con la ventana abierta** perdería su compromiso | Recorte + píldora |
| **Distrito / zona** | Es a **quién** mirás, no **dónde está** en el embudo | Faceta multivalor con conteos |

### 3.2 Los dos peldaños nuevos, y las dos trampas medidas

🔴 **Trampa 1 — un regex sobre el texto entrante MIENTE, y el repo lo midió ayer.** ADR 0052: el chip
«Piden info» enganchaba 685 conversaciones y **604 (88,2 %) matcheaban por la palabra `informaci`**,
porque era el texto que **prellena el anuncio de Meta**. En campaña es peor: el **61 % de los entrantes
tiene ≤ 12 caracteres** (67 de 110), la **mediana es 8**, y el **26,1 % de los entrantes de la Escuela
no tiene texto** (audio, imagen). → **`se_identifico` no se deriva de un regex sobre texto libre**, y
`cola/precio.ts` **se retira entero** (funcionaba porque leía *nuestros* mensajes, que salen de
plantillas).

🔴 **Trampa 2 — «tenemos su nombre» no es «se identificó», y la diferencia es de 6,7×.** Medido en la
línea de campaña: **20 de 25** tienen nombre en `bot_estado_conversacion.datos`; **3** lo dijeron
(`bot_memoria_lead.hechos`). `bot/identidad.ts` **ya calcula** la procedencia («la conversación» / «de
Cerberus» / «su perfil de WhatsApp») y **`bot/orquestador.ts:370` la tira a la basura al persistir**. Un
peldaño derivado de «hay nombre» mediría **20 donde la verdad es 3**: la misma forma exacta del fraude
de los 2.252, viva el día 1.

→ **La procedencia del dato es parte del dato.** Arreglo de una línea, consecuencia de columna entera.

**De dónde sale entonces `se_identifico`: dos puertas, y las dos ya existen.**

- **Puerta A — el extractor determinista de `bot/memoria.ts`** (regex, no LLM; su encabezado lo dice).
  Su defecto es de vocabulario y es el mismo de `alias_curso`: **`PAISES_CONOCIDOS` son países**, porque
  el mercado de la Escuela es LATAM. En una campaña regional la unidad es la provincia y el distrito.
  Medido: **10 de 25 personas nombraron un lugar de Áncash** y el extractor no ve ninguno. Pasa a ser
  lista **del tenant, en la base, editable sin deploy, con baja lógica** (el molde de `alias_curso`).
  **Techo medido: 6 de 25 (24 %)**; con los patrones actuales, 3 (12 %).
- **Puerta B — el hecho tipado de ADR 0037** (`eventos_contacto`), con `intereses` como **única fuente
  de verdad** del tema/demanda.

⚠️ **La puerta A no es opcional.** ADR 0044 nació midiendo que *lo que exige que una persona declare, no
se usa*: `gestiones` tiene **39 filas en toda la base** y `eventos_contacto` **3**. Si `se_identifico`
colgara solo de la B, mediría cero para siempre.

> **6 de 25 es una columna chica. Y es la columna correcta.** Es el mismo trade que hizo ADR 0044 cuando
> «Cierre» pasó de una promesa a **13**, y su comentario dice *«y 13 es la verdad»*.

### 3.3 El perfil del votante: aserciones con procedencia, no columnas

**Un perfil no es una fila con columnas: es una LECTURA DERIVADA sobre un registro inmutable de
aserciones** — cada una dice *quién afirma qué, sobre quién, cuándo y con qué evidencia*. Se calcula en
cada consulta y **no se guarda nunca**, como la etapa efectiva (0013/0044), las señales (0016) y la
ventana (0041). El motivo: un perfil guardado es una segunda escritura de la misma verdad (#37), y **un
perfil viejo no se ve viejo** — «está a favor», calculado con la regla del mes pasado, se lee idéntico a
uno correcto. En la Escuela eso costaba una cotización; acá manda una brigada a la puerta equivocada.

**Lo que la medición ordena, y hay que decirlo antes de escribir una línea:**

| | medido en la línea de campaña |
|---|---:|
| Mediana del largo de un entrante | **8 caracteres** (media 22,0 · la Escuela 38,3) |
| Personas que nombraron un lugar de Áncash | **10 de 25** |
| Personas que nombraron una demanda (agua, pista, salud…) | **2 de 25** |
| 🔴 Personas con intención de voto explícita | **0** |

> **El perfil NO sale mayormente de la conversación.** Sale del `[CODIGO]` del QR, del formulario, del
> brigadista. La conversación aporta *lugar*, a veces *tema*, y el permiso para seguir hablando. **El
> campo que la frase «perfil de votante» promete —la opinión política— es el que menos evidencia tiene:
> cero.**

**Las tres reglas duras del modelo:**

1. 🔴 **`postura` e `intención_de_voto` son campos SENSIBLES y NUNCA se infieren.** Garantizado por el
   tipo (ausentes del enum de la herramienta, `extraible: false`, `procedenciasPermitidas` sin
   `inferido`) y por un test sobre el `Record` entero: **un campo sensible nuevo no puede nacer
   extraíble**. Y no cuesta nada: medido, 0 de 25 lo expresaron. **La forma más barata de no manejar mal
   un dato sensible es no fabricarlo.**
2. 🔴 **Un `inferido` no aterriza nunca en el perfil.** Vive en `perfil_propuesta`; el **clic humano** lo
   promueve. Es `cursos/confirmar.ts` calcado: la derivación **propone**, el clic **escribe**.
3. 🔴 **La confianza NO es un número del modelo**: es un ordinal cerrado que calculamos nosotros
   (`alta` declarado con cita verificada · `media` cargado por una persona · `baja` sin cita). El repo ya
   tiene el cadáver de la alternativa: `panel/timeline.ts:20` declara `confianza?: number` y **la única
   aparición en todo `src/` es la declaración**.

**El extractor** (`perfil/extractor.ts`, módulo propio y **no una tool más del bot**) reusa
`crearClienteBedrock()` tal cual, corre **sobre ventana cerrada** (no por turno) y tiene **cinco
guardas puras**, de las cuales una es el guardarraíl entero:

> 🔴 **La cita tiene que ser subcadena LITERAL de un mensaje ENTRANTE de ESE sujeto.** Un modelo que
> inventa un hecho casi siempre tiene que inventar la frase de la que sale. Es O(n), no necesita modelo
> y no se discute.

Y cuando alucina: se rechaza antes de tocar la base, **se cuenta con su motivo**
(`{cita_inexistente: 3, …}`), y se mide. Un rechazo silencioso es el modo de fallo de ADR 0042: el día
que el prompt se rompa, el extractor deja de producir y nadie se entera.

⚠️ **La evidencia de que mezclarlo con el bot falla ya está en la base**: `bot_calificaciones` tiene **5
filas en la línea de campaña, las 5 `tibio`, sin una cita**. Es el extractor adentro del bot, corriendo
hoy, y produjo una constante.

### 3.4 El sustituto de la venta, y el veredicto de volumen

`resultados/` **no mide cero** sin Cerberus: de las cuatro cosas que `loQuePaso()` deriva, **tres
sobreviven**. `huboRespuesta` ya funciona — medido en la línea de campaña: **44,3 % (54/122)
[35,8–53,1]**.

**Dos monedas, y la regla de que no se suman:**

| | **moneda de trabajo** | **moneda de valor** |
|---|---|---|
| base | `respondio_despues_de` | `hubo_compromiso_despues_de` |
| el acto | contestó | apretó el botón · vino · trajo · dejó el cartel |
| quién lo afirma | nadie (se deriva) | el vecino (botón) **o** el operador |
| ventana | 48 h (ya existe) | 14 días (nueva) |

**Nunca se multiplican.** «44 % contesta × 5 % se compromete = 2,2 %» es la definición operativa de
*narrativa con decimales*: compone dos denominadores distintos. `Medicion` existe para que eso no se
pueda serializar.

🔴 **El veredicto de volumen, y es mejor saberlo hoy:**

- **La moneda de trabajo alcanza.** A ritmo ×0,5 (3.233 salientes en 53 días) con 8 piezas en rotación
  son ~404 envíos por pieza, y hacen falta **174 por brazo** para separar 44 % de 30 %: una comparación
  decidible cada una o dos semanas. **Condición única, hoy incumplida: que las piezas se estampen. Hoy
  0 de 80.**
- **La moneda de valor NO alcanza, y no va a alcanzar en este ciclo.** Aun a ritmo ×1 (1.378 personas),
  con 5 % de compromiso son **69 compromisos en toda la campaña**; para separar 5 % de 2 % harían falta
  **570 por brazo**. **La moneda de valor no va a rankear piezas antes del 4 de octubre.**

🔴 **Y un bug del gate que hay que arreglar antes de prender esto:** `muestraSuficiente` es
`n >= 30` **sin mirar la tasa**. Con una base del 44 % es razonable; con una del 3-10 % **se pone verde
y no decide nada**. La prueba está en producción hoy:

```
foro_estado_5_ago   2,6 % (26/1004)  [1,8–3,8]   muestraSuficiente: true
promo_3x1_cursos    0,0 % (0/89)     [0,0–4,1]   muestraSuficiente: true
leGanaClaramente(...) = false en las dos direcciones
```

El repo **se niega correctamente** a decir que una le gana a la otra — y las dos filas dicen «muestra
suficiente». Quien lea la tabla sin los corchetes elige la primera. El arreglo ya está escrito en el
comentario de `medicion.ts`: el criterio no es `n`, es **el ancho del intervalo contra la diferencia que
importa** (`DELTA_QUE_IMPORTA`). `MUESTRA_MINIMA = 30` queda como **piso, no como veredicto**.

**El corolario que cambia una decisión comercial (D3):** conversación entrante **44,3 %** contra
difusión saliente **2,6 %** — dos poblaciones distintas, cada una con su base. Son **17×**. La ranura
vendida se llama «Alcance masivo digital y mensajería» y el instrumento dice, con números propios, que
el alcance masivo produce diecisiete veces menos de la única señal que el sistema sabe medir.

### 3.5 El dato sensible: retención, export y borrado, desde el día 1

Hechos, sin interpretarlos: en Perú rige la **Ley 29733 de Protección de Datos Personales** y la opinión
política figura en su categoría de datos sensibles. `dos-planos.md` §3.6 pide que todo nodo nazca con
export y borrado verificable escritos; **D4 está abierta**.

Cinco mecanismos, todos del día 1:

1. **Un campo sensible no se infiere.** (§3.3, regla 1.)
2. **Vida útil por campo, guardada en la fila** (`postura` e `intención`: 90 días). Lo vencido **no se
   borra: se deja de servir**, y el test de paridad verifica que la regla pura y el SQL lo descarten **en
   el mismo instante** (el molde de `ventana.paridad.test.db.ts`). **Lo que nadie renueva caduca solo.**
3. 🔴 **`olvidar` es lo CONTRARIO de `archivar`, y es la única vez que la regla de la casa se invierte.**
   Vacía físicamente `valor`, `cita` y `evidencia_ref`, y **conserva la fila** con `olvidado_at` y
   `olvidado_por`. Lo que sobrevive es **el hecho de que algo se borró y cuándo** — que es lo que vuelve
   el borrado *verificable* en vez de simplemente ausente.
4. **Export en formato abierto**, por sujeto y por tenant. Una campaña termina y el cliente se va con su
   dato.
5. **La purga del día después es un comando, no un cron**: `perfil:purgar --antes-de 2026-10-05`,
   dry-run por default. Es comando porque **la fecha es una decisión del dueño (D4), no del código**.

⚠️ **Lo que esto NO resuelve:** `interactions.texto` guarda el mensaje entero, y eso ya pasa hoy.
Olvidar una aserción **no borra el mensaje del que salió**. La retención del hilo es otro frente y es
más grande que éste.

---

## FASE 4 — El front (después de que el entorno exista)

El front está **mucho menos atado de lo que su documentación sugiere**: de 330 archivos, **14 imports en
11 archivos** cruzan a `cerberus`/`venta`, y la mesa de trabajo entera tiene **cero**.

| qué | medido | qué se hace |
|---|---:|---|
| Se lleva **tal cual** | la mesa: `canales` `whatsapp` `notas` `agenda` `reparto` `autorespuesta` `senales` `navegador` | nada |
| Se traduce | **708 ocurrencias** de vocabulario de venta (el número real de ediciones está entre 708 y algo menor: no se midió cuántas son *strings* de JSX contra identificadores) | rótulos |
| Se retira | `cerberus` `venta` `padron` `hechos` `plantillas` `dashboard` | borrar |
| 🔴 Código muerto que aparece de yapa | **11 archivos de producción sin un solo importador**, entre ellos `panel/pestanas.ts`, `sugerencias/DosRespuestas.tsx`, `hechos/BloqueHechos.tsx`, `notas/PanelNotas.tsx` | decidir: reconectar o archivar |

⚠️ **El panel derecho no es el de ADR 0017 ni el que describe `CLAUDE.md`** — verificado con
alcanzabilidad real desde `App.tsx`. Es un timeline (Encabezado · ZonaPendientes · eventos ·
RegistrarEvento · FichaContacto · pie «Registrar venta»). **Antes de tocarlo, verificá contra el árbol.**

⚠️ **`gestiones` con etapa `cierre` = 0 filas en toda la base**: el botón «Registrar venta», que hoy es
la única acción primaria del pie del panel, **nunca cerró nada**.

---

## §5. Los candados — los tests que hacen que esto no se deshaga

Sin estos, cada arreglo de arriba dura hasta el próximo sprint.

| qué protege | dónde | por qué |
|---|---|---|
| 🔴 **el motor no importa del adaptador** | un test de dependencia en un `kernel/` del server, que este plan propone y **al 16-ago-2026 no se construyó** (tampoco existe el directorio) | **No existe, y por eso pasó**: en dos días el alcance transitivo del motor hacia el adaptador subió de **9 de 18 módulos a 12 de 18** — `reparto`, `espacios` y `notas`, los tres marcados 🟢 «se lleva», se contaminaron por **un** import (`reparto/asignar.ts → routing/repositorio.ts → cursos/alias.ts`), con CI verde. Nace con la allowlist en **18** (no 16) y contando **cierre transitivo**, no pares directos. **Congela, no arregla** |
| 🔴 **el estado del bot no toca el embudo** | test que falla si `cola/` importa `bot/estados.ts` | §3.1: la máquina de estados tiene nombres perfectos, está poblada, y avanza cuando hablamos nosotros |
| **el prompt que se manda ≡ el perfil de la línea** | reescribir `bot/perfiles.test.ts` para que arme el prompt **por el pipeline real** | Hoy está verde con el defecto vivo (§1.2.3) |
| **la cita es subcadena literal del mensaje** | `perfil/guardas.test.ts` | El guardarraíl del extractor |
| **sensible ⇒ no extraíble ⇒ ausente del enum** | `perfil/vocabulario.test.ts`, recorriendo el `Record` | Un campo sensible nuevo no puede nacer extraíble |
| **la regla pura ≡ su gemelo SQL** | `perfil/paridad.test.db.ts`, `etapaEfectiva` | El patrón de ADR 0009. ⚠️ Compara **valor Y procedencia** |
| **ninguna base de medición promete causa** | `resultados/medicion.test.ts` (existe) | Se le suman `voto · votante · intencion · persuad · convence · moviliza · apoyo · simpat`. La regla general se escribe en el archivo: **una base nombra un ACTO OBSERVABLE, nunca un estado interno** |
| **toda etapa que el embudo devuelve se puede pedir** | `routes/conversaciones.etapa.test.ts` (existe) | `?etapa=sin_respuesta` respondía **400** con 15 tests con base en verde: el defecto vivía en la costura |

---

## §6. Qué NO se hace, y por qué está escrito acá

- **No se bifurca la derivación por `numeros_wa.proposito` dentro del mismo proceso.** Dos `CASE` y dos
  escalas en la misma consulta es la forma de divergencia muda que este repo paga con tests de paridad,
  y acá **no habría contra qué comparar**.
- **No hay score de votante**, ni `probabilidad_de_voto`, ni ranking. Es el campo con más consecuencia y
  menos evidencia. ⚠️ **Si «¿cuál es la probabilidad de que este vecino vote?» es un requisito de
  producto y no una pregunta, este plan es el equivocado** y hay que decirlo en un ADR, no resolverlo
  agregando una columna.
- **No hay resumen del vecino escrito por un modelo.** En el momento en que a un modelo se le permite
  escribir una frase durable sobre una persona, el campo deja de ser un hecho y pasa a ser una opinión
  con timestamp. Exportada meses después, **es el incidente**.
- **No se prende el bot de campaña** sin una decisión escrita (§2, D7).
- **No se empuja el satélite contra octubre.** *«El carril 3 no tiene una versión apurada: tiene una
  versión y una catástrofe.»*

---

## §7. La ruta, con sus gates

### Esta semana (antes del 19-ago)

> ⚠️ **Esta tabla se escribió el 12-ago y quedó parcialmente vieja. El orden vigente está en §0.5 · 5**,
> que suma el frente que este cuadro no podía prever: el **CLI gemelo de `numero_vendedora`**, hoy la
> precondición del SSO de Centurión que ya está construido.

| # | qué | GATE |
|---|---|---|
| 1 | ✅ **HECHO 12-ago** — Rebasar el checkout (§0.1) | `HEAD..origin/main` = **0** y `tsc --noEmit` pasa en front **y** server. ⚠️ No había nada que rebasar: los 76 archivos sin commitear eran **una copia vieja de trabajo ya mergeado** (#358), y lo único que tenían de más era la cita falsa que el review retiró |
| 2 | Cerrar la fuga de la cuenta de WhatsApp (§0.2) — **por código, no por `.env`** | filas nuevas en `fotos_perfil` de teléfonos no-campaña por esa cuenta, **con la línea vinculada** = **0** |
| 3 | ✅ **APLICADO al `.env` 12-ago 15:53** — Sacar la línea de `BOT_LINEAS` (§0.3) | surte efecto en el próximo restart (respaldo `.env.bak-12ago-1553`). `bot_respuestas` de esa línea deja de crecer (hoy 96, última fila anoche 22:01 Lima) |
| 4 | **D5 por escrito**, ADR corto (§0.4) | el archivo existe en `docs/adr/` |
| 5 | **#338 — el test de dependencia**, independientemente de todo lo demás | corre en N1 y su número es **18** |
| 6 | Ejecutar la Fase 1 (o la salida E, según 4) | `interactions` de la línea = **0** en `hermes_db` y **243** en la base nueva |

⚠️ **El carril 2 sigue vivo y nada de esto lo toca.** Su gate ya está escrito: al **25-ago**,
`captacion.escaneo` **> 0**; si no, se cancela y va a post-octubre.

### Hasta el 4-oct

| # | qué | GATE |
|---|---|---|
| 7 | El corte de Cerberus, pasos 1-4 (§Fase 2) | el operador entra sin Cerberus; `select count(*) from operadores` ≥ 1 |
| 8 | La procedencia del nombre (§3.2, trampa 2) | `se_identifico` mide **3-6**, no 20 |
| 9 | El embudo de cinco columnas (§3.1) | un vecino aparece en «Se comprometieron» **sin que nadie lo haya arrastrado** |
| 10 | Estampar las piezas | `envios_wa where numero_propio=… and pieza_clase is not null` **> 0**. Hoy: 0 de 80 |
| 11 | El perfil, peldaños A→C (a mano → observado → extractor **en sombra**) | `perfil_asercion` > 0; y a 30 días el extractor imprime propuestas y descartes **por motivo**. ⚠️ La primera pregunta no es «¿acierta?» sino **«¿propone algo?»** — con mediana de 8 caracteres la respuesta plausible es que no |
| 12 | Retención, export y purga escritos (§3.5) | `perfil:purgar --antes-de` corrido en dry-run **antes de que haya un dato real que perder** |

### Después del 4-oct

| # | qué | GATE |
|---|---|---|
| 13 | **#339** parametrizar `sugerencias/estado.ts` | allowlist de 18 → **≤ 13** |
| 14 | **#340** `kernel-hermes@0.1.0`, preservando historia git | allowlist en **0** *y* la Escuela sigue vendiendo con el kernel importado |
| 15 | D1, D1b, D2, D3, D4, D6 escritas | antes del peldaño 2 del satélite, no después |
| 16 | Podar el schema (de 69 tablas a 18) | migración baseline propia del entorno de campaña |
| 17 | El satélite en Centurión | **el gate de ADR 0042, literal: contá filas en `events`. > 0. Nunca por un 200** |

---

## §8. Cómo se falsifica este plan

- **Si la Fase 1 no aísla el deploy.** Si con `hermes-campana` corriendo, un N5 de la Escuela produce una
  sola línea `Restarting` o un `sin-vincular` en el journal del servicio nuevo, **B no compró lo que dice
  comprar**. *Prueba: un restart de `hermes` con la línea vinculada, contando reinicios del otro.*
- **Si la mudanza no cierra.** *Prueba: archivos referenciados por el nuevo `events` que no existan en el
  nuevo `.wa-media` = 0.*
- **Si «Se identificaron» no llega a dos dígitos.** Techo medido: **6 de 25 (24 %)** con el extractor
  extendido. Si a 30 días con >200 conversaciones el peldaño mide < 10 %, **no existe observablemente por
  WhatsApp** y el embudo del votante es de tres columnas, no de cinco.
- **Si el compromiso no se registra.** `eventos_contacto` tiene **3 filas en toda la base** en un año. Si a
  30 días hay < 20 compromisos, **la columna de arriba mide cero y `resultados/` no tiene qué medir**.
- **Si el extractor en sombra no propone nada** (mediana de 8 caracteres). Si a 30 días `sum(propuestas)`
  sobre todos los campos queda bajo 30, **§3.3 se retira entero**: el perfil se queda con `cargado` +
  `observado`, que es un formulario firmado y un QR. Más chico, más barato y honesto.
- **Si el operador confirma TODO.** Una tasa cerca de 100 % con descarte humano < 5 % significa que el chip
  es un sello y la cita no se está leyendo: hay que sacar el botón.
- **Si el volumen no aparece.** El día medido (26 personas / 122 salientes) fue el pico de un alta de
  emergencia. A ritmo ×0,1 ninguna pieza llega a 174 por brazo y **ni la moneda de trabajo decide**.
- **Si al segundo candidato hay que reescribir los predicados.** Los cinco peldaños tienen que servir a una
  candidatura provincial, regional y municipal sin tocar SQL. Si no, **no hay activo transversal: hay
  consultoría con buen tooling** (el gate de generalización de `dos-planos.md` §11.5).
- **Si la allowlist no baja.** Si al sprint siguiente el test de dependencia sigue en 18 o sube, el motor no
  era un motor y hay que decirlo **antes** de vender la extracción.

---

*Medido el 12-ago-2026 contra `hermes_db` en VPS1 (read-only) y `origin/main = 5f3571f`. Marco:
[`dos-planos.md`](dos-planos.md). Mapa: [`plan-hermes-para-candidatos.md`](plan-hermes-para-candidatos.md).
Orden de los carriles: [`plan-de-ataque-hermes-candidatos.md`](plan-de-ataque-hermes-candidatos.md).*
