# Flux → catálogo → lazo: el circuito de la pieza visual

> **La tesis**: no se trata de «meter Flux en Hermes». Se trata de cerrar un circuito de tres tramos
> —**Studio produce · el catálogo versiona · el lazo mide**— del que **dos ya existen** y nadie
> conectó. Fecha: **2026-07-28**. Depende de [`dos-planos.md`](dos-planos.md) (esto es plano A:
> Goberna produciendo para su propia Escuela) y de los ADR **0022** (lazo) y **0023/0025** (catálogo).

---

## 1. Por qué esto vale, en un número

**El 42 % de la secuencia de venta lleva imagen, y en Goberna el precio vive ADENTRO de la imagen.**

De ahí salen las dos cosas que hacen valioso este frente, y ninguna es «generar placas más lindas»:

1. **Hoy no se puede saber qué flyer vende.** El lazo mide plantillas, no imágenes.
2. 🔴 **Hoy se puede mandar un flyer con el precio vencido y nada lo detecta.** Hermes resuelve
   `{precio}` en el server, contra Cerberus, **en el instante** — precisamente para no mandar un
   número cacheado (ADR 0007). Pero el flyer adjunto tiene el precio **quemado en los píxeles**, de
   cuando se diseñó. Cuando Cerberus cambia un precio, **el texto sale bien y la imagen sale mal, en
   el mismo mensaje.**

El segundo punto es un bug de negocio en producción que nadie tiene abierto, y se puede arreglar
**sin Flux, sin GPU y sin Studio**. Por eso es la fase 0.

---

## 2. Qué existe y qué falta

| Tramo | Estado | Dónde |
|---|---|---|
| **Producir** | 🚧 spec | `goberna-studio-e21` — monorepo planeado (web React+Konva · api Express+tRPC · worker Python+PIL). FLUX.1-schnell en geografo `:8081`, `/api/flux` y `/api/flux/batch`. Guía de prompting real y probada: `docs/heros-flux-guia.md` |
| **Versionar** | 🟢 existe | `piezas/direccion.ts` + `piezas/version.ts` (ADR 0023). **El archivo YA entra en el hash** — *«cambiar `flyer-julio.jpg` por `flyer-agosto-PRECIO-NUEVO.jpg` es versión nueva»* |
| **Medir** | 🟢 existe | `procedencia/` + `resultados/` (ADR 0022), con `Medicion`, Wilson y `muestraSuficiente` |

**Los cuatro huecos reales:**

### Hueco 1 — la imagen no tiene identidad propia

El archivo entra al hash **adentro** de la versión de la plantilla. Consecuencia: cambiás el flyer y
cambia la versión de la plantilla entera, así que **no se puede atribuir la mejora a la imagen o al
texto**. Es exactamente el argumento del ADR 0022 —*«sin versión, mejorar una frase suma los dos
textos y una pieza que pasó de 12 % a 30 % se reporta 21 % para siempre»*— aplicado un nivel más
abajo, y todavía sin pagar.

**PROPUESTA**: la imagen es una **clase de pieza**, `imagen`, con su `id` y su versión por hash del
**contenido del archivo**. La plantilla deja de hashear los bytes y pasa a hashear la **referencia**
(`imagen:flyer-agosto@sha256:…`). Se preserva la propiedad de ADR 0022 —otro archivo ⇒ otra
referencia ⇒ otra versión de plantilla— **y se gana** poder agrupar resultados por imagen a través
de plantillas distintas.
⚠️ Esto es **schema, y por lo tanto va DENTRO de ADR 0025** (el catálogo con bases y deltas), no
pegado al costado. Un catálogo de piezas y un catálogo de imágenes serían dos recetas de versión — la
enfermedad que `piezas/receta-unica.test.ts` existe para atrapar.

### Hueco 2 — Studio planea tener SU PROPIO catálogo de piezas

El diseño de Studio dice `apps/api` = *«Producto: clientes, piezas, historial»*. **Eso es un segundo
catálogo de piezas con una segunda receta de versión**, y el resultado conocido es *cero filas en
silencio* en el join contra `envios_wa`.

**PROPUESTA — la decisión de arquitectura de este frente**: **Studio NO es dueño de piezas. Studio es
un PRODUCTOR que publica en EL catálogo.** Studio conserva lo suyo —borradores, capas del canvas,
prompts, seeds, historial de generación—, que es su negocio real. Pero en el momento en que una placa
pasa a «se puede mandar», se convierte en una `Pieza` del catálogo único, con la receta única.
Es la regla de la casa aplicada tal cual: *«Nadie arma una `Pieza` fuera de `catalogo/armar.ts`»*.

### Hueco 3 — la VRAM: **la restricción NO es la que este documento decía** (medido 28-jul)

> ⚠️ **Corrección.** La primera versión decía «en 16 GB no caben dos LLM + Flux, así que Flux va en
> ventanas con mutex». Esa cita del repo es real **pero habla de DOS LLM**, y hoy en geografo **no
> hay ningún LLM local cargado**: el redactor es **Haiku por Bedrock**. Medido en vivo:

```
NVIDIA RTX A4000 · 16.376 MiB · usados 9.305 (57%) · libres ~7 GB · 0 OOM en 30 días
  ivi-chat            3.394 MiB
  reranker            3.640 MiB   ← el consumidor local MÁS GRANDE
  ollama (bge-m3)       874 MiB
  flux-api            1.058 MiB   ← EN IDLE: el modelo no está residente
```

**Flux e Ivi ya conviven, ahora mismo, y sobran 7 GB.** El lease de GPU como *prerrequisito* era una
conclusión mía, no un hecho medido.

**Lo que sí queda por medir**: FLUX.1-schnell en **idle** ocupa 1 GB porque descarga a CPU; el pico
**durante la generación** es otra cosa y **nadie lo midió**. Eso es lo que decide si hace falta
mutex — no una cita de un YAML.

**Y la restricción real es OTRA, y es de disponibilidad, no de memoria**: geografo es una
**HP Z4 G4 Workstation, chassis `desktop`, con CachyOS** — una máquina de escritorio, con
`plasmalogin`, bluetooth y power-profiles corriendo, y **un crash registrado el 8-jul**. De esa
máquina depende Ivi, que le responde a las vendedoras a través de Hermes. Ése es el problema a
resolver, y es exactamente el que la propuesta del dueño resuelve.

### Hueco 4 — variantes sin asignación sistemática no se pueden medir

Si Studio produce 6 variantes y cada vendedora elige la que le gusta, lo que se termina midiendo es
**la vendedora**, no la imagen. Con ~1.997 conversaciones y tres líneas, la muestra no perdona
confusión.

**PROPUESTA**: **dos variantes, no seis**, y la asignación la hace el sistema (rotación estable por
contacto), no el gusto. Y se reporta con la disciplina que el repo ya exige: `n`, `base`, Wilson, y
**`muestraSuficiente` antes de dejar que alguien saque conclusiones**. Sin esto, todo el frente
produce anécdotas con decimales.

---

## 3. El plan, en cinco fases

### **FX-0 · La compuerta de precio vencido** — sin Flux, sin GPU, sin Studio 🔴

La única fase que entrega valor sola y protege ingresos hoy.

1. Cada paso con imagen declara de qué **familia de curso** es el precio que tiene quemado, y **con
   qué precio se generó** (`precio_impreso`, `precio_moneda`, `precio_capturado_en`).
2. Al preparar/enviar, Hermes ya consulta el precio vivo de Cerberus para `{precio}`. Se compara con
   `precio_impreso`.
3. Si difieren: **no se manda**, con el mismo criterio que las dos guardas que ya existen (una
   plantilla `propuesta` no se manda; un paso con imagen pendiente tampoco). El aviso dice qué precio
   tiene la imagen y cuál es el vivo.
4. Para las imágenes que ya están cargadas y nadie sabe qué precio tienen: `precio_impreso = null`
   significa **«no se sabe»**, y se avisa sin bloquear — *«no se pudo saber» no es «está bien»*, la
   misma regla que `edad_del_dato`.

**Gate**: un flyer con precio desactualizado no puede salir, y hay un test que lo fija.
**Agentes**: `typescript-pro` (la guarda + tipos), `postgres-pro` (las columnas), `code-reviewer`
adversario. **Prohibido**: resolver el precio en el cliente (rehidrata precios de ayer, ADR 0007);
bloquear cuando el precio es desconocido (avisar, no trancar).

### **FX-1 · La imagen es una pieza** (dentro de ADR 0025)

Clase `imagen`, versión por bytes del archivo, plantilla referencia en vez de incrustar. Los
candados de siempre: vectores literales en `piezas/vectores.ts` afirmados desde los dos lados, y
`receta-unica.test.ts` que falla si aparece un `createHash` nuevo.

**Gate**: `piezas:resultados` puede agrupar por imagen a través de plantillas distintas.
**Prohibido**: una segunda receta de versión; hashear el archivo *resuelto por contacto* (haría una
versión por destinatario, el error que ADR 0022 ya documentó para el texto).

### **FX-2 · El reparto geografo ↔ Bedrock** — *«geografo pone los píxeles, Bedrock pone el lenguaje»*

**La propuesta del dueño (28-jul) es la dirección correcta, y el código ya la anticipa.** Pero es un
reparto en tres tramos, no uno, y cada uno tiene un precio distinto:

| Pieza de Ivi | Hoy | ¿Se puede a Bedrock? | El precio real |
|---|---|---|---|
| **Redactor** | ✅ **Ya es Bedrock** (Haiku, con Nova y qwen3 de respaldo) | Hecho | — |
| **Reranker** (`bge-reranker-v2-m3`, **3,6 GB — el más grande**) | Local, venv con torch CUDA | **Sí**, Cohere Rerank está en Bedrock | Latencia por llamada y costo por consulta. **Es la mudanza que más VRAM libera** |
| **Embedder** (`bge-m3`, 874 MB) | Local por Ollama | **El camino YA EXISTE en `rag/embedder.py`**: backend `bedrock` con **Cohere embed-multilingual-v3** | 🔴 **Re-ingestar el corpus entero.** Los dos son 1024-dim pero **espacios vectoriales distintos, y no se mezclan** — el propio repo lo llama *«decisión firme: no se cambia»* |

#### El corpus, medido (28-jul) — y las dos objeciones que se caen

```
rag.documentos:  2.423 chunks · 40 MB · 478 k-tokens · 789 chars/chunk
embedder:        ollama:bge-m3 → 2.423   (el backend bedrock NUNCA se usó en producción)
sensible:        false → 2.408 chunks (105 docs, 99,4%)
                 true  →    15 chunks (  2 docs,  0,6%)
fuentes:         meta-escuela/{specs 702, adr, prompts, loops, agents}, procedimientos…
volumen pgvector: 120 MB  ·  tráfico de producción hoy: ~0 (Hermes recibe 404: el endpoint no está desplegado)
```

**Objeción 1 — «el split es por sensibilidad, mandarías los docs de negocio a AWS»: SE CAE.**
El **99,4 % del corpus ya está marcado `sensible = false`**, y es documentación de ingeniería de
meta-escuela (specs, ADRs, prompts). Lo sensible son **2 documentos, 15 chunks**. Eso no es una
frontera arquitectónica: es una excepción de dos archivos que se dejan fuera o se quedan locales.

**Objeción 2 — «re-ingestar el corpus entero»: SE CAE.**
Son **478 k-tokens**. A precios de embeddings gestionados eso es del orden de **centavos y minutos**,
no un proyecto. *(Verificar la tarifa vigente de Cohere Embed en Bedrock antes de firmar el número;
lo que no cambia es el orden de magnitud.)* La *«decisión firme: no se cambia el embedder»* se tomó
para evitar un costo que a este tamaño de corpus **no existe**. Merece revisarse, y ésta es la
revisión.

#### 🔴 Lo que nadie nombró: la BASE VECTORIAL y el SERVICIO también viven en geografo

`ivi_rag_pg` es un contenedor **en geografo** (volumen `ivi_rag_pgdata`, 120 MB) e `ivi-chat.service`
corre ahí también.

> **Mover embedder y reranker a Bedrock y dejar el store donde está NO desacopla nada.** Ivi
> seguiría dependiendo de la workstation exactamente igual.

«geografo solo Studio» no son dos mudanzas — **son tres**:

| # | Qué se mueve | A dónde | Costo real |
|---|---|---|---|
| 1 | Redactor | Bedrock | ✅ **ya está** |
| 2 | Reranker (3,6 GB) + embedder (874 MB) | Bedrock (Cohere Rerank + Cohere Embed) | Re-ingesta ≈ centavos · costo y latencia **por consulta**: medir |
| 3 | **`ivi_rag_pg` + `ivi-chat.service`** | **VPS1** | `pg_dump`/restore de 120 MB. VPS1 ya corre imágenes pgvector |

**Y el 3 tiene un premio que compensa la latencia del 2**: Ivi consulta el catálogo `governa.*` en
**`100.85.119.49:4100` — que ES VPS1**. Hoy cada consulta SQL de Ivi cruza el tailnet. Mudándolo,
Ivi se acerca a su fuente de datos y se aleja de una GPU que deja de necesitar.

#### La única objeción que queda en pie (y es de implementación, no de arquitectura)

**El camino a Bedrock va por el AWS CLI en subprocess** (no boto3, por PEP 668): un *spawn de
proceso* por llamada. Para ingestar da igual; en el **camino caliente** —cada pregunta embebe su
query, y el rerank es otra llamada— eso es latencia que se nota. **No es un problema de Bedrock: es
del transporte.** Se arregla con boto3 en un venv propio o un sidecar persistente, y hay que
arreglarlo *antes* de mover el embedder, no después.

#### ⏱️ El argumento de oportunidad, que es el más fuerte

**Ivi hoy no atiende tráfico de producción** — Hermes recibe 404 porque el endpoint no está
desplegado. **Éste es el momento más barato en que esta migración va a estar jamás**: nadie depende
de ella, no hay que coordinar una ventana, y una re-ingesta que salga mal no le arruina el día a
ninguna vendedora. Cada semana que pasa, el mismo movimiento cuesta más.

**PROPUESTA revisada**: hacer las tres, **en este orden y con el gimnasio de Ivi como gate en cada
paso** (ya existe: `python3 -m rag.gimnasio --negocio --auditoria`, y produce el artefacto de la
corrida):

1. **Arreglar el transporte** (boto3 o sidecar) y **medir** latencia por llamada.
2. **Reranker → Bedrock.** Libera 3,6 GB, no toca el corpus.
3. **Store + servicio → VPS1.** Acá es donde geografo empieza a quedar libre de verdad.
4. **Embedder → Bedrock** con re-ingesta completa, dejando los 2 docs sensibles fuera o locales.
   Correr el gimnasio **antes y después**: cambiar de espacio vectorial puede mover la calidad de
   recuperación, y ése —no el costo— es el riesgo que hay que medir.

Al terminar, **geografo corre Studio y nada más**, y su próximo crash detiene una generación de
flyers en batch en vez de dejar sin cerebro a las vendedoras.
**Agentes**: `devops-engineer` (transporte, systemd, la mudanza), `postgres-pro` (dump/restore +
HNSW), `dueno-exigente` (corre el gimnasio y compara antes/después, sin piedad).
**No es prerrequisito de FX-3**: Flux e Ivi conviven hoy, así que Studio puede avanzar en paralelo.

### **FX-3 · Studio publica al catálogo**

El worker de geografo genera (con la guía de prompting que ya está probada: prosa, no sopa de tags;
4 steps fijos; el bloque anti-texto; el tercio inferior en negro para que entre el título). La API de
Studio **publica una `Pieza` de clase `imagen`** por el contrato del catálogo — con credencial de
servicio propia, como `HERMES_CATALOGO_SERVICE_TOKEN` pero de escritura y distinta.

**Prohibido**, y esto es la regla editorial de Studio elevada a invariante del circuito: el LLM
**solo reformula hechos que escribió un humano**; ninguna cifra, nombre ni cita nace del modelo. Y
**nada de lo generado se envía automáticamente** — sale por `EnvioControlado` como todo lo demás.

### **FX-4 · Rotación medida**

Dos variantes, asignación por el sistema, reporte con `n`/`base`/Wilson. Recién acá el circuito
cierra y la pregunta «¿qué flyer vende?» tiene respuesta en vez de opinión.

---

## 4. Orden y por qué

```
FX-0 ─────────────────────────────────► protege ingresos HOY, no depende de nadie
        │
        ├─► FX-1 (ADR 0025) ──► FX-3 (Studio publica) ──► FX-4 (rotación medida)
        │        schema              producto                 el círculo cierra
        │
        └─► FX-2 (geografo↔Bedrock) ── en paralelo, NO bloquea
                 medir pico · reranker a Bedrock · embedder al final
```

FX-0 primero porque es el único tramo con valor inmediato y cero dependencias. FX-1 antes que FX-3
porque Studio necesita un destino que exista. **FX-2 dejó de ser prerrequisito** al medirse que Flux
e Ivi ya conviven con 7 GB libres: corre en paralelo, empujado por disponibilidad y costo, no por
memoria.

## 5. Lo que NO se hace

- **Generación dentro del chat de la vendedora.** Es producción de campaña, no una respuesta a un
  lead. Y la regla del dueño (27-jul) es explícita: la IA entra como potenciador **después** de que
  la estructura esté.
- **Mover el embedder «de paso».** Cambiar de espacio vectorial obliga a re-ingestar el corpus
  entero; se hace por una razón declarada o no se hace.
- **Un catálogo de piezas en Studio.** Ver hueco 2.
- **Flux always-on.** Ver hueco 3.
- **Envío automático de nada generado.** Un envío = una acción humana.
- **Seis variantes.** Ver hueco 4.

---

*Depende de: ADR 0022 (lazo), 0023 (catálogo para Ivi), 0025 (catálogo con bases y deltas — donde
FX-1 debe vivir), y de la restricción de VRAM documentada en `ivi-cerebro/deploy/llama-swap.yaml`.
Guía de prompting probada: `goberna-studio-e21/docs/heros-flux-guia.md`.*
