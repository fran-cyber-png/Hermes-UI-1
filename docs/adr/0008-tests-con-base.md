# ADR 0008 — El SQL se testea contra una Postgres efímera en el runner

- **Fecha:** 2026-07-22
- **Estado:** aceptado
- **Decide:** issue #33 (milestone «WhatsApp Business potenciado»), plan `docs/plan-wsp-business/` Fase 0

## Contexto

Los tests del server son **puros**: 29 archivos `*.test.ts`, ninguno toca la base. Todo el SQL
—la cola, el radar, las proyecciones, las ingestas— **no lo ejecuta ningún test**. Y ahí es donde
pasaron los dos incidentes que este harness viene a atrapar:

1. Una **regresión de rendimiento** (#19/#28): mover un filtro al `HAVING` hizo perder el índice;
   el endpoint pasó de 14 ms a un segundo, con code-review de dos ejes y CI verde. Ningún test lo vio.
2. Un **criterio de aceptación imposible de escribir** (#30): «dado un instante inyectado, una
   conversación fuera de la ventana no aparece» — hubo que verificarlo a mano porque no había dónde
   escribir ese test.

La duda no era *si* testear el SQL, sino **cómo levantar la base en CI**, porque el runner es el
**self-hosted de VPS1** — la MISMA máquina donde vive la base de producción (`meta_escuela`, puerto
5438). Más opciones que un runner efímero, y más riesgo de dejar basura (o de tocar prod) en una
máquina que corre otras cosas.

## Decisión

**Postgres efímera propia en el runner, por corrida, con guardia hard-fail anti-prod.** (Opción A del
plan; el dueño la confirmó el 2026-07-22.)

1. **`docker-compose.test.yml`** — `pgvector/pgvector:pg17`, puerto **5439** (nunca 5438/prod ni
   5434/dev), datadir en **`tmpfs`**: la base vive en RAM y muere con el contenedor. Sin volumen, sin
   estado, sin basura que sobreviva en el runner.
2. **Template + base por archivo.** `montarBase.ts` arma UNA vez una base plantilla en un **orden
   exacto**: recrear → **`CREATE EXTENSION vector`** → **`drizzle-kit push --force`**. La extensión va
   *antes* del push o el push muere en `rag.documentos` (columna `vector`). Cada test crea su propia
   base con `CREATE DATABASE ... TEMPLATE` (barato: clona el template, extensión incluida), la usa y la
   borra en `t.after`. Correr la suite dos veces da lo mismo.
3. **Guardia hard-fail** (`base.ts:guardarAntiProd`): aborta ANTES de crear o borrar nada si la URL
   menciona `:5438` / `:5434` / `meta_escuela` / `hermes_db`, o si no es explícitamente `:5439`.
4. **Los seams reciben `db` por argumento** — `consultarRadar(db)`, `consultarCola(db)` — para que el
   test inyecte su base y producción inyecte el singleton de `db/client.ts`. No se swappea el
   singleton (frágil, y `db/client.ts` arma la conexión al importar). Es el motivo de extraer los
   seams (#37/#38).
5. **Corren aparte de los puros.** Nombre `*.test.db.ts` (el glob puro `*.test.ts` no los toma, así
   `npm test` sigue puro y rápido). Script `npm run test:db`. Job separado en `ci.yml`
   (`tests-con-base`) que levanta el compose, corre, y baja el contenedor `if: always()`.

## Alternativas descartadas

- **B — un Postgres de test persistente en VPS1** (queda levantado; cada corrida crea/borra una base
  adentro). Evita arrancar/parar el contenedor, pero suma **un servicio más que vigilar** en la
  máquina de producción, para siempre. El `tmpfs` de A da el mismo aislamiento sin ese costo.
- **C — un runner hosted de GitHub** (`ubuntu-latest` + `services: postgres`). Aislamiento total de
  VPS1, pero **gasta minutos de GitHub** — lo que el runner self-hosted existe justamente para evitar
  (repo privado, plan free). Contradice la razón de ser del runner actual.

## Consecuencias

- La próxima consulta SQL puede —y debe— nacer con su `*.test.db.ts` al lado. Es lo que pidió el
  dueño: «tests verdaderos y reales de cada funcionalidad».
- Se puede fijar el comportamiento de las ventanas de tiempo (30 días de la cola, 7 de la ventana Meta,
  24 h de Messenger) como test, no como comentario.
- El job nuevo necesita Docker en el runner (ya lo hay: prod corre Postgres en Docker) y el puerto 5439
  libre en VPS1.
- **No hace falta para lo demás**: el resto del trabajo se sigue verificando midiendo contra la base
  local, que para cambios de consulta es más fuerte que un mock. Esto es para que deje de depender de
  que alguien se acuerde de medir.
- Cómo escribir uno: `CLAUDE.md` §«Tests con base».
