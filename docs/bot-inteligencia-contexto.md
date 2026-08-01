# Bot especializado en Inteligencia y Contrainteligencia — contexto y plan

> Estado: 2026-08-01. Este documento junta (1) lo que el negocio sabe del diploma,
> (2) lo que el bot sabe hoy, (3) cómo está configurado, y (4) el plan para que el
> bot atienda, procese y cierre la venta de Inteligencia de punta a punta.
> Cualquier cifra sale de datos vivos (catálogo de Cerberus, plantillas en base),
> no de memoria.

---

## 1. El producto: Diploma de Inteligencia y Contrainteligencia

### 1.1 Datos reales del catálogo de Cerberus (vivo, 2026-08-01)

| Campo | Valor |
|---|---|
| SKU (familia) | **`DIPICOT`** |
| Nombre oficial | Diploma de Especialización en Inteligencia y Contrainteligencia |
| Ediciones activas | 14 (DIPICOT001 … DIPICOT014) |
| Precio normal | **USD 250** |
| Precio promoción | **USD 150** (ediciones 001, 003–009, 011, 014) |
| Moneda | Dólar (USD) — el payload público de Cerberus no trae key de moneda (#43); la plantilla aprobada dice «$150 dólares» |

### 1.2 Lo que el bot ya tiene (plantilla 3, aprobada, la única pieza de Inteligencia vigente)

- Diploma Internacional de Inteligencia y Contrainteligencia — «desarrolla tus habilidades estratégicas para la recopilación, análisis y protección de información en diversos ámbitos».
- **Inicio: lunes 10 de agosto** · **Lunes, miércoles y viernes** · **19:00–21:00 GMT-5**.
- **Certificación internacional (120 hrs), emitida desde Estados Unidos**.
- **Precio de promoción: $150 dólares**.
- **Bono incluido: curso grabado de Ciberinteligencia**.
- Modalidad: 100% virtual, clases en vivo por Zoom (quedan grabadas), campus 24/7 (del contexto de la casa).
- Piezas relacionadas (propuestas, sin aprobar): seguimiento de 2 pasos («¿Le gustaría realizar su pago de inscripción hoy día?») y el flyer con **link de pago Openpay** + emojis (no se puede mandar como está: el bot tiene prohibidos los emojis).

### 1.3 Lo que sabemos y el bot todavía NO sabe

- El **temario** real del diplomado (módulos/planes de estudios) — no está en ninguna pieza ni en el contexto.
- La **fecha de cierre de inscripción** de la edición de agosto.
- **Duración en semanas** (solo se sabe «120 hrs»).
- Los **docentes** del diplomado.
- Si el precio de **$150** tiene fecha de vencimiento (promo).
- Las **formas de pago**: 2 cuotas (hecho «cuotas»), link de pago, moneda local por país.

### 1.4 ⚠️ ALINEAMIENTO DE FAMILIAS — hay dos SKUs y el bot apunta al equivocado

| SKU | Producto REAL (catálogo Cerberus) | Precio |
|---|---|---|
| **DIPICOT** | Diploma de Especialización en Inteligencia y Contrainteligencia | $250 / $150 |
| **DIPCINTE** | Diploma Internacional en **Ciberinteligencia y Ciberdefensa** | $100 |

- El alias de prod mapea bien: «inteligencia y contrainteligencia» → **DIPICOT** (también «inteligencia», «contrainteligencia», «inteligencia estratégica», «operaciones clandestinas»).
- Pero el bot está enfocado en **DIPCINTE** (`ENFOQUE_PRODUCTO` en `bot/recuperador.ts`) y el contexto del prompt dice «Inteligencia y Contrainteligencia (DIPCINTE)» (`bot/prompt.ts`) — **los dos están mal**.
- La plantilla 3 (aprobada, la pieza del bot) tiene `familia_curso = DIPCINTE` pero su texto es de Inteligencia y Contrainteligencia — arrastra el mismo error.
- Consecuencia hoy: el bot filtra el catálogo por DIPCINTE → ve la plantilla 3 por el texto (es la única), pero el interés que registra la cola/el lead llega como DIPICOT → el chip, el `interesPropuesto` y las piezas del bot no casan en familia.

---

## 2. El bot hoy — cómo está configurado

### 2.1 Configuración viva (prod, VPS1)

| Parámetro | Valor |
|---|---|
| Estado | **EN PRODUCCIÓN, modo `automatico`** (responde de verdad) |
| Línea | 51984429504 (solo esa; las de ventas quedan afuera por decisión del dueño) |
| Modelo | `us.anthropic.claude-haiku-4-5-20251001-v1:0` (Claude Haiku 4.5, vía Bedrock) |
| Buffer por mensaje | 10 s (agrupa mensajes de la misma ráfaga) |
| Topes | 40 turnos/día por conversación · 60 respuestas/hora por línea |
| Follow-up | 20/día, solo entre 9:00 y 20:00 (hora Lima), única cosa que el bot inicia |
| Idiomas | Español neutro peruano, sin emojis, 2–4 oraciones, una pregunta por mensaje |

### 2.2 Cómo llega un mensaje (el camino completo, ya verificado con leads reales)

1. **Ingesta whatsmeow** (`whatsapp/ingesta.ts`) persiste el entrante y avisa al despachador (`bot/ingesta.ts` → claim en `bot_pendientes`) — el eslabón se cerró el 2026-08-01; antes el bot solo recibía lo que el webhook Cloud API entregara (nada, con whatsmeow).
2. **Despachador** (`bot/despachador.ts`): cada 5 s toma hasta 3 claims vencidos (`skip locked`) y corre el pipeline.
3. **Pipeline de 16 pasos** (`bot/orquestador.ts`): normalizar → contexto (nombre/Cerberus, país, interés derivado del anuncio) → estado → decidir → validar entrada → recuperar piezas → prompt → tools → agente → validar salida → transicionar → scoring → **enviar** → ejecutar acciones → auditar.

### 2.3 Qué decide el bot (orden fijo, `bot/decision.ts`)

apagado → línea no habilitada → frenado → **pausado** (pausa activa: rechazo/despedida/escalado) → vendedora activa → repetido (spam) → tope de turnos → tope de línea → desconectado → **responder**.

⚠️ *Bug descubierto en vivo:* una pausa por escalación (`escalado_por_cerrar`, creada por el modelo cuando le dijo a Alan «una asesora se comunica contigo») es **permanente** (`hasta = null`) y deja al bot **mudo para siempre** aunque el lead vuelva a escribir pidiendo más info. Hoy lo destrabamos borrando la pausa a mano. Un entrante nuevo tras un escalado debería re-anudar.

### 2.4 El prompt (`bot/prompt.ts`)

- **Rol**: «Eres Kathy Alva, asesora académica de la Escuela de Goberna». Misión: ayudar a encontrar el programa, con eficiencia y calidez, **sin inventar nunca**.
- **Contexto de negocio** (fijo): la Escuela (formación política LATAM+EEUU+Brasil), modalidad 100% virtual, sedes y teléfonos por país, «no damos certificaciones universitarias».
- **Datos que puedes afirmar**: los 7 hechos (abajo).
- **Piezas enviables**: las del catálogo filtrado por el bot (hoy: 1 plantilla).
- **Reglas duras (0–10)**: presentarse preguntando nombre y país (uno por mensaje); **nunca escribir cifras de precio en texto** (va por `mandar_pieza`); nunca inventar datos (si no está → escalar); nunca decir que es bot/IA; si piden humano → escalar; si rechazan/despiden → pausar; si piden **precio/pago/inscripción → registrar interés + calificar caliente + «Dame un momento, te mando la información» + escalar `por_cerrar`** (el cierre y la cotización los hace un asesor humano); registrar interés sin decirlo; no prometer lo que no controla; dar sedes del país del lead; **toda respuesta lleva texto** (las acciones nunca reemplazan el mensaje).
- **Contexto de contacto** (por conversación): nombre, país (+procedencia: memoria/Cerberus/prefijo), interés registrado, señales.
- **Lenguaje (regla del dueño, 1-ago-2026)**: español neutro del PERÚ, conjugación de «tú». El voseo rioplatense está PROHIBIDO y tiene capa propia en el guardrail (`FORMAS_DE_VOSEO`, violación `voseo`): «tenés/podés/querés/sos/decís/venís/decime/contame/che/vos» bloquean el mensaje. Las formas ambiguas (sabes, piensas, hablas, mira, mandame, fijate) quedan a cargo del prompt y del registro de los hechos — el guardrail solo atrapa lo inequívoco porque un falso positivo manda el lead a escalado humano. Todo lo que el modelo LEE (hechos, plantillas, prompt) se mantiene en ese mismo registro: el modelo copia la conjugación de lo que afirma.

### 2.5 Las herramientas del bot (5, conectadas al modelo)

| Tool | Qué hace hoy |
|---|---|
| `mandar_pieza` (id) | ⚠️ **NO EJECUTA NADA** — el caso en `bot/ejecutar.ts` es un no-op. El modelo puede agendarla y no pasa nada. |
| `registrar_interes` (familia) | Guarda el interés en la tabla (válida contra `alias_curso`) |
| `calificar` (temp/motivo) | Guarda la calificación del lead |
| `escalar_a_vendedora` (motivo) | Pausa la conversación + marca escalada (6 motivos: pidió humano, preguntó si es bot, por cerrar, sin respuesta en catálogo, frustrado, error del bot) |
| `pausar_conversacion` (motivo) | Pausa para siempre (rechazo/despedida) |

### 2.6 El catálogo que ve el bot (`bot/recuperador.ts`)

- Filtro: solo clases `plantilla` y `hecho`, familia `null` o igual a `ENFOQUE_PRODUCTO` (hoy **DIPCINTE** — debe pasar a **DIPICOT**).
- Hoy en prod: 1 plantilla aprobada (la de Inteligencia, solo texto, **sin flyer cargado**) + 7 hechos (sembrados en tabla `hechos`, iguales al default de código).
- Si el catálogo no se puede leer: el bot **degradea ruidoso** (responde sin piezas; `mandar_pieza` quedaría ciega y se avisa en logs).

### 2.7 Los 7 hechos que puede afirmar (desbloquean la venta, medidos en 1.876 conversaciones, #153)

1. **Cuotas**: se puede pagar en 2 cuotas (primera reserva, segunda antes de empezar).
2. **Acceso por un año**: clases grabadas + campus por 12 meses, «entras cuando puedas».
3. **Público general**: no hace falta ser policía ni militar (abogados, funcionarios, consultores, empresarios, estudiantes cursando).
4. **Canal oficial**: verificable en redes y canal de WhatsApp antes de pagar.
5. **Moneda local**: se pasa el precio en la moneda del país (sin sorpresas de cambio).
6. **Certificado**: con código de verificación, sirve para CV y concursos públicos.
7. **Próxima edición**: si esta no le queda cómoda, se anota para avisarle (objeción #1: el aplazamiento, 13%).

### 2.8 Qué está hecho y qué es stub en el pipeline

| Pieza | Estado |
|---|---|
| Tools conectadas al modelo (loop tool_use/tool_result) | ✅ hecho |
| `registrar_interes`, `calificar`, `escalar`, `pausar` | ✅ ejecutan |
| `mandar_pieza` | ❌ **no-op** |
| Paso «tools» del pipeline (filtro por estado) | ⚠️ stub (`tools:stub_todas` — todas pasan siempre) |
| Paso «scoring» y «auditar» | stub (Fases 4/5) |
| País por prefijo / Cerberus / memoria | ✅ hecho |
| Referral del anuncio → interés propuesto | ✅ hecho |
| Media (imágenes) en envíos del bot | ❌ no existe (el transporte y `enviarMediaYProyectar` sí lo soportan) |
| Expansión de `{nombre}`/`{precio}`/`{curso}` en lo que manda el bot | ❌ no existe (la app lo hace en el server al enviar pasos) |
| Procedencia/versión estampada (lazo de resultados #169) | ❌ el bot manda con `referencia: bot-auto-<clave>`, sin pieza |

---

## 3. El plan — el bot de Inteligencia full, atender → procesar → cerrar

### F0. Alinear el producto (corregir el desalineamiento) — inmediato

- `bot/recuperador.ts`: `ENFOQUE_PRODUCTO` → **DIPICOT**.
- `bot/prompt.ts`: `CONTEXTO_NEGOCIO` → «Inteligencia y Contrainteligencia (DIPICOT)» (y arreglar la lista).
- Base: `plantillas` fila 3 → `familia_curso = DIPICOT` (la pieza ya es de Inteligencia).
- `bot/tools.ts` `FAMILIAS_POR_DEFECTO`: dejar DIPICOT primero (ambas están, no rompe).

### F1. La munición completa (lo que el bot necesita para vender bien)

- **Flyer real**: cargar la imagen del flyer de Inteligencia en la plantilla 3 (hoy `media_archivo` vacío; sin imagen, `mandar_pieza` no puede mandar el flyer y el 42% de las secuencias que cierran llevan imagen).
- **Aprobar/armar la pieza de precio + pago**: la propuesta 1 tiene el texto completo (precio promoción $150 + link de pago Openpay) pero trae emojis y no está aprobada. Crear la pieza «precio/pago» limpia (sin emojis, regla de la casa) y aprobarla — es la que el bot manda cuando el lead pide precio (regla 1: el precio NUNCA en texto, siempre por pieza).
- **Seguimiento**: aprobar la plantilla propuesta 2 (seguimiento «¿le gustaría realizar su pago de inscripción hoy día?») para los follow-ups.
- **Hechos de Inteligencia que faltan**: temario, duración (120 hrs), fechas de la edición, docentes — decidir cuáles van a la tabla `hechos` (editables sin deploy) vs al contexto fijo.
- **Decisión de negocio pendiente**: qué hace el bot con el **cierre** — hoy la regla 6 manda escalar `por_cerrar` (la cotización la hace un humano). Si el dueño quiere que el bot cierre solo: mandar la pieza de pago y esperar confirmación, con tope de intentos antes de escalar.

### F2. Ejecutar `mandar_pieza` de verdad (el salto que hoy no existe)

- Resolver la pieza desde la DB (plantilla + pasos + media) y mandarla por **`enviarMediaYProyectar`/`enviarTextoYProyectar`** (la misma puerta que la app: EnvioControlado, topes, persistencia del saliente en el hilo).
- **Expandir `{nombre}`** (del contexto del lead) y `{precio}`/`{curso}` (de Cerberus, familia DIPICOT → edición activa) si se puede; si un placeholder no se puede resolver, no mandar el texto con el hueco — mandar la media sola o escalar.
- **Espaciado** entre pasos de una secuencia (1.5–3 s, como la app) y progreso.
- **Estampar la procedencia** (clase/id/versión + `via: bot`) para que el lazo de resultados (#169) mida qué pieza del bot funciona — hoy los envíos del bot son línea de base.
- Guarda de la casa: `archivoSeguro` + `existsSync` antes de mandar media (no mandar medio mensaje).

### F3. El flujo de venta completo (atender → procesar → cerrar)

1. **Atender**: saludar (Kathy Alva), nombre y país en mensajes separados, luego «¿qué programa te interesa?».
2. **Identificar**: el interés llega derivado del anuncio/formulario (referral → `interesPropuesto`) y/o por registro manual (`registrar_interes` → DIPICOT).
3. **Informar (procesar)**: mandar el flyer/pieza de Inteligencia (`mandar_pieza`) + afirmar los hechos que correspondan (cuotas, acceso un año, público general, moneda local, certificado) en el momento justo.
4. **Cotizar**: ante pedido de precio → pieza de precio/pago ($150 promo) + registrar interés + calificar caliente.
5. **Cerrar**: según la decisión de F1 — escalar `por_cerrar` con la data completa para el humano (hoy), o cerrar el pago el propio bot (si el dueño lo aprueba).
6. **No perder**: follow-up a los que pidieron info y no respondieron (9:00–20:00, ya configurado), y **re-anudar tras un escalado cuando el lead vuelve a escribir** (el bug de Alan).

### F4. Medición y blindaje

- El tablero de resultados (#169) con la procedencia estampada: ¿el flyer del bot convierte?
- **Verificación en vivo**: cada cambio se valida en modo `sombra` primero (el pipeline guarda `sombra` sin enviar) con leads sintéticos, antes de tocar prod.
- Topes ya activos (40/día, 60/hora) — vigilar el `temporary_ban` en el journal.

### Decisiones que necesito del dueño

1. ¿El bot cierra la venta solo (manda link de pago y espera confirmación) o siempre escala `por_cerrar` a la vendedora? *(hoy: escala)*
2. ¿Dónde está el flyer/imagen oficial del diplomado para cargarla? *(la plantilla 3 no tiene media)*
3. ¿La promo de $150 vence? ¿Hay que avisar «precio solo hasta X»?
4. ¿El temario oficial (módulos) lo cargamos como hecho o como pieza?

---

## Anexo — archivos que toca cada frente

- `server/src/bot/recuperador.ts` — ENFOQUE_PRODUCTO (F0), filtro de clases.
- `server/src/bot/prompt.ts` — CONTEXTO_NEGOCIO (F0), piezas, reglas (F1/F3).
- `server/src/bot/ejecutar.ts` — ejecución real de `mandar_pieza` (F2).
- `server/src/bot/orquestador.ts` — paso enviar (media), paso tools (F2/F3), re-anudar tras escalado (F3).
- `server/src/bot/decision.ts` + `estados.ts` — pausa por escalado reactiva (F3).
- `server/src/bot/tools.ts` — familias válidas (F0).
- Base: `plantillas`/`plantilla_pasos` (familia, flyer, pieza de precio, seguimiento), `hechos` (munición nueva), `alias_curso` (ya ok).
