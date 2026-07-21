# 24 — Ivi Studio v2: el estudio adaptativo (guiado + chat + texto libre)

> Plan de diseño. Nace del pedido de Estephano (2026-07-17) tras probar la v1
> (docs/prototypes/ivi-studio.html): "quiero poder escribir mi propio texto en
> cada paso para que se adapte mejor, poder chatear con Ivi, combinar los dos,
> y que Ivi con sus deducciones vaya adaptando todo". Este doc planea cómo
> seguimos. No es código todavía: es la arquitectura de la experiencia y su
> mapa a KOS Gen-2 (docs/21).

## 1. La visión, en una frase

**El creativo es un documento vivo. Lo moldeás de dos formas a la vez, por
manipulación directa (el flujo guiado) y por conversación (el chat con Ivi), y
Ivi re-deduce y re-adapta todo en cada input, siempre anclado en tus datos
reales.**

La v1 era un wizard con listas para elegir. La v2 le suma tres cosas que la
cambian de categoría:

1. **Input expresivo** — en cada paso podés escribir lo tuyo, no solo elegir.
2. **Conversación** — un chat con Ivi corre en paralelo al flujo.
3. **Adaptación** — lo que escribís/decís reordena y repersonaliza todo lo demás.

## 2. Por qué la fusión, y no una de las dos formas puras

| Forma pura | Qué da | Qué le falta |
|---|---|---|
| **Wizard rígido** (la v1) | estructura, cero parálisis de hoja en blanco, cada paso con sentido | expresión: te encierra en las opciones que yo previ |
| **Chat plano** (el Ivi actual) | flexibilidad total | estructura: hoja en blanco, no sabés qué pedir, se pierde el hilo |

La magia está en el medio: **la estructura te da el andamiaje y el chat te da la
libertad, y Ivi usa lo que hacés en cualquiera de los dos para mejorar el otro.**
Es el patrón "canvas + conversación" (como los Artifacts), pero con un canvas
específico del dominio (el creativo de campaña) y una IA experta (Ivi, con los
datos de Cerberus atrás).

## 3. La idea central: un solo estado, dos superficies

Todo se apoya en **el Brief** (el estado compartido): la única fuente de verdad
que el canvas y el chat leen y escriben.

```
                        ┌───────────────────────────┐
                        │        EL BRIEF           │  ← estado vivo
                        │  producto · ángulo ·      │    (una sola verdad)
                        │  audiencia · tono ·       │
                        │  imagen · titular · cuerpo│
                        │  · CTA · notas-del-user · │
                        │  hechos citados           │
                        └─────────────┬─────────────┘
              lee/escribe             │            lee/escribe
        ┌──────────────────┐          │          ┌──────────────────┐
        │   CANVAS (guiado)│◄─────────┴─────────►│   CHAT (con Ivi)  │
        │  pasos + opciones│    cada cambio en    │  preguntar,       │
        │  + TEXTO LIBRE   │    uno se refleja    │  dirigir, explorar│
        │  por paso        │    en el otro        │                   │
        └──────────────────┘                      └──────────────────┘
                        ▲                                    ▲
                        └──────────── IVI RE-DERIVA ─────────┘
                         (motor determinista da los hechos;
                          el modelo redacta y adapta — Ley I)
```

- **Canvas**: el flujo de 5 pasos de la v1, pero cada paso gana un campo de
  texto libre ("o escribilo vos / decime cómo lo querés"). Lo que tipeás lo
  interpreta Ivi y lo pliega al Brief.
- **Chat**: un panel de Ivi persistente (lateral o inferior). Preguntás,
  dirigís, explorás; cada turno puede producir un **cambio visible en el canvas**
  (un "diff" que ves aplicarse).
- **El Brief**: no es un formulario oculto, es lo que Ivi "entiende" de lo que
  querés. Cada click, cada texto, cada mensaje lo actualizan.

## 4. El lazo adaptativo (el corazón de "que vaya adaptando todo")

Cada input del usuario (click, texto libre, o mensaje de chat) dispara el mismo
ciclo:

```
input → interpretar → actualizar el Brief → re-derivar → reflejar en canvas + chat
                                              │
                                    (Ley I: los HECHOS salen del
                                     motor determinista; el modelo
                                     solo redacta y propone)
```

La "deducción" de Ivi es real y opera por **tres mecanismos**:

**a) Propagación entre pasos.** Un cambio arriba re-sugiere lo de abajo.
Ejemplo: elegís el ángulo "urgencia" → el paso de imagen sesga hacia conceptos
con menos texto y CTA de reserva; el de titular arranca con escasez. Tipeás un
titular que menciona "diplomado internacional" → Ivi ajusta el posicionamiento
del Brief y las próximas sugerencias lo respetan.

**b) Aprendizaje de tu voz.** Cuando escribís lo tuyo o editás una sugerencia,
Ivi extrae tu estilo (tono, largo, vocabulario) y **regenera las próximas
opciones en esa voz**. "Generá más así" deja de ser un botón: es el
comportamiento por defecto una vez que Ivi te leyó.

**c) Deducción con honestidad (la barrera dura).** Toda adaptación pasa por el
motor determinista. Si tipeás "el curso #1 de LATAM", Ivi marca que no es un
HECHO verificable y te ofrece el real ("648 personas ya se formaron" sí lo es).
**Ivi adapta el mensaje, nunca inventa el dato.** Esto es la Ley I de docs/21
llevada al creativo: los números y afirmaciones nacen del pipeline, no del
modelo.

## 5. Cómo cambia cada paso (concreto)

Cada paso conserva sus opciones sugeridas (evitan la hoja en blanco) y suma
**input libre + conciencia del chat**:

| Paso | v1 (elegir) | v2 (adaptativo) |
|---|---|---|
| **Producto** | tarjetas | + "o describime la campaña" → Ivi infiere producto, audiencia y objetivo del texto |
| **Brief/ángulo** | 3 ángulos fijos | + escribí tu propio ángulo; Ivi lo valida contra los datos y ajusta el país/canal sugerido |
| **Imagen** | 4 conceptos | + "describí la imagen que ves" → prompt a Flux; las sugerencias siguen tu descripción y el ángulo |
| **Texto** | variantes fijas | + escribís/editás libremente; Ivi aprende tu voz y regenera en ella; marca claims no-verificables |
| **Compuerta** | dry-run | + preguntás "¿y si apunto a México?" en el chat y Ivi te muestra la implicación en datos antes de aprobar |

## 6. La conversación con Ivi (qué hace el chat)

El chat no es una cosa aparte: es **el volante del canvas**. Sus trabajos:

- **Preguntar**: "¿por qué Perú y no México?" → Ivi explica desde los datos.
- **Dirigir**: "hacelo más corto", "menos formal", "probá un ángulo de
  comunidad" → el canvas cambia (diff visible).
- **Explorar**: "¿qué pasaría si apunto a EEUU?" → Ivi muestra la implicación
  (ROAS 17,46× pero base chica) sin comprometer nada.
- **Deshacer/comparar**: "volvé al titular anterior", "compará estos dos".

Regla de oro: **cada turno de chat que cambia algo, lo muestra como un cambio en
el canvas** — nunca un cambio invisible. El usuario siempre ve qué tocó Ivi.

## 7. Por qué esto ES el kernel de KOS Gen-2 (no un proyecto aparte)

Ivi Studio v2 es la **primera capacidad real** de KOS Gen-2 (docs/21):
`creativo.campaña`. Y es la vertical que nos obliga a construir el kernel de
verdad, en vez de en abstracto:

| Pieza del kernel (docs/21) | Qué la ejercita en Ivi Studio |
|---|---|
| **Contexto & Memoria** (§6.6) | El Brief ES `contexto.armar`: ensamblar un contexto anclado desde hechos + tu input + memoria de la sesión |
| **Inferencia** (§6.5) | Interpretar texto libre + charlar + generar copy = el model gateway (y una decisión de modelo real, §9) |
| **Compuerta** (§6.4) | El paso 5 es literalmente la puerta de efectos con aprobación humana |
| **Bóveda** (§6.7) | El creativo aprobado se guarda content-addressed con su procedencia |
| **Ledger** (§6.3) | Cada deducción/derivación queda registrada (auditable: "¿por qué sugirió eso?") |
| **Ley I / II / III** | El dato nace del motor; publicar pasa por la compuerta; el creativo es derivación reproducible |

Construir esto bien = tener el kernel naciendo con un consumidor real. Es
exactamente la "regla de extracción" de docs/21: nada entra al kernel sin un
uso real, e Ivi Studio es ese uso.

## 8. Fases de construcción (cada una un corte probable y deployable)

**Fase A — El Brief vivo + texto libre + chat scripteado (solo front, sin
backend nuevo).** Hacer real el estado compartido en el prototipo: campos de
texto libre por paso y un panel de chat con respuestas guionadas (reglas, no
modelo todavía). Objetivo: **sentir la fusión guiado+chat+texto** y validar la
UX antes de cablear nada. Barato, se prueba en el navegador.

**Fase B — Chat real con Ivi.** Cablear el panel de chat al motor Ivi (ya está
instantáneo por P1/P2), scopeado al creativo en construcción. Podés preguntar
cosas ancladas durante el flujo.

**Fase C — Texto libre interpretado (el núcleo adaptativo).** Lo que tipeás en
cualquier paso lo parsea el modelo y actualiza el Brief, con la barrera de
honestidad (chequeo determinista). Es lo más difícil y lo más valioso: el
"deduce y adapta". Depende de la decisión de modelo (§9).

**Fase D — Imágenes reales (Flux en geógrafo).** El paso 3 genera creativos
reales desde el Brief. (Inventario de VRAM: Flux + ivi-ventas conviven; ver
memoria de config de geógrafo.)

**Fase E — Compuerta + Bóveda reales (K1).** Aprobar se vuelve un efecto
gobernado de verdad, guardado con procedencia, con la tarjeta de aprobación en
Mattermost.

Cada fase agrega valor sola y de-risquea la siguiente. Fase A no toca prod.

## 9. Decisiones abiertas (los forks reales, para vos)

1. **El modelo que interpreta texto libre y charla.** `ivi-ventas` (qwen3:8b,
   local, ya está) está afinado para narración BI; puede quedar corto para
   parsear intención creativa y generar copy con matiz. Opciones:
   (a) seguir con ivi-ventas y medir el techo;
   (b) sumar un segundo rol de modelo (uno BI, otro creativo/parsing);
   (c) usar un modelo cloud (Gemini/Claude) SOLO para el creativo, ya que el
   copy de un curso no lleva PII sensible (no es el P&L). Tiene costo/latencia/
   privacidad distintos. **Es la decisión que más forma el resto.**

2. **El peso del chat vs el canvas.** ¿El chat es un panel lateral siempre
   visible (co-igual con el canvas), o un asistente que se invoca cuando lo
   necesitás? Cambia el layout y la sensación.

3. **El alcance del primer corte.** ¿Validamos toda la UX primero (Fase A,
   prototipo con estado + texto libre + chat scripteado), o vamos directo a
   cablear el chat real (Fase B) porque el motor ya está listo?

## 9.bis Decisiones tomadas (2026-07-17)

Los tres forks, resueltos por Estephano:

1. **Primer corte: Fase A** — prototipo fusionado (Brief vivo + texto libre por
   paso + chat scripteado), sin backend. Validar la UX antes de cablear.
2. **Modelo: dos roles locales**, gestionados con **llama-swap** (llama.cpp
   intercambia modelos en/out de la VRAM bajo demanda) para convivir con Flux
   en la A4000 de 16GB. Aplica desde la Fase C (Fase A no usa modelo).
3. **Layout: chat que se invoca** — el canvas guiado es el protagonista a
   pantalla completa; el chat con Ivi aparece con un botón flotante. Pantalla
   limpia y enfocada.

## 10. Riesgos honestos

- **Latencia del texto libre**: si cada tecleo dispara al modelo, se siente
  lento. Mitigación: interpretar al confirmar (no en cada letra), y el caché
  P1 ayuda con lo repetido.
- **Alucinación en el creativo**: el modelo generando copy puede inventar
  cifras. La barrera de honestidad (§4c) es obligatoria, no opcional.
- **Sobre-adaptar**: si todo se reordena con cada input, el usuario pierde el
  control. Regla: los cambios de Ivi siempre son visibles y reversibles.
- **Scope creep**: es fácil que esto se vuelva "todo KOS". Disciplina: una
  vertical (creativo de campaña), un corte por fase, cada corte útil solo.
