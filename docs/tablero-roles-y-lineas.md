# Tablero — roles, frontera y líneas

> **Qué es esto**: el estado compartido entre agentes que trabajan
> `docs/plan-implementacion-roles-y-lineas.md`. El PLAN dice qué hay que hacer y por qué; **este
> tablero dice quién lo está haciendo, con qué modelo y contra qué está bloqueado.**
>
> Existe porque el trabajo se reparte entre **dos herramientas distintas** (OpenCode y Claude Code)
> que no comparten memoria de proceso. Un archivo en git es lo único que las dos pueden leer y
> escribir. **Si tu herramienta no puede editar este archivo, no podés tomar una unidad de trabajo.**

## 0 · Cómo se reparten herdr y este archivo

**[herdr](https://herdr.dev) es el sustrato, no el orquestador**, y esa distinción decide qué va
dónde. Es un multiplexor de terminal que sabe de agentes: detecta Claude Code y OpenCode solos, les
rastrea el estado **idle / working / blocked** y lo sube a las pestañas.

| Lo contesta **herdr** | Lo contesta **este archivo** |
|---|---|
| ¿Quién está corriendo ahora? | ¿Quién *tomó* qué unidad? |
| ¿Cuál está **blocked**? | ¿Qué la bloquea, y hasta cuándo? |
| ¿Qué escribió? (replay del pane) | ¿Qué **midió**, con qué comando? |
| — | ¿Qué no se puede empezar todavía, y por qué? |

**Convención que hace que las dos vistas se lean juntas**: nombrá cada pane con el ID de su unidad.

```bash
herdr agent rename B1     # el pane pasa a llamarse como la fila del tablero
herdr agent attach B1     # y así se llega a él sin buscarlo
```

Con eso, la pestaña que herdr te muestre en rojo tiene el mismo nombre que la fila que hay que
mirar acá.

⚠️ **Lo que herdr NO hace, y por eso este archivo no sobra**: no conoce el grafo de dependencias, no
sabe de ramas ni de migraciones, y no comparte lo que un agente *midió* con el siguiente. Su
`blocked` dice «este proceso está esperando algo»; la columna `Estado` de acá dice «esta unidad no
se puede empezar hasta que B1 aterrice». Son dos cosas distintas y las dos hacen falta.

⚠️ **Y no salva de R4**: el pane sobrevive a que te desconectes, no a que la máquina se duerma ni a
que se acabe la sesión del modelo. Lo que sí da es el **replay**: cuando una corrida muera, el
transcript sigue en el pane — hoy se perdieron dos y hubo que reconstruirlas mirando el disco.

---

## 1 · Las tres restricciones que mandan, medidas el 16-ago-2026

Antes de repartir nada, esto es lo que limita el paralelismo de verdad. No es la cantidad de
agentes: es la infraestructura.

### 🔴 R1 · El runner de CI es UNO y serializa

`ci.yml` corre en el runner self-hosted de VPS1 (label `vps1-hermes`), que es uno solo. Una corrida
completa son **~8 min** y N5 puede quedar **15+ min encolado**. Con seis PRs en vuelo, el sexto
espera una hora sin que nadie esté trabajando.

**Consecuencia**: el paralelismo útil son **4 a 6 unidades**, no 16. Más agentes no van más rápido —
hacen cola. Si vas a lanzar más, que sea sobre unidades que **no abren PR** (medición, docs,
investigación).

### 🔴 R2 · Sólo UNA rama a la vez puede generar una migración

El `when` del journal de drizzle es un contador monótono y **falla en silencio**: si una migración
queda con un `when` menor al máximo aplicado, drizzle **la saltea sin error** y el deploy sale verde
con la tabla sin crear. Pasa exactamente al mergear dos ramas que generaron una migración cada una.

**Consecuencia**: las unidades que traen migración (**B1**, **C3**, **C6**) van **en serie entre
ellas**, y quien las tome corre `JOURNAL_FILE=server/drizzle/meta/_journal.json goberna-journal-set-when`
antes de commitear. No se negocia.

### 🔴 R3 · Un worktree por agente. Compartirlo ya costó hoy

Con varios agentes sobre el mismo worktree, el `tsc --noEmit` de cada uno ve los archivos a medio
editar de los otros. Hoy, textual de un agente: *«hay TS1005 rotando por routes/admin.ts, bot.ts,
enlaces.ts… archivos que no son míos, todos a mitad de edición; corrí 14 veces esperando»*. Uno
terminó armando un tsconfig aislado para poder verificar lo suyo.

**Consecuencia**: `git worktree add`, uno por unidad. Y **verificá la rama antes de cada commit** —
hoy el checkout principal cambió de rama bajo los pies dos veces, y dos commits cayeron en la rama
de otro frente.

### ⚠️ R4 · Las corridas largas mueren

De cinco workflows lanzados hoy, **dos murieron enteros**: uno por límite de sesión (9 agentes) y
otro porque la máquina se durmió a mitad (4 agentes, 5 h). El trabajo parcial quedó en disco sin
reportar.

**Consecuencia**: unidades **cortas y con checkpoint**. Si una unidad no puede terminar en una
corrida, partila. Y antes de relanzar, **mirá el disco** (`git status`): puede haber trabajo bueno
que nadie reportó.

---

## 2 · Qué modelo para qué

No hace falta Opus para todo. La regla, y sale de las cicatrices de este repo:

> **Opus donde el error es SILENCIOSO e IRREVERSIBLE.
> Un modelo barato donde el error SE VE.**

| | Va con Opus | Por qué |
|---|---|---|
| Fronteras (quién ve qué) | **sí** | Un `OR` de más no tira excepción: devuelve un 200 con la libreta de otra persona |
| Migraciones | **sí** | El journal falla en silencio y el deploy sale verde con la tabla sin crear |
| SQL de la cola | **sí** | Hoy se midió: la llave «correcta» costaba 10.354 ms contra 9,8 ms, y ningún test lo veía |
| Credenciales (WhatsApp, sesiones) | **sí** | Irreversible: recuperar una sesión exige el teléfono físico |
| Componentes de UI a partir de un molde | no | El error se ve en la captura |
| Call sites mecánicos con el seam ya definido | no | Falla el typecheck o el test |
| Tests a especificación, docs, mediciones | no | El resultado se lee |

⚠️ **Y una excepción que hoy se pagó**: envolver 175 handlers era mecánico, pero **decidir cuáles
envolver no lo era** — la métrica intuitiva («¿tiene un try?») estaba mal en tres formas distintas.
**El que decide el criterio va con Opus; el que lo aplica, no.**

---

## 3 · El grafo de dependencias

```
A1 rescatar el plan ─────────────── (hecho)
A2 #387 la valla OFFSET 0 ───────── independiente
A3 paso 3.1 cláusula de línea ───── independiente
A4 paso 4 auto-vinculación ──────── independiente
A5 paso 1 operación (no es código)  independiente

              ┌──────────────────────────────┐
B1 paso 5 · LA TABLA DE ROLES ──────┤ bloquea SEIS de los doce pasos │
              └──────────────────────────────┘
                         │
     ┌────────┬──────────┼──────────┬─────────┬─────────┐
    C1 p6    C2 p7      C3 p8      C5 p10   C6 p11    C7 p12
   routing  /equipo   líneas+rueda frontera  fusión   apagar
                      (migración)  por rol  (migrac.)  CSV
                                      │
                                   C4 p9 el cartel (va ANTES de C5)
```

🔴 **B1 es la llave y no arrancó.** La migración 0027 es `ediciones_wa`, otra cosa. Mientras B1 no
esté, seis de los doce pasos no se pueden ni empezar — y lo que avanzó del plan avanzó por otros
frentes, no por éste.

---

## 4 · Las unidades de trabajo

**Protocolo**: para tomar una, poné tu nombre en `Dueño` y la fecha en `Desde`. Una unidad = un
agente = un worktree = una rama. Al terminar, `Estado` → `listo` y escribí abajo en la bitácora.
**No edites una fila que no es tuya.**

| ID | Paso | Qué | Modelo | Estado | Dueño | Rama / worktree |
|---|---|---|---|---|---|---|
| **A1** | — | Rescatar el plan a git | — | ✅ listo | — | `fix/los-tres-que-quedaban` |
| **A2** | — | #387: los tres `OFFSET 0` en `telefono/identidadSql.ts` + re-verificar el costo | **opus** | 🔴 medida · NO MERGEA | claude-opus5 (2026-08-17) | `chore/a2-medir-llave-telefono` — 2 commits, verde, sin PR a propósito |
| **A3** | 3.1 | La cláusula de línea en la frontera (contra `numero_vendedora`, no `numeros_wa`) | **opus** | ✅ listo | claude-opus5 (2026-08-17) | `fix/a3-frontera-clausula-de-linea` — 3 commits, sin PR |
| **A4** | 4 | Auto-vinculación: los 7 defectos | **opus** | ✅ listo | claude-opus5 (2026-08-17) | `feat/auto-vinculacion-whatsapp` — 6 commits, sin PR · ⚠️ bloqueada por #194 para PRENDERSE |
| **A5** | 1 | Reasignar las 24+20 conversaciones · sacar a Tracy de la rueda | humano | 🔒 bloqueado por P1/P2 | — | |
| **B1** | 5 | Tabla de roles + `cargarRol` + los 17 call sites (migración) | **opus** | ✅ listo · **DESBLOQUEA C1·C2·C4** | claude-opus5 (2026-08-17) | `feat/b1-tabla-de-roles` — 5 commits, migración 0028, sin PR |
| **C1** | 6 | Cerrar `/api/routing` | barato | 🔒 espera B1 | — | |
| **C2** | 7 | `/api/equipo` + vista Equipo | barato | 🔒 espera B1 | — | |
| **C3** | 8 | Líneas y rueda desde el panel (migración) | **opus** | 🔒 espera B1 · serie con C6 | — | |
| **C4** | 9 | El cartel (N4) — **va ANTES de C5** | barato | 🔒 espera B1 | — | |
| **C5** | 10 | La frontera pasa a ser propiedad del rol | **opus** | 🔒 espera B1 y C4 | — | |
| **C6** | 11 | Fusión de grafías (migración) | **opus** | 🔒 espera B1 · serie con C3 | — | |
| **C7** | 12 | Apagar los CSV del `.env` | barato | 🔒 espera B1 y C5 | — | |

**Cuántos a la vez, en la práctica**: hoy se pueden correr **A2 · A3 · A4 · B1** en paralelo — cuatro
worktrees, cuatro ramas, y ya rozando R1. Cuando B1 cierre, se abren C1·C2·C4 juntos (baratos), y
C3/C6 **de a uno** por R2.

---

## 5 · Cómo se ejecuta una unidad, paso a paso

### 5.1 · Montar el worktree (una vez por unidad)

```bash
# 1. Rama y worktree propios. El ID de la unidad va en el nombre de los dos.
cd /Users/milaa/goberna/hermes
git fetch origin
git worktree add -b fix/b1-tabla-de-roles .claude/worktrees/B1 origin/main

# 2. Dependencias — hacen falta en la RAÍZ y en `server/`, son dos node_modules.
cd .claude/worktrees/B1 && npm ci && (cd server && npm ci)

# 3. 🔴 El `.env` del server es GITIGNORED: el worktree nace SIN él.
#    Sin esto, seis tests con base fallan con «DATABASE_URL no está configurado»
#    y parece un bug del código. Copialo de un checkout que ya lo tenga.
cp /Users/milaa/goberna/hermes/server/.env server/.env

# 4. La base efímera de test (puerto 5442 — nunca 5438/5434/5439).
docker compose -f docker-compose.test.yml up -d --wait
(cd server && npx tsx src/pruebas/montarBase.ts)
```

⚠️ **La base de test es UNA sola para todos los worktrees.** Dos unidades corriendo `test:db` a la
vez se pisan. Si vas a correr tests con base en paralelo, hacelo de a uno o levantá otro contenedor
en otro puerto.

### 5.2 · Abrir el pane y nombrarlo

```bash
herdr agent rename B1     # el pane se llama como la fila del tablero
```

Después arrancás tu agente ahí adentro (`claude`, `opencode`, lo que sea). Herdr lo detecta solo y
te va a mostrar `working` / `idle` / `blocked` en la pestaña.

### 5.3 · El prompt. Lo que hoy funcionó y lo que no

El prompt tiene que traer **cinco cosas**, y las cinco salieron de corridas de hoy:

1. **El worktree, y que todo comando empiece con `cd <worktree>`.** Sin eso el agente trabaja en el
   checkout equivocado.
2. **Qué archivos son suyos**, explícito. «Tocá lo que haga falta» termina en tres agentes editando
   el mismo archivo.
3. **Las prohibiciones ENUMERADAS.** Lo que no se prohíbe explícito, el agente lo decide solo. Las
   que sirvieron: no cambiar contratos HTTP ni códigos de estado · no borrar comentarios (acá
   documentan el porqué medido y valen más que el código) · no usar `any` para callar al compilador
   · no commitear ni pushear · escribir en castellano.
4. **El 🔴 de su paso, copiado del plan.** Es la trampa que ya mordió. Un agente que no la lee la
   vuelve a pisar.
5. **Cómo verificar, con los comandos**, y —si el frente tiene candado— **que lo verifique por
   MUTACIÓN**: revertir el arreglo y comprobar que el test se pone rojo. Hoy eso atrapó tests que
   habrían pasado igual sin el arreglo.

⚠️ **Y pedile que reporte lo que NO pudo verificar.** El mejor resultado de hoy fue un agente que
dijo «esto está hecho y NO se puede mergear», con la medición al lado. Un agente que sólo puede
decir «listo» te devuelve un listo que no vale.

### 5.4 · Antes de abrir el PR

```bash
cd <worktree>
git branch --show-current          # 🔴 el checkout cambia de rama solo: verificá SIEMPRE
npm run mapa:verificar             # las seis reglas en verde
npx tsc --noEmit -p tsconfig.app.json && (cd server && npx tsc --noEmit)
npm test && (cd server && npm test)
(cd server && env DATABASE_URL="postgresql://hermes_test:hermes_test@127.0.0.1:5442/hermes_test" \
   npx tsx --test 'src/**/*.test.db.ts')
```

Si tu unidad trae **migración**: `npm run db:generate`, después
`JOURNAL_FILE=server/drizzle/meta/_journal.json goberna-journal-set-when`, y commiteá
`server/drizzle/` **completo**. Ver R2.

### 5.5 · Al terminar

1. `Estado` → `listo` en la tabla de arriba, con tu rama.
2. Escribí en la **bitácora** lo que otro agente necesita y no está en el plan. Con el comando.
3. PR con `Closes #N`. **Y esperá**: el runner es uno (R1), así que no abras la siguiente unidad
   con PR hasta que ésta cierre.

---

## 6 · Antes de tomar cualquier unidad

1. **Re-medí.** Las cifras del plan son del 15-ago: 24 conversaciones, Tracy con 10, 2.564
   huérfanas. Pasaron días y varios deploys. El propio plan pone el candado: *«si toca 34 o 44,
   alguien metió a Tracy o a ventas10@»*.
2. **Leé el 🔴 de tu paso en el plan.** Cada uno tiene su trampa escrita, y son las que ya mordieron.
3. **Mirá el disco antes de empezar** (`git status`, `git stash list`): puede haber trabajo bueno de
   una corrida que murió sin reportar. Le pasó hoy a dos.

---

## 7 · Bitácora — sólo se AGREGA, no se edita

Acá va lo que otro agente necesita saber y no está en el plan. Formato: fecha · unidad · hallazgo.
Si medís algo, **poné el comando**.

### 2026-08-17 · A2 · La llave canónica del teléfono cuesta 1.000× más, y ningún test lo veía

`identidadTelefonicaSql` cuesta **10.354 ms contra 9,8 ms** del sufijo pelado sobre 20.000 leads,
porque **Postgres APLANA su `LATERAL`** (subquery pull-up) y vuelve a inlinear la cascada:
`regexp_replace(phone…)` termina evaluado ~76 veces por fila y el plan pasa de 3 KB a **831 KB**.

O sea que la API por columnas proyectadas de `identidadSql.ts` mantiene chico el **texto** que
escribimos, y el planner reconstruye igual la explosión que su propio docblock dice haber evitado.
**Su test de paridad no lo puede ver: mide corrección sobre 26 números, no costo.**

El arreglo son tres `OFFSET 0`, uno por escalón del LATERAL: **10.354 → 33,5 ms**, plan de 3 KB.
⚠️ Afuera no sirve: envolver la llamada en un `OFFSET 0` propio lo empeora a **66 s**.

```
EXPLAIN (ANALYZE, TIMING OFF, SUMMARY ON)   -- 20.000 leads sembrados
sufijo pelado                0,03 ms plan /      9,8 ms exec
identidad                   28,7  ms plan / 10.354,9 ms exec  (plan 831 KB)
identidad + OFFSET 0 ×3      0,3  ms plan /     33,5 ms exec  (plan   3 KB)
```

**Lección general**: un test de paridad prueba que dos escrituras dicen lo mismo, **no que las dos
se puedan pagar**. Al mover una llave a una consulta caliente, medí el plan además del resultado.

### 2026-08-17 · A2 · 🔴 NO SE PUDO REPRODUCIR EL ARREGLO — por eso #387 NO se mergeó

Se intentó verificar la valla antes de mergear y **la medición no confirmó el número de arriba**:

- con una cascada **simplificada a mano** (3 países), la valla salió **peor**: 224 ms con
  `OFFSET 0` contra 170 ms sin ella;
- con las **funciones reales** importadas del repo (26 países), sobre 2.000 conversaciones ×
  20.000 leads, **la medición no terminó en 4 minutos** y hubo que cortarla — sin llegar a saber
  cuál de las tres formas era la lenta.

⚠️ **Lo segundo no refuta el hallazgo: lo hace más creíble.** El propio docblock de
`identidadSql.ts` cuenta que la primera versión del módulo generaba 2,58 MB de SQL y que **«el
planner de Postgres tardaba 14 min en 3 filas»** — o sea que este archivo ya tiene antecedentes de
ser imposible de planificar. Que una medición de 20.000 filas no termine en 4 minutos es
consistente con eso.

**Qué falta para desbloquear A2**, y es concreto:
1. Una medición que corra hasta el final, **con las funciones reales del repo** (no una copia a
   mano: la copia no es la misma consulta y su resultado no vale).
2. Que distinga cuál de las tres formas es la lenta — con `statement_timeout` para que una no se
   coma la corrida.
3. Y contra el **volumen real**: 20.000 leads sembrados no son los 25.511 de producción con su
   distribución de países.

**Mientras tanto, el cableado NO se mergea.** Es la consulta más caliente del repo (`consultarCola`
y su tabla temporal, el 4.797 → 1.632 ms de #361), y meter ahí un cambio que puede ser 1.000× sin
una reproducción es exactamente lo que este repo tiene escrito como no hacer.

El trabajo hecho está guardado y no se perdió: los tres call sites cableados, el test nuevo
`cola/identidadDelTelefono.test.db.ts` (7 casos, verificado por mutación) y los tres `OFFSET 0`
quedaron en un `git stash` de la rama `fix/los-tres-que-quedaban` con el mensaje
`387-llave-telefono`. Quien tome A2 arranca de ahí, no de cero.

### 2026-08-17 · A2 · `dashboard/negocio.ts` bloquea migrar la llave del CTE `lead_curso`

Engancha `lc.sufijo = sufijoTelefonoSql(b.persona_id)` adentro de un agregado: dejar dos filas por
sufijo le **duplicaría conversaciones**. Por eso el CTE sigue keyeado por sufijo y lo que cambia es
el JOIN contra `leads`. Arregla el caso medido (conversación de un país, lead de otro) y **queda un
residuo**: dos conversaciones que comparten los 9 finales con países distintos.

### 2026-08-17 · A2 · Agrupar no es comparar

El `DISTINCT ON` de `leadsCte` **no puede** usar `mismaIdentidadSql`: el país `NULL` es comodín y un
comodín **no es transitivo**. Se agrupa por `local`. Y el descarte contra `interactions` pasó de
`NOT IN` a `NOT EXISTS`, porque con dos columnas y país nullable **un solo NULL vuelve el predicado
UNKNOWN y el brazo entero se queda sin una fila, mudo**.

### 2026-08-17 · setup · Tres cosas del plan que ya envejecieron, medidas al montar los worktrees

El plan mide sobre `origin/main = 073834c`. **Hoy `origin/main` es `1cd22b3`, 17 commits después.**
Los números de línea del plan ya no ubican: **buscá por símbolo, no por línea.** Lo que sí sigue
exacto, verificado con grep contra el `main` de hoy: los **17 call sites** de `esSupervisor`
(campana 10 · padron 5 · dashboard/personal 1 · consultarCola 1), los **4** de
`supervisoresConfigurados` y los **2** de `recorteDelDashboard`.

🔴 **LA MIGRACIÓN DE B1 ES LA 0028, NO LA 0027.** El plan §5.1 dice «la siguiente libre es la 0027
(la última es `0026_lame_zarda`, idx 26)» y **eso ya no es cierto**: `0027_gorgeous_surge`
(`ediciones_wa`, ADR 0056) está en `origin/main` con `idx: 27` y `when: 1787314368155`. Generar una
0027 nueva es exactamente el caso que R2 describe — el `when` queda por debajo del máximo aplicado y
drizzle **saltea la migración sin un solo error**, con el deploy en verde y la tabla sin crear.

```bash
git show origin/main:server/drizzle/meta/_journal.json | python3 -c \
  "import json,sys; j=json.load(sys.stdin); print(max(e['when'] for e in j['entries']))"
# → 1787314368155   (el when nuevo tiene que ser MAYOR)
```

🔴 **LA BASE DE TEST NO SE PUEDE PARALELIZAR, Y NO ES PEREZA.** El §5.1 sugiere «levantá otro
contenedor en otro puerto» — **no se puede**: `guardarAntiProd` (`server/src/pruebas/base.ts:66`)
aborta si la URL no contiene `:5442` **literal**. Darle un puerto propio a cada worktree exige tocar
la red anti-prod, que es lo único que separa un `DROP DATABASE` de la producción de VPS1. Entonces la
base es UNA y los `test:db` se serializan con un candado de archivo. Vale también para
`montarBase.ts`, que **rehace el template**: remontarlo mientras otra unidad hace
`CREATE DATABASE ... TEMPLATE` falla, y el error se lee como un bug del código que estabas escribiendo.

⚠️ **A3 y B1 chocan en UNA línea, y el grafo de §2 no lo marca.** `consultarCola.ts:1006` es
`fronteraDeAsignacionSql(vendedoraId, esSupervisor(vendedoraId ?? "", process.env))`: A3 le cambia el
predicado (y tiene que sacar de ahí la lectura de `process.env`) y B1 le cambiaría la fuente del rol.
**Reparto decidido: la línea es de A3.** B1 toca los **16** call sites restantes y deja ése anotado —
la fuente del rol de la frontera se mueve en el paso 10 (C5), que es donde el plan ya la pone.

⚠️ **El worktree de A4 estaba 17 commits atrás y se rebasó sobre `origin/main`.** Tres conflictos, los
tres de import y del mismo movimiento de módulos de `main`: `features/canales/lineas` →
`dominio/lineas` y `features/canales/conversaciones` → `dominio/conversaciones`. Resueltos con la ruta
nueva + el import que agrega A4. Verificado después: `tsc --noEmit` en verde **en las dos mitades**.

⚠️ **Un worktree nuevo no sirve sin `server/.env`** (gitignored, §5.1 ya lo dice) **ni sin los dos
`node_modules`** — raíz y `server/`, ~560 MB por worktree.

### 2026-08-17 · A2 · 🔴 LA VALLA REPRODUCE, Y EL CABLEADO SIGUE SIN PODER MERGEARSE

Son **dos hallazgos, no uno**, y el segundo tumba al primero.

**(1) Los tres `OFFSET 0` valen, reproducido dos veces con siembras distintas.** Con las funciones
REALES del repo importadas (26 ramas de país) sobre 25.511 leads × 4.000 conversaciones: la cascada
**sin** la valla **no termina** (plan de **7.083 KB**), **con** la valla cuesta 77–188 ms (plan de
20 KB), contra 34–61 ms del sufijo pelado. O sea ~2× el sufijo. El «1.000×» del 17-ago queda
confirmado en dirección y orden de magnitud.

**(2) 🔴 PERO LA VALLA ARREGLA EL FRAGMENTO Y NO SOBREVIVE A LA COMPOSICIÓN.** Sobre los mismos
datos y la misma máquina, **`consultarCola` pasa de 169 ms a 232–255 s. 1.400×.** Y está ubicado:
la consulta del `CREATE TEMP TABLE todo` —donde viven `sufijos_con_conversacion` y `leadsCte`—
cuesta **116–166 ms** (o sea que el brazo de leads con la identidad está BIEN, al revés de lo que
su propio docblock predecía); la que explota es la de la **página**, la que lleva el CTE
`lead_curso` de `cola/cursoSql.ts`: **232 s**. Suelta, esa misma consulta cuesta 114 ms.

⚠️ **Es la lección del repo AL REVÉS**: acá aislar el fragmento lo hace parecer BARATO. La regla
«medí el seam completo» no era sobre no subestimar el fragmento — es que el fragmento y el seam
pueden diferir en cualquiera de las dos direcciones.

```bash
cd .claude/worktrees/A2/server
npx tsx scratchpad/medir-llave-telefono.ts --leads=25511 --conv=4000 --repeticiones=3 --timeout=60 --resembrar
npx tsx scratchpad/medir-llave-telefono.ts --solo-seam --seam --repeticiones=2 --timeout=300
```

🔴 **POR QUÉ LA MEDICIÓN ANTERIOR «NO TERMINABA», y esto sirve para cualquier medición futura:
`statement_timeout` NO ALCANZA.** El timeout de Postgres se chequea en los puntos de interrupción
del **ejecutor**, y la **planificación** casi no los tiene — así que una forma que explota al
PLANIFICAR se lleva puesto el timeout y sigue corriendo (medida activa a los 3 min con
`statement_timeout = 120s`). Hace falta un **perro guardián en el cliente**, que cancele desde OTRA
conexión. Segunda trampa que también costó una corrida en falso: medir el seam con
`postgres({max: 1})` **se auto-bloquea**, porque `consultarCola` abre una transacción — y el síntoma
es idéntico a «esta forma no termina».

**Lo siguiente a probar**, y es un mecanismo distinto del de la valla (la valla de adentro ya se
probó y no sirve): `WITH lead_curso AS MATERIALIZED (…)` en `cola/consultarCola.ts` y
`dashboard/negocio.ts`.

### 2026-08-17 · A2 · 🔴 HAY UN CUARTO CRUCE POR TELÉFONO SIN MIGRAR, Y ESCRIBE EN `intereses`

`cursos/consultarDerivados.ts` —el interés DERIVADO de la ficha, el del «📣 … [Confirmar]» cuyo clic
**escribe en `intereses`**, la única fuente de verdad de «qué curso quiere»— sigue cruzando
`JOIN leads l ON sufijoTelefonoSql(l.phone) = p.sufijo`. Reproducido con la MISMA siembra que el
test nuevo declara arreglada (conversación `51987654321` + lead `+56987654321`): la cola ya no le
cuelga el curso chileno y `candidatosPorClave` **sí** devuelve el «Diplomado en Ciberseguridad».
O sea que el cableado, tal como está, hace que **dos superficies digan cosas distintas de la misma
persona** — #37 textual. `gente/leadDeTelefono.ts:102` está igual. Ninguno de los dos está en la
deuda declarada de `cursoSql.ts`.

### 2026-08-17 · A3 · El bug de los conteos (3.2) YA estaba arreglado en `main`

Lo arregló `2ded5d8`, **17 commits después** del corte de medición del plan. La frontera dejó de ser
opt-in igual (se retiró `HERMES_COLA_AISLADA` y `tieneColaAislada`) y se le agregó el candado
dedicado que faltaba (`cola/frontera.conteos.test.db.ts`). **Antes de implementar un paso del plan,
mirá si `main` ya lo hizo.**

### 2026-08-17 · A3 · 🔴 EL PREFLIGHT SALÍA ROJO CONTRA PRODUCCIÓN POR UN MOTIVO FALSO

El techo de huérfanas corría sobre **todas** las filas, supervisoras incluidas — y para una
supervisora `huerfanas = total - propias` es **la mesa entera por definición**: ve todo, que es lo
que la frontera le concede. Con la mesa real (~5.492) cualquier supervisora configurada rompía el
techo sola y el script salía en 1 diciendo «la cláusula de línea no está acotando — revisá
`numero_vendedora`»: un diagnóstico **falso**, apuntando a la tabla equivocada, justo antes de un N5.

⚠️ **La exclusión estaba pensada**: el detector de «frontera apagada» de veinte líneas más abajo sí
hace `filas.filter((f) => !f.esSupervisora)`. Y **ningún test lo veía** porque el único escenario con
`esSupervisora: true` del archivo usaba `huerfanas: 2`. **Un caso de prueba con cifras de juguete no
ejercita el umbral que el código tiene.** El candado nuevo usa 5.480 sobre 5.492 y exige que el techo
SIGA disparando para una vendedora en la misma corrida — si no, la guarda apagaría el chequeo en vez
de acotarlo. Verificado por mutación: sin la guarda se pone rojo exactamente uno.

⚠️ **Lo que A3 NO midió y hay que mirar antes del N5**: la cláusula agrega un `EXISTS` + un
`NOT EXISTS` correlacionados por fila, y entran en las **tres** consultas, encima de la tabla
temporal de #361. A favor: `numero_vendedora` tiene ~5 filas con PK `(numero, vendedora_id)`. En
contra: no se corrió el seam completo. Es literalmente el frente donde A2 acaba de medir 1.400×.

### 2026-08-17 · A4 · Los siete defectos, y las dos cosas que siguen bloqueando el frente

Los siete arreglados, cada uno con candado verificado por mutación. Los que cambiaron de forma al
arreglarse: el **candado global** se extrajo puro a `numeros/pareoPropio.ts` reusando la MISMA
constante `VIGENCIA_QR_MS` del vinculador (dos vigencias que pueden divergir es un frente nuevo); la
**guarda del transporte** va **antes de iniciar el pareo**, no antes de montar, porque la credencial
la escribe `Vinculador.iniciar()` al hacer `createClient({store})`; y el **defecto 5 no se arregla
desmontando** (`GestorWhatsapp` no expone `quitar`) sino con «la fila queda, el montaje se reintenta»
— por eso `puedeAutoVincular` acepta re-parear la propia: «solo 1» es cuántas líneas, no cuántas veces.

🔴 **Y siguen las dos cosas que no son código.** Producción corre `WHATSAPP_TRANSPORTE=falso`, así
que la guarda del defecto 3 deja la auto-vinculación en **409 en producción**: prenderla es un cambio
de `.env` + reinicio manual. Y **#194 sigue siendo la precondición**: con 24 reinicios por semana y
mediana de 1,36 h, una línea auto-vinculada tiene vida esperada de horas. **Está listo y no se puede
prender.**

⚠️ **Y el re-pareo PISA lo que declaró Cerberus**: en la rama `conectado`, `upsertNumero` escribe
`proposito: 'vendedora'` sobre cualquier número cuyo set de vendedoras la incluya — la exención del
reintento. Si esa fila era una línea que Cerberus declaró `proposito: 'campana'` a su nombre, queda
reclasificada y `soloSusLineas` deja de dar true: **la persona pasa a ver la cola de la Escuela**, que
es el cruce entre los dos planos de Goberna. Hoy es inalcanzable (hace falta el teléfono físico, y el
transporte en `falso` corta antes), pero el comentario del router afirma lo contrario de lo que el
código hace.

### 2026-08-17 · B1 · 🔴 R2 ATRAPADO EN EL ACTO: el `when` generado era MENOR que el máximo de main

`db:generate` produjo la 0028 con `when: 1786979446616` y el máximo aplicado en `main` es
**1787314368155**. O sea: sin `goberna-journal-set-when`, drizzle **la salteaba en silencio** y el
deploy salía verde con las tres tablas sin crear. Quedó en `1787400768155`, y el journal verificado
monótono **releyéndolo**, no confiando en que el comando corrió.

```bash
python3 -c "import json;j=json.load(open('server/drizzle/meta/_journal.json'));print('monótono:', all(j['entries'][i]['when']<j['entries'][i+1]['when'] for i in range(len(j['entries'])-1)))"
```

⚠️ **El call site 17 (`cola/consultarCola.ts`) queda leyendo el CSV** mientras el padrón, las
campañas y el Dashboard ya leen la tabla — es de A3 y era la instrucción. El efecto durante la
ventana entre los dos merges es concreto y mudo: darle `supervisor` a alguien **en la tabla** sin
agregarlo al CSV le abre el padrón, «El negocio» y las campañas, **y le deja la cola recortada**.
Dos fuentes para el mismo permiso, viviendo en producción. **Conviene que B1 y el paso 10 no se
separen mucho.**

⚠️ `hayQuienMande` puede contradecir a la puerta: devuelve `true` desde el CSV cuando la tabla no
tiene ningún admin/supervisor, pero la cascada le da `vendedora` a esa misma persona si tiene fila
activa (la fila le gana al CSV). Reproducido contra base. Hoy no es alcanzable —`revisarSemilla` no
siembra a quien está en el CSV con rol menor— y se vuelve alcanzable en cuanto el panel (paso 7)
escriba una fila `vendedora` para alguien que quedó en el `.env`.

### 2026-08-17 · TODAS · `mapa:verificar` cuenta LÍNEAS DE COMENTARIO, y eso pone N1 rojo solo

Mordió a **dos de las cuatro** unidades y es invisible: `docs/mapa.md` lleva el conteo de líneas de
comentario, así que **cualquier edición de un comentario** posterior al último `npm run mapa` deja el
archivo desactualizado, y `mapa:verificar` es un paso de `ci.yml` que compara **byte a byte**. En A4
pasó dentro de la misma rama: un commit regeneró el mapa y el siguiente agregó 6 líneas de comentario
a un test. El PR no mergea y el mensaje no dice qué cambió. **Regenerá el mapa en el ÚLTIMO commit,
no en el que agrega el módulo.**

⚠️ Y **las cuatro unidades regeneraron `docs/mapa.md`**, así que el primer merge deja a las otras tres
en conflicto. Es generado: quien mergee segundo corre `npm run mapa`, **no resuelve el conflicto a
mano**.
