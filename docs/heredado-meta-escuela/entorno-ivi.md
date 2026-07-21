# Conectar la matriz a Ivi

Un solo comando para levantar el proyecto entero: `ivi matriz`.

Ivi abre la sesión de tmux, arranca Postgres, el API y el front en el orden correcto, y te
abre el navegador cuando la pantalla responde. Si algo ya está corriendo, no lo duplica.

---

## 1. La línea que hay que pegar

En `~/.config/ivi/entornos.conf`, al final:

```
matriz | meta-escuela,la-matriz,ontologia,ontología,goberna-matriz | ~/goberna/meta-escuela/meta-escuela | http://localhost:5173 | api:4100=docker compose up -d --wait && cd server && npm run dev ;; web:5173=npm run dev
```

Y listo:

```fish
ivi matriz              # abre todo
ivi la matriz           # los alias entienden lenguaje natural
ivi ontologia           # esto también
ivi -v matriz           # en una ventana nueva de Ghostty
ivi matar matriz        # cierra la sesión
```

---

## 2. Qué levanta, y en qué orden

Son **tres piezas**, y el orden no es negociable: si el API arranca antes que Postgres, revienta.

| Pieza | Puerto | Qué es |
|---|---|---|
| **Postgres** | `5434` | El contenedor `meta_escuela_db`. Todo vive acá: el espejo crudo de Cerberus, la capa canónica, el grafo de identidad, el lazo. |
| **API** | `4100` | Express + Drizzle. El BFF (`/api/overview`) y los análisis. |
| **Front** | `5173` | Vite + React. Es la URL que Ivi abre en el navegador. |

### Por qué `docker compose up -d --wait` y no `up -d` a secas

`up -d` vuelve cuando el **contenedor arranca**, no cuando **Postgres acepta conexiones**. Son cosas
distintas: hay ~6 segundos entre una y otra en frío. El API sale corriendo, no encuentra la base y
se muere — y en `tsx watch` eso se ve como un log rojo que aparece y desaparece.

El `docker-compose.yml` tiene un `healthcheck` (`pg_isready`) justamente para esto, y `--wait` lo
respeta: bloquea hasta que la base está **sana**, no hasta que está **encendida**.

```
docker compose up -d --wait   →  5,8s en frío, 0,3s si ya estaba arriba
```

### Por qué el puerto 5434 y no el 5432

El **5433 ya lo usa `goberna_escuela_db`** (el LMS). Si los dos proyectos pelean por el mismo puerto,
uno de los dos se conecta a la base equivocada — y eso no falla, que es lo peor que puede pasar.

---

## 3. Lo que Ivi NO levanta (y vas a necesitar)

Ivi arranca los servidores. Los datos entran con estos comandos, a mano, desde `server/`:

```fish
# El espejo crudo de Cerberus. Ingiere el dump Y reproyecta la capa canónica y el grafo.
npm run cerberus:ingestar -- ~/ruta/al/dump.sql

# SOLO rehace la capa canónica y el grafo, sin releer el dump.
npm run cerberus:proyectar

# El lazo: qué ventas se le pueden contar a Meta, y por qué las demás no.
npm run lazo -- --simular      # evalúa y guarda, SIN mandarle nada a Meta
npm run lazo                    # manda de verdad
```

### Cuándo correr `cerberus:proyectar`

La capa canónica (`ontologia.venta`, `cliente`, `pago`, `cuota`, `producto`) es **derivada**: se
calcula desde el espejo crudo. Cuando cambia la **semántica del negocio** —una tasa de cambio nueva,
un estado que pasa a contar como cobrado, un bug de conversión que se arregla— hay que rehacerla, y
el dump no cambió. Volver a ingerir 100 MB de SQL para eso es absurdo.

Corre en **una sola transacción**: si algo falla, la capa vieja sigue en pie. Un dato de hace una
hora es infinitamente mejor que un cero que parece un dato.

---

## 4. El `.env`

Vive en `server/.env` (nunca se commitea). Lo mínimo para que arranque:

```sh
PORT=4100
DATABASE_URL=postgresql://meta_escuela:meta_escuela_dev@127.0.0.1:5434/meta_escuela
META_ACCESS_TOKEN=          # system user token de Meta. Sin esto no hay pauta ni creativos.
```

Y los tres interruptores que importan:

| Variable | Default | Qué hace |
|---|---|---|
| `DECISIONES_MODO` | `simulacion` | En `simulacion` **nada se escribe en Meta**. Para ejecutar de verdad hay que poner `ejecucion` **en el .env** — a propósito no alcanza con tocar un botón en la pantalla. |
| `META_TEST_EVENT_CODE` | *(vacío)* | Si está seteado, **todo el lazo** va a la pestaña Test Events de Events Manager y no afecta la optimización de los anuncios. Es el modo con el que hay que probar primero, **siempre**. Sin ese código, cada evento es real y entra al modelo de Meta. |
| `PAUTA_RELOJ` | *(encendido)* | `off` apaga el job que va a buscar el snapshot de pauta a Meta. Útil para trabajar sin gastar llamadas a la Graph API. |

---

## 5. Trampas que ya me comí

**Un servidor viejo escuchando en el 4100.** Ivi no relanza un puerto que ya está ocupado — es su
gracia, evita duplicados. Pero si quedó una instancia de una sesión anterior, está corriendo el
**código viejo**, y vas a estar mirando resultados de hace tres commits sin darte cuenta. Cuando algo
no cambie después de tocar el backend, esto es lo primero que hay que descartar:

```fish
lsof -ti:4100 -sTCP:LISTEN | xargs -r kill
```

**El `-sTCP:LISTEN` no es opcional.** Sin esa bandera, `lsof -ti:4100` devuelve *todo lo que toca ese
puerto* — incluido **el navegador**, que tiene una conexión abierta contra el API. O sea: `lsof -ti:4100
| xargs kill` te cierra Zen. (Sí, me pasó mientras escribía este documento.) Lo mismo vale para
verificar: si contás procesos sin filtrar por `LISTEN`, vas a "descubrir" duplicados que no existen.

**Un vite fantasma en el 5173.** Lo mismo, pero peor: el HMR puede dejar un estado intermedio roto y
la consola te tira errores de código que ya no existe — errores de líneas que borraste. Mismo
remedio, con `:5173`.

**El API es el 4100.** Si ves `000` en un `curl`, empezá por ahí antes de buscar un bug.

---

## 6. Los comandos del día a día

```fish
cd ~/goberna/meta-escuela/meta-escuela

npm run dev              # front (5173)
cd server && npm run dev # api (4100)

cd server && npm test    # 141 tests. Corren sin base: son puros.
npx tsc --noEmit         # el server
npx tsc --noEmit -p tsconfig.app.json   # el front (desde la raíz)
```

Los tests **no necesitan Postgres**: todo lo que toca la base está detrás de una función pura que se
testea con datos armados a mano. Eso es a propósito — un test que necesita una base es un test que
alguien va a saltear.
