# 20 — Ivi v3 en construcción: P0, las fundaciones

> Sesión 2026-07-16 (noche). Ejecuta la fase P0 del plan maestro
> (`docs/19-PLAN-IVI-V3.md`). Código commiteado a main y verificado en local;
> se activa en geógrafo cuando el operador corra `deploy-ivi-geografo.sh`.
> Este doc es el estado de la arquitectura v3 **tal como está quedando**, no
> como se planeó — donde nos desviamos del plan, acá dice por qué.

## La foto grande (dónde estamos parados)

Ivi es el analista BI conversacional de Goberna. La arquitectura tiene una
regla madre que no cambia en v3: **ningún cálculo de negocio en el modelo**.
El pipeline determinista decide QUÉ decir; `ivi-ventas` (qwen3:8b en la RTX
A4000 de geógrafo) solo lo redacta.

```
Usuario (navegador, :8080)
   │  POST /api/chat {message, session}        ← P0.2: session propia por navegador
   ▼
server.py ──► intent_analyzer ─► data_planner ─► data_collector ──► backend Mac :4100
   │                                                │                 (espejo de Cerberus + Meta)
   │                                                └── cache 60s TTL ← ahora con stats (P0.4)
   ▼
kpi_engine ─► analytics ─► insight ─► recommendation ─► impact
   │
   ▼
prompt_builder ──► Ollama (ivi-ventas) ──► response_formatter ──► JSON al navegador
   │
memory.py (follow-ups por sesión)              ← P0.1: thread-safe + tope

Transversal (P0.3/P0.4): systemd `ivi.service` mantiene vivo el proceso;
GET /api/health lo hace observable.
```

La v3 completa (docs/19) apunta a: respuestas frecuentes **ya servidas**
(P1 caché por huella del prompt + P2 warmer en background) y un motor que
**piensa más** (P3 hipótesis/acciones reales, P4 prompts más ricos con los
40K de contexto que el modelo sí soporta). P0 es el piso que evita que esas
fases amplifiquen bugs.

## P0.1 — La memoria conversacional ya no es una carrera

**El problema.** `_SESSIONS` (el dict de sesiones de `ivi/memory.py`) se
mutaba sin lock. Con `OLLAMA_NUM_PARALLEL=4` (desde docs/18) hay 4 requests
reales adentro del proceso a la vez: dos `setdefault` simultáneos podían crear
dos `Session` para el mismo sid (una se perdía con su turno), y el
append+trim de `history` corría sin protección.

**Lo construido.**
- `threading.RLock()` de módulo guardando `get_session` / `remember` /
  `is_followup` / `apply_followup_filters`. Es RLock y no Lock porque
  `apply_followup_filters` llama a `get_session` ya con el lock tomado.
- **Tope `_MAX_SESSIONS = 200`** (esto no estaba en el plan): con P0.2 el sid
  pasa a generarlo el navegador, o sea que es entrada del cliente — sin tope,
  un cliente que rote sids infla el dict sin límite. Al llegar al tope se
  desaloja la sesión más vieja por orden de inserción; esa conversación solo
  pierde sus follow-ups.

**Tests** (`tests/test_memoria_concurrente.py`, 5): 8 threads × 50 turnos
martillando la misma sesión sin explotar y con history ≤ 12; 16 threads
recibiendo UNA sola instancia por sid; sesiones distintas que no se mezclan;
el tope desalojando; el tope NO desalojando cuando el sid ya existe.

## P0.2 — Cada navegador es una conversación

**El problema.** El front nunca mandaba `session`, así que todos los usuarios
eran `sid="default"`: los follow-ups de dos personas se mezclaban ("¿y solo
Lima?" podía acotar el análisis de OTRO).

**Lo construido.** La UI genera un sid persistente en `localStorage` y lo
manda en cada POST. **Desviación del plan**: el one-liner propuesto
(`crypto.randomUUID()`) habría roto el chat en prod, porque `randomUUID` solo
existe en **contextos seguros** (https/localhost) y la UI se sirve por
`http://100.117.204.80:8080`. El fallback no es decorativo:

```js
const SID = localStorage.sid || (localStorage.sid =
  (crypto.randomUUID ? crypto.randomUUID()
   : 'sid-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)));
```

El server endurece la entrada (`data.get("session") or "default"`) y el sid ya
salía en cada línea de log — la evidencia "dos navegadores, dos sids" se lee
directo de `ivi-server.log`.

## P0.3 — El proceso sobrevive: systemd en vez de nohup

**El problema.** El engine corría con `nohup` desde el deploy: un reboot de
geógrafo (o un OOM, o un crash) lo dejaba muerto hasta que un humano se diera
cuenta.

**Lo construido.** `deploy/ivi.service`, instalada por el deploy en
`/etc/systemd/system/`:

| Decisión | Por qué |
|---|---|
| `Restart=on-failure`, `RestartSec=3` | cubre crashes Y `kill -9` (señal = failure para systemd) |
| `After=network-online.target ollama.service` | sin Ollama el engine solo puede contestar 503 |
| `WorkingDirectory=/home/geografo/ia-local` **absoluto** | systemd NO expande `~/ia-local` (el plan lo escribía así; no es válido) |
| `StandardOutput=append:.../ivi-server.log` | conserva la ruta de log que ya conocen el operador y los docs |
| `ExecStart=/usr/bin/python3 -u -m ivi.server` | `-u` sin buffering, para que `tail -f` sirva (mismo motivo que el nohup viejo) |

**El deploy cambió de forma** (`deploy-ivi-geografo.sh`, ahora 9 pasos):
- **Paso 6**: mata los procesos legacy de nohup ANTES de que systemd tome
  `:8080` — filtrando por **cgroup**, no por cmdline (el gotcha del pkill
  suicida de docs/18 sigue vigente: los patrones solo viajan por `bash -s`).
  Después instala la unidad, `daemon-reload`, `enable`, `restart` — todo el
  sudo en UN `ssh -t` (un solo prompt de password).
- **Paso 7 (nuevo)**: **prueba** la resurrección — `kill -9` al MainPID,
  espera, verifica que systemd lo revivió con pid nuevo, y le pega a
  `/api/health`. El criterio de "hecho" del plan, automatizado en el deploy.

## P0.4 — `/api/health`: el probe que hace observables P1 y P2

`GET /api/health` responde:

```json
{"ok": true, "model": "ivi-ventas", "inflight": 0,
 "frescura": {"datos": {"ventas": "datos de ventas hasta el 2026-07-11"},
              "calculada": "2026-07-16T17:22:05"},
 "cache": {"entries": 2, "hits": 0, "misses": 2},
 "uptime_s": 1.2}
```

(JSON real de la verificación local de hoy.)

**La decisión de diseño**: el health es **O(1), sin fetches, sin Ollama**.
Un health que dispara `collect()` tarda 15s cuando el backend está caído —
inservible como probe. En cambio reporta la **última frescura conocida**
(la deja `collect()` en un snapshot de módulo, con timestamp de cuándo se
calculó): antes del primer collect es `{datos: {}, calculada: null}`, honesto,
nunca inventado. Cuando P2 (warmer) corra cada 10 minutos, "última conocida"
va a converger a "actual" solo.

Piezas alrededor:
- `cache.py` ganó contadores `hits`/`misses` + `entries` (y un lock que le
  faltaba: los fetchers del collector lo martillan en paralelo).
- `inflight` reusa el gauge que ya existía para leer cola vs inferencia.
- El access-log **omite** `/api/health`: un monitor cada 30s son ~3K
  líneas/día en un log que systemd solo appendea (pendiente conocido: no hay
  rotación de log — se decide cuando duela).

## Extra que no estaba en el plan: `tests/run.py`

`test_error_honesto.py` estaba escrito para pytest (que no está instalado ni
acá ni en geógrafo): sin bootstrap de `sys.path` ni bloque `__main__`, no
corría solo — el "runner ad-hoc con importlib" que mencionaba docs/19 existía
únicamente en la sesión anterior, nunca se commiteó. Ahora es `tests/run.py`:
la corrida canónica del harness completo, un comando, un total único:

```
python3 goberna-kos/tests/run.py    →    49/49 passed
```

## Verificación (regla dura #2 — evidencia, no promesa)

Local (Mac), server real levantado en puerto de prueba:

1. **Health** → `200` con el contrato completo (JSON de arriba).
2. **Sesión de punta a punta** → `POST {message, session:"sid-prueba-A"}` y el
   log escribe `chat sid=sid-prueba-A FALLO ollama=0.0s ... prompt=7807ch`
   (7.807 chars = prompt armado con datos reales del backend; el FALLO es el
   503 honesto — no hay Ollama en el Mac, y eso es exactamente lo esperado).
3. **Frescura post-collect** → health pasa de `datos:{}` a
   `"ventas": "datos de ventas hasta el 2026-07-11"` con timestamp.
4. **Suite completa** → 49/49 (los 39 previos + 10 nuevos de P0).

Pendiente de prod (lo cierra el operador corriendo el deploy):
- paso 7 en vivo: `kill -9` → pid nuevo + health ok en geógrafo;
- `sid=` distintos en el log desde dos navegadores reales;
- reboot de geógrafo → el engine vuelve solo.

## Lo que viene (docs/19)

| Fase | Qué agrega | Estado |
|---|---|---|
| **P0 fundaciones** | esto | **código listo, falta activar en geógrafo** |
| P1 caché por huella | respuesta = f(pregunta, datos); hash del prompt como clave, sin TTL | siguiente |
| P2 warmer | las 12 frecuentes precalculadas en background → Ivi "instantáneo" | tras P1 |
| P3 motor que piensa | hipótesis y acciones reales, deterministas y testeadas | corte 2 |
| P4 des-resumir | ctx 8K→16K, el modelo ve país×ROAS, mix, 24 meses | corte 3 |
