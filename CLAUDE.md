# Hermes — reglas para Claude

**Hermes es el CRM de la Escuela**: una app de escritorio (Tauri; la UI vive en el server — OTA) donde una vendedora de Goberna
atiende, desde una sola pantalla, a toda la gente que levantó la mano por **Facebook, Instagram,
Messenger y WhatsApp** — con la ficha del contacto al lado del chat, y registrando la venta contra
Cerberus. Negocio: la **Escuela** de Goberna (formación política, LATAM).

Extraído de `meta-escuela` preservando historia git (ver `docs/adr/0001`). El **plan y las decisiones**
viven en `docs/plan-hermes-mvp.md` (léelo antes de tocar arquitectura). El concepto en `docs/concepto.md`.

## Stack

- **Front** (`src/`): React 19 + Vite 8 (React Compiler), Tailwind 4, TanStack Query, lucide-react.
  **Sin router** — un espacio con vistas conmutadas por estado (ADR 0002; hoy solo existe la
  Bandeja). Marca Goberna en `src/index.css` (azul + dorado, Montserrat; el dorado significa
  **tiempo que se acaba**, nada más). El norte de producto: `docs/plan-crm-definitivo.md`.
- **Escritorio** (`src-tauri/`): **Tauri v2** — la cáscara solo abre `https://hermes-api.goberna.us`
  (OTA; fallback al dist local). Windows se compila en Actions (`tauri-windows.yml`), no cross-compila.
  `electron/` convive hasta paridad verificada y después se archiva (ADR 0003).
- **Server** (`server/`): Express 4 + Drizzle ORM + Postgres 17 (imagen pgvector, puerto **5434** en
  local) + Zod 4. Event store append-only + proyecciones.
- **WhatsApp**: `@whatsmeow-node/whatsmeow-node` (cliente de protocolo no oficial, binario Go vía
  subprocess). Ver §WhatsApp.

## Correr en local

```bash
docker compose up -d --wait                       # Postgres (event store), en la raíz del repo
cd server && npm install && npm run dev            # API en :4100 (necesita server/.env)
npm install && npm run dev:app                     # Vite :5173 + la app de escritorio (Electron)
```

- `npm run dev` (sin `:app`) abre el front en el navegador: la cola y la conversación nativa funcionan;
  solo el viejo webview no (y ese está retirado, ver §WhatsApp).
- **Tests**: `cd server && npm test` (node:test, puros salvo checks en vivo). **Typecheck**: front
  `npx tsc --noEmit -p tsconfig.app.json`, server `cd server && npx tsc --noEmit`.
- **Refrescar datos de Meta**: `cd server && npm run ingest:interactions` (polling manual, read-only).
  Captura comentarios FB/IG + DMs de Messenger de **todas las Páginas que el token puede ver** (`me/accounts`).

## WhatsApp — la costura y la vinculación

- **Todo pasa por la interfaz `TransporteWhatsapp`** (`server/src/whatsapp/transporte.ts`). Habla
  **teléfonos, nunca JIDs**. Tres implementaciones: `falso` (dev/tests), `whatsmeow` (real), `cloud-api`
  (futuro respaldo de Meta). Se elige por env `WHATSAPP_TRANSPORTE`. Si un JID aparece arriba de esa
  línea, la costura falló (la conversión vive en `identidadWa.ts`).
- **Vincular un número** = server-side, aparte de la app (decisión **D13**): `cd server && npm run
  wa:vincular -- <numero>`. Da un código de 8 dígitos para poner en el teléfono (WhatsApp → Dispositivos
  vinculados → Vincular con número). La sesión queda en `server/.wa-sessions/` (**gitignored: es la
  credencial de la cuenta, NUNCA se commitea**). La app de la vendedora **no vincula, solo ve**.
- **El webview viejo** (`src/features/whatsapp/PanelWhatsapp.tsx`) está **retirado** por D13. No se usa;
  archivar con ADR cuando se limpie.
- **Nada de automatización**: no envío masivo, no auto-respuesta, no warmup, no anti-ban. Un envío = una
  acción humana, por `EnvioControlado` (la única puerta hacia `enviarTexto`). El `temporary_ban` **se
  muestra siempre**, nunca se esconde.

## Auth

Login de vendedoras **contra Cerberus** (Django, sin API REST): `cerberus/auth.ts` hace el handshake
CSRF + POST a `/ingresar/`. Éxito → Hermes emite un **token HMAC Bearer** (`auth/sesion.ts`). El
`vendedoraId` = username de Cerberus. Middleware `requiereVendedora` delante de todo lo que envía o
atribuye a una vendedora.

## Deploy

**VPS1** (`deploy@161.132.39.165`), en `/srv/hermes` — **EJECUTADO 2026-07-21**: servicio systemd
`hermes` (PORT=4110), Postgres propio `hermes_db` (127.0.0.1:5438), API pública
**`https://hermes-api.goberna.us`** (nginx + certbot dns-cloudflare; el 4110 no se expone), número
51986394450 vinculado ALLÁ. Actualizar: `ssh … 'cd /srv/hermes && git pull && sudo systemctl
restart hermes'`. **No hay CI/CD todavía.** Runbook: **`docs/deploy-vps1.md`**.
**La app de las vendedoras se EMPAQUETA**, no se clona: `env VITE_API_URL=https://hermes-api.goberna.us
npm run build && npm run empaquetar:mac` (o `:win`) → `release/Hermes-*.dmg|.exe`.

## Secretos y config (env)

Solo en `server/.env` (gitignored). **Se referencian por nombre, jamás se pegan** (regla dura #1):
`DATABASE_URL`, `META_ACCESS_TOKEN`, `CERBERUS_BASE_URL`, `HERMES_SESSION_SECRET`,
`WHATSAPP_TRANSPORTE`, `WHATSAPP_NUMERO`. Ver `server/.env.example` (solo nombres).

## Reglas duras (Goberna)

1. **Secretos**: por nombre, nunca pegados en prompts/archivos/docs.
2. **Verificación antes de "listo"**: ningún cambio de UI o deploy se reporta terminado sin screenshot
   (Playwright/Electron) o `curl` a la URL viva.
3. **Toda reescritura documenta qué reemplaza** (ADR en `docs/adr/`) y archiva al predecesor.
4. **latin1 de Cerberus**: el enemigo son los **emojis**, no los acentos (á/é/ñ pasan; el emoji revienta
   el INSERT en MySQL). Sanitizar en el borde.

## Gotchas

- **Drizzle sin migraciones versionadas**: el schema se aplica con `npm run db:push` (drizzle-kit). Al
  tocar `server/src/db/schema.ts`, push contra la DB.
- **El transporte falso repite ids entre reinicios** (`falso-1`, `falso-2`…): reprocesar colisiona con la
  idempotencia (`wa:falso-N` ya existe) y el mensaje no entra. Para demos limpias, borrar los
  `external_id LIKE 'wa:falso-%'` primero. El transporte real usa ids reales de WhatsApp (únicos).
- **whatsmeow trae binario Go por plataforma**: en el deploy linux, `npm install` baja el binario linux.
- **La cola sirve conversaciones, no filas** (`/api/conversaciones`, no `/api/interactions`): los
  mensajes se agrupan por `(canal, persona, número propio)`; los comentarios siguen individuales.

## Estado (2026-07-22)

Hermes es un CRM completo EN PRODUCCIÓN (VPS1, OTA): Dashboard radar · Pipeline con compuertas
(cotizado exige interés; cierre solo vía venta) · chat multicanal con media completa y BarraGestion ·
Contactos · Correos (falta SMTP) · Agenda-calendario. Sidebar: Dashboard · Pipeline · Contactos ·
Mensajes · Correos · Agenda. **La foto completa, los pendientes y el contexto: `docs/estado.md`**;
la bitácora de cómo se llegó: `docs/sesion-2026-07-21-crm-definitivo.md`.
