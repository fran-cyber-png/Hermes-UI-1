# ADR 0021 — El schema se versiona en migraciones, no se empuja contra la base viva

- **Fecha:** 2026-07-24 · **enmendado el 2026-07-27** (la verificación del baseline dejó de ser
  un paso del runbook y pasó a ser parte del script; ver las dos secciones marcadas)
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
  staging** sobre una base con historia (ADR 0022).

Cuatro decisiones que la acompañan:

### El baseline se prueba solo, en cada adopción — enmienda del 2026-07-27

`0000_baseline.sql` dice describir el schema de producción. Eso se **verifica**, no se supone.

> **Como se decidió el 24-jul**, la verificación era un procedimiento escrito en
> `docs/migraciones.md`: aplicar el baseline sobre una base vacía, sacar dos `pg_dump --schema-only`
> y compararlos con `diff`. Encontró **una** diferencia (el índice GIN de arriba) y quedó en cero.
>
> El problema no era el método, era **quién lo corre**. Era un paso manual, y los pasos manuales no
> se hacen. Peor: su fallo es el más caro que tiene este sistema. Si se adopta una base que NO está
> en el estado del baseline, queda **marcada como al día mintiendo** — drizzle no vuelve a mirar el
> baseline nunca más y la diferencia sobrevive en silencio, para siempre.

**Ahora la verificación la hace `db:adoptar`, antes de registrar nada.** Levanta una base temporal
en el mismo servidor, le aplica las migraciones desde cero, lee las dos estructuras del catálogo
—tablas, columnas con tipo, nulabilidad y default, índices y restricciones— y las resta en las dos
direcciones. Ante cualquier diferencia **se rehúsa** y las lista.

Tres detalles que la hacen verificable en vez de decorativa:

- **`--si` no la saltea.** `--si` es la confirmación de *escribir*, no un permiso para no mirar. La
  salida de emergencia es otra bandera (`--forzar-sin-verificar`) que imprime un cartel y **exige un
  motivo escrito**.
- **La salida dice qué comparó**, no solo su veredicto: los esquemas, las migraciones aplicadas a la
  referencia y el conteo de cada aspecto de los dos lados. Un «✓ todo igual» sin decir sobre cuántas
  tablas es indistinguible de una consulta que devolvió vacío — la lección del simulacro de la
  auto-respuesta, que imprimió un plan impecable estando mal de siete formas.
- **El criterio es una función pura con tests** (`migraciones/estructura.ts`), y el camino completo
  tiene tests con base efímera que corren el script como subproceso. La misma disciplina que la
  urgencia (ADR 0009) y las señales (ADR 0016): el criterio vive una vez.

Se lee del **catálogo** y no de `pg_dump`: no hace falta el binario en la máquina, ni normalizar su
prosa, ni pelearse con los tokens aleatorios que pg_dump 17 mete en `\restrict`.

### Que el repo y el schema no puedan divergir — enmienda del 2026-07-27

El baseline original se generó el 24-jul y en tres días le faltaban **nueve tablas**: `clientes_padron`,
`hechos`, `alias_curso`, `plantillas`, `plantilla_pasos`, `estado_conversacion` y las dos de la
auto-respuesta entraron por `db:push` mientras la rama esperaba. Un baseline incompleto no es uno
viejo: es uno **falso**.

La guardia es un test de paridad en N2b —`PARIDAD · migrar desde cero da el mismo schema que declara
src/db/*.ts`— que monta dos bases y las compara enteras. Cambiar el schema sin traer su migración
deja de compilar el PR, con el nombre de la tabla que falta en el mensaje de error.

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
- **La adopción no depende de que nadie se acuerde de nada**: se prueba sola y se rehúsa ante
  cualquier diferencia, listándolas.
- **El schema y el repo no pueden divergir sin que CI lo diga** (paridad en N2b).

**En contra**

- Un paso más al cambiar el schema (`db:generate` y commitear `drizzle/` completo).
- El `when` del journal es un modo de falla nuevo y **silencioso**: si una migración queda con un
  `when` menor al máximo ya aplicado, drizzle la **saltea sin error** y el deploy sale verde. Por eso
  `journal.test.ts` corre en N1 y por eso existe `goberna-journal-set-when`.
- Expand-only obliga a partir en dos los cambios destructivos. Es más lento, a propósito.
- `db:adoptar` necesita poder hacer `CREATE DATABASE` en el servidor de la base que adopta: la
  referencia se levanta al lado. Es aditivo, efímero y se borra en un `finally`, pero si el proceso
  muere en el medio queda una `hermes_verificacion_*` suelta — el script las lista al arrancar, con
  el `DROP` listo para copiar.
- Regenerar el baseline le cambia el hash, y toda base que ya lo había aplicado queda con «una
  migración que este repo no conoce». En staging se resuelve borrando la base; después de que
  producción adopte, el baseline se congela y solo se agregan migraciones nuevas.

**Lo que NO cambia**

`db:push` sigue existiendo y sigue siendo lo correcto **para las bases efímeras de test**
(`montarBase.ts`): ahí no hay datos que preservar ni historia que registrar, y push es más rápido.

## Alternativas descartadas

- **Seguir con `db:push` y frenar el CD.** Es el estado que veníamos de tener. El costo real no era
  el paso manual sino la deriva que produce, que tardó meses en verse.
- **Generar el baseline y aplicarlo en producción.** Habría muerto en el primer `CREATE TABLE`.
- **Empezar el journal vacío y versionar solo lo nuevo.** Deja el schema actual sin describir en
  ningún lado: una base nueva (staging, un dev que arranca) no se puede levantar desde el repo.
- **Verificar con `pg_dump` desde el script** en vez de leer el catálogo. Obliga a tener el binario
  de la versión correcta a mano, a normalizar la prosa de su salida y a lidiar con los tokens
  aleatorios de `\restrict` — tres fuentes de falsos positivos que no aportan nada: lo que el dump
  dice ya está en el catálogo, sin formatear.
- **Comparar contra una base de referencia en otra máquina** (por ejemplo, la de staging). Compararía
  también las diferencias entre servidores: versión de Postgres, locale, collation. La referencia va
  al lado de la base que se adopta, o la comparación mide otra cosa.
