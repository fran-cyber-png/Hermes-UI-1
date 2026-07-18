# meta-escuela — dashboard de pauta + el motor Ivi (analista)

**Qué es:** ESTE proyecto. El dashboard de pauta Meta Ads del negocio educativo, y el
**motor de Ivi analista** (BI + estudio creativo). Repo `Goberna-Lab/meta-escuela`.
Backend Express + Drizzle + **PostgreSQL 17** (:5434). Ivi engine en Python
(`goberna-kos/ivi/`), corre en **geógrafo** (`ivi.service`, :8080).

## Cómo arma la data (el cruce)
- **Ventas**: dump SQL de Cerberus → `fuentes.registro` (crudo jsonb) → `proyectarCerberus()`
  → capa canónica **`ontologia.venta`** (a USD con tasa congelada, estado resuelto).
- **Gasto Meta**: `refrescarPauta()` (reloj 6h) → Graph API insights → **`pauta_snapshots.gasto`**
  (foto agregada por país, sin serie temporal).
- **Cruce**: `/api/overview/atribucion` une ventas × gasto **por país** (nombre normalizado):
  `roasPais` con ROAS, gasto, **confianza** (alta/media/baja) y **accion** (escalar/observar/
  recortar). Umbrales en `roas.ts` (**recalibrados** a piso 3x, docs/27).

## El motor Ivi (pipeline)
`IntentAnalyzer → DataPlanner → DataCollector → KPIEngine → AnalyticsEngine → InsightEngine
→ RecommendationEngine → PromptBuilder → LLM → ResponseFormatter`. Consume el backend por
HTTP (no toca Postgres ni Meta). **Ley I**: cada número lo calcula el motor, el LLM solo
presenta. Criterios centralizados en `criterios.py` (docs/27 §3).

## Lo construido (esta sesión, vivo en geógrafo)
Ivi Studio en la web (https), voz (Piper TTS + whisper STT), `think:false` (~5,5s), y la
capa de análisis afinada (materialidad, frescura, jugada por país con presupuesto).
Ver [../27](../27-PLAN-DATA-Y-MARCO-ANALITICO.md) y [../28](../28-PLAN-API-FASE-C.md).

## Qué le da a Ivi
Es el **integrador** actual: la única capa que hoy cruza Cerberus × Meta. El plan (docs/29)
lo extiende para cruzar también LMS (goberna-escuela) e Icarus (CRM) → todo el embudo.

## Gaps
Frescura desacoplada (dump manual); sin serie de gasto país×tiempo; sin per-producto-por-país.
docs/27 §2.
