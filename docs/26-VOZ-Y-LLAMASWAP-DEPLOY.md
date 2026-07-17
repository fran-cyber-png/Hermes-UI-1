# 26 — Deploy de la voz de Ivi + migración a llama-swap (geógrafo)

> Guía operativa para llevar a producción lo que se construyó en esta sesión: el
> loop de voz (Ivi habla y escucha) y la migración de modelos a llama-swap. Todo
> corre en **geógrafo** (100.117.204.80, la A4000). Yo no puedo deployar ahí
> (necesita tu TTY/sudo), así que esto queda listo para que lo corras vos.
> Decisiones de Estephano (2026-07-17): Piper local, llama-swap ya, crédito AWS
> al LLM creativo, voz peruana buena si se puede.

## 0. Estado: DESPLEGADO en geógrafo (2026-07-17) y verificado

- **`think:false`** (commit `6a731ed`): en prod las respuestas bajan de ~14s a
  **~5,5s** (medido). Activo por default; `IVI_THINK=1` lo revierte.
- **Voz VIVA en geógrafo**: `curl localhost:8080/api/health` -> `voz: {tts:piper,
  stt:true}`.
  - **TTS**: Piper `es_MX-claude-high` (CPU, 0 VRAM, RTF ~0,06). `/api/tts` ->
    WAV real. Verificado desde la Mac vía Tailscale.
  - **STT**: faster-whisper `small` int8 en venv (vía PYTHONPATH; el engine sigue
    con el system python3.14). Loop cerrado verificado: la voz de Ivi -> `/api/stt`
    -> "Hola, soy Ivi, Estados Unidos lidera el ROAS con 17,4" en ~4s. El
    `initial_prompt` de `voz.py` arregla los nombres propios ("Ivi", no "Libid").
- **UI de voz** en el prototipo: toggle "Ivi habla" (auto-play del resumen
  hablado) + push-to-talk, gateados por `/api/health`. El prototipo NO está
  servido en geógrafo (es local); para usar el mic en el navegador falta servirlo
  por **https** (getUserMedia, ver §1).
- Reproducible con `deploy/setup-voz-geografo.sh` (refleja los pasos reales).

## 1. Instalar la voz (Piper + faster-whisper)

Corré en geógrafo: `goberna-kos/deploy/setup-voz-geografo.sh` (confirmá las URLs
de release adentro; Piper se movió a OHF-Voice, las voces viven en HF). Después,
en `ivi.service` (systemd) exportá y reiniciá:

```
IVI_PIPER_BIN=/srv/ia-local/piper/piper
IVI_PIPER_VOICE=/srv/ia-local/piper-voices/es_MX-claude-high.onnx
IVI_WHISPER_MODEL=small
IVI_WHISPER_DEVICE=cpu        # o cuda si Flux deja VRAM (whisper small int8 ~1-2GB)
```

Probá: `curl -s localhost:8080/api/health | jq .voz` debe dar `{"tts":"piper","stt":true}`.

**Gotcha del navegador (importante):** el micrófono (`getUserMedia`) solo funciona
en **localhost o https**. El prototipo servido por `http://IP:puerto` NO puede
grabar. En producción hay que servir el estudio por **https** (o por un túnel /
reverse-proxy con TLS). El TTS (que Ivi hable) sí anda por http; el que se corta
sin https es el mic.

## 2. La voz peruana buena (decisión 4)

Piper **no tiene es-PE**. Caminos, de menor a mayor esfuerzo:

1. **Baseline ya**: `es_MX-claude-high` o `es_AR-daniela-high` (el script baja las
   dos). Escuchá y elegí la más neutra para oído peruano. Es lo que anda hoy, 0
   VRAM, gratis.
2. **Voz peruana clonada (recomendado para "que sea buena")**: **XTTS-v2**
   (Coqui) clona una voz desde ~6-30s de muestra limpia. Si grabás una voz
   peruana (tuya o de alguien del equipo, con permiso), XTTS le da a Ivi una
   identidad peruana real. Costo: usa **GPU/VRAM** (compite con Flux/LLM -> entra
   en el time-share del paso 3) y es más pesado que Piper. Buen candidato para el
   experimento con el crédito AWS (g6.xlarge) si no querés cargar la A4000.
3. **Fine-tune de Piper** en datos peruanos: la más "propia" y liviana en runtime
   (sigue siendo CPU/0 VRAM), pero entrenar lleva tiempo y datos. Solo si la
   quieres perfecta y 100% local.

Recomendación: **baseline es_MX ya** para tener el loop andando, y en paralelo
**probar XTTS con una muestra peruana** (decisión tuya sobre de quién es la voz).

## 3. Migración a llama-swap (decisión 2: "llama-swap ya")

Config lista: `goberna-kos/deploy/llama-swap.yaml` (dos roles: `ivi-ventas` BI +
`ivi-creativo`, en un grupo `swap+exclusive` -> un solo LLM en VRAM a la vez).

### 3.1 Pasos en geógrafo

1. Traer/convertir los GGUF: `ivi-ventas` hoy es un modelo Ollama (qwen3:8b +
   Modelfile) -> exportar/convertir su GGUF; elegir el `ivi-creativo` (8-14B local
   para arrancar, o el 32B del experimento cloud, docs/25 §6).
2. Correr llama-swap: `llama-swap --config .../llama-swap.yaml --listen 127.0.0.1:8090`
   (systemd). Expone API OpenAI-compatible.
3. **Mutex con Flux**: llama-swap no ve a ComfyUI/Flux. Poné un lock externo
   (p.ej. un `flock` sobre `/srv/ia-local/gpu.lock` que tomen tanto el arranque de
   Flux como el engine antes de invocar al LLM) para que no colisionen en VRAM.
   Serializar, no concurrir (docs/25 §3.1).

### 3.2 El cambio en el engine (a hacer y TESTEAR en geógrafo)

Hoy `server.py::call_ollama` habla con Ollama (`/api/generate`). Para llama-swap,
el único seam a cambiar es esa función, hacia el endpoint OpenAI-compatible. Lo
dejo escrito acá para hacerlo **con** el box (no lo mergeo sin poder verificarlo):

```python
# Backend configurable: IVI_LLM_BACKEND=ollama (default, actual) | openai (llama-swap)
def call_llm(prompt: str) -> str:
    if LLM_BACKEND == "openai":
        # llama-swap: OpenAI /v1/chat/completions. qwen3 sin thinking = /no_think.
        p = ("/no_think\n" + prompt) if not OLLAMA_THINK else prompt
        payload = json.dumps({"model": LLM_MODEL,
            "messages": [{"role": "user", "content": p}],
            "stream": False, "temperature": OLLAMA_TEMP}).encode()
        req = urllib.request.Request(LLAMASWAP_URL, data=payload,
            headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=OLLAMA_TIMEOUT) as r:
            return json.loads(r.read())["choices"][0]["message"]["content"]
    return _call_ollama(prompt)   # el actual, sin cambios
```

Plan seguro: `IVI_LLM_BACKEND=ollama` sigue siendo el default (probado); levantás
llama-swap, apuntás `IVI_LLAMASWAP_URL=http://127.0.0.1:8090/v1/chat/completions`,
flipeás a `openai` y verificás una respuesta anclada (Ley I) + latencia. Reversible.

## 4. Orden sugerido

1. Deploy de lo ya hecho (`think:false` + endpoints) con `deploy-ivi-geografo.sh`.
2. `setup-voz-geografo.sh` + env de voz -> `/api/health.voz` verde. Servir el
   estudio por https para habilitar el mic.
3. Baseline de voz es_MX andando; probar XTTS peruana en paralelo.
4. llama-swap: modelos + config + mutex Flux; migrar el gateway (3.2) y testear.
5. Iterar: Fase C real (el modelo creativo interpretando texto libre -> Brief),
   resumen hablado desde el modelo (campo `resumen_hablado`, docs/25 §2.4).
