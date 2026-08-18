# El entorno de pruebas — Hermes y Cerberus

Un lugar donde ver un cambio **funcionando, con datos de verdad, antes de que lo vea
una vendedora o un alumno**. Dos mitades que se hablan entre sí y no hablan con nada
más: `pruebas.hermes.goberna.us` y `pruebas.app.goberna.us`, las dos detrás de
Tailscale.

La otra mitad del mapa: `ceberusapp/docs/entorno-de-pruebas.md`.

## Las dos ramas, en los dos repos

```
feature/* --PR--> desarrollo --(automático)--> PRUEBAS
                      │
                     PR   ← acá se decide que algo es viable
                      ▼
                    main   --(N4 auto / N5 botón)--> PRODUCCIÓN
```

`main` sigue siendo producción y no se toca directo. Lo nuevo es `desarrollo`: la rama
paralela donde se junta lo que todavía no se promovió, y que se despliega sola.

## Por qué esto no existía ya (y qué se movió)

Hermes **ya tenía** un N3 en `/srv/hermes-staging`: aplicaba migraciones de verdad y
corría un smoke autenticado. Lo que no era, era un lugar donde mirar algo. Tres cosas
lo impedían, y las tres cambian acá:

| | Antes | Ahora |
|---|---|---|
| Cuándo se desplegaba | al pushear a `main` — o sea **después** de que el cambio ya iba a producción | al pushear a `desarrollo`, **antes** |
| Cómo se abría | el front se compilaba con `VITE_API_URL=http://127.0.0.1:4111`: solo funcionaba **dentro** de VPS1 | `https://pruebas.hermes.goberna.us`, desde cualquier máquina de la tailnet |
| Con qué datos | vacía, más lo que dejaran los smokes | copia de producción, refrescable a pedido |

Y una cuarta que era el agujero de verdad: **staging apuntaba a Cerberus de
producción** (`CERBERUS_BASE_URL=https://app.goberna.us`). Registrar una venta desde
el ensayo la escribía en el ERP. Ahora apunta al Cerberus de pruebas.

N3 sigue siendo gate duro de N4: en un push a `main` corre igual, como ensayo previo.
Es el mismo entorno, pisado con el código de `main` — que a esa altura ya pasó por acá.

## Los números

| | Producción | Pruebas |
|---|---|---|
| Hermes — servicio | `hermes` · `:4110` | `hermes-staging` · `:4111` |
| Hermes — base | `hermes_db` · `127.0.0.1:5438` | `hermes_staging_db` · `127.0.0.1:5440` |
| Hermes — URL | `https://hermes-api.goberna.us` | `https://pruebas.hermes.goberna.us` |
| Cerberus — contenedor | `cerberus_app` · `:8001` | `cerberus_pruebas_app` · `:8003` |
| Cerberus — URL | `https://app.goberna.us` | `https://pruebas.app.goberna.us` |
| Máquina | VPS1 (Hermes) · VPS2 (Cerberus) | las mismas |

## El candado es el `listen`, no una contraseña

Los dos vhosts de pruebas escuchan **solo en la IP de Tailscale** de su máquina
(`100.85.119.49` en VPS1, `100.87.97.7` en VPS2). Los registros DNS son públicos y
apuntan a esas `100.x`, que no se rutean desde internet: quien no está en la tailnet
no llega ni al handshake TLS.

Se eligió así sobre basic-auth porque no hay contraseña que rotar ni lista de IPs que
mantener, y porque el modo de falla es el correcto: si Tailscale se cae, pruebas queda
**inalcanzable**, no abierto.

⚠️ **Lo que reabre el agujero es cambiar un `listen` a `0.0.0.0`** «para probar desde
el celular». Adentro hay una copia de producción.

🔴 **Y hay un modo de falla al revés, que casi muerde al montarlo**: escuchar en una IP
que todavía no existe. `ip_nonlocal_bind` estaba en **0** en las dos máquinas y nginx no
declara dependencia de orden con `tailscaled`, así que en un reinicio nginx podía
arrancar primero, fallar el bind y **no levantar** — llevándose la API de producción en
VPS1 y los ~40 sitios de clientes en VPS2. Resuelto con
`/etc/sysctl.d/99-nginx-bind-tailscale.conf` en ambas. Si montás otro vhost sobre la
tailnet, ese sysctl es parte del trato.

⚠️ **nginx de VPS1 es 1.18 y el de VPS2 es 1.29**: `http2 on;` solo existe de 1.25 en
adelante. En VPS1 va como parámetro del `listen`. `nginx -t` lo atrapa, pero solo si lo
corrés antes del reload — y ahí la diferencia es entre no desplegar y tirar el server.

El certificado sale por **DNS-01** (certbot dns-cloudflare, el mismo camino que
`hermes-api.goberna.us`). Tiene que ser DNS-01: el desafío HTTP exige que Let's
Encrypt alcance el puerto 80 desde afuera, y justamente no puede.

## 🔴 Lo que hace peligroso a este entorno es la BASE

No el código: los datos. Pruebas corre sobre una copia de producción, así que los
teléfonos, los correos y las conversaciones de adentro son de gente real y **son
correctos**. Un envío de prueba no falla por número inválido: llega.

Lo único que lo evita es el `.env` de cada mitad. Los inventarios completos, variable
por variable y con el motivo al lado:

- Hermes → `deploy/vps1/env.pruebas.example`
- Cerberus → `ceberusapp/deploy/env.example`

Los que más duelen de cada lado:

**Hermes**
1. `WHATSAPP_TRANSPORTE=falso` — **sin excepción** (ADR 0022). Es el candado principal.
2. `CERBERUS_BASE_URL` al Cerberus de pruebas — si no, las ventas son reales.
3. `SMTP_*` vacías — la vista Correos manda de verdad por SES.
4. `AUTO_RESPUESTA=off` y `BOT_LINEAS` vacío — los dos contestan solos.

**Cerberus**
1. `MOODLE_BASE_URL` vacía — matricular crearía el usuario en el campus real.
2. `SES_SMTP_*` vacías **y** backend de consola — las de SES le ganan a las de Gmail.
3. `ICARUS_CERBERUS_WEBHOOK_ENABLED=False` — es una sola URL y da a la producción de
   un cliente de consultoría. Se apaga; **nunca se re-apunta**.
4. `SESSION_COOKIE_DOMAIN` vacía — con `.goberna.us` la cookie de pruebas pisa la de
   `app.goberna.us` y desloguea vendedoras en producción, sin un solo síntoma.

**La pregunta que hay que hacerse al agregar una variable de entorno nueva** es a cuál
de los tres grupos pertenece (🔴 apagada · 🟡 distinta · ⚪ igual), y anotarla en el
`env.example` que corresponda. Si no, el próximo que monte el entorno no puede saberlo.

## Refrescar los datos

```bash
# Hermes, en VPS1
/srv/hermes-staging/deploy/vps1/refrescar-datos-pruebas.sh            # dry-run
/srv/hermes-staging/deploy/vps1/refrescar-datos-pruebas.sh --aplicar

# Cerberus, en VPS2
/srv/cerberus-pruebas/app/deploy/refrescar-datos.sh --aplicar
```

Los dos son **a pedido, nunca por cron**: un refresco automático pisaría lo que alguien
esté probando.

El de Hermes hace algo que vale la pena entender: restaura el estado de **producción**
y recién después corre las migraciones de `desarrollo` encima. O sea que cada refresco
es también un ensayo de la migración pendiente contra datos reales — que es justo lo
que una base sembrada no puede probar.

## Lo que este entorno NO cubre

- **La app de escritorio no puede apuntar acá.** `URL_PROD` está clavada en
  `src-tauri/src/lib.rs` y no hay override por env: la cáscara instalada siempre
  muestra producción. Pruebas se mira **en el navegador**; para tocar la cáscara,
  `npm run dev:app`.
- **No llegan webhooks de Meta.** Una app de Meta tiene una sola URL de callback y es
  la de producción. Lo que entra por ahí (mensajes de la Cloud API, comentarios de
  FB/IG) no se puede ensayar sin reenviar un payload a mano.
- **WhatsApp no se puede probar de punta a punta**, por definición: el transporte es
  `falso`. Se prueba lo que Hermes hace con un mensaje, no que el mensaje salga.
- **Cerberus no tiene CI de tests** — ni en `main` ni en `desarrollo`. Del lado de
  Cerberus, pruebas es hoy la única red antes de producción, y es manual.
- **Comparten máquina con producción.** Un `npm ci` de pruebas compite por CPU con las
  vendedoras. Es la misma deuda que ADR 0022 ya declaraba.
- **N3 hace `git checkout --force`.** Cualquier cosa editada a mano en
  `/srv/hermes-staging` se pierde en el próximo push, sin aviso. Es un destino de
  despliegue, no un escritorio.

## Montarlo la primera vez

Los dos runbooks están en los repos: `deploy/vps1/` acá (unit, vhost, `.env`, refresco)
y `deploy/` en ceberusapp. El orden que conviene es **Cerberus primero** — Hermes de
pruebas necesita apuntarle a algo.
