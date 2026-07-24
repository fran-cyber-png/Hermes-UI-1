# ADR 0013 — El schema se versiona en migraciones, no se empuja contra la base viva

- **Fecha:** 2026-07-24
- **Estado:** aceptado
- **Reemplaza:** la parte de `db:push` de ADR 0001 (el resto de ADR 0001 sigue vigente)
- **Decide:** el pedido de un CI/CD completo, y el hueco declarado en `docs/despliegue-continuo.md` §6

## Contexto

Hasta acá el schema se aplicaba con **`drizzle-kit push`**: le mostrás el `schema.ts`, mira la base
viva, calcula la diferencia y la aplica. No hay archivo, no hay revisión, no hay registro de qué se
aplicó ni cuándo. La consecuencia práctica no era teórica: **el CD tenía que frenar** cada vez que
cambiaba `server/src/db/schema.ts` y pedir un `db:push` a mano por SSH.

O sea que el caso más común de cambio real —agregar una tabla o una columna— era justo el que no se
podía automatizar. El pipeline andaba bien mientras nadie tocara la base.

Tres problemas concretos, todos vistos en este repo:

1. **`push` decide solo, sin plan.** Compara y aplica. Un rename mal interpretado es un `DROP` + un
   `CREATE`, y los datos de esa columna ya no están. No hay dónde revisarlo antes.
2. **Lo que `push` no sabe hacer, no se hace.** `notas_texto_gin_idx` es un índice sobre
   `to_tsvector('spanish', texto)`; drizzle-kit no emite índices de expresión, así que se creaba a
   mano por SSH después de cada push. **Producción lo tenía y ninguna base nueva lo tenía** — deriva
   silenciosa, encontrada recién al montar staging.
3. **No hay historia.** «¿Cuándo se agregó `categorias`?» no se contesta mirando la base.

## Decisión

**Migraciones versionadas con `drizzle-kit generate` + `migrate`, con un baseline que describe el
estado actual de producción.**

- `server/drizzle/NNNN_*.sql` — el SQL, en el repo, revisable en el PR que lo introduce.
- `server/drizzle/meta/_journal.json` — el índice, con su contador `when`.
- El CD las aplica solo, **después de respaldar la base** y **después de haberlas aplicado en
  staging** sobre una base con historia (ADR 0014).

Cuatro decisiones que la acompañan:

### El baseline se probó, no se declaró

`0000_baseline.sql` dice describir el schema de producción. Eso se **verificó**, no se supuso: se
aplicó sobre una base vacía en staging y se comparó el resultado contra producción con `pg_dump
--schema-only`. Primera corrida: **una** diferencia (el índice GIN de arriba). Corregida: **cero**.

El procedimiento queda en `docs/migraciones.md` porque hay que repetirlo cada vez que se adopte una
base que ya existía.

### Lo que drizzle-kit no emite se escribe a mano en el `.sql`

`CREATE EXTENSION vector` y el índice GIN de notas están escritos en `0000_baseline.sql`. Es la
ventaja de tener un archivo: lo que la herramienta no sabe generar, se agrega. Un test
(`journal.test.ts`) verifica que la extensión siga estando y antes del primer uso del tipo.

### Producción se «adopta», no se migra

La base de producción ya tenía las tablas. Correr `migrate` ahí habría muerto en el primer
`CREATE TABLE`. `npm run db:adoptar` registra migraciones como aplicadas **sin ejecutar su SQL**.
Sin `--si` solo dice qué haría, y se rehúsa si la base está vacía — confundir «adoptar» con «migrar»
dejaría una base sin tablas creyéndose al día.

### Las migraciones son expand-only, y CI lo hace cumplir

Solo `ADD`: tabla nueva, columna nullable o con default, índice nuevo. Un `DROP`, `RENAME`,
`SET NOT NULL` o `ALTER TYPE` va en un **deploy posterior**.

Esto no es higiene: es **lo que hace válido el rollback automático del deploy**. Si las migraciones
solo agregan, el código viejo sigue funcionando contra el schema nuevo, y volver atrás el código no
necesita volver atrás la base. Con un `DROP` en el medio, el rollback deja al código viejo
hablándole a un schema que ya no entiende — y ahí sí hace falta restaurar el dump, con downtime.

## Consecuencias

**A favor**

- El CD ya no frena por un cambio de schema: es el caso normal, no la excepción.
- El SQL se revisa en el PR, antes de tocar nada.
- Se acabó el paso manual post-push que ya había producido deriva real.
- Hay historia: qué se aplicó, cuándo, en qué orden.

**En contra**

- Un paso más al cambiar el schema (`db:generate` y commitear `drizzle/` completo).
- El `when` del journal es un modo de falla nuevo y **silencioso**: si una migración queda con un
  `when` menor al máximo ya aplicado, drizzle la **saltea sin error** y el deploy sale verde. Por eso
  `journal.test.ts` corre en N1 y por eso existe `goberna-journal-set-when`.
- Expand-only obliga a partir en dos los cambios destructivos. Es más lento, a propósito.

**Lo que NO cambia**

`db:push` sigue existiendo y sigue siendo lo correcto **para las bases efímeras de test**
(`montarBase.ts`): ahí no hay datos que preservar ni historia que registrar, y push es más rápido.

## Alternativas descartadas

- **Seguir con `db:push` y frenar el CD.** Es el estado que veníamos de tener. El costo real no era
  el paso manual sino la deriva que produce, que tardó meses en verse.
- **Generar el baseline y aplicarlo en producción.** Habría muerto en el primer `CREATE TABLE`.
- **Empezar el journal vacío y versionar solo lo nuevo.** Deja el schema actual sin describir en
  ningún lado: una base nueva (staging, un dev que arranca) no se puede levantar desde el repo.
