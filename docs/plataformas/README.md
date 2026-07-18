# Plataformas y datos de Goberna (mapa para Ivi)

> Índice del ecosistema del **negocio educativo** (grupogoberna), pensado como la
> base de conocimiento sobre la que Ivi razona. Cada plataforma tiene su ficha
> enlazada. El plan de cómo Ivi integra todo esto (RAG/embeddings/fine-tuning) vive
> en [`../29-INTEGRACION-IVI-PLATAFORMA.md`](../29-INTEGRACION-IVI-PLATAFORMA.md).
> Verificado contra los repos de Goberna-Lab (2026-07-18).

## El embudo, de punta a punta

```
  ADQUISICIÓN          CAPTACIÓN            VENTA              ENTREGA            FIDELIZACIÓN
  Landings +           Icarus (CRM)         Cerberus (ERP)     goberna-escuela    Icarus campañas
  Meta Ads       ───▶  leads, stage,   ───▶ ventas, pagos, ──▶ (LMS) cursos,  ──▶ email/WhatsApp,
  (pauta)              tier, revenue        productos, país    matrículas         certificados
     │                     │                    │                  │                  │
     └── gasto Meta ───────┴──── webhook ───────┘                  └── certificaciones-goberna
         (nexus-meta /                (Cerberus→Icarus)
          goberna-dashboard)
                                  Todo cruza en ──▶ meta-escuela (backend :4100) ──▶ Ivi (geógrafo)
```

**El punto para Ivi:** hoy solo ve un pedazo (ventas de Cerberus × gasto de Meta,
cruzados por país). El potencial es razonar sobre **todo el embudo**: de qué campaña
vino un lead, si se convirtió, qué curso compró, si lo terminó, y cuánto vale en el tiempo.

## Las plataformas (negocio educativo)

| Plataforma | Qué es | Data clave para Ivi | Stack / dónde | Ficha |
|---|---|---|---|---|
| **Cerberus** (`ceberusapp`) | ERP: el sistema de ventas | ventas, pagos/cuotas, productos, clientes, país, estado | Django + MySQL, VPS2 (app.goberna.us) | [cerberus.md](./cerberus.md) |
| **goberna-escuela** | LMS: cursos/diplomas (reemplaza Moodle) | cursos, módulos, matrículas, alumnos, avance/completación | Bun + tRPC + Drizzle + PG 17 | [goberna-escuela.md](./goberna-escuela.md) |
| **Icarus** | CRM + motor de campañas multicanal | leads (stage/tier/revenue), listas, campañas email/WhatsApp, aperturas/clics | React + Express + PG (schema `icarus`), VPS1 | [icarus.md](./icarus.md) |
| **meta-escuela** | Dashboard de pauta + **motor Ivi** | ontologia.venta (Cerberus proyectado), pauta_snapshots (gasto Meta), atribución | Express + Drizzle + PG :5434; Ivi en geógrafo | [meta-escuela-ivi.md](./meta-escuela-ivi.md) |
| **goberna-dashboard** / **nexus-meta** | Sync de Meta Ads (gasto por campaña×país×mes) | `tb_meta_ads`: spend, ROAS por producto×país | Django/Vercel; VPS2 | [meta-ads-sync.md](./meta-ads-sync.md) |
| **goberna-ia-box** | Infra de IA en geógrafo (A4000) | llama-swap: qwen3 + FLUX + Qwen-Image-Edit (mutuamente excluyentes) | systemd, geógrafo `100.117.204.80` | [ia-box.md](./ia-box.md) |
| Landings (grupogoberna + Astro) | Top del embudo | copy, píxel de Meta, formularios de lead | WordPress/cPanel + Astro | (pendiente) |
| **certificaciones-goberna** | Certificados PDF + sync Moodle | certificados emitidos | — | (pendiente) |

## Dos "Ivi" (no confundir)

- **Ivi analista** (ESTE proyecto, `meta-escuela/goberna-kos/ivi`): el cerebro de BI +
  el estudio creativo (pauta, ROAS, creativos). Es de lo que trata este plan.
- **Ivi personal** (repo `Goberna-Lab/ivi`): asistente personal de Estephano (voz,
  memoria, comidas, tmux) — qwen3:14b + Gemini, whisper.cpp, PWA con orbe de voz.
  Comparte piezas (voz local) con la analista; **decisión abierta**: ¿convergen o
  quedan separadas? (ver docs/29).

## Dónde vive cada dato (para el RAG)

- **Estructurado (SQL)** — la mayoría: ventas y pagos (Cerberus/MySQL → proyectado a
  `ontologia.venta` en meta-escuela/PG), cursos y matrículas (goberna-escuela/PG),
  leads y campañas (Icarus/PG), gasto Meta (`tb_meta_ads` + `pauta_snapshots`).
  → **No es RAG de embeddings: es text-to-SQL / consulta estructurada** (ver docs/29).
- **No estructurado (docs/texto)** — copy de campañas, playbooks, contenido de cursos,
  bitácoras, specs, este mismo set de docs. → **Ahí sí RAG de embeddings.**
- **Sensible vs público**: ventas/leads/P&L = sensible (rol BI, local, Ley I); copy y
  contenido público = ok por API (rol creativo, Bedrock).
