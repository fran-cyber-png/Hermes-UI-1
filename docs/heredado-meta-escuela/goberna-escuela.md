# goberna-escuela — el LMS (cursos y alumnos)

**Qué es:** la plataforma de cursos, diplomados y certificaciones que **reemplaza al
Moodle** (`campus.grupogoberna.com`), migrando data de a poco. Repo
`Goberna-Lab/goberna-escuela`. **Bun** + Express 5 + **tRPC v11** + **Drizzle** +
PostgreSQL 17 (dev :5433) + React 19. Single-tenant. `backend/src/schema.ts` = fuente
única del modelo.

## Entidades / data clave (patrón LMS)
- **users** (alumnos/staff; `active boolean` = soft-disable, no soft-delete), **user_roles** (N:M).
- **courses** / **course_modules** — catálogo de cursos y su estructura.
- **enrollments** (implícito) — matrícula alumno↔curso, con avance/estado.
- `moodle_metadata` (`jsonb`) — blobs de la migración desde Moodle.
- Convenciones: PK `uuid`, timestamps con timezone, índices por query.

## Integración
- Con **Cerberus**: la venta de un curso (DetalleVenta.producto, con `id_curso_moodle`)
  se materializa en una **matrícula** (fulfillment). El puente producto↔curso es la clave
  para cruzar "qué se vendió" con "qué se entregó/completó".
- Con **Moodle** (legacy): sync de certificados vía `certificaciones-goberna`.

## Qué le da a Ivi (potencial, hoy NO cableado)
- **Completación / engagement por curso** → señal de calidad del producto y de reembolso.
- **Escalera de productos** (quién compró qué, para upsell a diplomas caros) → alimenta el
  LTV real, clave para el criterio de CAC (docs/27 §3.2: "el CAC caro se justifica si el
  LTV medido sube por la escalera").
- **Cohortes** (matrículas por período) → demanda por curso en el tiempo.

## Gaps
Hoy Ivi no lee el LMS. Integrarlo (vía dump/API tRPC o el mismo patrón que Cerberus) es
lo que habilita análisis de **producto** y **LTV**, no solo de venta.
