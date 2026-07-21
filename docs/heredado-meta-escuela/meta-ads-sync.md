# Sync de Meta Ads (goberna-dashboard + nexus-meta)

**Qué es:** los componentes que traen el **gasto y las campañas de Meta** (Marketing API)
al ecosistema. Dos piezas:

## goberna-dashboard (el que ya tiene lo que Ivi necesita)
Repo `Goberna-Lab/goberna-dashboard`. Django, deploy VPS2 (dashboard.goberna.us), sobre la
**MySQL compartida** del ERP/LMS (app.goberna.pe). Comando **`sync_meta_ads`**:
- Llama `me/adaccounts`, `{act}/campaigns`, `{act}/insights` con **level=campaign,
  breakdowns=country, time_increment=monthly** → **`tb_meta_ads`**: spend, reach,
  impressions, clicks, results, cost_per_result por **campaña × país × mes**.
- Calcula **ROAS por (producto, país)** cruzando spend con ventas pagadas.
- `import_meta_ads` carga históricos desde Excel.

**Es la implementación de referencia de exactamente lo que a Ivi le falta** (gasto por
campaña/país/mes + ROAS por producto). Pero: corre en OTRO stack (MySQL, no Cerberus/PG),
**no está cableado a Ivi**, sync **manual** (sin cron), FX limitada, ~137/237 campañas 2026
sin `codigo_producto` (~122k USD sin atribuir).

## nexus-meta
Repo `Goberna-Lab/nexus-meta`: "Sync de Meta Ads (Facebook/Instagram) — feeds para CRM".
Otra ruta de sync (para el CRM). **A reconciliar**: ¿nexus-meta y goberna-dashboard duplican
el pull de Meta? Unificar la fuente de gasto es parte del plan (docs/29).

## Qué le da a Ivi
El **denominador del ROAS** (gasto), y —vía el `tb_meta_ads` del dashboard— el camino más
corto a **ROAS por producto** y **gasto país×tiempo** (los gaps #1 y #2 de docs/27), sin
reconstruirlo de cero.

## Nota
El backend de meta-escuela YA hace su propio pull de gasto (`geoGasto`, país sin tiempo).
Hay **tres** lugares tocando la Marketing API (backend, dashboard, nexus-meta) → consolidar.
