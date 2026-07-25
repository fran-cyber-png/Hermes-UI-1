# Evidencia — rediseño del Pipeline (ADR 0016)

Regla dura #2: nada se reporta listo sin verlo. Estas capturas son de Playwright, a **1440
y 1280** (el Pipeline es una app de escritorio: los tres paneles no reflowean). Verificado
además que a 1280 **no hay scroll horizontal** (`scrollWidth - clientWidth === 0`).

## El ANTES — producción, datos reales

`https://hermes-api.goberna.us`, 2026-07-25. Solo lectura.

| Archivo | Qué muestra |
|---|---|
| `pipeline-ANTES-1440.png` | El tablero de PR #122: 1.389 tarjetas mudas en una columna, tres columnas vacías ocupando el 60 % del ancho, la bandeja como un contador gris que dice «nadie les respondió aún» sobre 476 conversaciones (218 de ellas ya atendidas). |
| `pipeline-ANTES-1280.png` | Lo mismo a 1280. |

## El DESPUÉS — dos juegos, por una razón

El server de producción todavía **no tiene** las señales nuevas (`precio_enviado`,
`ya_le_hablamos`, `desglose`, y el curso/nombre del formulario): se despliegan con el botón
N5. Por eso hay dos:

> Las capturas son del **25-jul, antes del rebase sobre #135**. La pantalla no cambió: lo
> que cambió es de dónde llega el curso —ahora del fragmento SQL de #135
> (`interes_curso`/`lead_curso`/`lead_nombre`) en vez del cruce propio que este PR traía—.
> Ver ADR 0016 §«De dónde sale el curso».

### 1. Contra producción — datos reales, server viejo

| Archivo | Qué muestra |
|---|---|
| `pipeline-DESPUES-prod-1440.png` | El tablero nuevo con las 1.389 conversaciones REALES: tarjeta nueva, fotos, el ✓ del turno, el chip dorado de «venció», las columnas vacías explicando cómo se llenan. Y la **degradación honesta**: sin `desglose` la bandeja cuenta con los conteos viejos y calla el detalle en vez de pintar ceros. |
| `pipeline-DESPUES-prod-1280.png` | Lo mismo a 1280. |

### 2. Contra el server de esta rama — todas las señales vivas

Base **local** (`hermes_demo_pipeline` en el Postgres de dev), sembrada con la forma medida
en producción: 476 en la bandeja (258 nunca respondidas · 218 que volvieron a escribir · 81
escribiendo en las últimas 24 h), 1.389 contactadas de las cuales 611 con precio enviado,
140 con lead web (nombre real + curso), 3 cotizadas, 1 cierre, 1 perdida, 6 seguimientos
vencidos. Nada de esto toca producción.

| Archivo | Qué muestra |
|---|---|
| `pipeline-DESPUES-1440.png` | El tablero completo: la bandeja diciendo «476 · 81 escribiendo ahora · 258 sin abrir · 218 volvieron a escribir», el curso y el precio en la tarjeta, el recorte «Con precio 611». |
| `pipeline-DESPUES-1280.png` | Lo mismo a 1280, sin scroll horizontal. |
| `pipeline-DESPUES-filtro-precio-1440.png` | El recorte activo: el encabezado pasa de **1.389** a **611** y el «Ver más» cuenta lo recortado. |
| `pipeline-DESPUES-modal-cotizar-1440.png` | Soltar en Cotizados sin interés: el modal pregunta y **ofrece el curso del formulario como un botón** en vez de un buscador. |
| `pipeline-DESPUES-cotizado-en-un-clic-1440.png` | Después del clic: Contactados 1.389 → 1.388, Cotizados 3 → 4, la tarjeta arriba de Cotizados con su curso ya registrado. La compuerta del server no se relajó: se satisfizo. |
