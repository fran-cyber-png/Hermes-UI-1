# Fase 1 — No perder ningún lead (Instagram + Facebook)

> Estado: **estructura acordada, bloqueada por permisos de Meta.**
> El dashboard de campañas (crear campaña + KPIs) queda **en stand-by**: funciona, pero
> ataca la Fase 3 (analítica), no el problema más caro.

## El problema que resuelve

El cuello de botella más caro de Goberna no es la IA: es que **los datos se enfrían**.
Cada minuto que pasa después de que alguien comenta un anuncio o llena un formulario,
baja la probabilidad de conversión. Hoy esa captura no existe: los leads viven
fragmentados entre Excel, Cerberus, dashboards sueltos y el CRM.

**Objetivo de la Fase 1: cero leads perdidos.** Todo evento de Meta llega a
meta-escuela, se guarda de forma durable, y dispara una acción — sin intervención humana.

## Decisión de arquitectura

**meta-escuela es la fuente de verdad.** No es un sensor que empuja a otro sistema:
aquí vive el event store. `icarus` y `goberna-crm` se conectan a él (o se migran) con el
tiempo. Esto es lo que evita construir un quinto sistema fragmentado — que es
exactamente el problema que la Fase 1 viene a resolver.

```
Meta (Facebook + Instagram)
  ├── Lead Ads (formularios)  ─┐
  ├── Comentarios             ─┤──►  Ingesta  ──►  EVENT STORE  ◄── fuente de verdad
  └── DMs (Messenger / IG)    ─┘                  (append-only)
                                                        │
                                        ┌───────────────┼───────────────┐
                                        ▼               ▼               ▼
                                 Auto-respuesta    Proyección      Push a
                                 (que nadie         → Ontology     goberna-crm
                                  espere)            (grafo)       (WhatsApp)
```

### Dos capas distintas, no una

- **Event store (Postgres, append-only):** el registro crudo e inmutable de *qué pasó*.
  Es la fuente de verdad. Todo el stack de Goberna ya es Postgres (goberna-crm PG15,
  icarus PG17, meta-partnert PG16) → cero curva de aprendizaje, cero infra nueva.
- **Ontology (grafo):** una *proyección derivada* del event store, no el almacén
  primario. Se construye después, a partir de los eventos. **La captura de leads no
  debe depender de levantar una base de grafo primero.**

Este es el modelo Palantir: capa de datos crudos → capa de ontología.

## 🔴 Bloqueo actual: permisos del token

Verificado contra la API real (no supuesto). Token actual: `SYSTEM_USER`, app
`1958308695630264`, long-lived.

| Capacidad | Estado hoy | Permiso que falta |
|---|---|---|
| Listar Páginas + IG vinculado | ✅ funciona | — |
| Listar formularios de leads | ✅ funciona | — |
| **Leer los leads en sí** | ❌ error 200 | **`leads_retrieval`** |
| Leer comentarios de posts | ❌ error 10 | `pages_read_user_content` |
| Suscribir webhooks | ❌ error 200 | `pages_manage_metadata` |

Hoy podemos ver que los formularios existen, pero **no podemos leer un solo lead de
adentro**. El token fue hecho para Ads, nunca para captura de leads.

**`leads_retrieval` es el unlock mínimo:** con ese permiso solo, ya se puede capturar
por *polling* — sin URL pública, sin webhooks, sin `pages_manage_metadata`.

**Gotcha aparte:** además del permiso en el token, el system user necesita la tarea
**"Acceso a clientes potenciales" (Leads Access)** asignada *en cada Página*
(Business Settings → Cuentas → Páginas → asignar system user).

## Alcance real hoy

- **12 Páginas** alcanzables.
- **Solo 2 tienen Instagram vinculado:** `Goberna` → `@gobernacorp`, y
  `Goberna República Dominicana` → `@gobernarp`. Las otras 10 no tienen IG conectado.
  → Cualquier feature de Instagram aplica hoy solo a esas 2 páginas.
- **5 formularios de leads reales** ya existentes en la página `Goberna`:
  ANALISTA DE INTELIGENCIA · DIPLOMADO DE OSINT & SOCMINT · osint ·
  Tecnopolítica Electoral · cod-veri-Operación jaque

## Orden de implementación

### Paso 1 — Lead Ads (formularios) · el más valioso y el más fácil
Ya existen 5 formularios reales con leads adentro. Dos formas de ingesta:

| | Polling | Webhook |
|---|---|---|
| Endpoint | `GET /{form_id}/leads` cada N min | Meta te avisa (`leadgen`) |
| Permiso | solo `leads_retrieval` | + `pages_manage_metadata` |
| Infra | **ninguna** (corre desde donde sea) | HTTPS público (VPS1) |
| Latencia | = intervalo (60s) | tiempo real |

**Empezar por polling.** Se desbloquea con un solo permiso y sin infra. Hoy los leads
tardan horas o días en ser atendidos → un polling de 60s ya resuelve el 95% del
problema. Migrar a webhook después, cuando el resto esté sólido.

**Idempotencia:** usar el `leadgen_id` de Meta como clave única → re-procesar el mismo
lead nunca lo duplica. Esto es lo que hace que "no perder ningún lead" sea real y no
una promesa.

### Paso 2 — Event store + deduplicación
Tabla append-only. Payload crudo de Meta + columnas tipadas. Nada se borra ni se pisa.

### Paso 3 — Comentarios (Facebook + Instagram)
Requiere `pages_read_user_content` + webhook.

### Paso 4 — DMs (Messenger + Instagram Direct)
El más pesado: `pages_messaging` / `instagram_manage_messages`, reglas de ventana de
24h, y App Review de Meta.

## Lo que queda fuera de la Fase 1 (a propósito)

- Optimización automática de campañas (Fase 4).
- El grafo/Ontology como tal (se proyecta desde el event store, después).
- Migrar icarus / goberna-crm (se conectan al event store cuando exista).
