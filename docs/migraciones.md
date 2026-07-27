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

---

## Qué hace el pipeline con eso

```
push a main
  │
  ├─ N1   journal.test.ts: idx consecutivos, `when` creciente, cada tag con su .sql
  │       guardia expand-only: la migración nueva no puede tener DROP/RENAME/NOT NULL
  │
  ├─ N3   STAGING — `db:migrate` sobre una base CON historia, después smoke funcional
  │       Si la migración rompe algo, se rompe acá. Nadie se entera.
  │
  └─ N5   PRODUCCIÓN (botón) — respalda la base, migra, reinicia, smoke, y si algo
          falla revierte el código solo
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
migraciones. Ya se hizo con producción; queda escrito porque hay que repetirlo con cualquier otra.

El problema: la base ya tiene las tablas, así que `drizzle-kit migrate` moriría en el primer
`CREATE TABLE`. La solución es registrar el baseline como aplicado **sin ejecutar su SQL** — pero
antes hay que **probar** que la base está realmente en ese estado, no suponerlo.

### 1. Respaldar

```bash
ssh deploy@161.132.39.165
docker exec hermes_db pg_dump -U <usuario> -d <base> | gzip > /srv/respaldos-hermes/pre-baseline.sql.gz
```

### 2. Probar que el baseline describe esa base

Se aplica el baseline sobre una base **vacía** (staging sirve) y se comparan los dos schemas:

```bash
# base limpia + baseline
docker exec hermes_staging_db psql -U hermes_staging -d postgres -c "DROP DATABASE IF EXISTS hermes_staging WITH (FORCE)"
docker exec hermes_staging_db psql -U hermes_staging -d postgres -c "CREATE DATABASE hermes_staging"
cd /srv/hermes-staging/server && npm run db:migrate

# los dos schemas, normalizados (sin dueños, sin el schema `drizzle`, sin los tokens
# aleatorios que pg_dump 17 mete en \restrict)
docker exec hermes_db pg_dump -U <usuario> -d <base> --schema-only --no-owner --no-privileges -N drizzle \
  | grep -vE '^(--|SET |SELECT pg_catalog|\\restrict|\\unrestrict|$)' | sed 's/<usuario>/DBUSER/g' | sort > /tmp/prod.txt
docker exec hermes_staging_db pg_dump -U hermes_staging -d hermes_staging --schema-only --no-owner --no-privileges -N drizzle \
  | grep -vE '^(--|SET |SELECT pg_catalog|\\restrict|\\unrestrict|$)' | sed 's/hermes_staging/DBUSER/g' | sort > /tmp/base.txt

diff -u /tmp/prod.txt /tmp/base.txt
```

**El diff tiene que dar vacío.** Si no da vacío, no adoptes: cada diferencia es algo que existe en
esa base y que el repo no describe. La primera vez que se corrió esto apareció
`notas_texto_gin_idx` —creado a mano por SSH, en producción y en ningún otro lado— y el arreglo fue
agregarlo al `.sql`, no ignorarlo.

### 3. Adoptar

```bash
cd /srv/hermes-staging/server
DOTENV_CONFIG_PATH=/srv/hermes/server/.env npm run db:adoptar        # dice qué haría
DOTENV_CONFIG_PATH=/srv/hermes/server/.env npm run db:adoptar -- --si  # lo hace
```

`db:adoptar` se rehúsa si la base está vacía: ahí lo correcto es `db:migrate`, y confundirlos
dejaría una base sin tablas creyéndose al día.

---

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

`db:push` **sigue existiendo** y sigue siendo lo correcto para las bases efímeras de test
(`montarBase.ts`): no hay datos que preservar ni historia que registrar. Contra producción o
staging, **nunca**.
