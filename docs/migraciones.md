# Migraciones — cómo cambiar el schema sin romper producción

> Desde el 2026-07-24 el schema de Hermes vive en migraciones versionadas, no en `db:push`.
> El *por qué* está en **ADR 0020**; esto es el *cómo*.

---

## El día a día: agregar una tabla o una columna

```bash
cd server
# 1. Editás src/db/*.ts — la fuente única del modelo.
npm run db:generate            # crea drizzle/NNNN_*.sql y actualiza meta/_journal.json
```

Después, **tres cosas en este orden**:

### 1. Leer el `.sql` generado

No es un trámite. Drizzle infiere: un rename que no reconoce lo emite como `DROP` + `CREATE`, y esa
columna se lleva los datos puestos. Si ves un `DROP`, un `RENAME`, un `SET NOT NULL` o un
`ALTER … TYPE`, **pará** — eso no va en este PR (ver «Cambios destructivos» abajo). CI lo rechaza,
pero es mejor darse cuenta antes.

### 2. Fijar el `when` del journal

```bash
git fetch -q origin
JOURNAL_FILE=server/drizzle/meta/_journal.json goberna-journal-set-when
```

**Este es el paso que rompe producción en silencio.** El `when` es un contador monótono global: si tu
migración queda con un `when` **menor** al máximo ya aplicado, drizzle la considera vieja y la
**saltea sin decir nada**. El deploy sale verde y la tabla nunca se creó.

Pasa fácil sin querer: dos ramas generan una migración cada una, se mergean, y la segunda en mergear
tiene el `when` más chico. Por eso el helper existe, y por eso `journal.test.ts` corre en N1.

> Si rebaseaste sobre `origin/main` **después** de generar, volvé a correrlo: el máximo de `main`
> pudo haber cambiado.

### 3. Probar contra tu base local

```bash
docker compose up -d --wait    # en la raíz del repo
cd server && npm run db:migrate
```

Y commitear **`server/drizzle/` completo** —el `.sql` nuevo *y* el `_journal.json`— junto al cambio
de `src/db/`. El schema y su migración viajan en el mismo PR o no viajan.

> **No te podés olvidar del `db:generate`.** El test `PARIDAD · migrar desde cero da el mismo schema
> que declara src/db/*.ts` (N2b) monta dos bases —una migrada desde cero, otra con el schema
> declarado— y las compara entera. Si tocaste `src/db/` sin generar la migración, CI falla con el
> nombre de la tabla que falta puesto en el mensaje. Es la misma disciplina que la paridad de la
> urgencia (ADR 0009): dos formas de decir lo mismo, y un test que impide que diverjan.

---

## Un PR que ya venía en camino y todavía usa `db:push`

Es el caso de cualquier rama abierta antes de que existiera este documento. Lo que hay que hacer es
mecánico y son cinco minutos:

1. **Rebase sobre `main`** — así el `drizzle/` del repo entra a la rama.
2. **`cd server && npm run db:generate`** con tu `src/db/*.ts` ya rebasado. Sale un
   `0001_<algo>.sql` con lo que tu PR agrega, y **solo** eso: el baseline ya describe el resto.
3. **Leer el `.sql`.** Si aparece un `DROP`, un `RENAME`, un `ALTER … TYPE` o un `SET NOT NULL`,
   CI lo va a rechazar (expand-only, N1) — hay que partirlo en dos deploys, ver abajo.
   Una columna nueva `NOT NULL` **sin default** es del mismo tipo: falla contra una tabla con filas.
4. **`goberna-journal-set-when`** después del rebase, siempre.
5. **`npm run db:migrate` contra tu base local** y commitear `server/drizzle/` completo.

Y **sacar del PR toda instrucción de correr `db:push`** —del cuerpo, del CLAUDE.md, de donde esté—
porque ya no es lo que hay que hacer y contradice al pipeline.

Lo que **no** cambia: el código, los tests, la UI. La migración es un archivo más en el mismo PR.

---

## Qué hace el pipeline con eso

```
PR / push
  │
  ├─ N1   journal.test.ts: idx consecutivos, `when` creciente, cada tag con su .sql,
  │       y que el baseline conserve las dos líneas que drizzle-kit no emite
  │       db:check: los snapshots de drizzle son coherentes
  │       guardia expand-only: la migración NUEVA no puede tener DROP/RENAME/NOT NULL
  │
  ├─ N2b  PARIDAD: migrar desde cero ≡ el schema que declara src/db/*.ts
  │       (o sea: no se puede cambiar el schema sin traer su migración)
  │
  ├─ N3   STAGING — db:estado (¿la base y el repo se corresponden?), después
  │       `db:migrate` sobre una base CON historia, después smoke funcional.
  │       Si la migración rompe algo, se rompe acá. Nadie se entera.
  │
  └─ N5   PRODUCCIÓN (botón) — respalda la base, verifica el estado, migra, reinicia,
          smoke, y si algo falla revierte el código solo
```

El respaldo previo queda en `/srv/respaldos-hermes/` (se conservan los últimos 20).

---

## Cambios destructivos: siempre en dos deploys

Un `DROP COLUMN`, un `RENAME`, un `SET NOT NULL` o un `ALTER … TYPE` **no van** en el mismo deploy
que el código que los estrena. CI los rechaza en N1.

No es purismo. El deploy **migra antes** de levantar el código nuevo, y el rollback automático
devuelve el **código** sin devolver la **base**. Esa combinación solo es segura si el código viejo
sigue funcionando contra el schema nuevo — o sea, si la migración solo agregó.

Con un `DROP` en el medio, el rollback deja al código viejo hablándole a un schema que ya no
entiende, y recuperarse pasa a requerir restaurar el dump, con downtime.

**El camino de dos pasos**, renombrar `foo` → `bar` como ejemplo:

| | PR | Migración | Código |
|---|---|---|---|
| 1 | este | `ADD COLUMN bar` | escribe en las dos, lee de `bar` con fallback a `foo` |
| — | *(deploy)* | | backfill: `UPDATE … SET bar = foo WHERE bar IS NULL` |
| 2 | el siguiente | `DROP COLUMN foo` | lee solo de `bar` |

Es más lento, a propósito.

---

## Adoptar una base que ya existía

Esto se hace **una vez por base**, cuando una base creada con `db:push` tiene que empezar a usar
migraciones.

El problema: la base ya tiene las tablas, así que `drizzle-kit migrate` moriría en el primer
`CREATE TABLE`. La solución es registrar el baseline como aplicado **sin ejecutar su SQL**.

Pero antes hay que **probar** que la base está realmente en ese estado. Si no lo está y se adopta
igual, la base queda **marcada como al día mintiendo**: drizzle no vuelve a mirar el baseline nunca
más y la diferencia sobrevive en silencio, para siempre. Es el peor modo de fallo que tiene este
sistema.

**Esa prueba la hace el script.** Antes la hacía este documento, con dos `pg_dump` y un `diff` a
mano — un paso manual, y los pasos manuales no se hacen.

### 1. Respaldar

```bash
ssh deploy@161.132.39.165
docker exec hermes_db pg_dump -U <usuario> -d <base> | gzip > /srv/respaldos-hermes/pre-baseline.sql.gz
```

### 2. Adoptar

```bash
cd /srv/hermes/server
npm run db:adoptar          # verifica y dice qué haría — NO escribe nada
npm run db:adoptar -- --si  # verifica y, si coincide, registra
```

> **La primera vez hay un huevo y una gallina**: el checkout de producción todavía no tiene
> `db:adoptar` (viene con las migraciones, y las migraciones no se pueden desplegar hasta que la base
> adopte). Se sale usando **otro checkout que ya tenga el código nuevo** —el de staging— apuntado al
> `.env` de producción, sin tocar `/srv/hermes`:
>
> ```bash
> cd /srv/hermes-staging/server
> DOTENV_CONFIG_PATH=/srv/hermes/server/.env npm run db:adoptar
> DOTENV_CONFIG_PATH=/srv/hermes/server/.env npm run db:adoptar -- --si
> ```
>
> Después del primer deploy, `/srv/hermes/server` tiene los scripts y esto deja de hacer falta.

Lo que hace la verificación, sola, cada vez:

1. levanta una base **temporal en el mismo servidor** (`hermes_verificacion_*`; mismo Postgres,
   mismo locale — comparar contra otra máquina compararía también las diferencias de la máquina),
2. le aplica **todas** las migraciones del repo desde cero,
3. lee las dos estructuras del catálogo —**tablas, columnas con su tipo, su nulabilidad y su
   default, índices y restricciones**— en los esquemas `public`, `fuentes`, `ontologia` y `rag`,
4. las resta **en las dos direcciones**, y
5. borra la base temporal.

Si hay una sola diferencia, **no adopta nada** y las lista con su lado:

```
✗ 2 diferencia(s). NO se adopta nada.

  [columna] public.notas.parche_de_las_2am :: text NULL
      ↳ está en la base y el repo no lo describe
  [índice] CREATE INDEX notas_texto_gin_idx ON public.notas USING gin (to_tsvector('spanish'::regconfig, texto))
      ↳ lo describe el repo y la base no lo tiene
```

Las dos direcciones importan igual. «Falta en la base» es obvio; «sobra en la base» significa que
el repo NO describe algo que existe, y la próxima base nueva no lo va a tener. Así se descubrió el
`notas_texto_gin_idx`, que vivía en producción y en ningún otro lado porque se creaba a mano por
SSH después de cada `db:push`. El arreglo fue escribirlo en el `.sql`, no ignorarlo — y ese es el
arreglo por defecto para cualquier diferencia: **hacia el repo**.

La salida dice **qué comparó**, no solo si coincidió:

```
Verificando que la base esté EXACTAMENTE en el estado del baseline.
  esquemas comparados : public, fuentes, ontologia, rag
  migraciones del repo: 0000_baseline
  base de referencia: hermes_verificacion_ms2va5hfwkhc5e (temporal, se borra al terminar)

Qué se comparó:
  · tabla        base viva:   42   baseline:   42
  · columna      base viva:  377   baseline:  377
  · índice       base viva:  124   baseline:  124
  · restricción  base viva:   61   baseline:   61
```

Un «✓ todo igual» que no dice sobre cuántas tablas es indistinguible de una consulta que devolvió
vacío. Los números son la parte que se revisa.

Otras dos cosas que el script se rehúsa a hacer:

- **base vacía** → `db:adoptar` no es lo que va; es `db:migrate`. Confundirlos dejaría una base sin
  tablas creyéndose al día.
- **el dry-run no escribe nada**, ni siquiera el schema `drizzle`. Un «decime qué harías» que deja
  objetos atrás no es un dry-run.

### La salida de emergencia

```bash
npm run db:adoptar -- --si --forzar-sin-verificar --motivo="por qué"
```

`--si` **no** saltea la verificación: es la confirmación de escribir, no un permiso para no mirar.
Saltearla es otra bandera, imprime un cartel y **exige un motivo escrito** — que queda en el log de
quien lo corrió, porque a partir de ahí nada más va a detectar el problema.

Existe para un solo caso realista: la base tiene una diferencia que ya mirás, entendés y aceptás, y
no podés arreglarla hacia el repo en ese momento. Si la usás, abrí un issue el mismo día.

### Staging: no se adopta, se recrea

Staging **no tiene datos que preservar**, así que ante cualquier lío la respuesta es borrarla:

```bash
ssh deploy@161.132.39.165
docker exec hermes_staging_db psql -U hermes_staging -d postgres -c "DROP DATABASE IF EXISTS hermes_staging WITH (FORCE)"
docker exec hermes_staging_db psql -U hermes_staging -d postgres -c "CREATE DATABASE hermes_staging"
cd /srv/hermes-staging/server && npm run db:migrate && npm run db:estado
```

Hace falta, por ejemplo, cuando el baseline se regeneró: la base vieja quedó registrada contra un
`.sql` que ya no existe. N3 lo detecta antes de migrar (`db:estado --exigir-coherencia`) y falla
diciendo esto mismo, en vez de morir con un «relation already exists» a mitad del archivo.

---

## Ver en qué estado está una base

```bash
cd /srv/hermes/server && npm run db:estado
```

Solo lee. Imprime las migraciones del repo, las registradas en la base, y el veredicto:

- **«nunca adoptó el baseline»** — falta correr `db:adoptar` (o `db:migrate`, si está vacía).
- **«N sin aplicar»** — normal antes de un deploy con migraciones; el deploy las aplica.
- **«registradas que este repo NO conoce»** — el caso feo: la base se migró contra otro baseline.
  Drizzle **no lo detecta solo**, porque su migrador compara por `when`, no por hash.

Es lo que hay que mirar después de un deploy con migraciones para saber que salió bien, y lo que
corre solo —con `--exigir-coherencia`— antes de migrar staging y producción.

## Cuando algo sale mal

### «la migración falló» en el deploy

El script **no reinicia el servicio** si la migración falla: producción sigue con el código viejo,
que funciona contra el schema viejo. Lo que aplicó, aplicó (drizzle no envuelve todo el archivo en
una transacción). Mirá qué quedó a medias y arreglá hacia adelante — el respaldo está en
`/srv/respaldos-hermes/`.

### La migración «se aplicó» pero la tabla no está

Es el `when`. Drizzle la salteó en silencio:

```bash
docker exec hermes_db psql -U <usuario> -d <base> -c \
  "select hash, created_at from drizzle.__drizzle_migrations order by created_at"
```

Compará esos `created_at` con los `when` del journal. El que falta es el que se salteó. Arreglo:
corregir el `when` en `_journal.json` para que supere al máximo aplicado, y volver a desplegar.

### `db:push` vs `db:migrate`

`db:push` **sigue existiendo** y sigue siendo lo correcto para **las bases efímeras de test**
(`montarBase.ts`): se crean vacías, se usan y se tiran; no hay datos que preservar ni historia que
registrar. Contra **producción o staging, nunca** — ADR 0020.

Por qué no: `db:push` compara contra la base viva y aplica lo que le parece, sin archivo, sin
revisión y sin registro. En la práctica pedía cosas peligrosas y las pedía por teclado — al agregar
`alias_curso.ad_id` ofreció **truncar la tabla** (habría borrado los 30 alias, incluidos los
editados a mano), y sin TTY se muere a la mitad. Nada de eso es revisable en un PR.

### El `.sql` no se edita después de commiteado

Una migración ya mergeada es historia: cambiarla le cambia el hash, y a partir de ahí toda base que
ya la aplicó queda con «una migración registrada que este repo no conoce» (`db:estado` lo dice). Si
hay que corregir algo, va **otra** migración encima.

La única excepción fue regenerar el `0000_baseline` antes de que ninguna base lo hubiera adoptado —
y ahí hubo que recrear staging a mano, que es exactamente el costo del que estamos hablando.
