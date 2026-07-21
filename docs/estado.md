# Estado de Hermes — para retomar (2026-07-21)

> **Empezá por acá.** Este doc es la foto completa: qué funciona, qué falta, y el
> contexto técnico para seguir sin re-descubrir nada. Repo: **github.com/Goberna-Lab/hermes**
> (privado, `main`). El diseño y las decisiones están en `plan-hermes-mvp.md`.

## Qué es Hermes (1 frase)

App de escritorio (Electron) donde una vendedora atiende, en UNA pantalla, todo lo
que llega por Facebook, Instagram, Messenger y WhatsApp — con la ficha del contacto
(¿cliente? ¿compró?) al lado del chat, registrando la venta contra Cerberus **sin
entrar nunca a Cerberus**.

## Qué funciona hoy (hecho, probado, commiteado y pusheado)

| Área | Estado |
|---|---|
| **Cola unificada** | FB/IG/Messenger/WhatsApp en una lista, agrupada por conversación, orden por urgencia (vivo→expira→espera→resto), leads recientes arriba |
| **WhatsApp real** | Número **51986394450 vinculado** (whatsmeow) vía consola `/vincular` (QR en vivo). Transporte conectado. Enviar/recibir por la conversación nativa |
| **Tiempo real (SSE)** | Los mensajes aparecen SOLOS (`/api/stream` + `useTiempoReal`). Verificado |
| **Login** | Vendedoras contra Cerberus (`/ingresar/`), token HMAC Bearer |
| **Ficha del contacto** | Por teléfono contra Cerberus: cliente/compras/nuevo/error. Verificado (Moises → GOB-00066) |
| **Atribución (embudo)** | Detecta origen del lead: anuncio (externalAdReply → ad_id + campaña vía Meta API) o landing ([código]). Badge en la conversación |
| **Registrar venta (S6b)** | **Form completo DENTRO de Hermes** → POST a `crear_venta` de Cerberus con la sesión de la vendedora. **Probado en vivo: creó GOB-13942**. Medio/Origen **inferidos** (no editables): Origen=canal, Medio=pagado si vino de anuncio |

Suite: **262 tests verde**. Imágenes en `docs/img-*.png`.

## PENDIENTES (en orden para la próxima sesión)

### 1. Deploy a VPS1 — LISTO PARA HACER (necesita al operador)
Runbook completo: **`deploy-vps1.md`**. VPS1 tiene Node v22, Docker 26, patrón `/srv`.
Lo que requiere la mano del operador (por eso no se hizo a ciegas):
- Clonar el repo **privado** en VPS1 (auth de GitHub) + cargar los **secretos** en `server/.env`.
- **RE-VINCULAR whatsmeow en VPS1**: la sesión local (`.wa-sessions/`) NO se transfiere;
  hay que correr `npm run wa:vincular` en VPS1 y escanear el QR con el teléfono de ventas.
- DNS en Cloudflare (`hermes-api.goberna.us`) + certbot HTTPS.
- Empaquetar el Electron para las vendedoras (`VITE_API_URL` apuntando al VPS1).

### 2. Verificar la atribución con un anuncio REAL (pendiente honesto)
**La detección de "vino de un anuncio" está probada solo con un mensaje SIMULADO**
(proto armado a mano), NO con un click real. Falta:
- Que Estephano haga clic en un anuncio de Click-to-WhatsApp real y escriba al número.
- Mirar el log `[wa raw]` para confirmar que whatsmeow entrega el `externalAdReply` con
  esa forma. Si no, la atribución por campaña espera la **Cloud API** (el `ctwa_clid`
  oficial, que meta-escuela ya tiene medio armado en `server/src/webhook/whatsapp.ts`).
- **Límites conocidos y honestos:** solo detectamos leads de **anuncios pagos** (CTWA).
  Lo **orgánico** (vio un reel/post y escribió) NO se detecta — WhatsApp no manda referencia.
  **FB vs IG específico es difuso** (un anuncio corre en ambos); por eso Origen=whatsapp (el
  canal), no facebook/instagram. La captura orgánica confiable = código en la landing.

### 3. El "hola" real no entra — resolver @lid
whatsmeow SÍ recibe (el log mostró un mensaje de grupo llegando), pero WhatsApp moderno
usa **`@lid`** (id de dispositivo) en vez del teléfono para algunos remitentes.
`telefonoDeContacto` devuelve null para `@lid` → el mensaje se descarta.
**Fix:** resolver `@lid` → teléfono con el store de contactos de whatsmeow (o `getUserInfo`).
Logs de diagnóstico activos: `[wa raw]` / `[wa in]` / `[wa estado]`.

### 4. Info de comentarios/Messenger — DISEÑADO, listo para implementar
El diseño completo está en **`plan-panel-contexto.md`** (slices S8a-S8f con tests T15-T21):
tabla `contexts`, ingesta ampliada (permalink/imagen/texto completo), curso inferido con fuente
declarada (mensaje > anuncio > post), hilo Messenger read-only, `PanelDerecho` conmutador.
Es el paso 2 del horizonte H1 del norte nuevo: **`plan-crm-definitivo.md`** (mapa completo de
funcionalidades CRM + rediseño con mockups en `prototypes/crm-definitivo/` + ADR 0002).

### 5. Crear cliente para leads NUEVOS
La venta hoy exige un cliente EXISTENTE (VentaForm.cliente = id). Para un lead nuevo,
falta crear el cliente en Cerberus primero (ClienteForm + formset de teléfono) antes de
la venta. Hoy un lead nuevo solo registra la "conversión" (funnel).

## Contexto técnico para no re-descubrir

- **Correr:** `docker compose up -d --wait` (Postgres 5434) · `cd server && npm run dev`
  (:4100) · `npm run dev:app` (Vite :5173 + Electron). Tests: `cd server && npm test`.
- **whatsmeow:** sesión en `server/.wa-sessions/<numero>.db` (gitignored, es la credencial).
  `WHATSAPP_TRANSPORTE=whatsmeow` + `WHATSAPP_NUMERO=51986394450` en `server/.env`.
- **Sesión de Cerberus (para crear ventas):** se captura en el login y vive **en memoria**
  (`cerberus/sesionStore.ts`), por `vendedoraId`. GOTCHA: el `vendedoraId` es el username
  tal cual se tipeó (case-sensitive). Si el server reinicia, la vendedora re-loguea.
- **Cerberus endpoints usados:** `/clientes/buscar/?q=`, `/clientes/<id>/json/`,
  `/productos/api/public/productos-cursos/` (públicos) · `/ventas/crearVenta/` (con sesión).
- **Meta API:** `META_ACCESS_TOKEN` (el de goberna-dashboard) resuelve ad_id → anuncio+campaña.
- **Datos de prueba en la DB:** hay leads simulados (`wa:sim-*`, `wa:falso-*`) y una cotización
  de prueba (GOB-13942 en Moises). Se pueden limpiar con `DELETE ... WHERE external_id LIKE 'wa:sim-%'`.

## Decisiones ya tomadas (no re-discutir)
`plan-hermes-mvp.md §4-5`. Las clave: Cerberus gordo / Hermes flaco (no reimplementar el
ERP — la venta la crea `crear_venta`); la vendedora NUNCA entra a Cerberus; Origen/Medio se
infieren, no se eligen; multi-número desde el modelo; vinculación server-side (D13).
