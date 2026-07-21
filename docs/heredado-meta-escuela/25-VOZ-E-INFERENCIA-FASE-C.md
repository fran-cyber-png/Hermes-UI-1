# 25 — Voz e inferencia: el plan de la Fase C (y la capa de voz)

> Plan de diseño. Nace del pedido de Estephano (2026-07-17), después de cerrar la
> Fase B (el chat del estudio ya habla con el motor Ivi real, commits `a5bd8b1` y
> `979bca9`): "quiero poder **hablar** con Ivi" (voz) y "con llama-swap y buen
> gestionamiento podemos convivir con Flux; tengo USD 100 de AWS para probar otra
> GPU, hay que planearlo bien". Este doc planea **dos capas**: (A) la **voz**
> (hablar y que Ivi conteste hablando) y (B) la **inferencia de la Fase C** (el
> modelo que interpreta texto libre y redacta copy con matiz). No es código: es
> arquitectura y decisiones, anclada en research verificado (37 agentes) y con la
> Ley I aplicada también al plan (las cifras sin verificar se marcan como tales).

## 0. Nota de honestidad sobre los datos (Ley I del plan)

Las cifras de abajo salen de un research con verificación adversarial. Marco
`[VERIFICADO]` lo confirmado contra fuente primaria, y dejo fuera o señalo lo que
quedó sin verificar o refutado. Los huecos conocidos:

- **Precios de GPU cloud (AWS EC2 G/P)**: on-demand corroborado por dos trackers
  independientes (Vantage + DoiT) que replican el tarifario de AWS us-east-1; la
  página oficial es JS-rendered y no se pudo scrapear directo. El **spot es
  dinámico** (snapshot de hoy, rango orientativo, no precio garantizado). Ver §6.
- **AWS Transcribe**: precio en conflicto entre fuentes (USD 0,01 vs 0,024/min),
  sin resolver. No pesa: para STT recomendamos local igual (Ley I).
- **Derivaciones "USD 100 = X caracteres / horas"**: cálculos propios no
  verificados. Se citan como orden de magnitud, no como hecho.
- **WER español de Whisper (~4-6%)**: fuente secundaria, sin verificar.

## 1. El hallazgo que reencuadra todo

Veníamos juntando "voz" con "presión de VRAM en la A4000". El research lo separa:

**La voz es barata en VRAM. El cuello real es Flux + el LLM, y el thinking de qwen3.**

- El **TTS local (Piper)** corre en **CPU, 0 GB de VRAM** `[VERIFICADO]` — los
  modelos son tan chicos que van más rápido en CPU que en GPU.
- El **STT (faster-whisper `small` int8)** pesa **~1-2 GB** `[VERIFICADO]` y solo
  se usa en ráfagas (cuando hablás), o **0 VRAM** en CPU con `whisper.cpp`.
- Lo que de verdad tarda ~14s por respuesta **no es solo `stream:false`**: qwen3
  **razona (thinking) antes de emitir contenido**, y ese reasoning domina el
  tiempo. El desbloqueo es **`think:false`**, no (solo) streamear.

O sea: se puede "hablar con Ivi" **sobre la Fase B ya construida, sin tocar el
presupuesto de VRAM ni la nube**. La pelea Flux vs LLM es un problema aparte, de
la Fase C, no de la voz.

## 2. Capa VOZ

### 2.1 Escuchar (STT): faster-whisper local, push-to-talk

- **Motor**: `faster-whisper small` en **int8**, warm-loaded server-side (~1-2 GB
  `[VERIFICADO]`). El navegador solo **graba** (MediaRecorder + corte por
  silencio) y sube el audio; el engine transcribe. Whisper **no es streaming
  nativo**: el patrón es **push-to-talk / corte por silencio + transcripción
  one-shot**, que además elimina eco y barge-in de un plumazo en la v1.
- **Upgrade si el acento peruano falla**: `large-v3-turbo` int8 (~1,5 GB
  `[VERIFICADO]`) antes que el `large-v3` completo (~10 GB). Alternativa 0 VRAM:
  `whisper.cpp small` en CPU (~852 MB RAM `[VERIFICADO]`).
- **NO usar Web Speech API del navegador**: en Chrome manda el audio a Google
  (viola la Ley I / privacidad), tope de 60s, y no anda en Firefox.

### 2.2 Hablar (TTS): dónde brilla Polly y dónde manda Piper

Acá está el matiz honesto. **Polly tiene la mejor voz, pero manda el texto a AWS
us-east-1** (no hay región Neural en Sudamérica ni voz peruana). Como las
respuestas de Ivi llevan **datos de negocio**, decirlas por Polly saca esos datos
del on-prem. Piper es local, privado y 0 VRAM, con voz "buena, no premium".

La reconciliación no es elegir una: es **ponerlas donde cada una gana**.

| Uso | Contenido | Recomendación | Por qué |
|---|---|---|---|
| **Locución del creativo** (la voz del anuncio que produce el estudio) | Público | **Polly Neural** | Es contenido que va a salir publicado; sin PII. La calidad importa y el free tier alcanza. |
| **"Hablar con Ivi"** (preguntar y que conteste sobre tus datos) | Privado (P&L, ventas) | **Piper local** (default Ley I) | El audio con datos de negocio nunca sale de geógrafo; 0 VRAM. |

Para un tool interno de un solo usuario (vos), usar Polly **también** para la voz
del análisis es una decisión de negocio válida si aceptás que el dato viaje a AWS
— el free tier lo cubre a USD 0. Pero el default correcto por Ley I es Piper para
lo privado.

**Precios de Polly `[VERIFICADO]` (por millón de caracteres):**

| Motor | USD / 1M car | Free tier (primeros 12 meses) |
|---|---|---|
| Standard | 4 | 5M car/mes (capa legacy) |
| **Neural** | **16** | **1M car/mes** |
| Long-Form | 100 | (sin voz en español) |
| Generative | 30 | 100K car/mes |

- **Voz de marca para Ivi**: fijar la tripleta `VoiceId+Engine+LanguageCode`
  (p.ej. **Lupe** es-US o **Mía** es-MX, `neural`) y usar léxicos (`PutLexicon`)
  para "Goberna", "Ivi" y nombres peruanos. Neural es determinista (misma entrada
  → mismo audio); Generative suena más humano pero **puede derivar** entre
  versiones del modelo (malo para una identidad estable).
- **Gotcha boto3**: el **streaming bidireccional de baja latencia de Polly NO
  está en Python/boto3** (solo Java/JS/Go/etc.); desde Python solo tenés el
  `AudioStream` de `SynthesizeSpeech` (request-response). No es bloqueante para
  el patrón de abajo, pero cierra esa optimización puntual.
- **Opción intermedia**: **Kokoro-82M** (local, <1 GB, RTF ~0,03 en GPU
  `[VERIFICADO]`, soporta español) — más natural que Piper, más pesado; a evaluar
  si Piper se queda corto y no querés mandar a la nube.

### 2.3 El patrón responsivo (que se sienta vivo sobre el motor lento)

```
push-to-talk → faster-whisper small (one-shot) → texto
   → Ollama stream:true + think:false          ← el desbloqueo real de los ~14s
   → sentence-chunking (flush en . ? ! ; y saltos)
   → Piper (CPU) por frase → cola Web Audio (AudioBufferSourceNode secuencial)
   → clip de relleno pregrabado ("dame un segundo...") tapa la 1ª ventana
```

- **`think:false` primero**: sin eso, el thinking de qwen3 domina y streamear no
  destraba la primera palabra.
- **Barge-in** (interrumpir a Ivi hablando) y cancelación de eco: **v2**, no v1
  (push-to-talk los evita). Presupuesto verificado para cuando toque:
  fin-de-habla → flush TTS **<150ms** `[VERIFICADO]`.
- **Costo del VAD por silencio**: un timeout de 800ms agrega **~1s** por
  respuesta `[VERIFICADO]`. Tenerlo en cuenta en la sensación de latencia.
- Nota de fidelidad: las cifras de "time-to-first-audio 1,25s" y "look-ahead 25
  car / 64 tokens" que circulaban **fueron refutadas** (no están en fuentes
  primarias). Medir en geógrafo, no citarlas como objetivo.

### 2.4 El resumen hablado (las tablas no se leen)

El motor devuelve Markdown con `##` y tablas, que no se dicen en voz. La solución:
**separar la pista visual de la hablada**. Pedirle al modelo un campo
`resumen_hablado` de 2-3 frases, con los números **en palabras** y las tablas
resumidas en prosa. El texto/tabla se muestra; el `resumen_hablado` se sintetiza.
La Ley I sigue igual: los números salen del motor, el modelo solo los verbaliza.

## 3. Capa INFERENCIA (Fase C): el modelo que interpreta y redacta

Esta es la capa que hace real el "deduce y adapta" del plan (docs/24 §8 Fase C):
lo que escribís en cualquier paso o en el chat lo **parsea un modelo** y devuelve
**actualizaciones estructuradas del Brief**, con la barrera de honestidad
determinista intacta.

### 3.1 El problema de VRAM (el "gestionamiento" que mencionaste)

En 16 GB **no caben simultáneos** Flux + dos roles de LLM + voz. Hechos:

- **Flux.1 [dev] FP8**: ~12 GB de pesos, **pico de pipeline ~16-17 GB**
  `[VERIFICADO]`.
- **qwen3:8b Q4_K_M**: **~5,03 GB** de pesos (corregido; no 4,6-4,9) `[VERIFICADO]`
  + KV cache (~0,3 GB @2K ... ~5 GB @32K de contexto `[VERIFICADO]`).
- La penalidad de correr Flux con offload (`--lowvram`/sequential) es **~5-10x
  más lento** (corregido; el "20-30%" que decían las guías **fue refutado** —
  aplica solo a offload liviano por bloques) `[VERIFICADO]`.

Conclusión: **la A4000 es un recurso time-shared, no concurrente.** La voz sale
de la ecuación (Piper en CPU, whisper en ráfaga). El nudo es Flux + LLM.

### 3.2 Gestión de modelos: Ollama para el MVP, llama-swap si hace falta

- **MVP (recomendado para arrancar Fase C)**: quedarse en **Ollama** con
  `OLLAMA_MAX_LOADED_MODELS=1` + `keep_alive` corto y contexto acotado (2K-8K),
  de modo que los **dos roles** (BI `ivi-ventas` + creativo/parsing) se
  **excluyen mutuamente** en VRAM. Menos piezas nuevas, ya lo tenemos.
- **llama-swap** (`groups` con `swap:true`) solo si necesitás **tuning por rol**
  (distintos parámetros/contexto por modelo) o **mezclar backends**. Es la
  herramienta correcta para intercambiar GGUF en/out, pero suma configuración.
- **Flux es el problema que ninguna de las dos resuelve**: es un proceso
  (ComfyUI) **invisible** para Ollama/llama-swap. Hace falta un **mutex/cola
  externo** entre "generar imagen" y "correr el LLM" para que no colisionen. No
  perseguir concurrencia Flux+LLM en 16 GB: **serializar**.

### 3.3 El modelo creativo: local vs cloud (el fork de los USD 100)

El copy de un curso **no lleva PII sensible** (no es el P&L), así que el creativo
es el único lugar donde la nube es defendible por privacidad. Las opciones:

- **Local en la A4000**: cero costo recurrente, privado, pero techo de calidad de
  un ~8B local y peleando la VRAM con Flux (time-share).
- **GPU cloud (el crédito de USD 100 como experimento acotado)**: probar un
  modelo más grande/mejor para el creativo y medir si el salto justifica
  costo/latencia. *(Tabla de precios EC2 en la §6.)*

El replanteo clave: **para la voz, el crédito NO conviene en GPU** (el TTS cabe
en el free tier de Polly). Si se usa el crédito, es **para el LLM creativo**, no
para la voz.

### 3.4 La Ley I no se mueve

El modelo de Fase C **redacta y propone**; **los números siguen saliendo del
motor determinista**. La barrera de honestidad (la que ya frena "#1 de LATAM" en
la Fase B) es obligatoria en todo lo que el modelo genere. El `contexto` del
creativo (que ya cableamos en la Fase B) es el gancho por donde la Fase C le pasa
el Brief al modelo.

## 4. El corte más chico: "hablar con Ivi" sobre la Fase B ya hecha

Lo mínimo para un loop de voz, **sin nube y sin tocar el presupuesto de VRAM**:

1. **`think:false` + `stream:true`** en el engine (consumir `message.content`).
   Es el cambio de mayor palanca: destraba la latencia percibida.
2. **Piper (CPU)** para que Ivi hable + **faster-whisper small** para escuchar.
3. **Push-to-talk** en el drawer de la Fase B (un botón de micrófono), sin
   barge-in ni eco todavía.

Eso ya es "hablar con Ivi" encima de lo construido. Polly y el LLM creativo son
mejoras posteriores, no requisitos del primer loop.

## 5. Secuencia sugerida

1. **V1 voz local** (corte de §4): think:false + stream en el engine, Piper +
   whisper small, push-to-talk. Todo local, de-risquea la experiencia de voz.
2. **Fase C inferencia**: modelo creativo (Ollama MAX_LOADED=1, mutex con Flux)
   que interpreta texto libre → updates del Brief, con barrera determinista.
3. **Polly** para la locución del creativo final (público) y demos.
4. **Experimento cloud** (si el local se queda corto): con los USD 100, medir un
   modelo creativo mejor en GPU cloud (requiere §6).

## 6. GPU cloud con los USD 100

Precios us-east-1, Linux, por hora. **On-demand corroborado por dos trackers
independientes** (Vantage + DoiT) que replican el tarifario público de AWS
`[VERIFICADO x2]`; la página oficial es JS-rendered y no se pudo scrapear directo.
El **spot es dinámico** (cambia por AZ y hora): las cifras son el punto vivo de
hoy, rango orientativo, no precio garantizado. Los tamaños de modelo son
estimación técnica (pesos GGUF + KV cache), no dato de AWS.

| Instancia | GPU (VRAM) | OD USD/h | Spot USD/h | Horas por USD 100 (OD / spot) | Modelo que entra |
|---|---|---|---|---|---|
| g4dn.xlarge | T4 16 GB | 0,526 | ~0,24 | ~190 / ~400-420 | 14B Q4 (igual que tu A4000) |
| g5.xlarge | A10G 24 GB | 1,006 | ~0,47-0,60 | ~99 / ~170-210 | 32B Q4, o 14B Q8 |
| **g6.xlarge** | **L4 24 GB** | **0,805** | **~0,46-0,57** | **~124 / ~175-215** | **32B Q4** (mejor USD/VRAM) |
| g6e.xlarge | L40S 48 GB | 1,861 | ~1,57-1,76 | ~54 / ~57-64 | 70B/72B Q4, o 32B Q8 |

**Lectura:**

- **g4dn (T4) no aporta nada sobre la A4000**: misma VRAM (16 GB), mismo techo
  (~14B Q4), y la T4 es más vieja (Turing, sin bf16) que tu Ampere. Ir a la nube
  para igualar la VRAM local es gastar el crédito de lado. Se va a la nube para
  **saltar de VRAM**, no para empatarla.
- **El experimento que vale el crédito: 24 GB para un 32B.** g6.xlarge (L4) en
  **spot ~USD 0,5/h** compra **~175-215 h** de un Qwen2.5/3-**32B Q4** — el salto
  real de calidad de copy vs tu 8B/14B local, con horas de sobra para iterar. Es
  el mejor USD/VRAM de 24 GB. Spot es ideal acá: es una sesión interactiva, no un
  servicio; si te cae la instancia (aviso de 2 min) reenganchás.
- **Una tajada chica para g6e (L40S 48 GB)** como control del extremo superior:
  ~USD 1,6/h spot = ~57-64 h; gastá 4-6 h probando si un **70B Q4** escribe
  notablemente mejor que el 32B. Si no despega, te quedás en 24 GB con la
  respuesta.
- **Ojo: la opción más barata por dólar quizá no sea una GPU.** Como el copy es
  **no sensible** (sin PII), una **API por token** (Bedrock u otro modelo grande
  hospedado) evita alquilar/operar la GPU: pagás lo que generás, sin horas idle
  ni bajar 20-40 GB de pesos. USD 100 en tokens de un modelo fuerte es muchísimo
  copy. La GPU cloud gana solo si querés **tus pesos y control total del estilo**.

**Cierre pragmático:** local (A4000) para producir a diario, **g6.xlarge spot**
para el experimento del 32B, y una **API por token** como comparación de
referencia. El crédito se usa en el 32B/70B, nunca en la voz (Polly free tier).

## 7. Decisiones abiertas para Estephano

1. **TTS de la voz del análisis privado**: ¿Piper local (Ley I, 0 VRAM, voz
   buena) o Polly (mejor voz, dato a AWS, free tier)? Recomiendo Piper para lo
   privado y Polly para la locución del creativo público.
2. **Gestión de modelos Fase C**: ¿arrancar en Ollama con exclusión mutua (MVP) o
   ir directo a llama-swap? Recomiendo Ollama primero.
3. **El crédito AWS**: ¿reservarlo para el LLM creativo cloud (recomendado) o
   gastarlo en Polly? (Polly casi no lo toca por el free tier.)
4. **Voz peruana**: Polly no tiene es-PE; ¿alcanza Lupe (es-US) / Mía (es-MX), o
   es un requisito que empuja a TTS local con voz fine-tuneable?
