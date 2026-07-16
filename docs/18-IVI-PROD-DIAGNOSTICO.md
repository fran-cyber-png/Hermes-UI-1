# Ivi en prod: por qué "no respondía", y qué se arregla

> Sesión 2026-07-16. Todo lo de acá está **medido contra geógrafo en vivo**
> (100.117.204.80), no estimado. Continúa de docs/17 (mapa del pipeline).
> El deploy lo activa el **operador** — el agente no tiene permiso.

## TL;DR

El modelo nunca estuvo caído. `ivi-ventas` (qwen3:8b) estaba cargado y respondía
bien. Lo que fallaba era la **cola**: Ollama estaba configurado para atender una
request por vez, así que a partir del 5º usuario simultáneo la espera cruzaba el
timeout de 120s y el usuario veía `Error al llamar a Ollama: timed out`.

Buscando eso apareció algo peor: **prod servía código viejo** y le decía a todo
el mundo que las ventas caían 54% cuando en realidad subían 28%.

## 1. El bug caro: prod comparaba peras con manzanas

`impact_engine.py` en geógrafo **no tenía** el guard de "mismos días" que sí está
en el repo (`impact_engine.py:48-58`). El deploy fue el 2026-07-15 18:43; el fix
es posterior y nunca se subió.

Misma pregunta, mismo backend, mismo instante:

| | Local (repo actual) | Prod (geógrafo) |
|---|---|---|
| Compara | jun **días 1-11** (121 ventas) vs jul días 1-11 (155) | jun **completo** (339) vs jul parcial (155) |
| Dice | **+28,1%**, momentum sube | **-54,3%**, riesgo `[crit]`, "contener la caída" |

Es la misma clase de bug de docs/16 (full-vs-parcial) reapareciendo en un archivo
hermano que no recibió el mismo parche. `prompt_builder._fmt_target_month()` sí lo
tenía desplegado — por eso la sección "MES SOLICITADO" salía bien y el error pasó
desapercibido: **una parte del prompt decía la verdad y la otra mentía**.

Lección: el fix se aplicó donde se encontró el síntoma, no en todos los lugares
que hacen la misma cuenta. El smoke test del paso 7 del deploy ahora falla ruidoso
si el impacto no dice "mismos días".

## 2. La causa del "no responde": la cola, no el modelo

Cadena completa, toda verificada:

1. `OLLAMA_NUM_PARALLEL=1` (en `/etc/systemd/system/ollama.service.d/tuning.conf`)
   → Ollama atendía **una** request por vez y encolaba el resto.
2. `handle_chat` es sincrónico y `ThreadingTCPServer` acepta N conexiones → los N
   threads quedaban todos encolados contra el mismo Ollama.
3. Cada inferencia cuesta ~25s → el usuario N esperaba ≈ 25×(N-1) segundos.
4. `call_ollama` tenía `timeout=120` → el 5º cruzaba el techo y moría.

Medido (5 requests concurrentes, misma pregunta):

```
req4 -> 200 en  25,9s
req1 -> 200 en  50,6s
req3 -> 200 en  76,7s
req5 -> 200 en 103,7s
req2 -> 200 en 120,4s  ← "Error al llamar a Ollama: timed out"
```

El escalón de ~25s es la firma de la serialización.

**Descartado**: el arranque en frío. `OLLAMA_KEEP_ALIVE=5m` descargaba el modelo,
pero medí la recarga y cuesta ~2s (30,2s en frío vs 28s en tibio). No era eso.

## 3. El fallo se disfrazaba de éxito

La request que murió devolvió **HTTP 200**, con el texto del error dentro de
`response` y seguido de un "## Impacto Económico" a medias (`format_response`
arma las secciones igual). Ningún monitoreo por status code podía verlo.

Ahora: `OllamaError` → **503**; error inesperado → **500**. El payload conserva
`response` legible (el front hace `data.response.replace(...)` y reventaría sin
él) y marca `live: false` — un fallo no puede afirmar que trae datos en vivo.
Cubierto por `tests/test_error_honesto.py`.

## 4. Cero observabilidad

`ivi-server.log` estaba en **0 bytes** incluso después de requests reales:
`Handler.log_message` era `pass` (silenciaba el access log) y no había ni un
print en el request path. No hay systemd ni journald — es un `nohup` plano.

Ahora cada request loguea intents, endpoints, tamaño del prompt, **inflight**
(cuántas requests hay adentro — lo que delata la cola), y los tiempos partidos
entre `collect` y `ollama`:

```
2026-07-16T16:27:27 INFO Ivi Analytical Engine en http://0.0.0.0:8080 — modelo=ivi-ventas ctx=8192 timeout=300s
2026-07-16T16:27:31 ERROR chat sid=default FALLO ollama=0.0s inflight=1 prompt=7807ch — URLError: Connection refused
```

El deploy arranca con `python3 -u` para que el log salga línea a línea.

## 5. Un solo modelo: `ivi-ventas`

Había dos servicios con modelos distintos peleando la VRAM, y
`OLLAMA_MAX_LOADED_MODELS=1` sólo permite uno cargado: cada uso de voz-ivi
expulsaba `ivi-ventas` y viceversa.

| Modelo | Peso | Quién lo usaba | Decisión |
|---|---|---|---|
| `ivi-ventas` | 5,2 GB | Ivi ventas (:8080) — el producto | **el único** |
| `qwen3:8b` | 5,2 GB | base de ivi-ventas (`FROM qwen3:8b`) | **se queda** |
| `qwen3:14b` | 9,3 GB | sólo voz-ivi (Apolo) | se borra |
| `qwen2.5:7b` | 4,7 GB | sólo `Modelfile.ivivoz` (voz viejo) | se borra |
| `bge-m3` | 1,2 GB | nadie (sólo un comentario "después se podría") | se borra |

`qwen3:8b` **no se toca**: es el `FROM` de `Modelfile.ventas`, sin él el
`ollama create` del deploy no puede reconstruir `ivi-ventas`. Los otros tres se
recuperan con `ollama pull` si alguna vez hacen falta.

**voz-ivi (Apolo) se apaga.** Fuera de alcance hoy: el foco es Goberna Escuela —
ventas y Meta. Sus archivos no se borran; corre en nohup sin systemd, así que no
vuelve solo tras un reboot. Para revivirlo: `cd ~/ia-local/voz-ivi && nohup
python3 server.py &` — y ahí habría que repensar el modelo único.

Elegí el 8B sobre el 14B a propósito: **la latencia ES el problema** y el 14B
genera ~2× más lento (llevaría los 25s a ~40s y engordaría la cola que queremos
matar). Además el pipeline resuelve el 100% del análisis — el modelo sólo
redacta, y el 8B redacta bien (verificado). Y verifiqué que `ivi-ventas` conserva
`Capabilities: completion, tools, thinking`, así que no se pierde tool calling.

## 6. Config nueva de Ollama

`goberna-kos/deploy/ollama-tuning.conf` → `/etc/systemd/system/ollama.service.d/tuning.conf`

| Variable | Antes | Ahora | Por qué |
|---|---|---|---|
| `OLLAMA_NUM_PARALLEL` | 1 | **4** | mata la cola; 4 slots ≈ 7,5 GB de 16 GB |
| `OLLAMA_KEEP_ALIVE` | 5m | **24h** | con un solo modelo no hay con qué competir |
| `OLLAMA_MAX_LOADED_MODELS` | 1 | **1** | se mantiene: ahora *refuerza* el modelo único |

Cuentas de VRAM (A4000, 16 GB): pesos 5,2 GB compartidos entre slots + ~0,6 GB de
KV cache por slot (`num_ctx=8192`, KV en `q8_0` que ya estaba activo) →
5,7 + 3×0,6 ≈ **7,5 GB**, con ~8,5 GB de margen. El paso 8 del deploy lo mide.

## 7. Runbook del operador

```bash
# desde la raíz del repo (meta-escuela/meta-escuela)
bash goberna-kos/deploy-ivi-geografo.sh
# o, si ya estás dentro de goberna-kos/
bash deploy-ivi-geografo.sh
```

Pide `sudo` en geógrafo (paso 4, systemd) — hay que correrlo con una TTY real. Los 8 pasos: sync del engine →
recrear modelo → apagar voz-ivi → tuning de Ollama → limpiar modelos → levantar
server → **smoke test que falla si el fix de "mismos días" no está vivo** →
prueba de concurrencia + VRAM.

Verificación después:

```bash
ssh ia tail -f ia-local/ivi-server.log   # ahora sí escribe
curl -s -X POST http://100.117.204.80:8080/api/chat \
  -H 'Content-Type: application/json' -d '{"message":"ventas de este mes"}' | head -c 300
```

Lo que hay que ver en el paso 8: las 4 requests terminando en una ventana
parecida (no el escalón 25/50/75/100s). Si el escalón sigue, el `tuning.conf` no
se aplicó — revisar `systemctl show ollama --property=Environment`.

## 8. Lo que queda abierto

- **`ivi.server` sigue en `nohup`**, sin systemd: no sobrevive un reboot de
  geógrafo. Vale una unidad systemd (ya venía anotado en docs/16).
- **`_SESSIONS` es un dict global sin lock** (`memory.py:30`) mutado desde varios
  threads, y el front **no manda `session`** (`server.py`, el JS embebido) → todas
  las conversaciones comparten `sid="default"`. Con NUM_PARALLEL=4 ahora sí puede
  haber 4 requests reales a la vez pisando la misma `Session.last`. No es el bug
  de hoy, pero la ventana se agrandó.
- **`_FOLLOWUP` (`memory.py:47`) es código muerto**: `is_followup()` nunca lo usa.
- **`"como_vamos"`** casi no dispara el intent `rendimiento` (docs/17, parada 2).
