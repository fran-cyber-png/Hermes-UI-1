# ADR 0057 — El censo de servidores se muda a `goberna-infra`

**Fecha**: 2026-08-16 · **Estado**: aceptado y ejecutado · **Decide**: el dueño · **Reemplaza a**:
nada de contenido — cambia dónde vive. **Molde**: el mismo que usó Hermes al salir de
`meta-escuela` (ADR 0001): extraer preservando historia git, no con un commit nuevo.

## Contexto

`docs/censo-servidores.md`, `docs/plan-2026-08-escuela-y-servidores.md` y los ADR 0026/0028 vivían
acá porque el censo de VPS1/VPS2 arrancó el 27-jul-2026 durante una sesión de arquitectura de
Hermes. Pero describen la infraestructura **entera** — más de 30 proyectos de Goberna, de los
cuales Hermes es uno solo. No correspondía que la única fuente de verdad de la infraestructura
compartida viviera en el repo de un producto.

## Decisión

Esos cuatro documentos se extrajeron el 16-ago-2026 a **`Goberna-Lab/goberna-infra`**, con su
historia git completa (`git filter-repo`, sobre un clon aparte — nunca sobre este checkout). Ahí
se les sumó `vps1-manifiesto.md`, `vps2-manifiesto.md` (inventario re-medido) y dos ADR nuevos:
0030 (por qué `ufw allow`/`ufw delete` no alcanza para cerrar un puerto que Docker publica — el
único mecanismo verificado es una regla explícita en `DOCKER-USER`) y 0031 (los dos primeros
retiros del Lote 2, ejecutados ese mismo día).

Los cuatro archivos originales quedan acá como **stub**: un párrafo que dice qué eran y a dónde
se fueron, no se borran sin dejar rastro (regla dura #4 del CLAUDE.md de Goberna).

**Lo que sigue en Hermes**, y por qué: `docs/dos-planos.md` y `docs/sistemas-goberna.md` también
hablan de arquitectura de Goberna, pero son de **producto** — qué se construye, en qué orden, cómo
se conectan los sistemas de negocio — no de infraestructura de servidores. No se movieron.

## Consecuencias

- `goberna-infra` es desde hoy la fuente de verdad del censo, la kill-list y la configuración de
  VPS1/VPS2. Este repo deja de acumular docs de infraestructura ajena a Hermes.
- La regla del censo no cambió y sigue en el repo nuevo: **nada muere sin censo, el censo es
  read-only, la kill-list la firma el dueño.**
