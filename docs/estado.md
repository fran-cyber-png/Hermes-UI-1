# Estado de Hermes — para retomar (2026-07-22, tras la sesión "crm-definitivo")

> **Empezá por acá.** La foto completa: qué funciona, qué falta, y el contexto para seguir sin
> re-descubrir nada. Repo: **github.com/Goberna-Lab/hermes** (privado, `main`). El norte de producto
> es **`plan-crm-definitivo.md`**; la bitácora de cómo se llegó acá:
> **`sesion-2026-07-21-crm-definitivo.md`** (14 features en un día, con sus commits).

## Qué es Hermes (1 frase)

El **CRM de la Escuela de Goberna**: la vendedora atiende todos los canales (WhatsApp, comentarios
FB/IG, Messenger), gestiona el embudo, agenda, llama, manda correos y registra la venta contra
Cerberus — desde UNA app (Tauri/web) cuya UI vive en el server (**OTA**: actualizar = actualizar
el VPS, nadie reinstala).

## Qué funciona hoy — EN PRODUCCIÓN (VPS1, `https://hermes-api.goberna.us`)

| Área | Estado |
|---|---|
| **Dashboard** (página principal) | Diseño por panel 3-lentes+juez: banda "Tu mañana" (vencidos/hoy + "Atender a {nombre} →"), radar en vivo (filas 2 líneas, calientes con borde oro, filtros que delatan fuentes muertas), riel (embudo-barra clickeable, top cursos pedidos, equipo Hoy\|7d) |
| **Pipeline** | Kanban con las 5 etapas del dueño (Interesados→Contactados→Cotizados→Cierre·Perdidos), arrastre, y **compuertas server-side**: a Cotizados con ≥1 curso de interés; a Cierre SOLO registrando la venta (la venta lo mueve sola: cotización→cotizado+intereses, venta→cierre+conversión) |
| **Mensajes** (chat) | Cola unificada 4 canales + búsqueda + **chat nuevo** · hilo WhatsApp **con media completa** (ver/mandar imágenes, videos, audios, flyers — clip con leyenda) · Messenger read-only · comentarios privado-antes-que-público · **BarraGestion arriba de todo chat**: etapa 1-clic, etiquetas, intereses, Agendar, **Llamar** (tel: + Copiar de respaldo) |
| **Contactos** | Búsqueda por teléfono → ficha Cerberus 4 estados |
| **Correos** | Composer 1-a-1 auditado + enviados del equipo. **Fail-closed**: falta el SMTP (ver pendientes) |
| **Agenda** | Calendario estilo GCal (mes/semana/día, chips por tipo, crear en día vacío, detalle flotante). Agendar mueve interesado→**contactado** solo. Badge dorado en el riel |
| **Infra** | API pública HTTPS + SSE + UI servida (OTA) · WhatsApp vinculado EN el VPS (51986394450, fix `@lid` con 14.7k mapeos) · webhook de landings listo (Bravo→Hermes) · cáscara **Tauri** 3-5 MB (mac+win, permiso tel:) · Electron convive hasta paridad (ADR 0003) |
| **Rendimiento** | Track «Rendimiento 2026-07» (spec #29): la cola con **ventana de 30 días** (3,8 s → 30 ms, #30) · el **caché de consultas sobrevive al cierre** — IndexedDB, restaurado antes del primer render, con sello «hace 14 horas» hasta que llega lo fresco (#31, ADR 0007) |

Suite: **271 tests verdes**. Sidebar: Dashboard · Pipeline · Contactos · Mensajes · Correos · Agenda
(Tablero fuera por decisión; componente conservado).

## PENDIENTES

### Del operador (minutos, destraban features ya construidas)
1. **SMTP para Correos**: cargar `SMTP_HOST/PORT/USER/PASS/FROM` en `server/.env` del VPS (la
   cuenta sale de mail.goberna.us / VPS2) + `systemctl restart hermes`. La UI se enciende sola.
2. **Landings al Dashboard**: en Bravo, poner `contact_webhook_url` de cada tenant con la URL de
   `ssh deploy@161.132.39.165 'cat /srv/hermes/.landing-webhook-url'` (runbook §9).
3. **Cerrar la sesión de WhatsApp de la laptop** (el teléfono tiene 2 dispositivos vinculados;
   debe atender solo el VPS). Dev local: `WHATSAPP_TRANSPORTE=falso`.
4. **Certificado de code signing Windows** (OV ~US$100-300/año) para matar el aviso de SmartScreen.

### De código (en orden sugerido)
1. ~~**Fase 2 del oficio taste**~~ — **EJECUTADA (2026-07-22)** como rediseño «Cierre de edición»:
   auditoría multi-agente (185 hallazgos) → dirección editorial → implementación completa de las 8
   pantallas + teclado global + puente entre vistas + capa de gráficas (series de 14 días en
   `/api/dashboard`). Spec, auditorías y screenshots antes/después: **`docs/rediseno-2026-07/`**.
   Kickers 33→6 · piso 11px en cero · presupuesto del oro aplicado. Predecesores `Bandeja`/
   `FilaInteraccion`/`useBandeja` archivados (ADR 0004). Pendiente de esa dirección: cablear el
   «modo racha» (`onSiguiente` en ResponderPanel, tono a validar con la vendedora real) y el
   flujo venta-precargada del drop en Cierre (`onRegistrarVenta` del kanban).
2. **Crear cliente en Cerberus para lead nuevo** (H1): hoy la venta exige cliente existente.
3. **S8 — contexto completo** (`plan-panel-contexto.md`): tabla `contexts`, ingesta ampliada,
   curso inferido del anuncio (join local ya posible), imagen de la publicación.
4. Verificación humana pendiente: **foto real entrante** al número, **envío de flyer** desde la UI,
   screenshots de las vistas logueadas (regla dura #2 — falta una sesión para Playwright).
5. Archivar Electron cuando la paridad Tauri esté confirmada en máquinas reales (ADR 0003).

## Contexto técnico para no re-descubrir

- **Actualizar prod (OTA):** `ssh deploy@161.132.39.165 'cd /srv/hermes && git pull && env
  VITE_API_URL=https://hermes-api.goberna.us npm run build && sudo systemctl restart hermes'`
  (+ `cd server && npm run db:push` si cambió el schema; `npm ci` si cambiaron deps).
- **VPS1:** systemd `hermes` (PORT=4110) · Postgres `hermes_db` 127.0.0.1:5438 · nginx
  `hermes-api` (SSE sin buffering, 64 MB adjuntos) · deploy key `github.com-hermes` · sesión WA en
  `/srv/hermes/server/.wa-sessions/` · media en `.wa-media/` · **la app abre también en navegador**.
- **Instaladores** (`/srv/hermes-descargas/` = `https://hermes-api.goberna.us/descargas/`):
  `Hermes-Windows.zip` (Tauri x64 + permiso tel:) · `Hermes_0.2.0_aarch64.dmg` · los Electron
  viejos conviven. Rebuild win: `gh workflow run tauri-windows.yml` (mac: `npx tauri build`).
- **Local:** `docker start meta_escuela_db` · `cd server && npm run dev` (:4100) · `npm run dev`
  (:5173). Tests: server `cd server && npm test`, front `npm test` (vitest). **Ojo cwd**: el shell
  persiste el directorio entre comandos.
- **Caché persistente** (ADR 0007): vive en IndexedDB, base `hermes` → tienda `cache` → clave
  `consultas`. Guarda SOLO el radar y la cola, dura 24 h, y el buster es la identidad del build
  (cada build tira lo viejo — con OTA, la forma del payload puede cambiar bajo los pies). Para
  depurar un arranque raro: borrar la base desde DevTools equivale a volver al comportamiento
  anterior. Evidencia: `docs/rendimiento-2026-07/cache-*.png`.
- **Datos clave:** etapa actual de una conversación = última fila de `gestiones` (append-only,
  legacy nuevo/venta se normalizan) · la clave de conversación es LA identidad transversal
  (`conv:canal:persona:numero` / `int:<id>` / `lead:<id>` / `'general'`) — etiquetas, intereses,
  gestiones, recordatorios y correos cuelgan de ella.

## Decisiones (no re-discutir)

`plan-hermes-mvp.md` §4-5 (D1-D13) + `plan-crm-definitivo.md` + ADR 0002 (espacio con vistas,
enmienda: 5→6 con Agenda; Tablero pausado) + ADR 0003 (Tauri) + de esta sesión: OTA como modelo de
updates · compuertas del embudo server-side · un envío/correo = una acción humana · dorado = tiempo
(vencido = rojo) · sombra O borde, nunca ambos · acciones de sistema (tel:) siempre con respaldo
visible (Copiar).
