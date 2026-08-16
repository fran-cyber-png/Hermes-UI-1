# El plan de integración — Hermes adentro de Centurión

> **Qué es esto.** El documento **autocontenido** de cómo se integra el CRM de campaña al ecosistema
> Centurión: el contrato técnico, la integración de datos, el despliegue, la seguridad y el orden.
> Escrito el **10-ago-2026**.
>
> **Los otros dos, si querés el porqué**: [`plan-hermes-para-candidatos.md`](plan-hermes-para-candidatos.md)
> es el **mapa medido y el planteo**; [`plan-de-ataque-hermes-candidatos.md`](plan-de-ataque-hermes-candidatos.md)
> es el **cuándo**. Éste es el **cómo se enchufa**. Si se contradicen sobre un hecho, gana el que
> declara contra qué midió.
>
> **Cómo leerlo.** Lo que dice un número está medido y dice contra qué. Lo que es propuesta dice
> **PROPUESTA**. Lo que necesita al dueño está en §9 y en ningún otro lado.

---

## 0. Resumen en una página

| | |
|---|---|
| **Qué se integra** | El motor de conversaciones de Hermes, como **CRM del comando de campaña** |
| **Dónde aparece** | **Una página más** del launcher `/app` de Centurión, activada por entitlement |
| **Qué forma tiene** | **Microservicio satélite** (el engine) **+ módulo UI liviano** (la pantalla) |
| **Cómo comparte código con Hermes** | **`kernel-hermes`, librería versionada.** Jamás un servicio corriendo compartido |
| **Cuál es el tenant** | `fase_1.candidatura.id` — el mismo de toda la plataforma |
| **Canal** | **Cloud API oficial** del número del comando. Nunca whatsmeow, nunca el celular del candidato |
| **Cuándo** | Carriles 1 y 2 ya (§8). El satélite, **después del 4-oct-2026**; su trámite de Meta, ya |
| **Qué bloquea hoy** | **D5** (¿de quién es el WABA?) y **D6** (el `codigo`). Las dos son de esta semana |

---

## 1. Los dos lados, medidos

**Hermes** (checkout canónico en `feat/libreta-link-avanzado` @ `c3a151f`, remedido el 10-ago-2026):
**616 archivos server / 99.769 líneas** · **301 archivos front / 51.700 líneas** — el front vive en
`src/`, no en `front/src` · 164 + 85 archivos de test · **25 migraciones** de drizzle · 50 `pgTable`
en `server/src`. Se parte en **motor** (~27.000 líneas, sirve a los dos planos), **adaptador de
Escuela** (~17.000) y **deuda** de meta-escuela (~11.000). El motor cruza al adaptador **16 veces** —
la línea todavía se puede dibujar.

⚠️ **La primera medición de este documento ya no reproduce**: decía 612 / 99.121 · 298 / 50.879 · 54
tablas · 24 migraciones, y el checkout avanzó en el día. Ninguna conclusión cambia, pero el número
que se cita hay que fecharlo contra un commit, no contra un día. Dos cifras siguen **sin
reverificar**: los **16 cruces** (dependen de la partición que define el propio `hermes#338`) y las
**54 tablas** (se midieron contra la base de Hermes, que acá no se tocó; el conteo de `pgTable` da
50). Y los «229 / 84 tests» de la primera pasada mezclaban unidades: acá van **archivos** de test.

**Centurión** (medido contra `goberna_web_dev`, read-only): **69 candidaturas** · 18 subservicios ·
272 selecciones (178 con `seleccionado = true`) · schemas con tablas: `territorio` 14, `formularios`
10, `agentes_campo` 7, `path_to_victory` 4. 🔴 **`captacion` no existe ni como schema** — no está en
`pg_namespace`; no es que esté vacío, es que su migración —en el repo **Centurión**,
`modules/captacion/migrations/2026_07_03_captacion_schema.sql`— nunca se aplicó.
`territorio.contacto` tiene **0 filas** con **35 brigadistas** (`territorio.brigadista`, 38 vínculos
a candidatura). El único módulo con uso real es **`formularios`: 696 respuestas**.

**Lo que ya está construido y no hay que volver a hacer**: el brigadista con JWT de `aud` propio, la
entidad ciudadano, el motor cartográfico compartido, el launcher con entitlements, y —del lado de
Hermes— el **transporte Cloud API** (`whatsapp/transporteCloudApi.ts`, cableado en `wiring.ts:75-89`
como spike con número de prueba). ⚠️ `CLAUDE.md` de Hermes todavía dice que ese transporte no existe:
quedó viejo.

---

## 2. La forma, y las tres reglas que no se negocian

### 2.1 Satélite + módulo — lo decide el propio contrato

`MICROSERVICE-CONTRACT.md` §2: es microservicio si corre **siempre** aunque nadie esté logueado
(webhooks entrantes), si necesita **runtime propio** (drivers de mensajería) o si **escala distinto**
al login/UI. Un CRM de conversaciones cumple **tres de cuatro**.

```
   apolo / deck-form ──── activa el subservicio por candidatura (fase_3) ─────┐
                                                                              │
   ┌──────────────────────────────────────────────────────────────────────────▼──┐
   │  CENTURIÓN (monolito modular, TanStack Start + Kysely + Bun→node)            │
   │   identidad (cookie cn_token, aud='centurion') · entitlement · launcher /app │
   │   └── módulo UI  modules/mensajeria/       ← la mesa: cola · hilo · ficha    │
   └───────────────┬─────────────────────────────────────────────────────────────┘
                   │  service token JWT HS256, aud='svc-mensajeria', lleva id_candidatura
   ┌───────────────▼─────────────────────────────────────────────────────────────┐
   │  SATÉLITE «mensajería»  (Express 4 + Drizzle + Postgres 17 + Zod 4)         │
   │   webhook Meta · TransporteCloudApi · EnvioControlado · cola · procedencia  │
   │   base PROPIA (rw)  +  goberna_web_dev (READ-ONLY)  ·  loopback + nginx     │
   └─────────────────────────────────────────────────────────────────────────────┘
                   ▲
        kernel-hermes@x.y.z  — librería versionada, NUNCA un servicio compartido
```

⚠️ **Dos stacks, un contrato, y está bien.** El módulo es ciudadano de Centurión (TanStack Start,
Kysely DB-first, Bun para instalar y buildear, **`node server.mjs` en producción** porque Bun
segfaultea en la CPU del VPS). El satélite es descendiente de Hermes (Express + Drizzle + Zod). No se
unifican los stacks: se unifica **el contrato**.

### 2.2 Las tres reglas

1. 🔴 **Ningún servicio corriendo se comparte entre planos.** `dos-planos.md` §4 lo nombra: *«la
   tentación va a ser hacer el servicio de WhatsApp de Goberna que sirva a la Escuela y a los
   candidatos. Es la peor idea disponible»* — un bloqueo de Meta, un bug de ruteo o un incidente
   cruzaría los dos negocios y todos los tenants a la vez. Se comparte **código versionado + ADR**.
2. 🔴 **Cloud API y solo Cloud API.** Política del 2026-07-03: Baileys y stacks no oficiales están
   **prohibidos para clientes**. La Escuela usa whatsmeow porque asume su propio riesgo; un candidato
   no puede heredarlo. Y el **número personal del candidato es carril B: conversación humana, cero
   software** — el satélite no debe siquiera poder configurarlo.
3. 🔴 **El satélite escribe SOLO su schema.** El core y los otros módulos son **read-only**. Si falta
   un dato, se le pide al dueño del módulo; no se le agrega una columna.

---

## 3. EL CONTRATO DE INTEGRACIÓN

### 3.1 Identidad — tres puertas, ningún login propio

`MICROSERVICE-CONTRACT.md` §3 es taxativo: **nunca un sistema de login paralelo**. Las tres puertas:

| Quién llama | Cómo se autentica | Precedente vivo |
|---|---|---|
| **El módulo UI** (operador con sesión) | cookie **`cn_token`** (HS256, `aud='centurion'`, `jti` revocable en `auth.sesion`), resuelta server-side con **`handleCurrentCandidato`** (en el repo **Centurión**, `lib/candidato.handlers.ts:22`) | todos los módulos |
| **El satélite ↔ el módulo** | **service token JWT** firmado con el **mismo `JWT_SECRET`** del core y **`aud='svc-mensajeria'`** | `territorio/jwt.ts`: `ACCESS_AUDIENCE = 'svc-territorio'` |
| **Meta** (webhook, sin sesión) | **firma HMAC** del payload + `hub.verify_token` en el GET de verificación | Hermes `webhook/firma.ts` |

**El `aud` propio es el aislamiento**: comparte secreto con el core y no vale como `cn_token`, ni al
revés. ⚠️ Y el `id_candidatura` **sale del token, jamás del body** — es la regla que separa un filtro
de una frontera.

### 3.2 Entitlement — estar autenticado no alcanza

Antes de responder para una candidatura, el satélite verifica que tenga el servicio activo. La consulta
es la misma que ya usan los módulos (`captacion.handlers.ts:54`):

```sql
SELECT 1 FROM fase_2.servicio_seleccion ss
  JOIN fase_3.subservicios sv ON sv.id = ss.id_subservicio
 WHERE ss.id_candidatura = $1 AND sv.codigo = 'mensajeria' AND ss.seleccionado = true;
```

Sin entitlement: **no responde** (404/403), sin filtrar datos y **sin un error que confirme que la
candidatura existe**. Lo activa y lo desactiva **apolo**, que es el dueño de `fase_3`.

⚠️ **Y el corte tiene que llegar al canal, no solo a la pantalla.** Es la decisión que `captacion` ya
tomó para sus QRs (revocado el subservicio, los QRs impresos dejan de redirigir): acá significa que
revocar `mensajeria` **corta la atención**, no solo el acceso a la UI. Hay que saberlo antes de
revocarle el servicio a una campaña en curso.

### 3.3 Tenancy y jurisdicción

- **Toda** operación va scopeada por el `id_candidatura` **resuelto de la identidad**.
- La **jurisdicción** (departamento/provincia/distrito) se lee de `fase_1.candidatura` — la define
  apolo. El satélite es **multi-jurisdicción por diseño: cero código por cliente**.
- Toda tabla con dato por candidato lleva `id_candidatura bigint` con FK a `fase_1.candidatura(id)`.
- Para geo se usa `geografia_politica` vía los `id_*` de la candidatura — **el único puente vivo** hoy
  entre módulos, y el que ya funciona.

### 3.4 Ownership de datos — quién escribe qué

| Zona | Schemas | Leer | Escribir | Migrar |
|---|---|:--:|:--:|:--:|
| **Core** | `auth`, `fase_1/2/3`, `geografia_politica`, `audit` | ✅ | ❌ | apolo/deck-form |
| **Otros módulos** | `territorio.*`, `formularios.*`, `captacion.*`, `path_to_victory.*` | ✅ | ❌ | su dueño |
| **Nuestro** | `mensajeria.*` (o la base propia del satélite) | ✅ | ✅ | nosotros |

**PROPUESTA — el satélite abre DOS conexiones**: la suya (read-write) y **`goberna_web_dev` en
read-only**. Hermes ya tiene el patrón exacto y probado: `ICARUS_DATABASE_URL` fuerza
`default_transaction_read_only=on` porque icarus sirve a un cliente real. Acá el motivo es el mismo y
peor: del otro lado hay campañas que pueden ser rivales.

⚠️ **Las migraciones de Centurión son manuales, aditivas e idempotentes, y el deploy NO las corre.**
No hay runner ni tabla `schema_migrations`: el `CREATE ... IF NOT EXISTS` es todo el tracking. El
satélite, en cambio, hereda de Hermes las **migraciones versionadas de drizzle** — y con ellas el
gotcha del `when` monótono del journal, que **falla en silencio** si dos ramas generan una migración
cada una.

### 3.5 El manifest y el alta

```ts
// el `manifest.ts` del módulo `mensajeria` que este plan propone: iría en el repo
// Centurión, bajo `modules/mensajeria/`, con la misma forma que captacion y
// path-to-victory. ⚠️ Al 16-ago-2026 ese módulo NO existe — no se construyó.
export const manifest = {
  codigo: 'mensajeria',
  nombre: '<lo que decide D6>',   // es el rótulo que el candidato LEE en su launcher
  icono: 'message-square',
  ruta: '/mensajeria',
  entitlement: 'mensajeria',
} as const
```

```ts
// service.manifest del satélite (MICROSERVICE-CONTRACT §7)
export const manifest = {
  codigo: 'mensajeria', tipo: 'microservicio', entitlement: 'mensajeria',
  aud: 'svc-mensajeria', endpoints_base: '/mensajeria', ui_modulo: 'mensajeria',
}
```

🔴 **El alta la hace apolo, y no hace falta un ítem comercial nuevo.** `fase_3.subservicios` ya tiene
la fila **id 12 — «Alcance masivo digital y mensajería», S/2.500, 9 candidaturas activas y `codigo`
vacío**: hay que darle `codigo = 'mensajeria'` a esa fila. ⚠️ Su nombre dice «masivo» y este producto
existe, entre otras cosas, para **no poder** mandar masivo — es la decisión **D3**.

**El `codigo` vacío no es la anomalía de esa fila: es la norma.** 13 de los 18 subservicios lo tienen
vacío; solo 5 lo tienen puesto, y son exactamente los 5 que tienen módulo vivo (`path_to_victory`,
`agentes_campo`, `estudio_realidad`, `formularios`, `mapeo_actores`). O sea: **poner el `codigo` es
el acto que convierte una ranura vendida en un módulo que existe**, y hacerlo con la fila 12 es
repetir el mismo trámite que ya se hizo cinco veces, no inventar uno.

🔴 **Y por eso `captacion` está doblemente muerto — este hallazgo no estaba en la primera pasada.**
Su query de entitlement filtra por `sv.codigo = 'captacion'` y **ninguna fila de
`fase_3.subservicios` tiene ese código**. Prender el schema (ticket `#115`) **no alcanza**: aunque se
apliquen las tablas, el gate nunca pasa y el módulo sigue invisible. El ticket #115 son **dos**
trámites, no uno — la migración y el `codigo` — y el segundo es el mismo que D6 pide para
`mensajeria`. Hay que hacerlo dos veces.

### 3.6 Endpoints

**Del satélite** (loopback, detrás de nginx):

| Método | Ruta | Quién llama | Auth |
|---|---|---|---|
| `POST` | `/webhook/meta` | Meta | firma HMAC · **ack primero**, o Meta desactiva la suscripción |
| `GET` | `/webhook/meta` | Meta | `hub.verify_token` |
| `GET` | `/api/conversaciones` | el módulo UI | service token + entitlement |
| `GET` | `/api/hilo/:clave` | el módulo UI | ídem |
| `POST` | `/api/enviar` | el módulo UI | ídem · **única puerta**, por `EnvioControlado` |
| `GET` | `/salud` | nginx / monitoring | ninguna, sin PII |

**De Centurión**, ya existente y que se reusa: `GET /w/$codigo` (el redirect público del QR, fuera de
`_authed`), que es de donde sale el `[CODIGO]` que el webhook parsea.

⚠️ **Idempotencia obligatoria en el webhook.** Hermes ya aprendió el caso raro: una llamada manda
varios webhooks con el mismo `id`, y sin meter el evento en la clave de idempotencia se pierde el
`terminate`, que es el único que trae la duración.

### 3.7 El módulo UI

Espeja `path-to-victory/` (la plantilla viva del repo). ⚠️ **Este árbol es la PROPUESTA y vive en el
repo Centurión, no en Hermes**; al 16-ago-2026 todavía no existe ninguna de estas piezas — `modules/`
de Centurión tiene `captacion`, `territorio`, `formularios`, `path-to-victory`, `agentes-campo`,
`estudio-realidad` y `mapeo-actores`, y ningún `mensajeria`.

```
modules/mensajeria/                      ← en el repo Centurión (PROPUESTA)
├── manifest.ts · domain.ts (PURO) · types.ts (client-safe)
├── repo.ts                  SERVER-ONLY: pool, schema calificado
├── mensajeria.handlers.ts   SERVER-ONLY: sesión + entitlement + llamada al satélite
├── mensajeria.fn.ts         createServerFn (dynamic import de handlers)
├── queries/ · components/ · migrations/ · README.md
└── routes/_authed/mensajeria.tsx   ← la página + gate en el loader
```

⚠️ **Los tres gotchas de Centurión que rompen el build o la hidratación**, y no son estilo:

1. **Imports server-only (`pg`, `bcryptjs`, `jsonwebtoken`) SOLO vía `await import()` dentro del
   `.handler()`.** A top-level crashea la hidratación.
2. **`npx tsc --noEmit` es obligatorio**: vite/esbuild **no** chequea tipos.
3. **`eslint --fix` hay que correrlo mirando el diff**: en ese repo
   `no-unnecessary-condition` borra aserciones que el runtime necesita. Ya rompió `tsc` en tres
   módulos. Si hace falta la guarda, usar `.at(i)` en vez de silenciar la regla.

---

## 4. LA INTEGRACIÓN DE DATOS — el nudo

Esta es la parte que **no existe en la Escuela** y que hace al producto del candidato mejor que
Hermes, no una copia peor. Centurión ya tiene sensores desplegados y **ningún hilo termina en una
conversación con la persona**.

### 4.1 Lo que ENTRA a la ficha del vecino

| Módulo | Qué aporta | Llave de join | Estado hoy |
|---|---|---|---|
| `captacion.escaneo` + `qr` | **de qué punto del territorio vino** | el `[CODIGO]` del primer mensaje | 🔴 el schema **no existe**, y su `codigo` tampoco |
| `territorio.contacto` | nombre real, dirección, lat/lng, notas, foto | teléfono normalizado | 🟡 **0 filas** |
| `territorio.visita` · `agentes_campo.ingreso_visita` | si ya lo visitaron y qué pasó | contacto / ubicación | 🟡 **1 fila** · 7 tablas |
| `formularios.respuesta` | **qué contestó**: intención de voto, tema | `id_candidatura` + teléfono | 🟢 **696** |
| `path_to_victory.unidad_meta` | la meta de su sector | unidad territorial | 🟢 **118 filas / 11 candidaturas** |
| `geografia_politica` | su subsector | geometría / `id_distrito` | 🟢 read-only |
| `fase_1.candidatura` | la jurisdicción | `id_candidatura` | 🟢 69 filas |

⚠️ **Corrección a la primera pasada: `unidad_meta` no tiene «14 activas».** Tiene **118 filas sobre
11 candidaturas**, y ni siquiera tiene columna de activo. El 14 era otra cosa —las candidaturas con
el subservicio `path_to_victory` **seleccionado**— y mezclar un conteo de *entitlement* con uno de
*datos* es el error exacto que esta tabla existe para no cometer: **lo vendido y lo poblado son dos
columnas distintas**. Cuando esta tabla diga «🟢», tiene que ser por filas.

**El interés del vecino sale de `formularios`, y de ningún otro lado.** Es la lección de ADR 0037 de
Hermes: con el curso guardado en dos lugares, la vendedora registraba «preguntó por Gestión Pública» y
al minuto la compuerta se lo rebotaba. **Una sola fuente de verdad de «qué le importa».**

### 4.2 Lo que VUELVE — y hoy no vuelve nada

- **A `captacion`**: qué QR trae gente que **contesta**, no solo que escanea. Hoy la métrica muere en
  el escaneo, que es medir una campaña por impresiones.
- **A `path_to_victory`**: comprometidos por unidad territorial → **el avance real contra la meta**,
  medido en personas y no en actividades.
- **A `territorio`**: 🔴 **la lista de puertas** — a quién ir a visitar mañana. Es el lazo que hoy no
  existe en ninguna parte del plano B: el campo alimenta al digital y el digital no devuelve nada.

### 4.3 🔴 La precondición: cuatro sistemas ya dicen quién es esa persona

`territorio.contacto`, `formularios.respuesta`, `captacion.escaneo` y la conversación.
`dos-planos.md` §10 ya vio este error en el plano A con tres modelos de entidad. **Sin resolución de
identidad, «integrado» es un JOIN optimista que va a mentir en silencio.**

**La maquinaria existe en Hermes y viaja en el kernel:**

- **`identidad/`** (ADR 0017): el enlace es una **estrella** — simetría, idempotencia y «sin ciclos»
  salen de la **forma del grafo**, no de código defensivo. **Deshacer revoca, no borra** (índice
  parcial sobre lo activo). La persona se crea **perezosamente al enlazar**, y **leer una ficha jamás
  escribe en el grafo**. Techo de 10 identidades por persona.
- **`telefono/paises.ts`**: `partirE164`, `variantesLocales`, `mismoTelefono`. El sufijo de 9 dígitos
  **solo** con guarda de país: en la Escuela, sin ella, un mexicano y un peruano compartían sufijo
  (falso positivo) y 393 guatemaltecos nunca llegaban a 9 dígitos (falsos negativos).
- ⚠️ **Comparar normalizando los DOS lados.** En Hermes, `Luz` vs `luz` hacía invisible una
  conversación **sin un solo síntoma**. Acá haría invisible a un vecino.

**El enlace vive en una tabla NUESTRA que apunta hacia afuera** (`mensajeria.vinculo_vecino`), nunca
en una columna agregada al módulo ajeno.

### 4.4 🔴 Lo que jamás cruza

- **Dato crudo entre candidaturas.** Ni con permiso, ni «para entrenar».
- **Cerberus ↔ cualquier nodo de cliente.** Cerberus tiene el negocio entero de Goberna.
- **Índices, embeddings o memoria compartida** entre tenants.
- **Un proceso compartido entre planos.**
- Hacia arriba (nodo → Goberna) vuelve **la forma del resultado con su `n` y su base**, jamás el dato:
  *«la secuencia de tres pasos tiene mejor tasa de respuesta que la de uno, n=340, base=envíos»* sí;
  el mensaje, el teléfono, el nombre o el distrito, **no**.

---

## 5. La integración con Hermes: `kernel-hermes`

**Entra**: `TransporteWhatsapp` + `TransporteCloudApi` + `TransporteFalso` · `EnvioControlado` ·
`piezas/` · `procedencia/` · `resultados/` · `cola/` · `entrega/` · `reacciones/` · `numeros/` ·
`reparto/` · `identidad/` · `telefono/` · `espacios/` · `notas/` · `eventos/` — **con sus tests**, que
son la mitad del valor.

**No entra**: todo el adaptador de Escuela (`cerberus` `cursos` `clientes` `hechos` `plantillas`
`negocio` `padron` `icarus` `atribucion` `gestiones` `campana` `dashboard`), la deuda de meta-escuela,
y **`bot/` — el más valioso y el más contaminado**, que es su propio frente.

**Qué hay que hacer en Hermes primero** (carril 1, ya abierto): el test de dependencia con los 16
cruces como allowlist (`hermes#338`), parametrizar `sugerencias/estado.ts` (`#339`, desbloquea 5 de un
saque) y extraer el paquete preservando historia git (`#340`).

⚠️ **`sugerencias/estado.ts` es LA frontera**: define `EstadoDeVenta` con `curso`, `cotizada` y
`precio`, y lo importan `procedencia/`, `catalogo/` y `autorespuesta/`. Mientras siga así, el corazón
del kernel no se puede extraer.

---

## 6. Despliegue e infraestructura

| | |
|---|---|
| **Satélite** | Contenedor propio detrás de nginx, con **health-check** |
| **Puertos** | **loopback-only** (`127.0.0.1:<port>`), **nunca** `0.0.0.0` — el VPS es compartido con clientes reales |
| **Firewall** | Respetar la cadena `DOCKER-USER` (Postgres bloqueado host-wide con whitelist por subred: fijar la subred del compose) |
| **Secretos** | `JWT_SECRET`, token de Meta y la clave de cifrado **por env**, nunca en el repo. Cifrados en reposo si se persisten (AES-256-GCM, patrón de `redes-meta`) |
| **Módulo UI** | Va con el deploy de Centurión: push a `main` → runner `[self-hosted, centurion]` → test (gate) → build → `rsync --delete` a `/srv/centurion` → `systemctl restart` → health en `:3020/login` |
| **Activable** | Prender y apagar el entitlement no puede romper nada más |

⚠️ **`rsync --delete` y los datos de usuario.** El deploy de Centurión excluye `/srv/centurion/uploads/`
**a mano**; hasta el issue #93 no lo hacía y **cada deploy borraba todos los audios**. Si el satélite
deja algo subido por usuarios bajo esa ruta, va al `--exclude` en el mismo PR — o mejor, fuera del
árbol de deploy.

⚠️ **Y un binario del sistema no es una dependencia declarada.** Centurión espera `ffmpeg` en el PATH
y es **fail-open** a propósito. El satélite hereda de Hermes ffmpeg.wasm para comprimir video, con su
propia trampa medida: el core lo copia un **plugin de `vite.config.ts` dentro del build**, no un hook
de npm — estaba en `prebuild` y **no corrió nunca en producción**, y el deploy salió verde con la
compresión rota porque el fallback SPA devuelve `index.html` con **200**.

🔴 **Al verificar un estático en producción se miran content-type y tamaño, nunca el status.**

---

## 7. Seguridad — checklist verificable

- [ ] Identidad validada contra el core; **sin login paralelo**.
- [ ] Entitlement chequeado **server-side** por candidatura antes de responder.
- [ ] Toda query scopeada por el `id_candidatura` **de la identidad**, nunca del cliente.
- [ ] Tokens (Meta, servicio) **siempre** por `Authorization: Bearer` — nunca en query params ni logs.
- [ ] Firma HMAC verificada en el webhook, con **ack primero**.
- [ ] Idempotencia por `external_id` **+ el evento**, no solo por id.
- [ ] Secretos cifrados en reposo si se persisten.
- [ ] Puertos loopback-only · firewall · health-check.
- [ ] **La prueba que cierra el checklist**: desactivar el entitlement **corta el acceso y el canal**.
- [ ] Export completo en formato abierto y **borrado verificable con constancia** (§9 · D4).

---

## 8. El orden — tres carriles, ya abiertos

Ordenados por un reloj medido: **67 de las 69 candidaturas votan el 4-oct-2026**.

| Carril | Riesgo | Depende de | Épica |
|---|---|---|---|
| **1 · La línea en Hermes** | cero | **nada** | `hermes#341` → #338 · #339 · #340 |
| **2 · Octubre** — *nada de acá manda un mensaje* | cero de canal | nada | `centurion#119` → #115 · #116 · #117 · #118 |
| **3 · El satélite** | alto si se apura | D1 · D5 · D6 | `centurion#120` |

🔴 **El gate del carril 2, con fecha: si al 25 de agosto `captacion.escaneo` sigue en 0, se cancela**
y todo se va a post-elección. Un QR impreso que nadie escanea no es un problema de software.
⚠️ Pero al 10-ago la tabla **no existe**: el reloj de ese gate no corre hasta que #115 aplique la
migración **y** le ponga el `codigo` (§3.5). Si el 25 de agosto llega sin schema, lo que se midió no
es el interés de la gente — es que nadie prendió el sensor, y eso no cancela nada, lo pospone.

⚠️ **`centurion#116` está desactualizado**: dice «24 brigadistas» y hoy `territorio.brigadista` tiene
**35**. El diagnóstico que pide el ticket es más urgente de lo que su propio título afirma.

🔴 **El camino crítico del carril 3 no es nuestro**: verificar el Meta Business, dar de alta el WABA,
verificar el número y **aprobar plantillas** son semanas de trámite. Si no empieza esta semana, el
satélite no arranca en noviembre: arranca en enero.

---

## 9. Decisiones abiertas

| # | Decisión | Bloquea | Cuándo |
|---|---|---|---|
| **D5** | ¿De quién es el WABA / Meta Business? | el trámite entero del carril 3 | 🔴 esta semana |
| **D6** | El `codigo` y el nombre (**es el rótulo que el candidato lee**) | el alta en `fase_3` y el ticket #115 | 🔴 esta semana |
| **D3** | La ranura vendida dice «Alcance masivo» y el producto no manda masivo | la **venta**, no el código | antes del candidato 2 |
| **D1** | ¿Instancia por candidatura o base por tenant? | solo el carril 3 | antes del primer código |
| **D1b** | ¿De quién es el vecino: del CRM, de territorio, o de una identidad canónica? | el nudo (#117) | antes de §4.3 |
| **D2** | ¿Goberna trabaja para dos candidatos de la misma elección? | la forma de D1 | con D1 |
| **D4** | ¿De quién es el dato del vecino el día después de la elección? | el contrato | antes del piloto |

> ⚠️ **«Como página en su Centurión» decidió la PANTALLA, no la BASE.** El launcher es del monolito
> compartido y eso está bien. **Dónde viven las conversaciones y los tokens de Meta sigue siendo D1.**
> Leerlo como «la base de siempre» pondría los chats de dos campañas rivales en el mismo motor detrás
> de un `WHERE`.

---

## 10. Cómo se verifica que la integración funciona

Cada gate es un hecho contable, no una pantalla que se ve bien:

| Peldaño | Gate |
|---|---|
| `captacion` prendido | ⚠️ **primero que el schema exista**: `select 1 from pg_namespace where nspname='captacion'`. Recién después, `select count(*) from captacion.escaneo` **> 0**. Hoy la segunda query **tira error, no devuelve 0** — y un error de relación inexistente se lee como falla de conexión, no como el hecho que es |
| La libreta recibe dato | **un** contacto cargado por un brigadista real desde su teléfono |
| El satélite recibe | 🔴 **contá filas en `events`.** Nunca por un 200 (la cicatriz de ADR 0042) |
| El nudo ata | **un** vecino cuya ficha muestre a la vez **de qué QR vino, qué contestó y qué dijo por chat** |
| La mesa sirve | un operador atiende un día entero sin volver a WhatsApp Web |
| El lazo mide | la primera pregunta no es «¿cuál funciona?» sino **«¿alguien las está usando?»** |

**La métrica de la integración**: **% de vecinos con ≥2 fuentes resueltas** sobre el total de
contactados.

---

## 11. Cómo se falsifica este plan

- **Si el nudo no ata**: si ningún vecino se puede mostrar con sus tres hilos juntos, los sensores de
  Centurión no describen a la misma gente y «integrado» es una promesa de pantalla.
- **Si el peldaño 0 no da escaneos**: el funnel territorial no existe y esto es un CRM buscando un
  problema.
- **Si la doctrina no generaliza**: si del candidato 1 al 2 hay que reescribir el 80 % de las piezas,
  no hay activo transversal — hay consultoría con buen tooling, que es un negocio distinto y digno.
- **Si la línea no se puede dibujar**: si el carril 1 no baja la allowlist a 0 en un sprint, el motor
  no era un motor, y hay que decirlo antes de vender la extracción.

---

*Medido el 10-ago-2026 y **reverificado el mismo día**: Hermes contra su checkout canónico en
`feat/libreta-link-avanzado` @ `c3a151f`; Centurión contra `goberna_web_dev` (read-only, solo
conteos) y contra el checkout `apolo/centurion`. Contratos: `apolo/centurion/MICROSERVICE-CONTRACT.md`
y `MODULE-CONTRACT.md`. Marco: [`dos-planos.md`](dos-planos.md). Política de carriles:
`GOBERNA-TERRITORIO-x-DIGITAL.md` §3.*

*La reverificación confirmó exactas las 69 candidaturas, los 18 subservicios, las 272 selecciones,
los conteos de tablas por schema, las 0 filas de `territorio.contacto` con 35 brigadistas, las 696
respuestas de `formularios`, la fila 12 de `fase_3.subservicios` con su precio y sus 9 activas, y el
reloj (ERM2026 = **4-oct-2026**, 67 candidaturas; las otras 2 son EG2026, que ya votó el 12-abr).
También confirmó en el código: `MICROSERVICE-CONTRACT.md` §2/§3/§7, `handleCurrentCandidato`
(`candidato.handlers.ts:22`), `ACCESS_AUDIENCE = 'svc-territorio'` y `routes/w.$codigo.ts` —los tres
en el repo **Centurión**—, el
`--exclude 'uploads/'` del deploy, `whatsapp/transporteCloudApi.ts` cableado como spike en
`whatsapp/wiring.ts:75-86`, el `CLAUDE.md` de Hermes que en la línea 88 todavía dice que ese
transporte no existe, `sugerencias/estado.ts` con `curso`/`cotizada`/`precio`, los ADR 0017 · 0037 ·
0042, y los 10 issues (`hermes#338-341`, `centurion#115-120`), todos **OPEN**. Lo corregido está
marcado ⚠️ en §1, §3.5, §4.1, §8 y §10.*
