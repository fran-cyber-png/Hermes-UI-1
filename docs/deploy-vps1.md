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
npm run db:migrate                         # crea el schema entero desde `drizzle/` (ADR 0020)
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

## 8b. Actualizar SIN rebuild en el VPS (y las más veces, sin restart)

El server **lee el `dist/` del disco en cada request** — `express.static(DIST)` y el `sendFile` del
fallback SPA (`server/src/index.ts:99-106`). Lo único que se evalúa al arrancar es que
`dist/index.html` **exista**, y en producción ya existe.

**Consecuencia**: reemplazar los archivos de `/srv/hermes/dist/` actualiza la UI **al instante**, sin
`npm run build` en el VPS y **sin `systemctl restart`**. Cero downtime: no se corta el SSE, no se
reconecta whatsmeow, y —esto importa— **no se pierden las sesiones de Cerberus**, que viven en un
`Map` de proceso y un restart las tira (el síntoma es un 409 «la sesión de Cerberus expiró» al abrir
el formulario de venta).

### A · Cambió SOLO el front → sin rebuild y sin restart

Se buildea en tu máquina y se manda el resultado:

```bash
# 1 · en tu máquina, apuntando a producción
env VITE_API_URL=https://hermes-api.goberna.us npm run build

# 2 · mandar el dist ya construido. --delete limpia los assets viejos (los nombres
#     llevan hash, así que sin --delete se acumulan para siempre).
rsync -avz --delete dist/ deploy@161.132.39.165:/srv/hermes/dist/
```

Listo. **No hay paso 3.** La próxima vez que alguien abra la app —o recargue— ve lo nuevo.

Por qué es seguro: Vite pone un hash en el nombre de cada asset y `index.html` los referencia; como
`express.static` va sin opciones de caché, el navegador revalida `index.html` en cada carga y se trae
los assets nuevos. El `--delete` es lo único que hay que respetar, o `dist/` crece sin techo.

### B · Cambió el server (rutas, SQL, deps) → hace falta restart

No hay forma de evitarlo: el código del server está en memoria.

> **Desde el 2026-07-24 esto no se hace a mano.** Es el **nivel 5** del pipeline: Actions →
> **Desplegar server (con restart)**. El trabajo lo hace `deploy/vps1/hermes-deploy.sh`, que
> respalda la base si hay migraciones, migra, construye, reinicia, espera `/health`, corre el smoke
> funcional y **revierte solo** si algo falla. Ver `docs/despliegue-continuo.md`.
>
> Por SSH corre exactamente la misma pieza — no es un camino alternativo, es el mismo:
>
> ```bash
> ssh deploy@161.132.39.165 'sudo hermes-deploy --dry-run'   # qué haría y qué migraciones trae
> ssh deploy@161.132.39.165 'sudo hermes-deploy'             # promueve origin/main
> ssh deploy@161.132.39.165 'sudo hermes-deploy --rollback'  # vuelve al último SHA sano
> ```

<details>
<summary>El procedimiento manual que esto reemplazó (por si el script no está disponible)</summary>

```bash
ssh deploy@161.132.39.165 'cd /srv/hermes && git pull && \
  ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci && \
  env VITE_API_URL=https://hermes-api.goberna.us npm run build && \
  sudo systemctl restart hermes'
```

- `npm ci` **solo si cambiaron dependencias** (`git diff --stat <sha-viejo>..main -- package.json`).
- `ELECTRON_SKIP_BINARY_DOWNLOAD=1` evita bajar ~100 MB que el VPS nunca usa.
- `cd server && npm run db:migrate` **solo si hay migraciones nuevas** en `server/drizzle/`.
  (Antes era `db:push`; ver ADR 0020.)

</details>

#### ~~SQL manual tras `db:push`~~ — el GIN de `notas`, resuelto

> Lo que decía acá: drizzle-kit no emite índices de expresión sobre `to_tsvector`, así que
> `notas_texto_gin_idx` había que crearlo **a mano por SSH después de cada `db:push`**.
>
> Eso produjo deriva real: el índice existía en producción y en ninguna base nueva. Lo encontró el
> `pg_dump` comparativo al montar staging (ADR 0020).

drizzle-kit sigue sin emitirlo, pero ahora el índice está **escrito en la migración**
(`server/drizzle/0000_baseline.sql`), que es la ventaja de tener un archivo: lo que la herramienta no
sabe generar, se agrega a mano una vez y queda versionado. No hay paso manual.

Del párrafo que había acá quedan dos cosas que siguen sirviendo cuando hay que entrar a la base a
mirar algo:

- El contenedor es **`hermes_db`** (no `cartografia_db` — ese es el Postgres del geovisor, en la
  MISMA VPS1 pero nada que ver). El usuario y la base salen de las env vars **del propio
  contenedor**, así el comando no depende de que quien lo corre las adivine:

  ```bash
  ssh deploy@161.132.39.165 "docker exec -it hermes_db sh -c 'psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\"'"
  ```

- Sin el índice GIN, `GET /api/notas?q=` sigue dando el **mismo resultado**: la expresión del
  `WHERE` es idéntica a la del índice, así que Postgres hace seq scan en vez de usarlo. Más lento
  con la libreta grande, no roto. Por eso el drift pudo durar tanto sin que nadie lo notara.

### Cuál de las dos me toca

```bash
git diff --stat <sha-de-produccion>..main -- server/ package.json
```

Sin salida → es **A**. Con salida → es **B**.

> ⚠️ **No partas un cambio entre A y B.** Si el front nuevo espera campos que el server viejo no
> manda (o al revés), la app se rompe en manos de la vendedora. Front y server se despliegan juntos
> salvo que hayas verificado que el cambio es compatible en las dos direcciones.

### Rollback

- **A**: volvé a buildear desde el commit anterior y `rsync` de nuevo. Segundos.
- **B**: `cd /srv/hermes && git checkout <sha-anterior> && npm ci && npm run build && sudo systemctl restart hermes`.

### Lo que NUNCA hace falta para actualizar

**Reinstalar la app.** La cáscara Tauri solo abre `https://hermes-api.goberna.us`; el instalador se
regenera únicamente para máquinas nuevas o para refrescar el respaldo offline. Ver ADR 0003 y 0007.

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
