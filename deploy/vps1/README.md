# Deploy del backend meta-escuela en VPS1 (always-on → dato en tiempo real)

Runbook para poner el backend + Postgres(pgvector) always-on en **VPS1** (`deploy@161.132.39.165`),
que es el requisito duro para que Ivi vea dato fresco. Ver el porqué en
[`docs/29 §6`](../../docs/29-INTEGRACION-IVI-PLATAFORMA.md) y el mapa de frescura.

## Qué resuelve (y qué NO)

- **Gasto/ROAS de Meta** → el reloj de pauta (`pauta/reloj.ts`) arranca prendido y refresca cada
  ~6h *mientras el backend corra*. Always-on = fresco solo. ✅
- **Ventas (Cerberus)** → siguen entrando por dump; automatizar la cadencia (§4). 
- **Leads (Icarus) / Matrículas (LMS)** → conectores nuevos (`governa.icarus.*`, `governa.escuela.*`),
  co-locados en VPS1. Fase siguiente.
- **NO toca escrituras a Meta**: `LAZO_RELOJ` (CAPI) queda apagado y `DECISIONES_MODO=simulacion`,
  como decidiste. Esto es real-time de LECTURA, no de envío.

## 0. Secretos (nunca se pegan en chat/repo)

`deploy/vps1/.env` (NO versionado) con los nombres:
```
DB_PASSWORD=<elige uno para el Postgres de VPS1>
META_ACCESS_TOKEN=<el mismo que usa server/.env local>
META_APP_ID=<idem>
```
Forma recomendada de moverlos sin pegarlos: `scp` host-a-host desde la Mac
(`scp server/.env deploy@161.132.39.165:/srv/meta-escuela/deploy/vps1/.env`) y agregar `DB_PASSWORD`.

## 1. Traer el repo a VPS1

```bash
ssh deploy@161.132.39.165
sudo mkdir -p /srv/meta-escuela && sudo chown deploy /srv/meta-escuela
git clone <repo-url> /srv/meta-escuela         # el repo anidado: la raíz git es meta-escuela/meta-escuela
cd /srv/meta-escuela/deploy/vps1               # acá viven el compose y el .env
```

## 2. Levantar DB + backend

```bash
docker compose up -d --build --wait
docker exec meta_escuela_prod_db psql -U meta_escuela -d meta_escuela -c "CREATE EXTENSION IF NOT EXISTS vector;"
docker compose exec backend npm run db:push    # crea schemas public/fuentes/ontologia/rag + tablas
```

## 2.5 Firewall (REQUERIDO — patrón de seguridad de VPS1)

VPS1 tiene `FORWARD policy DROP` y un allowlist en la cadena `DOCKER-USER` para el puerto 5432:
solo subredes whitelisteadas alcanzan cualquier Postgres. La subred de este compose
(`10.0.27.0/24`, pinneada en el compose) debe agregarse, o el backend NO alcanza su db (los
paquetes se DROPean → `CONNECT_TIMEOUT db:5432`). Mismo patrón que `meta-partnert internal db`:

```bash
# Insertar ANTES del DROP genérico de 5432 (necesita sudo — decisión humana):
sudo iptables -I DOCKER-USER 1 -s 10.0.27.0/24 -p tcp -m tcp --dport 5432 -j ACCEPT \
  -m comment --comment "meta-escuela internal db"
# Persistir (que sobreviva reboot). Según cómo persista VPS1 el resto de reglas:
sudo netfilter-persistent save    # o iptables-save > /etc/iptables/rules.v4
```
Después de esta regla: `docker exec meta_escuela_backend node -e "..."` conecta y las herramientas
SDK devuelven datos.

> Nota post-carga: tras un `pg_dump`/carga masiva, correr `ANALYZE` y **reiniciar el backend**
> (`docker compose restart backend`) — postgres.js cachea planes por conexión; sin stats +
> reinicio, las queries pueden caer en el timeout de 30s con un plan viejo.

## 3. Cargar la data inicial

```bash
# Cerberus: subir un dump reciente y proyectarlo (ver server/src/scripts/cerberus.ts)
docker compose exec backend npm run cerberus:ingestar   # espejo crudo -> fuentes.registro
docker compose exec backend npm run cerberus:proyectar  # -> ontologia.venta (USD, estados)
docker compose exec backend npm run cerberus:hechos     # eje del tiempo
# RAG (opcional acá; puede vivir en geografo): desde goberna-kos/ con RAG_DATABASE_URL apuntando a esta DB
```

## 4. Frescura de ventas en cadencia (cron)

```bash
# Un timer que re-ingesta Cerberus cada N horas (ajustar cadencia). Ejemplo crontab (deploy):
0 */6 * * * cd /srv/meta-escuela/deploy/vps1 && docker compose exec -T backend npm run cerberus:ingestar && docker compose exec -T backend npm run cerberus:proyectar
```
Alternativa mejor (casi al instante): cablear el webhook vivo de Cerberus para que **re-proyecte**
`ontologia.venta` (hoy solo emite CAPI). Es cambio de código en `webhook/ruta.ts`.

## 5. Apuntar Ivi / RAG / front a VPS1

- **Ivi engine** (geografo): `IVI_BACKEND=http://100.85.119.49:4100` (tailnet).
- **RAG**: `RAG_BACKEND=http://100.85.119.49:4100`.
- **Front**: la base de la API → `100.85.119.49:4100` (o el proxy que corresponda).

## 6. Verificar

```bash
curl -s http://100.85.119.49:4100/health                       # {"ok":true}
curl -s http://100.85.119.49:4100/api/sdk/herramientas          # catálogo SDK vivo
# a las ~6h: el gasto se refrescó solo (governa.atribucion.roasPorPais → edadMinutos baja)
```

## Follow-up: CI/CD

VPS1 despliega por runners self-hosted por repo (`actions-runner-<app>`). meta-escuela no tiene
workflow todavía; registrar un runner + `.github/workflows/deploy.yml` que haga `git pull` +
`docker compose up -d --build` reemplaza los pasos manuales de arriba. Fase siguiente.
