# Bitácora — sesión "crm-definitivo" (2026-07-21)

> La sesión en que Hermes pasó de "bandeja con ficha" a **CRM completo en producción**. Este doc
> es el contexto histórico: qué se hizo, en qué orden, por qué, y con qué commit. El estado VIVO
> está en `estado.md`; el norte en `plan-crm-definitivo.md`.

## La secuencia (cronológica, con commits)

| # | Qué | Commit | Notas |
|---|---|---|---|
| 1 | **Planeamiento**: investigación 3 frentes (código+Ivi+mercado de 14 CRMs) → plan maestro + plan del panel de contexto + ADR 0002 + 4 mockups verificados | `edcf527` | Hallazgos: 2 Ivi (la analista es la relevante), join comentario→anuncio es LOCAL (pautaSnapshots), Messenger sin atribución por polling |
| 2 | **Fix `@lid`**: mensajes reales se descartaban; `MapaLids` lee `whatsmeow_lid_map` del store (14.7k mapeos) | `549c65d` | 5 tests; probado contra el store vivo |
| 3 | **Deploy a VPS1**: clone (deploy key `github.com-hermes`), `hermes_db` :5438 (+pgvector), systemd PORT=4110, **re-vinculación por QR** (el pair-code daba 400; QR mostrado vía Preview), fix de puertos (4100 y 5434-5437 tomados) | — (runbook) | La sesión WA vive en el VPS; `deploy-vps1.md` tiene los desvíos reales |
| 4 | **Rediseño Goberna**: marca escudo+HERMES, espacio con vistas, Messenger deja de ser dead-end (endpoint `/api/persona/conv/:canal/:personaId`), panel de contexto v0, ResponderPanel des-modalizado | `1f4cdee` | |
| 5 | **Media WhatsApp completa**: recibir (downloadAny→`.wa-media/`, media en `events.payload`, JOIN sin columna nueva) y mandar (uploadMedia+sendRawMessage por `EnvioControlado.enviarMedia` — mismas guardas) + UI estilo WhatsApp Web con clip | `67f71a3` | Proto exacto en examples del wrapper; fileLength va como String |
| 6 | **API pública + OTA embrión**: DNS `hermes-api` creado vía API CF (credenciales del propio VPS), nginx+certbot dns-01, empaquetado Electron firmado | `fe6c1b1` | El 4110 queda cerrado; ufw solo 80/443 |
| 7 | **Instalador Windows roto → causa real**: electron-builder compila para la ARCH DEL HOST (arm64) → `--x64`. Investigación web descartó NSIS>2GB y Defender como causa primaria | (subida directa) | Gotcha permanente: verificar `archs=` en el log |
| 8 | **Agenda + OTA real**: seguimientos por vendedora + el server sirve `dist/` y la cáscara carga la URL viva — **actualizar = actualizar el VPS** | `860abe8` | Respuesta a "¿algo tipo EAS Update?" |
| 9 | **Cáscara Tauri** (ADR 0003): la razón de Electron (webview WA) murió con D13; dmg 4,6 MB (23× menos), win 3,3 MB por Actions (`tauri-windows.yml` — Tauri no cross-compila) | `27f3694` | Electron convive hasta paridad; Rust ≥1.9x |
| 10 | **Dashboard radar + riel de navegación + gestión**: página principal con grilla unificada (chats+lead-ads+landings), stats por vendedora, **webhook de landings** (Bravo `contact_webhook_url`→Hermes: el "excel" en vivo, porque el Sheet NO es legible), tablas gestiones+etiquetas, riel vertical, búsqueda en cola, **chat nuevo** | `6803220` | Token del webhook en `/srv/hermes/.landing-webhook-url` |
| 11 | **Agenda → calendario GCal**: mes/semana/día, chips por tipo de acción, crear en día vacío, detalle flotante, crear general o atado a teléfono | `c969327` | |
| 12 | **Embudo con compuertas**: etapas del dueño (Interesados→Contactados→Cotizados→Cierre·Perdidos), arrastre, cotizado exige interés (tabla `intereses`, autocomplete Cerberus), cierre solo vía venta (`asentarVentaEnEmbudo`) | `c35ad3a` | Los productos de la orden SON los intereses |
| 13 | **BarraGestion**: el embudo entero desde el chat (etapa 1-clic + etiquetas + intereses + agendar) | `55c2965` | |
| 14 | **Dashboard por panel de diseño** (workflow 3 lentes + juez: vendedora-first + densidad) + **Correos** (nodemailer fail-closed, tabla auditada) + **sidebar del dueño** (Dashboard·Pipeline·Contactos·Mensajes·Correos·Agenda; Tablero fuera) | `49b26b9` | Veredicto completo en el commit y en la memoria engram |
| 15 | **Llamar + agendar→contactado**: tel: desde chat y radar; agendar asienta 'contactado' si estaba en interesado | `f723d51` | |
| 16 | **Pasada de oficio anti-IA (fase 1)** + Llamar con red de seguridad (popover Copiar) + capabilities tel: en la cáscara (rebuild mac+win) | `494f9b4` | Medido: 10 dobles marcos, 88 micro-fuentes, 33 kickers |

## Cómo se decidió el diseño

- **Mockups** aprobados en `prototypes/crm-definitivo/` (previos a la implementación).
- **Dashboard**: workflow de 3 propuestas paralelas (lente vendedora / dueño / densidad) + juez
  que sintetizó — el veredicto completo (layout, 15 micro-decisiones, descartes con porqué) quedó
  en la memoria engram y aplicado en `49b26b9`.
- **Vara**: goberna-design-system manda tokens; taste-skill la calidad. Dorado = tiempo (vencido =
  rojo). Estados honestos siempre. Un envío = una acción humana.

## Deuda conocida que esta sesión DEJÓ a propósito

- Kickers uppercase aún abundantes (33) — fase 2 del oficio, con el dueño mirando.
- Tests: la suite (271) cubre server/lógica; las vistas nuevas no tienen tests de UI (no hay
  runner de front) — el gate visual es screenshot, pendiente de sesión logueada.
- `VistaTablero` sin ruta en el riel (decisión), `AgendarSeguimiento.tsx` eliminado (absorbe
  RegistrarGestion), Electron pendiente de archivo formal.
- El SSE no distingue eventos finos (todo invalida mucho) — optimizar si algún día pesa.
