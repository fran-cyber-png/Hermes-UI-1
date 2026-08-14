# Directorio de personas de Goberna — especificación ejecutable

> **Qué es este archivo.** Lo que hay que saber para **crear el repo nuevo y construirlo**: stack,
> paquetes, estructura, modelo de datos, API, deploy, y el orden de tareas para ejecutarlo con varios
> agentes en paralelo. Escrito el **14-ago-2026**.
>
> **El porqué vive en otro lado**: [`plan-directorio-goberna.md`](plan-directorio-goberna.md) — el
> terreno medido, las cinco minas y la decisión de no hacer un servicio de autenticación. **Leelo
> antes.** Acá está el CÓMO.
>
> **Cada elección cita el precedente que la justifica.** Lo que no lo tiene dice **PROPUESTA**.
> Los números de este documento se verificaron uno por uno contra los repos y VPS1 el 14-ago-2026;
> los borradores previos de esta especificación contenían citas que no decían lo que se les atribuía,
> y por eso **acá no entra nada que no se haya abierto**.
>
> ⚠️ **Cuando el repo exista, este archivo se muda a su raíz** como `ESPECIFICACION.md` y en Hermes
> queda el puntero.

---

## 1. La regla que gobierna todo el diseño

> **El directorio dice QUIÉN ES cada persona y QUÉ LE CORRESPONDE. No verifica credenciales y no
> guarda ninguna.**

De ahí salen las tres propiedades que ningún cambio puede romper:

| | |
|---|---|
| **Sin credenciales** | Ninguna columna guarda una contraseña, un hash ni un secreto de persona. Si aparece una, esto dejó de ser el directorio. |
| **No es la fuente de quién existe** | Cerberus da de alta empleados y Centurión candidatos. El directorio los **nombra**, no los crea. |
| 🔴 **Que se caiga no puede impedir trabajar** | VPS1 se cayó el 14-ago. Si mañana eso deja a alguien afuera de Hermes, construimos un punto único de falla para toda la organización. Ver §7 — **es una propiedad, no una sección al final.** |

---

## 2. El stack, decidido contra lo que la casa ya corre

| # | Frente | **Elegido** | Alternativa | Por qué | Verificado |
|---|---|---|---|---|---|
| 1 | Runtime | **Node 22** | Bun (kanban) | 🔴 **Bun segfaultea en la CPU de VPS1 (sin AVX)** — es un veto medido, no una preferencia | `apolo/centurion/server.mjs:7-8`, literal. VPS1: `node v22.22.2` |
| 2 | HTTP | **Express 4** (`^4.21.2`) | Express 5 (kanban), Hono | Los middlewares que se copian están tipados contra 4 y se pegan sin traducir. Hono en la org es **sólo un adaptador** del handler fetch de TanStack Start, no un router | `hermes/server/package.json`; `centurion/server.mjs:9` |
| 3 | ORM | **Drizzle** (`^0.45.2`, el de Hermes) | Kysely (Centurión) | El esquema que se adopta ya es Drizzle. ⚠️ kanban está en `^0.38.0`: **hay salto de versión**, no se copia el archivo, se copia el diseño | `hermes` y `kanban` `package.json` |
| 4 | Migraciones | **Versionadas, expand-only, aplicadas por el deploy** | Manuales sin runner (Centurión) | En Centurión el deploy **no** corre migraciones y el schema puede derivar. Acá el valor entero es una tabla que otros leen | `hermes/docs/migraciones.md` |
| 5 | Validación | **Zod 4** (`^4.4.3`) | — | Hermes ya está en 4.4.3: un schema del contrato se copia y compila | `hermes/server/package.json` |
| 6 | Tests | **`node:test` vía `tsx --test`** | vitest | Mismo runtime que producción, sin capa de transform entre test y prod | `hermes/server/package.json` |
| 7 | Cripto | **`node:crypto`, cero dependencias** | `jsonwebtoken`, `jose` | Cerberus **no publica JWKS** (404 medido), nadie rota claves asimétricas: `jose` no compra nada hoy | `hermes/server/src/auth/centurion.ts` |
| 8 | Lint | **oxlint + prettier** | eslint | 🔴 En Centurión `eslint --fix` **borró aserciones que el runtime necesitaba** y rompió `tsc` en tres módulos | `centurion/CLAUDE.md` §Gotchas |

⚠️ **Sobre `node:crypto` y el HS256 a mano**: es el patrón de `auth/centurion.ts`, que funciona. Pero
si el `tsconfig` activa `noUncheckedIndexedAccess`, **ese archivo no compila** (`const [a,b,c] = partes`
no se estrecha con un `if (partes.length !== 3)`). Elegí uno: o el flag, o el patrón. **PROPUESTA: sin
el flag**, para que el código que ya funciona se pegue sin reescribir.

---

## 3. La estructura del repo

Es la convención viva de Hermes: **el dominio puro separado del I/O, y una regla vive una vez**.

```
directorio/
├─ src/
│  ├─ index.ts                    arranque: perímetro + routers + escucha
│  ├─ db/
│  │  ├─ schema.ts                las tablas (§4)
│  │  └─ client.ts                el singleton; los seams reciben `db`
│  ├─ personas/
│  │  ├─ dominio.ts               PURO: normalización, forma de una identidad
│  │  ├─ dominioSql.ts            el gemelo SQL de lo que tiene que existir en los dos
│  │  ├─ repositorio.ts           SEAM: recibe `db`, nunca lo importa
│  │  ├─ dominio.test.ts
│  │  └─ paridad.test.db.ts       cruza puro vs SQL sobre los mismos casos
│  ├─ permisos/                   ídem
│  ├─ auth/
│  │  ├─ servicio.ts              credencial POR RELACIÓN (§5.1)
│  │  └─ perimetro.ts             cerrado por defecto
│  ├─ rutas/
│  └─ lib/
├─ drizzle/                       migraciones versionadas + journal
├─ deploy/vps1/                   el unit, el vhost, el script
└─ ESPECIFICACION.md              este archivo
```

🔴 **`auth/perimetro.ts` se copia de Hermes y no se discute.** Su cicatriz está escrita ahí: *la auth
por-router se olvida —19 de 27 routers quedaron abiertos— y el perímetro no*. Un directorio de
identidad con un router abierto por olvido es el peor caso posible.

---

## 4. El modelo de datos

### 4.1 Qué se adopta de kanban, y qué NO

`goberna-kanban/backend/src/schema.ts` resolvió este problema el 7-ago-2026 y **su diseño de
identidades es el punto de partida**:

```ts
// kanban, schema.ts:787-812 — se adopta TAL CUAL
export const userIdentities = pgTable('user_identities', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),        // kanboard | google | cerberus | microsoft
  externalId: text('external_id').notNull(),   // el sub de Google, el pk de Django
  email: text('email'),
  verified: boolean('verified').notNull().default(false),
}, (t) => [
  uniqueIndex('user_identities_provider_external_uq').on(t.provider, t.externalId),
]);
```

🔴 **Pero su tabla `users` NO se adopta, y el motivo es la regla №1**: tiene `password_hash`
(`schema.ts:86`) porque kanban **autentica**. El directorio no. Adoptar esa tabla entera metería
credenciales adentro del servicio que existe para no tenerlas.

> **Se adopta el MAPA de identidades, no la tabla de usuarios.** kanban sigue siendo una aplicación
> con sus usuarios y su login; el directorio es otra cosa que apunta a las mismas personas.

⚠️ Y hay salto de versión de Drizzle (kanban `0.38`, Hermes `0.45`): **se copia el diseño, no el
archivo**.

### 4.2 `persona` — el ancla

```ts
export const personas = pgTable('personas', {
  /** El ancla. NUNCA cambia: es lo que hace que la historia sobreviva a cualquier
   *  cambio de login. Todo lo demás son nombres que otros sistemas le dan. */
  id: uuid('id').primaryKey().defaultRandom(),
  nombre: text('nombre').notNull(),
  /** Para mostrar y para el match por correo. No es identidad: la identidad vive
   *  en `identidades`, porque la misma persona puede tener varios correos. */
  email: text('email'),
  /** Baja lógica CON LECTOR. Si nadie la lee, es teatro (`numeros_wa.activo`
   *  no tenía un solo lector y retirar una línea con él no retiraba nada). */
  bajaAt: timestamp('baja_at', { withTimezone: true }),
  creadoAt: timestamp('creado_at', { withTimezone: true }).notNull().defaultNow(),
});
```

🔴 **Ninguna columna de credencial. Nunca.**

### 4.3 `identidad` — cómo la llama cada sistema

Los proveedores del día 1, y de dónde sale cada `external_id`:

| `provider` | `external_id` | quién lo crea |
|---|---|---|
| `cerberus-username` | el **username** (`luz`, `ventas10@grupogoberna.com`) | Cerberus |
| `cerberus-sub` | el **PK de Django** | Cerberus (OIDC) |
| `centurion` | `auth.usuario.usuario` | Centurión |
| `kanban` | `users.id` (uuid) | kanban |
| `hermes` | el `vendedoraId` tal como está en `gestiones` | derivado |

🔴 **`cerberus-username` y `cerberus-sub` son DOS proveedores, no uno, y ésa es la mina 1 del plan.**
El `sub` de Cerberus es el PK de Django; el `vendedoraId` de Hermes **es el username**. Un directorio
que federe por `sub` rompe la atribución de ventas, `gestiones`, notas y asignaciones de toda la
Escuela. Son dos filas que apuntan a la misma `persona`.

**La grafía se normaliza al ESCRIBIR, una sola vez**, y el índice único lo garantiza:

```ts
uniqueIndex('identidad_proveedor_externo_uq').on(t.provider, sql`lower(btrim(${t.externalId}))`)
```

Precedente: `hermes/server/src/espacios/` normaliza los dos lados con `lower(btrim(...))` e índice
funcional, **y el defecto que lo motivó está medido**: donde la comparación quedó exacta, un humano con
dos grafías tiene dos agendas, dos catálogos y dos libretas privadas.

⚠️ **`verified`**: `false` es una **hipótesis** por correo. Una identidad no verificada **se puede
leer pero no otorga permisos**. Si a 30 días la mayoría sigue en `false`, el padrón miente con formato
de verdad — es uno de los gates de §8.

### 4.4 `permiso` — modelado sobre los cuatro casos que existen

🔴 **Nada de RBAC genérico.** Los casos reales son cuatro y todos tienen la misma forma —
*(persona, sistema, permiso, ámbito)* — más quién lo afirmó:

| caso real | hoy vive en | `sistema` | `permiso` | `ambito` |
|---|---|---|---|---|
| supervisor del Dashboard/padrón | `HERMES_SUPERVISORES` (CSV en env) | `hermes` | `supervisor` | — |
| atiende una línea | `numero_vendedora` | `hermes` | `atiende_linea` | el número |
| entra al reparto | `reparto_rueda` | `hermes` | `en_la_rueda` | el número |
| contactos habilitados | `contacto_habilitado` | `hermes` | `padron` | — |

```ts
export const permisos = pgTable('permisos', {
  personaId: uuid('persona_id').notNull().references(() => personas.id),
  sistema: text('sistema').notNull(),
  permiso: text('permiso').notNull(),
  ambito: text('ambito'),                 // null = todo el sistema
  /** Quién lo afirmó. Un permiso sin rastro no se puede auditar, sólo obedecer. */
  otorgadoPor: text('otorgado_por').notNull(),
  otorgadoAt: timestamp('otorgado_at', { withTimezone: true }).notNull().defaultNow(),
  revocadoAt: timestamp('revocado_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('permiso_activo_uq').on(t.personaId, t.sistema, t.permiso, t.ambito)
    .where(sql`revocado_at is null`),
]);
```

**Revocar no borra** (índice parcial sobre lo activo) — el molde es `vinculos_identidad_activo_uq` de
`hermes/server/src/identidad/`.

⚠️ **Ninguna columna que nadie lea.** Si al terminar hay un campo sin un `SELECT` que lo consulte,
se saca: es exactamente el defecto de `numeros_wa.activo`.

---

## 5. La API

### 5.1 Autenticación: **un secreto por relación**

🔴 **Un secreto compartido por todos los consumidores hace que el `aud` no aísle nada** — es el defecto
medido de Cerberus (mina 2 del plan: un solo `OIDC_SHARED_SECRET` HS256 para todos). No se repite.

| consumidor | variable | patrón |
|---|---|---|
| Hermes | `DIRECTORIO_SECRET_HERMES` | JWT HS256 corto, `aud: 'directorio'`, `iss: 'hermes'` |
| Centurión | `DIRECTORIO_SECRET_CENTURION` | ídem, `iss: 'centurion'` |
| Cerberus | `DIRECTORIO_SECRET_CERBERUS` | ídem |
| kanban | `DIRECTORIO_SECRET_KANBAN` | ídem |

**El secreto se usa siempre como FIRMA, nunca como bearer** — el patrón de `CENTURION_SSO_SECRET`, que
ya funciona entre Hermes y Centurión. Y **se verifica `aud`, `iss` Y `exp`**: un token sin `exp` no
vence nunca, y `jwt.verify` sólo valida el vencimiento si el claim está presente (defecto real,
encontrado y arreglado en `centurion/src/lib/hermes-sso.ts` el 14-ago).

### 5.2 Los endpoints

| Método | Ruta | Para qué | Caída → |
|---|---|---|---|
| `GET` | `/api/persona/por-identidad?proveedor=&id=` | resolver `centurion:betto.romero` → persona | **caché del consumidor** |
| `GET` | `/api/persona/:id/permisos?sistema=` | qué le corresponde | **caché del consumidor** |
| `POST` | `/api/identidad` | vincular una identidad a una persona | falla ruidoso |
| `POST` | `/api/permiso` | otorgar | falla ruidoso |
| `DELETE` | `/api/permiso` | revocar | 🔴 **falla ruidoso y se reintenta** (§7) |
| `GET` | `/salud` | monitoreo, sin PII | — |

**Códigos**, con el criterio de la casa: **un error de config no se disfraza de credencial mala**.

| | significado |
|---|---|
| `401 credencial_invalida` | el JWT no lo firmó un consumidor conocido |
| `403 servicio_no_autorizado` | lo firmó, pero esa operación no es suya |
| `503 falta_config` | al directorio le falta el secreto de esa relación |
| `200` con `persona: null` | **no hay tal identidad** — y no es 404: un 404 no se distingue de «la ruta no está desplegada» |

⚠️ **Nada de `.strict()` en los schemas de respuesta.** Un campo nuevo no puede ser un 502 para un
consumidor viejo — el criterio de `hermes/server/src/ivi/cliente.ts`.

### 5.3 El cliente

**Cada consumidor escribe el suyo**, con el molde de `hermes/server/src/centurion/credenciales.ts`:
firma con `node:crypto`, valida con Zod, timeout, códigos tipados. Son 4 consumidores en 3 stacks
distintos (Express/Drizzle, TanStack/Kysely, Django) — **un paquete compartido tendría que existir en
tres ecosistemas**, y el cliente son ~120 líneas.

---

## 6. El deploy

```ini
# /etc/systemd/system/directorio.service
[Unit]
Description=Directorio de personas de Goberna
After=network.target docker.service
[Service]
Type=simple
User=deploy
WorkingDirectory=/srv/directorio
EnvironmentFile=/srv/ops/directorio.env
Environment=NODE_ENV=production
Environment=PORT=4130
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5s
[Install]
WantedBy=multi-user.target
```

🔴 **`ExecStart` con un binario, nunca `npm run dev`.** El `hermes.service` corre `npm run dev`
(= `tsx watch`) y eso produjo **41 s de API muerta con systemd reportando `active (running)`**.

⚠️ **`EnvironmentFile` propio (`/srv/ops/directorio.env`), no `platform.env`** — que es el archivo
compartido de la plataforma. Un error de sintaxis ahí voltea todo lo que lo lee.

- **Puerto 4130** y **base 5441**, los dos verificados libres el 14-ago. ⚠️ **5439 está reservado**
  para la base efímera de tests de Hermes: nunca tomarlo.
- **`/srv/ops/new-project.sh <nombre> <dominio> <puerto> --ssl` ya existe** y hace directorio, unit,
  vhost, symlink y certbot.
- **Runner propio**: los 14 de VPS1 son **uno por repo** y ninguno está libre.

---

## 7. 🔴 Qué pasa cuando el directorio está caído

**VPS1 se cayó el 14-ago-2026.** Esta sección es la razón por la que el diseño tiene la forma que
tiene.

| consumidor | lectura | escritura |
|---|---|---|
| **Hermes** | 🔴 **Nunca bloquea un login.** Sirve la última respuesta buena de su caché, fechada. Sin caché: el comportamiento de hoy (`HERMES_SUPERVISORES` del env, `numero_vendedora` de su tabla) | encola y reintenta |
| **Centurión** | ídem: el entitlement sigue saliendo de `fase_2` | ídem |
| **Cerberus** | su push a `/api/admin` de Hermes **no pasa por el directorio** | — |
| **kanban** | su login es local y no lo consulta | — |

**La asimetría es deliberada, y tiene precedente**: `cola/lineas.ts` es **fail-open** para personal
interno (una vendedora nueva tiene que ver la cola, no una pantalla vacía) y el SSO de Centurión es
**fail-closed** para alguien ajeno. **El directorio caído nunca convierte un fail-open en fail-closed.**

🔴 **La única excepción, y hay que decirla**: una **revocación** no se puede servir desde caché — es
lo único donde estar desactualizado otorga de más. Por eso las revocaciones se **empujan** al
consumidor (no se preguntan), y si el push falla se reintenta hasta confirmar.

---

## 8. El plan de ejecución con varios agentes

Cada tarea es tomable por un agente sola. **El gate es contable**: un número contra una fila, nunca
«se ve bien».

| # | tarea | depende de | gate |
|---|---|---|---|
| **T0** | Commitear la capa satélite de Centurión (`service-token.ts`, `entitlement.ts`) | — | `git ls-files` la encuentra · `tsc` sin los 3 errores |
| **T1** | Repo, tsconfig, lint, CI, unit, vhost, runner | — | `/salud` responde 200 desde el dominio |
| **T2** | Esquema + migraciones + seed vacío | T1 | `drizzle.__drizzle_migrations` con las filas esperadas |
| **T3** | `auth/servicio.ts` (secreto por relación) + `perimetro.ts` | T1 | un token de otro `iss` da 401; sin secreto, 503 |
| **T4** | `GET /persona/por-identidad` + su cliente en Hermes | T2, T3 | resuelve `centurion:betto.romero` a una persona real |
| **T5** | Permisos: otorgar, revocar, consultar | T2, T3 | un permiso revocado deja de venir, y su fila sigue |
| **T6** | 🔴 **El alta de línea sin Cerberus** | T5 | **un agente digital entra a Hermes sin que Cerberus escriba una fila** |
| **T7** | Poblar: kanban + Centurión + Hermes | T2 | `identidades > 0`, y el % `verified` medido |
| **T8** | **Sombra**: el directorio contesta y nadie le hace caso; se cuentan las diferencias | T4, T7 | 7 días con **diferencias = 0** contra la fuente actual |
| **T9** | Cutover por consumidor, con vuelta atrás ensayada | T8 | revertir toma **< 5 min**, cronometrado |

**T1, T2 y T3 pueden ir en paralelo** una vez creado el repo. **T6 es el que decide si esto vale**:
es la versión más chica que hace algo que hoy no se puede.

⚠️ **T6 ya tiene el terreno listo**: el `PUT` declarativo de Cerberus dejó de borrar las identidades
federadas (`hermes#372`, 14-ago). Sin eso, el directorio no podía ser un segundo escritor de
`numero_vendedora` sin que el siguiente push de Cerberus lo pisara en silencio.

---

## 9. Lo que NO se hace

- **No se migran usuarios.** Lo que se migra son **decisiones** que hoy viven en un CSV, un env var y
  un CLI. Nadie pierde su login.
- **No hay RBAC genérico**, ni roles jerárquicos, ni herencia. Cuatro casos reales, una forma.
- **No hay UI en la v1.** Se administra por API y CLI, con el molde de `reparto:rueda` (dry-run por
  default). Una pantalla se justifica cuando haya a quién mostrársela.
- **No se toca la autenticación de nadie.** Ni Cerberus, ni Centurión, ni kanban.
- **No entra Mattermost como consumidor**: va a morir y kanban lo absorbe. Sus 47 cuentas entran al
  padrón **por kanban**, una sola vez, cuando esa absorción termine.

---

## 10. Lo que queda para el dueño

| | decisión | estado |
|---|---|---|
| **D1** | ¿VPS1? | **PROPUESTA en el plan §5.** Sin esto no arranca T1 |
| **D2** | ¿Adoptar el mapa de identidades de kanban? | **Resuelta de hecho**: kanban absorbe Mattermost y es el centro de gravedad. Falta escribirlo |
| **D3** | ¿Entra `gestion.goberna.us` como consumidor, o sólo como fuente? | abierta — define el tamaño |
| **D4** | El nombre del repo y del servicio | abierta. Este documento dice `directorio` como marcador |

---

*Verificado el 14-ago-2026: `centurion/server.mjs:7-8` (veto de Bun), VPS1 `node v22.22.2`, puertos
4130 y 5441 libres, `/srv/ops/new-project.sh` presente, `hermes/server/package.json`
(express `^4.21.2`, zod `^4.4.3`, drizzle-orm `^0.45.2`), `goberna-kanban/backend/src/schema.ts:78-108`
(`users`, con `password_hash`) y `:787-812` (`user_identities`).*
