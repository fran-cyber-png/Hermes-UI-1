# Tablero — roles, frontera y líneas

> **Qué es esto**: el estado compartido entre agentes que trabajan
> `docs/plan-implementacion-roles-y-lineas.md`. El PLAN dice qué hay que hacer y por qué; **este
> tablero dice quién lo está haciendo, con qué modelo y contra qué está bloqueado.**
>
> Existe porque el trabajo se reparte entre **dos herramientas distintas** (OpenCode y Claude Code)
> que no comparten memoria de proceso. Un archivo en git es lo único que las dos pueden leer y
> escribir. **Si tu herramienta no puede editar este archivo, no podés tomar una unidad de trabajo.**

---

## 0 · Las tres restricciones que mandan, medidas el 16-ago-2026

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

## 1 · Qué modelo para qué

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

## 2 · El grafo de dependencias

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

## 3 · Las unidades de trabajo

**Protocolo**: para tomar una, poné tu nombre en `Dueño` y la fecha en `Desde`. Una unidad = un
agente = un worktree = una rama. Al terminar, `Estado` → `listo` y escribí abajo en la bitácora.
**No edites una fila que no es tuya.**

| ID | Paso | Qué | Modelo | Estado | Dueño | Rama / worktree |
|---|---|---|---|---|---|---|
| **A1** | — | Rescatar el plan a git | — | ✅ listo | — | `fix/los-tres-que-quedaban` |
| **A2** | — | #387: los tres `OFFSET 0` en `telefono/identidadSql.ts` + re-verificar el costo | **opus** | 🔴 bloqueante | — | |
| **A3** | 3.1 | La cláusula de línea en la frontera (contra `numero_vendedora`, no `numeros_wa`) | **opus** | libre | — | |
| **A4** | 4 | Auto-vinculación: los 7 defectos | **opus** | libre | — | |
| **A5** | 1 | Reasignar las 24+20 conversaciones · sacar a Tracy de la rueda | humano | 🔒 bloqueado por P1/P2 | — | |
| **B1** | 5 | Tabla de roles + `cargarRol` + los 17 call sites (migración) | **opus** | libre · **LA LLAVE** | — | |
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

## 4 · Antes de tomar cualquier unidad

1. **Re-medí.** Las cifras del plan son del 15-ago: 24 conversaciones, Tracy con 10, 2.564
   huérfanas. Pasaron dos días y varios deploys. El propio plan pone el candado: *«si toca 34 o 44,
   alguien metió a Tracy o a ventas10@»*.
2. **Leé el 🔴 de tu paso en el plan.** Cada uno tiene su trampa escrita, y son las que ya mordieron.
3. **`git worktree add` y verificá la rama** (`git branch --show-current`) antes del primer commit.
4. **Corré `npm run mapa:verificar`** antes de abrir el PR: las seis reglas tienen que estar en verde.

---

## 5 · Bitácora — sólo se AGREGA, no se edita

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
