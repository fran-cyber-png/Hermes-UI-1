# Documentación de Hermes

Los distintos contextos del proyecto, para entenderlo y extenderlo. Empezá por donde te sirva:

## Para retomar el trabajo
- **[estado.md](estado.md)** — qué funciona hoy, qué falta y en qué orden. **Empezá acá.**
- **[../CLAUDE.md](../CLAUDE.md)** — cómo correr, testear, desplegar; convenciones y gotchas. La guía operativa.

## Para entender el diseño
- **[plan-hermes-mvp.md](plan-hermes-mvp.md)** — el plan completo: modelo de dominio, arquitectura,
  módulos, UI, slices, y **todas las decisiones (D1–D13)** con su porqué. La fuente de verdad del diseño.
- **[concepto.md](concepto.md)** — qué es Hermes en una página, las asimetrías (Meta por API / WhatsApp
  por DOM-transporte), y la postura sobre el robo de datos.
- **[adr/0001-extraccion-desde-meta-escuela.md](adr/0001-extraccion-desde-meta-escuela.md)** — por qué
  Hermes se extrajo de meta-escuela y no se reescribió.

## Para operar
- **[deploy-vps1.md](deploy-vps1.md)** — desplegar en VPS1 y **vincular el número de WhatsApp**, paso a paso.

## Los contextos del sistema (bounded contexts)

| Contexto | Dónde vive | Qué es dueño |
|---|---|---|
| **Atención** (Hermes) | `server/src/{routes,cola,whatsapp}`, `src/` | Event store, cola, urgencia, conversación, envíos |
| **Transporte WhatsApp** | `server/src/whatsapp/transporte*.ts`, `identidadWa.ts` | JIDs, whatsmeow, vinculación, ban. La costura habla teléfonos |
| **ERP** (Cerberus) | externo — `server/src/cerberus/` es el borde | tb_cliente/tb_venta, tesorería, matrícula, auth |
| **Ingesta Meta** | `server/src/meta/`, `routes/interactions.ts` | Comentarios FB/IG + DMs Messenger por Graph API |

Detalle de cada costura en `plan-hermes-mvp.md §1` (bounded contexts) y `§2` (módulos profundos).

## Heredado de meta-escuela
`heredado-meta-escuela/` — los 47 docs del dashboard de pauta del que salió Hermes. Referencia histórica;
no describen a Hermes.
