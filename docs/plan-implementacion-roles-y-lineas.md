# Plan de implementación — roles, frontera y líneas propias

> **Qué es este documento.** El paso a paso para llevar a producción tres frentes que se pisan: la
> **auto-vinculación de WhatsApp** (construida y sin mergear, en un worktree), el **modelo de roles
> administrado desde Hermes** (decidido, sin construir) y los **defectos vivos** que los dos
> arrastran. Está pensado para seguirse en orden, de arriba abajo.
>
> **Corte de medición: 15-ago-2026.** `origin/main` = `073834c` = producción, sin drift. Toda cifra
> sale de un SELECT contra `hermes_db`/`meta_escuela` en VPS1; toda afirmación de código lleva
> `ruta:línea` y dice si es del **worktree** o de **main**.
>
> ⚠️ **Ninguna escritura a producción la ejecuta un agente.** Los SQL y los scripts con `--aplicar`
> de este documento los corre **una persona**, leyendo antes el control previo y teniendo a mano el
> rollback. Están escritos completos para eso.

---

## 1 · Lo que está decidido, y lo que no

### Decidido por el dueño (15-ago-2026)

| | Decisión |
|---|---|
| **D1** | Se agrega un tercer rol: **admin**. Los roles son `admin` / `supervisor` / `vendedora`. |
| **D2** | Roles y frontera **dejan de vivir en el `.env`**: los administra el admin desde una pantalla. |
| **D3** | El panel alcanza **todo, líneas incluidas**: qué línea atiende cada persona, y la rueda del reparto. |
| **D4** | **La frontera es propiedad del rol**: toda vendedora ve lo suyo + lo huérfano; supervisor y admin ven todo. |
| **D5** | El `.env` se siembra a la tabla y queda como **break-glass solo para admin**, gritando en el log. |
| **D6** | Los admin son **`Usuario1` y `alan`** — dos, no uno. |
| **D7** | **`usuario2` no es solo campaña**: atiende también la Escuela. |
| **D8** | Las **24 conversaciones** de las cuentas dormidas se **reasignan a `luz`**. |
| **D9** | Desactivar a alguien **lo saca de la sesión** (401 `equipo_inactiva`). |
| **D10** | **Se le avisa a Cerberus antes** del paso que cambia la propiedad de `numero_vendedora`. |
| **D11** | Una vendedora que no es supervisora puede **traer su propio número, solo 1**, desde la app (revierte parcialmente D13). |

### Sin decidir — bloquean pasos concretos

| # | Qué | Recomendación | Bloquea |
|---|---|---|---|
| **P1** | **Tracy.** No está en ninguna lista. Activa en la rueda, 10 conversaciones asignadas, **la última de hoy**, un solo envío en 30 días, sin línea. | Sacarla de la rueda hoy y decidir si sigue trabajando. | Paso 1 |
| **P2** | **Las otras 20 conversaciones**: 10 de `Tracy` y 10 de `ventas10@`. D8 cubre solo 24. | Que vayan a `luz` junto con las 24. | Paso 1 |
| **P3** | **Qué rol le toca a `ventas10@`.** Está en supervisores, 0 envíos en 30 días. | `vendedora` — salvo que corra campañas (10 de los 17 call sites son de campaña). | Paso 5 |
| **P4** | **Break-glass vs. `activa`**: si un admin queda desactivado, ¿el `.env` lo salva? | Sí: el break-glass se evalúa **antes** de `activa`, no cuenta para el candado del último admin, y grita en cada request. | Paso 7 |
| **P5** | **Quién pilotea la auto-vinculación y en qué ventana.** | Una sola persona, con reinicio provocado a propósito en ventana muerta. | Paso 4 |

---

## 2 · El estado de hoy

### Tres checkouts

| Dónde | Rama | Estado |
|---|---|---|
| `/Users/milaa/goberna/hermes` | `feat/campana-internacional` (`48fc176`) | 2 archivos de la frontera **sin commitear** + 17 `scratch-*.mts` sin trackear |
| `.claude/worktrees/auto-vinculacion-whatsapp` | `feat/auto-vinculacion-whatsapp` (`073834c`) | 8 modificados + 12 sin trackear, **cero commits** |
| `/srv/hermes` (VPS1) | `main` (`073834c`) | sin drift |

⚠️ **Hay cinco worktrees compartiendo un solo `.git`.** Un `git commit` desde el directorio equivocado
cae en la rama de otro frente — ya pasó una vez. **Antes de cada commit, verificar la rama en el
directorio donde vas a commitear.**

### Las cifras que gobiernan las decisiones

| Hecho | Cifra |
|---|---|
| Conversaciones en la ventana de 30 días | **5.492** |
| …con dueña — todas en `51984429504` | **2.591** |
| …que el **script de campaña** colgó, no la rueda | **2.543** (98,1 %) |
| Huérfanas en la línea que hoy recibe | **0** |
| Huérfanas que son historia de dos líneas muertas | **2.875** (99,1 %) |
| Reinicios de producción en 7 días · mediana | **24** · **1,36 h** |
| …en horario de venta (08–19 Lima), sobre 58 en 30 días | **54** |
| Humanos con actividad en 7 días | **4** |
| …que mandaron mensajes | **2** (`luz` 610, `usuario2` 31) |

---

## 3 · La secuencia

| Paso | Qué | Nivel | Precondición |
|---|---|---|---|
| **0** | Guardar el trabajo: commitear el worktree, mover la frontera a rama limpia, correr los tests con base | sin deploy | — |
| **1** | Operación: avisar a Cerberus, las 24 a `luz`, ordenar la rueda | sin código | P1, P2 |
| **2** | **PR-1** · normalización de grafías (+ la decisión de Centurión) | N5 | paso 1 aplicado |
| **3** | **PR-2** · frontera con cláusula de línea + el bug de los conteos | N5 | PR-1 |
| **4** | **PR-3** · auto-vinculación con los siete arreglos | N5 | PR-2, P5, #194 |
| **5** | Roles: tabla `equipo` + carga del rol (**migración 0027**) | N5 | P3 |
| **6** | Cerrar `/api/routing` | N5 | paso 5 |
| **7** | El panel: `/api/equipo` + vista Equipo | mixto | paso 5, P4 |
| **8** | Líneas y rueda desde el panel (**migración 0028**) | N5 | D10 aplicado |
| **9** | El cartel: el recorte deja de ser mudo | **N4** | — |
| **10** | La frontera pasa a ser propiedad del rol | N5 | paso 9 en el mismo PR |
| **11** | Fusión de grafías (**migración 0029**) | N5 | respaldo |
| **12** | Apagar los CSV del `.env` | `.env` + restart | paso 5 |

**La regla que ordena todo: el server va primero, salvo el cartel.** N4 sale sin reinicio en el push a
`main`; N5 es un botón y el runner de VPS1 es uno solo (15+ min encolado — **encolado ≠ colgado**).

⚠️ **Un PR que toca `server/` deja el front sin desplegar también** (N4 termina en `success` diciendo
«no aplica»). Cada paso mixto necesita N5 para las dos mitades.

⚠️ **Antes de cada N5**: `ssh deploy@161.132.39.165 'cd /srv/hermes && git status --porcelain -uno'`.
El drift bloquea N4 y pone roja la corrida entera sin que el PR se vea rojo.

---

## Paso 0 — Hoy, sin desplegar

### 0.1 · Commitear el worktree, sin push

Es lo único que hay entre ese trabajo y un borrado accidental: **tiene cero commits**.

```bash
# Verificar la rama ANTES de tocar nada.
git worktree list
git -C .claude/worktrees/auto-vinculacion-whatsapp rev-parse --abbrev-ref HEAD
#   → feat/auto-vinculacion-whatsapp
git -C .claude/worktrees/auto-vinculacion-whatsapp rev-parse HEAD
#   → 073834c1b17372d3e846a177a5157701f6c10c12  (== origin/main)
```

**Dos commits, no uno.** El primero aísla la normalización de grafías para que PR-1 sea un
`cherry-pick` y no una re-implementación:

```bash
W=.claude/worktrees/auto-vinculacion-whatsapp

# Commit 1 — solo la normalización (lo que PR-1 se lleva).
git -C $W add server/src/numeros/repositorio.ts server/src/numeros/repositorio.test.db.ts
git -C $W commit   # mensaje: fix(numeros): las líneas de una vendedora se cruzan normalizando las dos grafías

# Commit 2 — el frente entero, evidencia y bitácora incluidas.
git -C $W add -A
git -C $W commit   # mensaje: feat(whatsapp): una vendedora trae su propia línea desde la app

# Verificar. NO se pushea.
git -C $W log origin/main..HEAD --oneline   # exactamente 2 líneas
git -C $W status --porcelain                # vacío
```

### 0.2 · Mover la frontera a una rama nacida de `main`

Los cambios sin commitear del checkout principal viven sobre una rama cuyos commits ya están en
`main` por otra vía. **Los blobs base son idénticos**, así que el `pop` no puede conflictuar:

```bash
cd /Users/milaa/goberna/hermes
git rev-parse 48fc176:server/src/cola/asignadaSql.ts 073834c:server/src/cola/asignadaSql.ts
#   → dos líneas IGUALES: 8bfb1345efc5700330d27b4a8808267f6eac9c97

git stash push -m "frontera: la lista gana sobre la supervisora" -- \
  server/src/cola/asignadaSql.ts server/src/cola/fronteraDeAsignacion.test.db.ts
git fetch origin
git switch -c fix/frontera-la-lista-gana-sobre-supervisora origin/main
git stash pop
git status --porcelain   # exactamente los dos ' M'
git stash list           # vacío
```

⚠️ **Ese parche queda obsoleto en el paso 10.** Invierte la precedencia «la lista de aislamiento gana
a la supervisora», que solo tiene sentido mientras la frontera sea opt-in. Con la frontera por rol la
pregunta desaparece. Se guarda igual — es trabajo hecho y sirve si el paso 10 se demora.

### 0.3 · Correr los tests con base

**Nadie los corrió, ni acá ni en la sesión que escribió el frente.** Es la acción de hoy con mejor
relación costo/riesgo: no despliega nada y cubre exactamente la línea que cambia el comportamiento de
una persona real.

```bash
open -a Docker                                   # el daemon está apagado
cd .claude/worktrees/auto-vinculacion-whatsapp   # ⚠️ el compose está en la RAÍZ, no en server/
docker compose -f docker-compose.test.yml up -d --wait
cd server && npm run test:db
```

Mirar: que aparezcan y pasen los tests de `numeros/repositorio.test.db.ts` —son la razón de correrlo—
y que `cola/fronteraDeAsignacion.test.db.ts` siga verde.

⚠️ El worktree **no tiene `server/.env`**. `test:db` no lo necesita (usa `TEST_DATABASE_URL`, default
`127.0.0.1:5439`), pero `npm run dev` sí — el frente no se puede levantar a mano desde ahí.

---

## Paso 1 — Operación, sin código

**Va primero porque depende de otra gente.**

### 1.1 · El aviso a Cerberus (D10)

> **Asunto: Hermes va a escribir `numero_vendedora` — coordinación antes del cambio.**
>
> Hoy el mapa número↔vendedora lo empuja Cerberus con `PUT /api/admin/numeros/:numero` y Hermes solo
> guarda la copia. Necesitamos, en este orden:
>
> 1. **Ahora**: agregar `usuario2` a `51984429504`. Manden el set **completo** (las 7 actuales +
>    usuario2): el campo `vendedoras` tiene `default([])` y un push que lo omite **vacía** las
>    asignaciones de ese número, sin error y sin log.
> 2. **Antes de `<fecha>`**: Hermes suma una pantalla que también escribe ese mapa. Que el PUT deje de
>    mandar `vendedoras` cuando no lo esté cambiando, y que una baja hecha desde Hermes no se recree
>    en el siguiente push.
> 3. Confirmar qué proceso de ustedes corre ese PUT y con qué frecuencia.
>
> Mientras tanto Hermes no escribe nada en esa tabla.

Verificación: `SELECT vendedora_id FROM numero_vendedora WHERE numero='51984429504'` → **8 filas**.

🔴 **Sin esto, PR-1 encierra a `usuario2` en la campaña** — exactamente al revés de D7.

### 1.2 · Las 24 conversaciones a `luz` (D8)

**Control previo** (correr de nuevo justo antes):

```sql
SELECT vendedora_id, count(*) AS n FROM conversacion_asignada GROUP BY 1 ORDER BY 2 DESC;
-- Medido 15-ago: luz 2355 · Sindy 192 · ventas12@ 11 · ventas11@ 11 · ventas10@ 10 · Tracy 10
--                ventas13@ 1 · ventas14@ 1

-- Colisión de clave (la PK es `clave`): si luz ya tuviera alguna, el UPDATE revienta.
SELECT count(*) FROM conversacion_asignada a
 WHERE lower(btrim(a.vendedora_id)) = 'luz'
   AND a.clave IN (SELECT clave FROM conversacion_asignada
                    WHERE lower(btrim(vendedora_id)) IN (
                      'ventas11@grupogoberna.com','ventas12@grupogoberna.com',
                      'ventas13@grupogoberna.com','ventas14@grupogoberna.com'));
-- Esperado: 0
```

**Respaldo y movimiento** — el respaldo va **fuera** de la transacción:

```sql
CREATE TABLE IF NOT EXISTS respaldo_asignada_2026_08_15 AS
SELECT clave, vendedora_id, numero_propio, motivo, asignada_por, asignada_en
  FROM conversacion_asignada
 WHERE lower(btrim(vendedora_id)) IN (
   'ventas11@grupogoberna.com','ventas12@grupogoberna.com',
   'ventas13@grupogoberna.com','ventas14@grupogoberna.com');
SELECT count(*) FROM respaldo_asignada_2026_08_15;  -- tiene que dar 24

BEGIN;
DO $$
DECLARE n int;
BEGIN
  UPDATE conversacion_asignada
     SET vendedora_id = 'luz', motivo = 'manual', asignada_por = '<quien-lo-corre>'
   WHERE lower(btrim(vendedora_id)) IN (
     'ventas11@grupogoberna.com','ventas12@grupogoberna.com',
     'ventas13@grupogoberna.com','ventas14@grupogoberna.com');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 24 THEN RAISE EXCEPTION 'esperaba 24 filas y toqué %', n; END IF;
  RAISE NOTICE 'OK: % conversaciones pasaron a luz', n;
END $$;
COMMIT;
```

🔴 **El candado de las 24 no es decorativo.** Si toca 34 o 44, alguien metió a `Tracy` o a `ventas10@`
y la transacción aborta sola sin escribir nada. Ahí hay que parar y resolver **P2**.

**Verificación**: `luz` pasa de 2.355 a **2.379**; las cuatro cuentas quedan en 0.
**Rollback**: el `UPDATE … FROM respaldo_asignada_2026_08_15` fila por fila, y después `DROP TABLE`.

⚠️ **Reasignar solo toca la propiedad.** El cursor de lectura sigue siendo el de las cuentas viejas
(`estado_conversacion`), así que `luz` las verá **como no leídas** — correcto. Y las gestiones y notas
quedan atribuidas a quien las hizo, que también es correcto: es historia, no propiedad.

⚠️ **Grafía `luz` en minúscula**, que es la que ya usa la tabla. Escribir `Luz` crea una segunda persona.

### 1.3 · Ordenar la rueda

```bash
ssh deploy@161.132.39.165 'cd /srv/hermes/server && npm run reparto:rueda'   # dry-run, sin flags
```

🔴 **Antes de sacar a nadie hay que entender esto**: `luz` y `Sindy` **no están en la rueda**. La rueda
real son seis cuentas `ventas1X@`/`Tracy` que suman 44 conversaciones y **3 envíos en toda su
historia**. Si se las saca a todas sin poner a nadie, el round-robin se queda sin destinos y el reparto
queda fail-open (todo sin dueña).

🔴 **Y el reparto por carga está envenenado**: `rueda.ts` elige a quien menos tiene, y las cargas salen
de `conversacion_asignada` **sin distinguir `motivo`**. Con 2.351 filas de campaña colgadas de `luz`,
cualquier persona que entre a la rueda va a recibir **el 100 % de los leads durante meses**. Eso hay
que decidirlo antes de meter a nadie nuevo — no es parte de este plan.

### 1.4 · Avisarle a `usuario2`

Su cola cambia de forma con PR-1. Decírselo antes de mergear, no después.

---

## Paso 2 — PR-1 · La normalización de grafías (N5)

**Solo dos archivos**, extraídos del worktree con `cherry-pick` del commit 1:

| Archivo | Qué |
|---|---|
| `server/src/numeros/repositorio.ts` | `lineasDeVendedora` (:73) y `lineasDeVendedoraConProposito` (:100) pasan de `eq()` exacto a `lower(btrim())` de los dos lados |
| `server/src/numeros/repositorio.test.db.ts` | el candado: `Luz` en la base, `luz` en la consulta |

### El blast radius real: dos identidades

Sobre las 11 grafías con las que alguien se logueó: **`luz`** pasa de `{}` a `{51984429504}` y
**`Usuario2`** de `{}` a `{51963139984}`. El resto ya matcheaba exacto o no tiene fila.

### 🔴 El choque de Centurión — decidirlo en este PR

`lineasDeVendedora` tiene **otro consumidor**: `routes/auth.ts:23` → `auth/sesionCenturion.ts:57-60`,
que rechaza con **403 `sin_linea_asignada`**. Ahí la comparación **ya es frontera**, y
`vendedoraIdDeCenturion` arma `centurion:<usuario>` **sin normalizar**.

Aflojarlo significa que `Betto.Romero` entra igual que `betto.romero`. **No puede pasar de callado en
un PR que dice «normalización»**: o el gate usa una función propia con comparación exacta, o se acepta
explícitamente y se escribe por qué.

### Verificación post-deploy

```bash
ssh deploy@161.132.39.165 'systemctl show hermes -p ActiveEnterTimestamp'
```

🔴 **Si sigue diciendo 14-ago, N5 salió verde y no reinició.** El guard está en
`deploy/vps1/hermes-deploy.sh:246-249` (mismo SHA → `exit 0`) y el `systemctl restart` está en :359,
**después**. La verificación nunca es el color del workflow.

⚠️ El workflow N5 exige el input `confirmar` = exactamente la palabra `reiniciar`.

---

## Paso 3 — PR-2 · La frontera con cláusula de línea, y los conteos (N5)

**Es el PR más difícil y el que más protege.**

### 3.1 · La cláusula de línea

La regla nueva:

```
rol supervisor/admin  → sin recorte
vendedora             → (dueño = yo)
                     OR (dueño IS NULL AND (numero_propio ∈ mis_líneas
                                            OR numero_propio no tiene dueña declarada))
                     OR (tipo = 'lead' sin dueña)
```

🔴 **La cláusula se escribe contra `numero_vendedora`, NO contra `numeros_wa`.** Las 5 líneas de
`numeros_wa` tienen `activo=true`, incluidas las 3 retiradas el 11-ago: esa columna **no distingue
nada**. `numero_vendedora` sí.

🔴 **La segunda mitad del OR es obligatoria.** Sin ella, las 2.564 huérfanas de la línea muerta dejarían
de verlas todas — y «lo que no tiene dueña es de quien la agarre» es una decisión tomada y con test.

⚠️ **La rama de `numero_propio IS NULL` no se toca**: el brazo de comentarios emite `NULL::text AS
numero_propio` (`consultarCola.ts:197`), igual que el de leads. Sin ella se caen los comentarios de
FB/IG el día que se enchufe ese webhook — que es justo el día en que nadie va a estar mirando la
frontera.

⚠️ **Corrección al diseño original**: «mis líneas» **no** entra por `OpcionesCola` desde la ruta. El
repo ya decidió lo contrario dos veces (`misAsignadasConProposito` y `enElReparto` se resuelven adentro
de `consultarCola`, contra la base). Lo que sí hay que sacar de adentro de la consulta es la lectura de
`process.env`.

### 3.2 · El bug de los conteos

🔴 **Corrección medida: son TRES sitios, no cuatro.** La página **ya lleva la frontera**
(`consultarCola.ts:1006` la calcula, `:1012` la mete en `condiciones`). Los que **no** la llevan:

| Dónde | Qué sirve mal |
|---|---|
| `consultarCola.ts:1170` | el **total** de la cabecera |
| `consultarCola.ts:1153-1154` (`conMias`) | los **conteos de cada chip** |
| `consultarCola.ts:1214` | el **desglose del embudo** (Pipeline) |

Hoy: a Sindy la cola le sirve **3.095 filas** y la cabecera le dice **5.494**.

### 3.3 · Los tests

| Archivo | Estado |
|---|---|
| `cola/consultarCola.mios.test.db.ts` | **se reescribe** — fija «quien no está en la rueda ve todo, huérfanas incluidas», que D4 revierte |
| `cola/ordenAjenaAlFondo.test.db.ts` | **se reescribe** con rol de supervisor ⚠️ y hay que **corregir su docblock**, que afirma lo contrario de este PR |
| `cola/fronteraDeAsignacion.test.db.ts` | **se reescribe** — hoy manosea `process.env` con un `t.after` |
| `cola/frontera.conteos.test.db.ts` | **nuevo** — el candado que hubiera visto el bug |
| `cola/frontera.comentarios.test.db.ts` | **nuevo** — siembra un comentario de FB/IG |
| `cola/lineaApagadaNoVaciaLaCola.test.db.ts` | **nuevo** |

### 3.4 · El preflight

Un script en `server/src/scripts/` que **antes** de desplegar imprima, por identidad activa, cuántas
conversaciones vería con la frontera puesta, y **falle por los dos lados**: si alguien activo queda en
cero, y si las huérfanas visibles superan un umbral.

🔴 `tracy` tiene 10 asignadas y **no existe en `numero_vendedora`**: con la frontera vería 2.574 (sus 10
+ las huérfanas de la línea muerta). Es el caso que un preflight basado solo en el mapa de líneas no
vería.

---

## Paso 4 — PR-3 · La auto-vinculación, con siete arreglos (N5)

### Los siete defectos

| # | Defecto | Dónde (worktree) |
|---|---|---|
| 1 | 🔴 **El camino feliz dice «La vinculación se cortó»** a los 1,5 s, y pisa también `error` y `baneado` | `miLinea.ts:172,206-208` + `VincularMiWhatsapp.tsx:41-49` |
| 2 | 🔴 **El candado global no tiene dueño ni caducidad**: cerrar el modal lo deja tomado hasta reiniciar y bloquea a cualquier otra | `miLinea.ts:53,85` |
| 3 | 🔴 **Un botón escribe una credencial real de WhatsApp** | `wiring.ts:260-267` |
| 4 | 🔴 **Cero tests del camino nuevo** | — |
| 5 | Si el montaje falla, la fila ya está escrita y no hay reintento | `miLinea.ts:173-201` |
| 6 | El router usa `req.vendedoraId!` sin declarar `requiereVendedora` | `miLinea.ts` |
| 7 | 🔴 **Séptimo, no listado antes**: `miLinea.ts:151` y `:215` comparan el dueño con `!==` **exacto** — la cicatriz de siempre | `miLinea.ts` |

### Correcciones al análisis previo

🔴 **La credencial la escribe el VINCULADOR al escanear, no `agregarLineaWhatsmeow`.**
`Vinculador.iniciar()` hace `createClient({ store: .wa-sessions/<numero>.db })` sin mirar el transporte
(`whatsapp/vinculador.ts:68-74`). El arreglo «exigir whatsmeow antes de montar» **llega tarde**: hay que
ponerlo antes de iniciar el pareo.

🔴 **Producción corre `WHATSAPP_TRANSPORTE=falso`**, así que esa guarda deja la auto-vinculación en
**409 en producción**. El defecto 3 no es solo código: convierte al frente en dependiente de un cambio
de `.env` + reinicio manual.

🔴 **El defecto 1 tiene dos causas.** Además del intervalo que no se apaga,
`VincularMiWhatsapp.tsx:43` hace `setEnVuelo(true)` **antes** del `await`: el primer poll puede llegar
antes de que exista el pareo y contestar `expirado` a los ~0 ms.

🔴 **No hay rollback posible del montaje**: `GestorWhatsapp` (`gestor.ts:54-97`) expone `agregar`, `de`,
`primero`, `numeros`, `todos` — y **ningún `quitar`**. El arreglo del defecto 5 no puede ser
«desmontar»: tiene que ser «la fila queda, el montaje se reintenta».

🔴 **El router no es testeable como está**: importa `db`, `vinculador` y `wiring` a nivel de módulo.
El defecto 4 no es «escribir tests», es **refactorizar a factory con seams inyectables** (molde:
`iviRouter(preguntar)` en `routes/ivi.ts`).

⚠️ **Los 5 tests de `autoVinculacion.test.ts` se rompen** con el arreglo del rol: comparan contra
`motivo:'es_supervisor'` y el renombre los invalida a los cinco.

### La regla del rol

Hoy `numeros/autoVinculacion.ts:34` pregunta `esSupervisor(id, env)`. Con el modelo de roles tiene que
preguntar **`rol === 'vendedora'`** (comparación exacta al rol más bajo), **no**
`!alcanzaRol(rol,'supervisor')`.

**Por qué**: es el **decimoctavo** call site y el único que **no** pregunta «¿ve de más?» sino «¿es del
piso?». Con Luz —que dirige y además atiende 2.355 conversaciones— la jerárquica se vuelve en contra.

### Precondición

🔴 **#194 deja de ser opcional.** Con 24 reinicios por semana y mediana de 1,36 h, una línea
auto-vinculada tiene **vida esperada de horas**. Y el workaround documentado **es inerte**: con el
transporte en `falso`, `wiring.ts:190-208` ni siquiera lee `WHATSAPP_NUMEROS`.

---

## Paso 5 — Roles: la tabla y la carga del rol (migración 0027)

### 5.1 · El esquema

**La siguiente migración libre es la `0027`** (la última es `0026_lame_zarda`, `idx: 26`).

```sql
CREATE TABLE "equipo" (
  "persona_id"      text PRIMARY KEY,                  -- CANÓNICO: lower(btrim(vendedora_id))
  "nombre"          text NOT NULL,                     -- lo que se MUESTRA; no compara nunca
  "rol"             text NOT NULL DEFAULT 'vendedora',
  "origen"          text NOT NULL DEFAULT 'cerberus',
  "activa"          boolean NOT NULL DEFAULT true,
  "creada_en"       timestamptz NOT NULL DEFAULT now(),
  "creada_por"      text NOT NULL DEFAULT 'alta-automatica',
  "actualizada_en"  timestamptz NOT NULL DEFAULT now(),
  "actualizada_por" text,
  CONSTRAINT "equipo_rol_ck"    CHECK ("rol"    IN ('admin','supervisor','vendedora')),
  CONSTRAINT "equipo_origen_ck" CHECK ("origen" IN ('cerberus','centurion')),
  -- EL CANDADO DE LAS GRAFÍAS, Y ES DE LA BASE: la fila `Luz` no entra.
  CONSTRAINT "equipo_id_canonico_ck"
    CHECK ("persona_id" = lower(btrim("persona_id")) AND "persona_id" <> '')
);
CREATE INDEX "equipo_admin_idx" ON "equipo" ("persona_id") WHERE "rol" = 'admin' AND "activa";

CREATE TABLE "equipo_grafia" (
  "grafia"     text PRIMARY KEY,
  "persona_id" text NOT NULL REFERENCES "equipo"("persona_id") ON DELETE CASCADE,
  "vista_en"   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "equipo_bitacora" (
  "id"      bigserial PRIMARY KEY,
  "cuando"  timestamptz NOT NULL DEFAULT now(),
  "quien"   text NOT NULL,
  "fuente"  text NOT NULL,
  "que"     text NOT NULL,
  "sobre"   text NOT NULL,
  "antes"   jsonb,
  "despues" jsonb,
  CONSTRAINT "equipo_bitacora_fuente_ck"
    CHECK ("fuente" IN ('panel','cerberus','cli','siembra','break-glass'))
);
CREATE INDEX "equipo_bitacora_sobre_idx" ON "equipo_bitacora" ("sobre", "cuando" DESC);
```

> 🔴 **Journal monótono.** Después de `npm run db:generate`, sin excepción:
> ```fish
> env JOURNAL_FILE=server/drizzle/meta/_journal.json goberna-journal-set-when
> ```
> ⚠️ **En fish, `JOURNAL_FILE=x cmd` no funciona** — hace falta `env`. El CLAUDE.md documenta la forma
> de bash. Después se commitea `server/drizzle/` **completo**. Un `when` menor al máximo aplicado hace
> que drizzle **saltee la migración sin un solo error** y el deploy salga verde con la tabla sin crear.
> **Las tres migraciones de este plan nacen en ramas distintas: es exactamente el caso que muerde.**

### 5.2 · El módulo puro

Un módulo `equipo/roles.ts` — **que este plan propone y todavía no existe**:

```ts
export type Rol = "admin" | "supervisor" | "vendedora";
export const ORDEN: Record<Rol, number> = { vendedora: 0, supervisor: 1, admin: 2 };
export const alcanzaRol = (rol: Rol, minimo: Rol) => ORDEN[rol] >= ORDEN[minimo];
export const puedeSupervisar = (rol: Rol) => alcanzaRol(rol, "supervisor");
export const clavePersona = (crudo: string) => crudo.trim().toLowerCase();
```

### 5.3 · 🔴 La trampa que mata el frente

**`cargarRol` no puede encadenarse como `app.use` y leer `req.vendedoraId`.** Confirmado leyendo:
`'/api/auth'` está en `PREFIJOS_ABIERTOS` (`auth/perimetro.ts:23`, con el comentario «(y /yo valida el
suyo adentro)») y `routes/auth.ts` monta `requiereVendedora` como handler del propio `/yo`, o sea
**después** de cualquier `app.use` de `index.ts:82`.

Resultado: el rol quedaría `undefined` justo en `GET /api/auth/yo`, que es **el único canal por el que
baja al front**. Con el default fail-closed, **el panel es invisible para todos, incluido el admin** —
sin 403, sin log, sin nada que investigar.

**La forma correcta**: `cargarRol` resuelve el Bearer **por su cuenta** con `verificarSesion`
(`auth/sesion.ts:31`, puro y ya exportado), **nunca responde 401** —solo anota— y con
`if (!id) return next()` adentro para que `/api/admin` y `/api/catalogo` no paguen una consulta.

**La cascada de degradación**, y los dos casos de falla **no se colapsan**:

| Situación | Rol | Frontera |
|---|---|---|
| `HERMES_ADMINS` contiene el id | `admin`, `porBreakGlass: true` | sin recorte |
| Hay fila `activa` | su `rol` | según el rol |
| Sin fila, pero está en `HERMES_SUPERVISORES` (transitorio) | `supervisor` | sin recorte |
| Sin fila y sin env | `vendedora` | recortada |
| **Tabla ausente** (0027 sin aplicar) | cascada al `.env`, `sinTablaDeEquipo` | **APAGADA** (como hoy) |
| **Consulta fallida** (blip de Postgres) | `vendedora`, `rolNoResuelto` | **ENCENDIDA** |

🔴 **Colapsar los dos últimos reabre la cola entera de Luz a todo el mundo en un blip**, después de
vaciar el `.env`.

### 5.4 · Los 17 call sites

| Archivo | Cuántos |
|---|---|
| `routes/campana.ts` | 10 (`:83,128,152,172,203,237,256,282,303,369`) |
| `routes/padron.ts` | 5 (`:126,235,254,306,369`) |
| `dashboard/personal.ts` | 1 (`:77`) |
| `cola/consultarCola.ts` | 1 (`:1006`) |

⚠️ **`recorteDelDashboard` tiene DOS call sites**, no uno: `routes/dashboard.ts:74` y `:110`.

⚠️ **`supervisoresConfigurados`**: las llamadas reales fuera del módulo son **cuatro**
(`padron.ts:197`, `campana.ts:87` y `:132`, `dashboard.ts:245`), y las cuatro hacen lo mismo. Pasan a
preguntar contra la tabla — **si no, el paso 12 las deja diciendo «nadie es supervisor» para siempre**.

### 5.5 · La siembra

🔴 **Las cadenas de servicio reales son TRES, medidas**: `campana` (2.554 envíos), `goberna-admin`
(325) y `bot` (261). **`estephano` y `dueno-11ago` no existen en la base** — cero filas en las 9 tablas
con `vendedora_id`. La exclusión de `centurion:*` va **por prefijo**, no por nombre.

🔴 **Las grafías partidas son TRES, no cuatro**: `luz`/`Luz`, `usuario1`/`Usuario1`,
`usuario2`/`Usuario2`. **`alan` tiene una sola grafía** — el `alan/Alan` del análisis previo no está en
la base.

🔴 **La siembra tiene que salir de la BASE, no de la lista del plan**: si no, `Tracy` —que está en la
rueda y tiene 10 conversaciones— queda afuera.

---

## Paso 6 — Cerrar `/api/routing` (N5)

Hoy: **cero chequeos de rol**. Seis rutas detrás del perímetro y nada más, escondidas por
`VEN_ROUTING = ['alan','Usuario1']` en el **front** (`src/features/vistas/acceso.ts:23`).

`exigeRol('supervisor')` en los dos GET, `exigeRol('admin')` en los tres PUT y el POST. Del lado de los
datos el frente está frío (cero reglas cargadas), así que es el lugar más barato para estrenar la guarda.

---

## Paso 7 — El panel: `/api/equipo` + vista Equipo

🔴 **No cuelga de `/api/admin`**: ese prefijo está **exento del perímetro** y su puerta es la credencial
de servicio de Cerberus — un panel ahí queda alcanzable sin identidad humana.

### El candado del último admin

Con **dos** admins (D6) el escenario es real: A degrada a B mientras B desactiva a A, las dos
transacciones cuentan 1 y las dos confirman → **cero admins**.

Tres correcciones sobre el diseño original:
- el conteo exige **`activa`**;
- va sobre **`persona_id` canónico**, no sobre la grafía del env;
- 🔴 **la siembra corre al ARRANQUE** (molde: `sembrarAliasCurso` en `index.ts:207`), **fuera de
  cualquier lock del handler**. Es la forma exacta que ya quemó al repo dos veces.

El lock: `pg_advisory_xact_lock(hashtext('equipo:admins'))`, en la **misma transacción** que el UPDATE.
Precedente: `cola/estado.ts:97`.

### La vista

Entrada **al final** de `VISTAS` (`src/App.tsx`): meterla en el medio **renumera ⌘5..⌘9 solo al admin**,
y dos personas por teléfono hablan de teclas distintas. `vistasDe` pasa de recibir `vendedoraId` a
recibir `rol`.

⚠️ **`App.tsx:476` no se toca**: es `VISTAS.find(...)!` para leer un rótulo, y durante el round-trip de
revalidación el rol es `undefined`. Todo gating tiene que ser `rol === 'admin'`, nunca `rol !== …`.

---

## Paso 8 — Líneas y rueda desde el panel (migración 0028)

```sql
ALTER TABLE "numero_vendedora" ADD COLUMN "origen"       text NOT NULL DEFAULT 'cerberus';
ALTER TABLE "numero_vendedora" ADD COLUMN "asignada_por" text;
ALTER TABLE "numero_vendedora" ADD COLUMN "asignada_en"  timestamptz NOT NULL DEFAULT now();
UPDATE "numero_vendedora" SET "origen" = 'centurion' WHERE position(':' in "vendedora_id") > 0;
ALTER TABLE "numero_vendedora" ADD CONSTRAINT "numero_vendedora_origen_ck"
  CHECK ("origen" IN ('cerberus','hermes','hermes_retirada','centurion'));
```

⚠️ **`numero_vendedora` NO tiene columna `numero_propio`: tiene `numero`**, con FK a
`numeros_wa(numero)` **ON DELETE CASCADE**. El panel **no ofrece borrar líneas**, solo apagarlas.

### La regla con Cerberus

> **Cerberus es dueño de la LÍNEA. Hermes es dueño de la ASIGNACIÓN.** Propiedad **por fila**, marcada
> en `numero_vendedora.origen`.

El DELETE del upsert (`numeros/repositorio.ts:160-163`) pasa de `NOT (esIdentidadFederadaSql)` a
**`origen = 'cerberus'`**. El patrón ya existe y funciona (`numeros/origenIdentidad.ts`): esto es su
**generalización**.

🔴 **Hace falta el tombstone** (`origen='hermes_retirada'`), o la regla protege lo que el admin
**agrega** y no lo que **saca**: un push de Cerberus re-crearía la fila retirada.

⚠️ **Corrección: `numeros/dominio.ts` YA está arreglado** — `proposito` y `activo` son `.optional()`
sin `.default()` (`:50-58`) y el upsert propaga la omisión. **Lo que sigue mal es `vendedoras`**, que
conserva `.default([])`.

### 🔴 Corrección importante sobre `proposito`

**`'vendedora'` NO es un valor declarado y sin usar.** La línea **viva** `51984429504` («Ventas Meta»,
la Cloud API que trae todos los leads) **ya lo tiene**, igual que dos retiradas. Y `numeros_wa` tiene
**cuatro propósitos vivos**: `vendedora`, `campana` y `escuela`. `soloSusLineas` solo mira `'campana'`.

---

## Paso 9 — El cartel (N4) · va ANTES del paso 10

Hoy `grep COLA_AISLADA src/` da **cero hits**: las dos personas con la cola recortada leen el rótulo
genérico «N en cola».

🔴 **El orden está invertido a propósito.** El cartel lee su campo como **opcional**, así que es inerte
hasta que el server lo mande: se puede mergear primero sin ningún efecto. Y **un PR que toca `server/`
no despliega el front**, así que la frontera **no puede arrastrar consigo su propio cartel**. Si sale
primero la frontera, `luz` abre el lunes y la cabecera pasa de 5.494 a ~2.400 **sin una palabra en
pantalla**.

---

## Paso 10 — La frontera es propiedad del rol (N5)

El predicado del paso 3, ahora gobernado por el rol. Se borran `tieneColaAislada` y
`HERMES_COLA_AISLADA` en el mismo commit.

🔴 **El recorte automático por estar en la rueda MUERE** (`consultarCola.ts:992-993`), y es una
decisión: si sobreviviera «solo para vendedoras», D4 quedaría falso para la mitad de ellas.

🔴 **Va en el MISMO PR que el paso 9**, o el caché lo desmiente.

### Qué le cambia a cada persona

| Persona | Rol | Cambio |
|---|---|---|
| `luz` | vendedora | 2.379 de 2.591. **No pierde nada que trabaje**; cambia el número de la cabecera |
| `sindy` | vendedora | 192. **Por fin los números coinciden con las filas** |
| `usuario1` | **admin** | nada; se le fusionan 15 filas de estado en el paso 11 |
| `usuario2` | vendedora | ve sus dos líneas — **26 hasta que se le reasigne trabajo** |
| `alan` | **admin** | gana la vista Equipo |
| `ventas10@` | (P3) | **gana la cola completa** si queda supervisor |
| `tracy` | vendedora | 10 — **hoy no tiene línea**, ver P1 |

---

## Paso 11 — Fusión de grafías (migración 0029)

🔴 **Un `UPDATE` a secas revienta.** Medido: `estado_conversacion` **15 claves** con las dos grafías
(PK `(vendedora_id, clave)`), `categorias` **6 nombres** (UNIQUE), `sesiones_cerberus` **2 filas** (PK).

🔴 **El orden es la trampa**: **fusión primero, normalización de los lookups después, mismo commit.** Al
revés, normalizar el JOIN de `estado_conversacion` matchea dos filas para las 15 claves compartidas →
conversaciones duplicadas y conteos inflados.

**Respaldo obligatorio antes**: `pg_dump --data-only -t estado_conversacion -t categorias -t
sesiones_cerberus`. Ninguna tiene `archivado_at`.

⚠️ **El universo real de columnas de identidad es 30**, no las 6 que uno imagina. Los lookups que
normalizan en este paso: `cola/estadoSql.ts:37` y `:56`, `routes/agenda.ts:25,89,102`,
`cerberus/sesionStore.ts:116,134,153`, y **el JOIN del round-robin** (`reparto/asignar.ts:180`).

⚠️ **Y dentro de `reparto/asignar.ts` conviven las dos formas**: `sacarDeLaRueda` (`:344-356`) y
`comoVaElReparto` (`:278-308`) comparan **exacto**, mientras la consulta de cargas (`:146-149`) y
`estaEnAlgunaRueda` (`:248`) **sí normalizan**.

---

## Paso 12 — Apagar los CSV

Se borran `HERMES_SUPERVISORES` y `HERMES_COLA_AISLADA` del `.env` de VPS1 **y la rama de unión del
código, en el mismo commit**.

🔴 **Hay una TERCERA lista de roles y vive en el front**: `VEN_ROUTING = ['alan','Usuario1']`
(`src/features/vistas/acceso.ts:23`). Coincide exactamente con los dos admins de D6. **Si el apagado no
la incluye, quedan dos fuentes del rol.**

```bash
ssh deploy@161.132.39.165 'sudo systemctl restart hermes'
ssh deploy@161.132.39.165 'systemctl show hermes -p ActiveEnterTimestamp'
```

🔴 **Nunca verificar con el color del workflow.** Y el auto-revert de `hermes-deploy` revierte el
**código**, no el `.env`.

**Copys que quedan mintiendo y se reescriben en ese commit**: `PantallaPadron.tsx:139-143`,
`features/reparto/reparto.ts:8-11` («esta superficie solo lee y pasa» — es un PUT que escribe),
`docs/multi-numero/cerberus.md:20-22` y `hermes.md:132-145`, y el CLAUDE.md.

---

## 4 · Lo que este plan corrige del análisis previo

| Se creía | Es |
|---|---|
| 4 sitios sin la frontera | **3** — la página ya la lleva |
| `proposito='vendedora'` sin usar | **La línea viva ya lo tiene**, y hay 3 propósitos vivos |
| Las grafías partidas son 4 | **3** — `alan` tiene una sola |
| Cadenas de servicio: 5 | **3** — `estephano` y `dueno-11ago` no existen |
| `numeros/dominio.ts` con defaults rotos | **Ya arreglado**; falta solo `vendedoras` |
| La credencial la escribe el montaje | **La escribe el vinculador al escanear** |
| Las cuentas dormidas son 4 | **6** — 24 cierra excluyendo a `ventas10@` y `Tracy` |
| «Mis líneas» entra por opciones desde la ruta | Se resuelve **adentro de `consultarCola`** |
| Faltaba trabajo de front para D9 | ⚠️ **Verificar**: `useSesion` ya trata cualquier 401 como token muerto |

⚠️ **`docs/adr/` tiene dos archivos numerados 0036.** El próximo libre es el **0056**.

---

## 5 · Lo que no se pudo verificar

- **Ningún test con base corrió**: el daemon de Docker está apagado. El candado del único cambio que
  toca código vivo **no lo ejecutó nadie**.
- **El montaje en caliente nunca se probó con un teléfono real.** Si falla la primera vez, ninguno de
  los choques del paso 4 llega a importar.
- **Con qué grafía entra `usuario2` hoy**: existen las dos sesiones del mismo día.
- **Montar una línea whatsmeow real cambia qué devuelve `primero()`** — y por ahí salen las fotos de
  perfil, el marcar-leído sin línea y la auto-respuesta.
- **`BOT_LINEAS` no se revisó**: si una línea auto-vinculada cayera en su alcance, el bot contestaría
  como «Sofía Rodríguez» **por el celular personal de la vendedora**.
- **Nada se probó con un token de vendedora ni con captura de pantalla.**
