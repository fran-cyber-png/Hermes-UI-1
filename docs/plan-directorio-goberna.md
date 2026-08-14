# El directorio de personas de Goberna — plan y contexto

> **Qué es esto.** El plan para construir, en **repo aparte**, la herramienta que contesta *quién es
> cada persona en todo Goberna, con qué identidades en cada sistema, y qué le corresponde*. Escrito el
> **14-ago-2026**.
>
> **Qué NO es.** No es un servicio de autenticación, y §1 explica por qué eso importa. Las
> credenciales se quedan donde están.
>
> **Cómo leerlo.** Lo que dice un número **está medido** y dice contra qué. Lo que es propuesta dice
> **PROPUESTA**. Lo que necesita al dueño está en §9 y en ningún otro lado.
>
> **Origen de los números.** VPS1 (`161.132.39.165`) y VPS2 (`75.119.138.200`), read-only, 14-ago-2026;
> checkouts de `hermes` (`b795d03`), `apolo/centurion` (`852ccbd`) y `goberna-kanban`. Ocho agentes:
> cuatro midiendo y cuatro refutando. **Donde el refutador corrigió a la sonda, va el número
> corregido**, y se dice cuál era el error.

---

## 0. La decisión, en una frase

**Un directorio de personas y permisos, no un proveedor de identidad.**

> La credencial se queda donde la persona **existe**. El directorio dice **quién es esa persona en
> todo Goberna** y **qué le corresponde**.

---

## 1. Por qué no un servicio de autenticación

La pregunta original fue «¿un microservicio que controle la autenticación por org?». La respuesta es
que **«auth» son tres cosas** y sólo dos duelen:

| | qué contesta | dónde vive hoy | ¿duele? |
|---|---|---|---|
| **Autenticar** | ¿es quien dice ser? | Cerberus (Django), Centurión (bcrypt), y **siete almacenes más** | no |
| **Padrón** | ¿quién es, y cómo lo llama cada sistema? | **en ningún lado** | 🔴 sí |
| **Permisos** | ¿qué le corresponde, y quién lo dijo? | un CSV, un env var, un CLI y una tabla | 🔴 sí |

Mudar la autenticación no paga porque **cada identidad está enredada con el dominio de su dueño**: una
vendedora existe en Cerberus porque ahí es empleada, con su legajo y sus ventas; un agente digital
existe en Centurión porque ahí viven la candidatura y el entitlement. Un servicio que guarde
«usuario + hash + org» se queda con la parte que no sirve sola, y todo consumidor volvería igual al
sistema dueño a buscar el resto.

Hay además un argumento propio de la casa: **se acaba de elegir una instancia por candidatura** para
que dos rivales no compartan un `WHERE`. Un servicio de autenticación compartido los vuelve a juntar
en un proceso.

**Lo que sí se comparte es el protocolo, y ya está construido**: JWT corto, un `aud` por consumidor, un
secreto por relación, e identidad namespaced por origen (`centurion:<usuario>`).

---

## 2. El terreno, medido

### 2.1 Los dos VPS

| | **VPS1** `161.132.39.165` | **VPS2** `75.119.138.200` |
|---|---|---|
| SO / kernel | Ubuntu **20.04**, 5.4 | Ubuntu **24.04.4**, 6.8 |
| vCPU / RAM | 8 / 30 GiB | **12 / 47 GiB** |
| Swap | 2 GiB, **1,4 en uso** | 0 B |
| Disco libre | **371 G** (39 % usado) | **83 G** (83 % usado) |
| Contenedores | **75** | 35 |
| Panel de control | ninguno | **HestiaCP, 41 usuarios** |
| Sitios de terceros | 3 | **~40 clientes, 35 WordPress** |
| `server_name` en nginx | 61 | **149** |
| Piezas de identidad | **Hermes, Centurión, `hermes_db`** | 🔴 **`cerberus_app`** |
| Runners | 14 `vps1-*` | 14, incl. `vps2-cerberus-runner` |

⚠️ **El nombre de VPS2 miente**: se llama `mail.goberna.us` y **no tiene mail**. El correo real —Mailu,
y el MX de los dominios de clientes— corre en **VPS1**.

🔴 **Y VPS1 tiene un agujero que este mapeo encontró de paso, que no es de este frente y hay que
arreglar igual**: `ufw` **no protege un puerto publicado por Docker en `0.0.0.0`** (el DNAT entra por
`FORWARD`, no por `INPUT`; la única cadena que filtra es `DOCKER-USER` y hoy sólo cubre el 5432). Medido
desde afuera, **seis bases responden desde internet**: `5433`, `5434` (`icarus_db`, que sirve a un
cliente real de consultoría), `5436`, `55433` (la base de Centurión), `3307`. Dos están abiertas a
propósito con regla comentada; **tres lo están contra la intención escrita** — su regla `ufw` existe y
no se aplica. Ver §9.

### 2.2 Las poblaciones — son más de tres

El primer mapeo dijo «142 credenciales en 3 almacenes». El refutador barrió VPS2 y **no reproduce**:

| almacén | población | filas |
|---|---|---|
| `nexus_postgres` | usuarios de nexus | **3.363** |
| `goberna_escuela_db` | alumnos | 6.056 (12 con clave) |
| `mattermost-db` | **el equipo entero** | 47 (45 activos) |
| `goberna_gestion_db` | operadores de gestión | **57** (56 con hash) |
| Centurión `auth.usuario` | candidatos, brigadistas, clientes | — |
| Cerberus (Django) | vendedoras y empresa | — |
| +3 más | `engram`, `gb-chat-dev`, `leads_crm`, `tenant_edwards` | — |

**Son al menos nueve almacenes de credencial, no tres.** Y dos de los que faltaban —Mattermost y
gestión— no son adyacentes: **son población de operadores**, justo la que este directorio tiene que
nombrar.

### 2.3 🔴 El prior art: esto ya está empezado, en `goberna-kanban`

El diseño que hace falta **ya existe** en `goberna-kanban` (= `gestion.goberna.us`), construido el
7-ago-2026. `backend/src/schema.ts`:

- **`users.id` uuid es el ancla y nunca cambia.**
- `user_identities (user_id, provider, external_id, email, verified)` con
  **`uniqueIndex(provider, external_id)`** — «la misma persona vista por cada sistema».
- `users.auth_provider` (`'local' | 'cerberus'`) es la costura de migración.

Su propio docblock ya anticipa el caso: *«Cuando los usuarios pasen a Cerberus (VPS2), su id de allá
vive acá y migrar a alguien es agregar una fila — no tocar las 22 tablas que referencian `users.id`»*.
Y `externalId` está documentado como *«el sub de Google, **el pk de Django**»* — o sea que ya vio la
mina de §3.1.

⚠️ **Pero migró CERO usuarios**: `auth_provider` → `local` 57, `cerberus` **0**; `user_identities` → **0
filas**; `oauth_code` → 2. **Es un spike verificado, no infraestructura de identidad en producción.**

> **Consecuencia para el plan: no se arranca de cero, se ADOPTA ese esquema.** La decisión no es «cómo
> modelar identidad» —está resuelta y probada contra 5.409 eventos atribuidos— sino **dónde vive y
> quién puede escribirla**.

---

## 3. Las cinco minas medidas

### 3.1 🔴 `sub` de Cerberus es el PK de Django, y el `vendedoraId` de Hermes es el USERNAME

Cerberus expone OIDC. Su `sub` es `str(auth_code.user.pk)`; el username viaja sólo en
`preferred_username`. **Hermes atribuye todo por username**: `gestiones`, `envios_wa`,
`numero_vendedora`, notas, asignaciones.

**Un directorio que federe por `sub` rompe la atribución de ventas de toda la Escuela.** El `sub` va en
`user_identities.external_id`; **el username es otra identidad, del proveedor `cerberus-username`.**
Son dos filas, no una.

### 3.2 🔴 Cerberus es «proveedor OIDC» de nombre, no un IdP enchufable

Medido dentro del contenedor y probando los endpoints:

- **No hay registro de clientes**: `_client_valido()` compara contra **un solo `OIDC_CLIENT_ID` de
  env**. Sumar un segundo consumidor es cambiar código + env + redeploy, no un INSERT.
- **Un solo `OIDC_SHARED_SECRET` HS256 para todos** → el `aud` **no aísla nada** entre clientes.
- **No hay discovery, JWKS ni userinfo** (`/.well-known/openid-configuration` → **404**, `/oauth/jwks/`
  → 404, `/oauth/userinfo/` → 404). Sin PKCE ni refresh. El `access_token` **es el mismo string** que
  el `id_token`.

**No se puede planificar sobre «ya tenemos OIDC».** El directorio habla con Cerberus como habla Hermes
hoy: por su login, con su contrato.

### 3.3 🔴 La capa satélite de Centurión no existe en git

`service-token.ts`, `entitlement.ts`, `service-auth.handlers.ts` y `svc.$servicio.api.candidatura.ts`
están **`??` untracked** — git no los conoce, en ninguna rama. El contrato servicio↔servicio que
`MICROSERVICE-CONTRACT.md` describe **está escrito y no versionado**.

**Antes de construir contra ese contrato, hay que commitearlo.** Es también la causa de los 3 errores
de `tsc` que arrastra el repo.

### 3.4 🔴 Una grafía distinta parte los datos personales de alguien, en silencio

`Luz` vs `luz`, `Usuario1` vs `usuario1`. Se sabía que rompía el cruce de conversaciones. Medido ahora,
es peor: donde la comparación es exacta, **un humano con dos grafías tiene dos agendas, dos catálogos de
categorías, dos juegos de plantillas y dos libretas privadas**.

Y hay un caso que contradice al `CLAUDE.md`: `notas/notas.ts:254` compara exacto mientras
`espacios/visibilidadSql.ts:50` —la misma regla— normaliza. La lista muestra una mitad y la búsqueda
encuentra las dos.

⚠️ El criterio no es «cuántos archivos normalizan» sino **quién escribe el otro lado**: exacto es sano
cuando ambos lados salen del token; rompe cuando lo escribe Cerberus, un CLI o Centurión.

### 3.5 El alta de una persona ya son dos pasos en dos sistemas

Un agente digital necesita: (1) su cuenta en Centurión y (2) **una línea en `numero_vendedora` de
Hermes**, sin la cual come 403. Y lo único que escribe esa tabla es `PUT /api/admin/numeros/:numero`,
**cuyo dueño es Cerberus** — que en el entorno de campaña no va a existir.

**Ese es el primer entregable, y ya está en el camino crítico por otro motivo.**

---

## 4. Qué es, y qué nunca es

**Es:**
- El **ancla**: una persona = un `id` que no cambia nunca.
- El **mapa de identidades**: `(proveedor, id_externo) → persona`, con si está verificada y quién lo
  afirmó.
- El **padrón de permisos**: qué le corresponde a quién, **escribible por más de un sistema**, con
  rastro.

**Nunca:**
- 🔴 **No guarda contraseñas.** Ni una. Si alguna vez las guarda, dejó de ser esto.
- **No es la fuente de verdad de quién existe**: Cerberus sigue dando de alta empleados y Centurión
  candidatos. El directorio los **nombra**, no los crea.
- **No autentica.** Puede *decir* con qué proveedor se autentica alguien; no verifica la credencial.
- **No es un servicio compartido entre planos** en el sentido de `dos-planos.md` §4: es de **Goberna
  interno**. Un nodo de cliente no le pregunta nada, y por lo tanto un incidente acá no cruza a un
  cliente.

---

## 5. Dónde vive — **PROPUESTA: VPS1**

| | a favor | en contra |
|---|---|---|
| **VPS1** | 2 de 3 consumidores ya están acá (Hermes, Centurión) · **371 G libres** · sin panel de control ni hosting compartido · patrón de servicio nuevo ya scripteado | SO 20.04, swap en uso, 75 contenedores |
| **VPS2** | Cerberus al lado · SO y CPU mejores | 🔴 **disco al 83 %** · HestiaCP con 41 usuarios y **35 WordPress** (fail2ban ya tiene jail `wordpress-auth`) · superficie de ataque de hosting compartido |

**Va en VPS1.** El argumento decisivo no es capacidad: es que **un directorio de identidad interno no
debe vivir en la máquina que hospeda 40 sitios de clientes con un panel de control**. Que Cerberus esté
en VPS2 no pesa: se le habla por HTTPS, que es lo que Hermes ya hace.

**Puerto `4130`** (el bloque 4121–4321 está libre; la convención es 4xxx de a 10) y base **`5441`**
(⚠️ `5439` está **reservado** para la base efímera de tests de Hermes — nunca tomarlo).

Y hay un atajo medido: **`/srv/ops/new-project.sh <nombre> <dominio> <puerto> --ssl` ya existe** y hace
los cinco pasos (directorio, unit, vhost, symlink, certbot). ⚠️ **El repo nuevo necesita su propio
runner**: los 14 son uno por repo y **ninguno está libre**.

---

## 6. El orden — primero la herramienta

> La regla que lo ordena: **el directorio nace AL LADO de lo que existe.** No se migra ningún usuario.
> Lo que se migra después no son personas — son **decisiones** que hoy viven en un CSV, un env var y un
> CLI. Esa migración es reversible y no le saca nada a nadie.

| # | qué | GATE |
|---|---|---|
| **0** | Commitear la capa satélite de Centurión (§3.3) | `git ls-files` la encuentra · `tsc` sin los 3 errores |
| **1** | El repo, el esquema adoptado de `goberna-kanban`, y **una** ruta: `GET /persona/:id` | `select count(*) from user_identities` **> 0** con las personas reales del equipo |
| **2** | 🔴 **El alta de línea sin Cerberus** (§3.5) — el primer entregable útil | un agente digital entra a Hermes **sin que Cerberus escriba una fila** |
| **3** | Los supervisores salen del CSV a la tabla, con quién los nombró | `HERMES_SUPERVISORES` deja de leerse · el Dashboard recorta igual que antes |
| **4** | La grafía se normaliza **en el borde de escritura**, una vez | cero pares que difieran sólo en mayúsculas entre las tres tablas |
| **5** | La rueda de reparto se administra desde acá | `reparto:rueda` deja de ser la única puerta |
| **6** | Recién ahí: ¿lo necesita alguien más? | si a los 30 días el único consumidor es Hermes, **no era un servicio** |

⚠️ **El paso 2 es el que decide si esto vale.** Es la versión más chica del directorio que hace algo
que hoy no se puede. Si funciona, el resto se justifica solo; si no, mejor saberlo antes de construir
un servicio.

---

## 7. El contrato con cada consumidor

Ninguno cambia su forma de autenticar. Todos preguntan **después** de autenticar.

| consumidor | qué pregunta | qué NO hace |
|---|---|---|
| **Hermes** | «¿quién es `centurion:betto.romero`? ¿es supervisor? ¿qué líneas atiende?» | no delega su login; `auth/sesion.ts` no se toca |
| **Centurión** | «¿este `auth.usuario` tiene identidad en Hermes?» | no delega su bcrypt |
| **Cerberus** | empuja altas y bajas, como ya empuja `numero_vendedora` | no pierde ser el ERP |

**Autenticación**: `Authorization: Bearer <jwt>` firmado con un **secreto por relación** y un `aud`
propio por consumidor — el patrón que ya funciona entre Hermes y Centurión, y que §3.2 muestra que
Cerberus **no** tiene.

---

## 8. Cómo se falsifica este plan

- **Si el paso 2 no se puede hacer sin tocar Cerberus.** Es la premisa entera. Si el alta de línea
  igual necesita que Cerberus escriba, el directorio no compró autonomía.
- **Si a los 30 días el único consumidor es Hermes**: no era un servicio, era un módulo de Hermes, y
  hay que decirlo antes de mantener un repo más.
- **Si `user_identities` se llena de suposiciones.** `verified = false` es una hipótesis por mail. Si a
  30 días la mayoría sigue sin verificar, el match automático no funciona y el padrón miente con
  formato de verdad.
- **Si aparece una contraseña adentro.** Cualquier columna que guarde una credencial convierte esto en
  lo que §1 descartó.
- **Si la grafía sigue partiendo datos después del paso 4.** El gate es contable: cero pares que
  difieran sólo en mayúsculas.

---

## 9. Lo que necesita al dueño

| # | decisión | por qué no la puedo tomar |
|---|---|---|
| **D1** | ¿VPS1, como propone §5? | es plata y es riesgo operativo |
| **D2** | ¿Se adopta el esquema de `goberna-kanban` o se reescribe? | adoptarlo ata el repo nuevo a decisiones de otro equipo |
| **D3** | ¿`gestion.goberna.us` y Mattermost entran al padrón, o sólo Hermes/Centurión/Cerberus? | define el tamaño real del frente |
| **D4** | El nombre del repo y del servicio | es el rótulo que va a leer todo el mundo |

> 🔴 **Y una que no es de este frente pero no puede esperar a que se decida éste**: las **tres bases de
> VPS1 expuestas a internet contra su propia regla `ufw`** (§2.1), una de ellas la de un cliente real de
> consultoría. Se arregla con el binding a `127.0.0.1` o con `DOCKER-USER`, y es independiente de todo
> lo demás.

---

*Medido el 14-ago-2026 contra VPS1 y VPS2 (read-only), `hermes@b795d03`, `apolo/centurion@852ccbd` y
`goberna-kanban`. Marco: [`dos-planos.md`](dos-planos.md). Contratos:
`apolo/centurion/MICROSERVICE-CONTRACT.md` y `MODULE-CONTRACT.md`.*

*⚠️ Este documento vive en `hermes/docs/` porque acá está el rastro de decisiones del que sale
(`dos-planos.md`, `plan-de-integracion-centurion-hermes.md`) y porque su primer entregable es un cambio
en Hermes. **Cuando el repo nuevo exista, se muda ahí y acá queda el puntero.***
