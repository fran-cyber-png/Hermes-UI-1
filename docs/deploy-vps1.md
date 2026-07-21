# Deploy de Hermes a VPS1 + vincular el número

> **Objetivo:** que el server de Hermes corra en **VPS1** (`deploy@161.132.39.165`), sobreviva reinicios,
> sea alcanzable por las apps de las vendedoras, y que un operador **vincule el número de ventas** ahí.
> **Estado: EJECUTADO 2026-07-21.** Desvíos reales respecto del plan original:
> `PORT=4110` (el 4100 lo usa meta_escuela_backend) · Postgres en `127.0.0.1:5438` como `hermes_db`
> (5434-5437 estaban tomados; override en `docker-compose.override.yml` del VPS, con password propia
> y `CREATE EXTENSION vector`) · clone vía **deploy key dedicada** (`~/.ssh/id_ed25519_hermes_deploy`
> + alias `github.com-hermes`, agregada al repo como read-only) · vinculación por **QR** (el pair-code
> daba 400) · cert por **dns-cloudflare** con el `/etc/letsencrypt/cloudflare.ini` que ya tenía el VPS
> (el registro A `hermes-api` también se creó con esas credenciales) · nginx con bloque SSE
> (`proxy_buffering off`, timeout 24 h) y `client_max_body_size 64m` para los adjuntos.
> Actualizar código: `cd /srv/hermes && git pull && sudo systemctl restart hermes`.

## Lo que ya hay en VPS1 (verificado 2026-07-21)

- **Node v22.22.2**, npm 10.9.7, git 2.25.1, **Docker 26** ✓.
- Postgres corre en Docker (`nexus_postgres`, `maquina_electoral_postgres` en :5432).
- Patrón de apps en `/srv/` (app, assets-service, certificaciones-goberna, foro-estado…).
- Runners self-hosted de GitHub **por repo** (labels propios). No hay pipeline de Hermes aún.

## Decisiones antes de arrancar

1. **Cómo llegan las vendedoras al server.** Sus apps de escritorio necesitan la API por HTTPS público.
   Recomendado: subdominio `hermes-api.goberna.us` en Cloudflare → nginx en VPS1 → `:4100`. (Alternativa
   si todas están en la tailnet: exponer por tailnet, sin subdominio.)
2. **Postgres de Hermes.** Un contenedor propio (aislado, como en local), no meterlo en `nexus_postgres`.
3. **El número de ventas.** El teléfono tiene que estar a mano para escanear/emparejar (paso 6).

## 1. Traer el código

```bash
ssh deploy@161.132.39.165
sudo mkdir -p /srv/hermes && sudo chown deploy:deploy /srv/hermes
git clone <URL del repo Goberna-Lab/hermes> /srv/hermes    # (crear el remoto primero)
cd /srv/hermes
```

## 2. Postgres propio (Docker)

```bash
# docker-compose.yml del repo usa el puerto 5434 y el volumen meta_escuela_pgdata.
# En VPS1, levantarlo igual (loopback):
docker compose up -d --wait
```

> Ojo: en VPS1 el 5434 debe estar libre. Si choca, cambiá el mapeo del puerto en `docker-compose.yml`
> y en `DATABASE_URL`. El puerto va **bindeado a 127.0.0.1**, nunca expuesto.

## 3. Configurar `server/.env` (secretos por nombre, nunca en el repo)

```bash
cd /srv/hermes/server
cp .env.example .env
# Editar .env y completar:
#   DATABASE_URL=postgresql://meta_escuela:...@127.0.0.1:5434/meta_escuela
#   META_ACCESS_TOKEN=<el mismo system-user token de goberna-dashboard>
#   CERBERUS_BASE_URL=https://app.goberna.us
#   HERMES_SESSION_SECRET=<openssl rand -hex 32>   # NUEVO, secreto, no el de dev
#   WHATSAPP_TRANSPORTE=whatsmeow
#   WHATSAPP_NUMERO=<el número de ventas, solo dígitos>
```

## 4. Instalar, crear tablas, buildear

```bash
cd /srv/hermes/server && npm ci            # baja el binario Go de whatsmeow para linux
npm run db:push                            # crea events/interactions/leads/envios_wa
npx tsc --noEmit                           # sanity
cd /srv/hermes && npm ci && npm run build  # build del front (dist/)
```

## 5. Correr el server como servicio (systemd — sobrevive reboots)

`/etc/systemd/system/hermes.service`:

```ini
[Unit]
Description=Hermes server (mesa de la vendedora)
After=network.target docker.service

[Service]
User=deploy
WorkingDirectory=/srv/hermes/server
ExecStart=/usr/bin/npm run dev
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now hermes
sudo systemctl status hermes          # debe decir active (running)
curl -s localhost:4100/health         # {"ok":true}
```

> Para producción de verdad conviene `npm run build` + `npm start` (node dist/) en vez de `npm run dev`
> (tsx watch). El `dev` alcanza para arrancar; migrar a `start` cuando el build del server esté verde.

## 6. VINCULAR EL NÚMERO (lo que preguntaste)

La sesión de WhatsApp vive en el server (D13). Se vincula UNA vez, con el teléfono a mano:

```bash
ssh deploy@161.132.39.165
cd /srv/hermes/server
npm run wa:vincular -- <numero>     # ej: npm run wa:vincular -- 51955135507
```

Imprime un **código de 8 dígitos**. En el teléfono de ese número:
**WhatsApp → Ajustes → Dispositivos vinculados → Vincular un dispositivo → Vincular con número de
teléfono → escribí el código.**

Cuando diga `✅ Conectado`, la sesión quedó guardada en `/srv/hermes/server/.wa-sessions/<numero>.db`.
Escribile a ese número desde otro teléfono y miralo aparecer en la salida. Cortá con Ctrl-C: el servicio
`hermes` (paso 5), con `WHATSAPP_NUMERO` igual a ese número, reconecta la MISMA sesión y ya recibe/envía.

> La sesión es la credencial de la cuenta: `.wa-sessions/` está gitignored y no sale de VPS1.

## 7. Exponer la API (nginx + Cloudflare)

`/etc/nginx/sites-available/hermes-api`:

```nginx
server {
    server_name hermes-api.goberna.us;
    location / {
        proxy_pass http://127.0.0.1:4100;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/hermes-api /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d hermes-api.goberna.us      # HTTPS
```

En Cloudflare: registro `hermes-api` → IP de VPS1. Confirmá `curl https://hermes-api.goberna.us/health`.

## 8. La app de las vendedoras — HECHO

Se empaqueta con electron-builder (config en `package.json`, salida gitignoreada en `release/`):

```bash
env VITE_API_URL=https://hermes-api.goberna.us npm run build   # el build queda apuntando a prod
npm run empaquetar:mac    # → release/Hermes-<v>-arm64.dmg (firmado con la identidad de desarrollo)
npm run empaquetar:win    # → release/Hermes-Setup-<v>.exe (NSIS un-clic)
```

Ese archivo es lo que se reparte: doble clic, login con **su usuario de Cerberus**, y la vendedora
está en su mesa. No vincula nada, no clona nada. (En Macs ajenas, al no estar notarizado, la primera
vez es clic derecho → Abrir.)

## Verificación final (regla dura #2)

- `systemctl status hermes` → active.
- `curl https://hermes-api.goberna.us/api/whatsapp/sesion` → `{"estado":"conectado","telefono":"..."}`.
- Desde un teléfono cualquiera, escribir al número → aparece en la cola de la app.
- Responder desde la app → llega al teléfono, y `envios_wa` registra el envío con la vendedora.

## Pendientes / riesgos

- **Catch-up offline de whatsmeow**: verificar que al reconectar entregue los mensajes que llegaron con
  el server caído (whatsmeow lo soporta; confirmar que el wrapper `@whatsmeow-node` no los tire).
- **Un número por sesión**: para varios números, un `TransporteWhatsmeow` por número + un gestor. El MVP
  arranca con uno (`WHATSAPP_NUMERO`).
- **Migrar `npm run dev` → build+start** para prod real.

## 9. El webhook de las landings (leads del "excel" en vivo)

Los formularios de landing caen a Bravo (fuente oficial) además del Sheet. Bravo reenvía cada lead
a la URL configurada en `portal.tenant_sites.contact_webhook_url` (por tenant). Para que caigan en
Hermes: apuntar ese campo a `https://hermes-api.goberna.us/webhook/landing/<LANDING_WEBHOOK_TOKEN>`
— la URL completa con el token vive en `/srv/hermes/.landing-webhook-url` (600) en VPS1; el token
es el env `LANDING_WEBHOOK_TOKEN` del `server/.env`. Idempotente por (tenant, momento, contacto);
sin token configurado la ruta rechaza todo (fail-closed). Configurarlo por tenant es tarea del
operador de Bravo (Estephano/Andreecito).
