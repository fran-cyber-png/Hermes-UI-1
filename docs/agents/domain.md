# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, or
- **`CONTEXT-MAP.md`** at the repo root if it exists — it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in. In multi-context repos, also check `src/<context>/docs/adr/` for context-scoped decisions.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

Single-context repo (most repos):

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

Multi-context repo (presence of `CONTEXT-MAP.md` at the root):

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← system-wide decisions
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← context-specific decisions
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_

---

# Lo específico de Hermes

_(Agregado local. Lo de arriba es la plantilla del skill; esto es lo que aplica en este repo.)_

**Layout: single-context.** Un solo producto, un solo lenguaje. `src/` (front) y `server/` son dos
paquetes del mismo contexto, no dos contextos: comparten el vocabulario entero.

**`CONTEXT.md` existe desde el 2026-07-22** — lo abrió el grilling del rediseño del Dashboard con
los primeros términos ganados (Deuda, Silencio, Ventana, Enfriamiento, Vencido, Persona,
Conversación, Comentario). Es un glosario y nada más: se lee **antes** de nombrar cualquier cosa,
y crece de a un término resuelto por vez.

El resto del vocabulario sigue repartido en los docs vivos, que son los que hay que leer para
entender el negocio detrás de esas palabras:

| Dónde | Qué vocabulario define |
|---|---|
| `CLAUDE.md` | La costura de WhatsApp (**teléfonos, nunca JIDs**), auth contra Cerberus, el flujo de trabajo, las reglas duras |
| `docs/concepto.md` | Qué es Hermes y para quién |
| `docs/plan-crm-definitivo.md` | El norte de producto y los nombres del embudo |
| `docs/estado.md` | La foto viva: qué funciona hoy y qué está pendiente |
| `docs/rediseno-2026-07/spec.md` | El vocabulario visual de la dirección «Cierre de edición» |
| `src/lib/etapas.ts` | Las etapas del embudo **en código** — la fuente de verdad, no la prosa |

**Trampas de vocabulario ya conocidas** (no las reinventes):

- **«La Bandeja»** sigue siendo el nombre de la vista **Mensajes** en el shell, pero la
  implementación por interacción murió (ADR 0004). La cola sirve **conversaciones, no filas**.
- **JID** es una palabra que solo existe debajo de `TransporteWhatsapp`. Si aparece más arriba,
  la costura falló.
- **El dorado** no es un color decorativo: significa **tiempo que se acaba**, y nada más.

Los ADRs vigentes van del 0001 al 0005 en `docs/adr/`.
