# Mapa del bot — todo lo que sabe, de dónde lo saca, y qué puede decir

> Volcado **verificado contra producción el 1-ago-2026 22:40** (línea `51984429504`,
> `ea92e394`). No es de memoria: cada tabla salió de una consulta y cada ruta de abrir el archivo.
>
> **Para qué sirve**: para poder mirar en frío si el mapeo está bien. Su compañero es
> `docs/como-se-vende-en-goberna.md`, que dice cómo *debería* venderse; este dice qué hay **hoy**.

---

## 1. De dónde sale cada cosa que el bot dice

Cinco fuentes, y ninguna es el modelo inventando:

```
                    ┌─ <rol> ──────────── prompt.ts, CÓDIGO (requiere deploy)
                    ├─ <contexto_negocio> prompt.ts, CÓDIGO (requiere deploy)
  SYSTEM PROMPT ────┼─ <datos_que_puedes_afirmar> ── tabla `hechos` (SIN deploy)
                    ├─ <piezas_enviables> ───────── tabla `plantillas` + hechos + acuses
                    └─ <reglas_duras> ──── prompt.ts, CÓDIGO (requiere deploy)

  POR CONVERSACIÓN ─┬─ <contacto> ─── Cerberus · memoria · perfil de WhatsApp · prefijo
                    └─ historial ──── últimos 20 mensajes del hilo
```

**La consecuencia práctica**: para cambiar QUÉ SABE el bot no hace falta desplegar (es la tabla
`hechos`, se edita por API). Para cambiar CÓMO SE COMPORTA, sí (es `prompt.ts`).

### `<contacto>` — lo que sabe de la persona

| Dato | De dónde, en orden de precedencia |
|---|---|
| **nombre** | Memoria de la conversación → Cerberus (teléfono verificado) → perfil de WhatsApp |
| **país** | Cerberus → **el prefijo del teléfono** (se marca «probable») |
| **es cliente / compras** | Cerberus |
| **interés** | Tabla `intereses` → propuesta del anuncio (alias de curso) |
| **señales** | Derivadas: cotizado, enfriado |

⚠️ **El bot NUNCA pregunta el país** (regla 0b, decisión del 1-ago): ya lo tiene del prefijo.

---

## 2. Los 24 hechos que puede afirmar

Todo esto vive en la tabla `hechos`. **Si un dato no está acá, el bot no lo puede decir.**

### Siempre disponibles (`momentos: []`)

| clave | Qué dice |
|---|---|
| `precio-por-pais` | Regular $199 → promo **$150 USD**. PE **S/500** · MX **$2,800** · BO **1,350 Bs** · resto USD. **Con instrucción de decir SOLO el del país de la persona** |
| `duracion-8-sesiones` | 3 semanas · 8 sesiones · 10 al 31 de agosto · lun/mié/vie 19–21 GMT-5 |
| `quien-certifica` | Escuela de Inteligencia & Estrategia + GOBERNA Analytics · emitido desde EE.UU. · Empresa Asociada CCL |
| `horas-academicas` | 120 horas académicas (clases en vivo + campus) |
| `titulo-que-recibe` | Asesor Estratégico Internacional en Inteligencia y Contrainteligencia, con código de verificación |
| `requisito-examen` | Sin requisitos para entrar; examen final con 13 para certificarse |
| `ponentes` | Los 5, con perfil |
| `canal-oficial` | grupogoberna.com · facebook.com/gobernacorp · la página del diploma |
| `brochure` | Que existe y cómo se anuncia antes de adjuntarlo |
| `pago-peru` · `pago-mexico` · `pago-bolivia` · `pago-ecuador` · `pago-usa` · `pago-panama-guatemala-rd` · `pago-link-tarjeta` · `pago-otros-paises` | Las cuentas de cobro de cada país |

> **Los ocho de pago quedaron SIN gate a propósito.** Tenían filtro por momento y **falló dos veces
> el mismo día**, las dos con un lead preguntando cómo pagar (SOMBRA 16:56, Moisés 22:21): el bot
> decía «te paso los datos» y no los tenía en el prompt. La protección no era el gate — un hecho
> **se ofrece, no se dispara**.

### Con gate de momento

| clave | Momentos | Por qué está acotado |
|---|---|---|
| `cuotas` | cotizada · material-sin-precio · en-conversacion · enfriada | *«NO lo ofrezcas si no te lo piden»*. Lo principal es 1 pago |
| `datos-para-registro` | idem | Es el paso posterior al sí |
| `cierre-inscripciones` | idem | Urgencia: se le dice a quien ya sabe qué compra |
| `acceso-un-anio` · `publico-general` · `certificado` · `proxima-edicion` | varios | Heredados del catálogo medido de #153 |

---

## 3. Las piezas que puede MANDAR (≠ afirmar)

`GET /api/catalogo/piezas` devuelve **38 piezas, 29 enviables**. Pero solo una es una secuencia real:

### `plantilla:3` — «DIPICOT — información del diploma (bot)» · dueño `bot` · estado `aprobada`

| Paso | Qué es |
|---|---|
| 1 | El texto del diploma (908 car., con negritas y el ancla $199 → $150) |
| 2 | `dipicot-temario-2026-08.jpeg` |
| 3 | `dipicot-docentes-2026-08.jpeg` |

**Verificalo con `npm run bot:verificar`** — imprime los tres pasos y si los archivos están en disco.

> ⚠️ El paso 1 **no lleva saludo**. Se lo saqué el 1-ago porque el bot se presentaba en su propia
> burbuja y después la plantilla lo repetía: el lead leía dos veces «soy Sofía Rodríguez».
> Si esta plantilla se manda a mano, hay que anteponerle un saludo.

### Las otras dos plantillas

`plantilla:1` y `plantilla:2` están en estado **`propuesta`** (dueño `Usuario1`) — el bot **no las
puede mandar**, y la #1 además tiene una imagen pendiente.

### Los cuatro acuses (`autorespuesta/plantillas.ts`, en código)

`fuera-de-horario-campana` · `-interes` · `-primer-contacto` · `-seguimiento`. Son de la
**auto-respuesta nocturna** (otro frente, hoy apagado), no del bot conversacional.

### El brochure

`dipicot-brochure-2026-08.pdf` está en `.wa-media` y **NO es una pieza del catálogo**: solo se manda
a mano. Es la respuesta a la objeción de credibilidad (trae los CV de los ponentes).

---

## 4. Las cinco herramientas que puede llamar

| Tool | Qué hace HOY | Estado |
|---|---|---|
| `mandar_pieza` | Manda la secuencia completa, con dedupe, procedencia y kill-switch entre pasos | ✅ desde F3 |
| `registrar_interes` | Escribe en `intereses` con `vendedora_id = 'bot'` | ✅ desde F3 |
| `calificar` | Escribe temperatura en `bot_calificaciones` | ⚠️ **escribe en una tabla sin lectores** |
| `escalar_a_vendedora` | Marca escalada + pausa de 2 h de gracia | ⚠️ **no le avisa a nadie** |
| `pausar_conversacion` | Pausa indefinida (rechazo o despedida) | ✅ |

---

## 5. Lo que el guardrail BLOQUEA (`bot/guardrails.ts`)

Es la última compuerta antes de que el texto salga. Seis violaciones, y **ninguna es de estilo**:

| Violación | Qué ataja |
|---|---|
| `precio` | Cualquier cifra que parezca un precio. El precio sale del catálogo, no del modelo |
| `automatismo` | «soy un bot», «como IA», jerga de modelo |
| `humanidad` | Afirmar ser humano, o **negar ser máquina** (delata igual y además miente) |
| `voseo` | «tenés», «podés», «sos» — el registro es «tú» peruano |
| `derivacion` | **«un asesor te contactará»** y variantes. Kathy/Sofía ES la asesora |
| `largo` | Más de 8.000 caracteres |

Un texto bloqueado **no sale**: la respuesta queda en `bot_respuestas` con estado `bloqueada`.

---

## 6. Los frenos, antes de decidir si responde

| Freno | Qué mira |
|---|---|
| **modo** | `bot_estado.modo` (base) sobre el env. **Kill-switch sin deploy** |
| **frenado** | `bot_estado.frenado_motivo` — freno total |
| **pausa** | `bot_pausas` — rechazo, despedida, escalada (2 h de gracia), descarte manual |
| **vendedora_activa** | ¿contestó una persona DESPUÉS del último mensaje del lead? |
| **spam** | El mismo texto repetido |
| **topes** | 40 turnos/día por conversación · 60/hora por línea · **2 piezas por turno** |
| **línea habilitada** | El número tiene que estar en `WHATSAPP_NUMEROS` |
| **espera excesiva** | Más de N horas sin procesar, se descarta |

---

## 7. Los dos vocabularios de estado (se confunden)

Son **distintos** y viven en lugares distintos:

**`bot_estado_conversacion.estado`** — la máquina del bot (`bot/estados.ts`):
`desconocido · saludo · identificando · calificando · informando · cotizando · escalado · pausado ·
enfriado · completado`

**`MomentoDeVenta`** — el que filtra los hechos (`sugerencias/estado.ts`):
`primer-contacto · pidiendo-info · material-sin-precio · cotizada · en-conversacion · enfriada`

> ⚠️ **Ese cruce es la causa de dos fallas de hoy.** Un hecho gateado por `cotizada` no aparece si la
> conversación nunca alcanza ese momento — y los momentos NO se derivan del estado del bot, sino de
> lo que pasó en el hilo. Al configurar un gate, hay que pensar en el segundo vocabulario, no en el
> primero.

---

## 8. El pipeline, paso por paso

```
claim → normalizar → contexto → estado → decidir → validar_entrada →
recuperar piezas → prompt → tools → AGENTE (LLM) → validar_salida (guardrail) →
transicionar → scoring → ENVIAR TEXTO → ENVIAR PIEZAS → ejecutar acciones → auditar
```

La traza de cada turno queda en el log con el tiempo de cada tramo. Ejemplo real:

```
recuperar:29_piezas·0_ya_enviadas → agente:ok → validar_salida:ok →
enviar:enviadas_2_de_2 → piezas:plantilla:3:3/3
```

---

## 9. Lo que el bot NO tiene, hoy

| Agujero | Costo medido |
|---|---|
| **La escalada no le avisa a nadie** | 3 leads marcados «listo para cerrar» el 1-ago, invisibles |
| **No hay reenganche** | 38 de 66 recibieron material y no volvieron. La config existe (`followupsDia`), sin consumidor |
| **El claim no vence** | Cada deploy con restart cuelga al lead en vuelo, en silencio |
| **No lee audio ni stickers** | 5 casos en un día; 2 quedaron colgados. Un sticker puede ser una objeción |
| **Pide el nombre antes de dar la información** | 6 leads en una noche con solo un saludo |
| **Solo vende DIPICOT** | Llegaron pedidos de Ciberseguridad, Consultoría y «seguridad ejecutiva» |
| **No hay simulacro completo** | `bot:verificar` cubre el catálogo, no el plan de despacho por conversación |

---

## 10. Preguntas abiertas para la sesión de análisis

1. **¿El mapeo de hechos cubre lo que la gente pregunta?** Hoy hubo preguntas sin respuesta en el
   catálogo: la ceremonia de graduación, «¿dónde es el curso?» (se agregó a mano), «seguridad
   ejecutiva».
2. **¿Los gates de momento están bien puestos?** Ya fallaron dos veces. ¿Conviene que algo tenga
   gate, o alcanza con el texto del hecho y el criterio del modelo?
3. **¿Un hecho por país o uno con la tabla?** Se probaron las dos: la tabla hacía que el bot recitara
   los tres países; ahora la tabla viene con la instrucción de elegir. Falta ver si obedece.
4. **¿La secuencia del prompt refleja cómo se vende?** El prompt pide el nombre antes de informar;
   el vendedor real manda el paquete y después conversa.
5. **¿Qué pasa cuando el lead pide otro producto?** Hoy es improvisación.
