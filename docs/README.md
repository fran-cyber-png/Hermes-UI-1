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

## Para entender la plataforma completa (2026-07-28)

Seis documentos escritos en la sesión de arquitectura del 27–28 de julio. Van de lo más abstracto a
lo más ejecutable; **si vas a implementar, leelos en este orden**:

| # | Documento | Qué responde |
|---|---|---|
| 1 | **[dos-planos.md](dos-planos.md)** | *Qué es Goberna arquitectónicamente.* Dos máquinas sin tubería entre ellas: **plano A** (Goberna opera: Cerberus+Hermes) y **plano B** (el cliente opera: Centurión, un nodo por candidato). La membrana: qué cruza y qué **jamás**. El eje es **quién opera**, no qué se vende |
| 2 | **[sistemas-goberna.md](sistemas-goberna.md)** | *Cómo están conectados hoy*, medido contra producción. Los cinco sistemas, las llaves que los unen y los eslabones rotos ordenados por plata |
| 3 | **[plan-2026-08-escuela-y-servidores.md](plan-2026-08-escuela-y-servidores.md)** | *Qué se hace en agosto.* Foco: escuela/eventos/ventas. Análisis de los 61 issues, los PRs de `ceberusapp`, y el inventario SSH de los dos VPS. Incluye el plan de limpieza y condensación de servidores |
| 4 | **[mapa-ivi-rag.md](mapa-ivi-rag.md)** | *Cómo funciona Ivi y dónde está la fuga.* El pipeline completo y el diagnóstico: **el corpus está invertido** (86,6 % es documentación de cómo se construyó Ivi) |
| 5 | **[aprendizaje-continuo-ivi.md](aprendizaje-continuo-ivi.md)** | *Cómo aprender de las conversaciones sin llenarse.* Destilación en vez de ingesta; dos almacenes con dos leyes; la política de retención que ya existe |
| 6 | **[plan-flux-studio-catalogo.md](plan-flux-studio-catalogo.md)** | *El circuito de la pieza visual.* Studio produce · el catálogo versiona · el lazo mide. Y el reparto geografo↔Bedrock |

Para implementarlos: **[prompt-orquestador-2026-08.md](prompt-orquestador-2026-08.md)** — el prompt
completo para arrancar una sesión de implementación, con las prohibiciones enumeradas.

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
