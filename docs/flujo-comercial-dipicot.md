# Flujo comercial del bot — Diploma de Especialización en Inteligencia y Contrainteligencia

> **Fecha**: 2026-08-01 · **Alcance**: UN producto, `DIPICOT`. Nada de lo que sigue está pensado
> para servir a otro diplomado.
> **Base**: `docs/bot-inteligencia-contexto.md` (el documento de entrada), verificado contra el
> código de `server/src/bot/` en `f7b4c4e` y contra `hermes_db` en VPS1 (lectura, 2026-08-01).
> **No reemplaza** ADR 0028 (el bot existe y el lead no sabe que hay automatismo) ni ADR 0015 §
> «lo que deliberadamente no se hizo».

---

## 0. Resumen ejecutivo

El bot está en producción, en modo `automatico`, y **no puede vender**. No por calidad de prompt:
por tres cables que no están conectados y una regla comercial que apaga la conversación justo en
el momento de mayor intención.

Los cuatro hallazgos que definen todo lo demás (verificados en código, no inferidos):

| # | Hallazgo | Dónde | Consecuencia comercial |
|---|---|---|---|
| **H1** | `mandar_pieza` **no ejecuta nada** | `bot/ejecutar.ts:94` | El flyer, el precio y el temario **nunca salen**. El bot conversa sobre un producto que no puede mostrar. |
| **H2** | `registrar_interes` **no ejecuta nada** | `bot/ejecutar.ts:95` | Ninguna conversación del bot deja interés en el CRM. La vendedora que reciba el handoff recibe un hilo sin ficha. |
| **H3** | Escalar **silencia al bot para siempre** y **no avisa a nadie** | `bot/ejecutar.ts:61-74` (`hasta: null`) + `bot_calificaciones` sin un solo lector | Cada escalación es un lead que queda en el limbo: el bot no vuelve a hablar y ninguna persona se entera. |
| **H4** | El bot apunta a **`DIPCINTE`**, que es otro producto ($100, Ciberinteligencia) | `bot/recuperador.ts:26`, `bot/contexto.ts:20` | El interés que llega del anuncio (`DIPICOT`) y el catálogo que el bot ve no casan en familia. |

Y la regla que cuesta más plata que las cuatro juntas:

> **Regla dura 6** (`bot/prompt.ts:108-112`): si piden precio, forma de pago o cómo inscribirse →
> escalar `por_cerrar` y **no seguir conversando**.

En WhatsApp de un ticket de USD 150, «¿cuánto cuesta?» es el mensaje **más frecuente** y suele
llegar en el turno 1 o 2. Con H3, esa regla convierte la pregunta de mayor intención comercial en
un final de conversación. El bot escala, se calla, nadie mira, el lead se enfría.

**La propuesta**, en una línea: el bot deja de ser un formulario de calificación que se apaga al
oír «precio» y pasa a ser el que **entrega la pieza y sostiene la objeción**, escalando solo en
**intención de pago** — con un handoff que avisa, deja ficha y **no lo enmudece**.

El producto ayuda: la pieza aprobada (plantilla 3) **ya trae valor y precio en el mismo mensaje**.
Eso hace innecesaria toda la coreografía de «no des el precio hasta crear valor»: un solo envío
resuelve las dos cosas.

---

## 1. El sistema tal como es hoy (comprensión verificada)

### 1.1 Qué sabe el bot

Tres fuentes, y **solo** tres. Todo lo que no está acá, no existe para el bot.

| Fuente | Contenido | Editable sin deploy |
|---|---|---|
| `<contexto_negocio>` (`bot/contexto.ts:9-36`) | Qué es la Escuela, modalidad 100% virtual/Zoom/grabadas/campus 24-7, lista de programas destacados, **6 sedes con teléfono y dirección**, «no damos certificaciones universitarias», «no hay programas gratuitos» | ❌ código |
| `<datos_que_puedes_afirmar>` — los 7 hechos (`hechos` en base; default en `hechos/catalogo.ts`) | cuotas · acceso un año · público general · canal oficial · moneda local · certificado · próxima edición | ✅ tabla `hechos` |
| `<piezas_enviables>` (`catalogo/repositorio.ts` → `bot/recuperador.ts`) | Hoy: **1 plantilla aprobada** (la de Inteligencia, sin imagen) + los 7 hechos como piezas | ✅ tablas `plantillas`/`plantilla_pasos` |

**El contenido real de la única pieza que puede mandar** (plantilla 3, aprobada): Diploma
Internacional de Inteligencia y Contrainteligencia · inicio **lunes 10 de agosto** · **lunes,
miércoles y viernes, 19:00–21:00 GMT-5** · **certificación internacional de 120 horas emitida desde
Estados Unidos** · **precio de promoción $150 dólares** · **bono: curso grabado de
Ciberinteligencia**.

Esa pieza es, hoy, el 90 % del argumento de venta del producto. Y el bot no la puede enviar (H1).

### 1.2 Qué NO sabe (y por lo tanto no puede decir sin inventar)

- **El temario** — módulos, plan de estudios. No está en ninguna pieza ni en el contexto.
- **La duración en semanas** (solo «120 horas»).
- **La fecha de cierre de inscripción** de la edición de agosto.
- **Los docentes.**
- **Si la promo de $150 vence.**
- **Cómo se paga en concreto** (link, medios, moneda por país) más allá del hecho «2 cuotas».
- **Qué edición está vendiendo** (hay 14 activas; el bot no consulta Cerberus para saber cuál).

Las cinco primeras son preguntas **naturales del turno siguiente al flyer**. Hoy todas terminan en
`escalar(sin_respuesta_en_catalogo)` → silencio permanente (H3). Esto no es un detalle de
conocimiento: es la fuga principal del embudo.

### 1.3 Cómo responde

`claude-haiku-4-5` vía Bedrock, `max_tokens: 2000`, hasta **4 iteraciones** de tool loop
(`bot/agente.ts:31`). Rol: «Kathy Alva, asesora académica». Español neutro del Perú, conjugación de
«tú», voseo prohibido con capa propia de guardrail. 2–4 oraciones, **una pregunta por mensaje**,
cero emojis. El texto se trocea en 1–3 burbujas (`chunker.ts`) que salen espaciadas 2–6 s.

**Guardrail de salida** (`guardrails.ts`, 1.278 líneas): bloquea cifras de precio, marcas de
automatismo («soy un asistente», «sistema», «IA»), afirmaciones de humanidad y voseo. Si bloquea →
`texto: null` + `escalar(error_bot)` (`bot/agente.ts:145-151`).

**Guardrail de entrada** (`guardrailsEntrada.ts`): sanitiza, detecta 10 patrones de jailbreak,
clasifica intención en 9 clases. La clasificación **no se usa para rutear** — solo se loguea.

### 1.4 Herramientas (5) — y qué hace cada una de verdad

| Tool | Lo que promete | Lo que hace hoy |
|---|---|---|
| `mandar_pieza(id)` | Enviar flyer/precio/temario | 🔴 **nada** (`ejecutar.ts:94`) |
| `registrar_interes(familia)` | Guardar el interés | 🔴 **nada** (`ejecutar.ts:95`) |
| `calificar(temp, motivo)` | Temperatura del lead | ✅ escribe `bot_calificaciones` — **sin lectores** |
| `escalar_a_vendedora(motivo)` | Pasar a un humano | ⚠️ marca `escalada` + **pausa permanente**; **no notifica** |
| `pausar_conversacion(motivo)` | Cerrar cortésmente | ✅ pausa permanente |

Las tools **acumulan** `Accion[]` y no ejecutan efectos (patrón correcto, ADR: D3). El problema no
es el patrón: es que dos de los cinco casos del ejecutor están vacíos con un comentario que dice
que los ejecuta otro archivo — y ese archivo tampoco los ejecuta.

### 1.5 El pipeline (16 pasos, `bot/orquestador.ts`)

`normalizar → contexto → estado → decidir → validar entrada → recuperar → prompt → tools →
agente → validar salida → transicionar → scoring → enviar → ejecutar → auditar`

Estado real de cada paso:

| Paso | Estado | Nota |
|---|---|---|
| 2 normalizar | ✅ | Sanitiza **solo el último entrante**; el historial que va al LLM entra crudo |
| 3 contexto | ✅ | Memoria › Cerberus › perfil WA; país por prefijo etiquetado como «probable» |
| 4 estado | ✅ | Lee `bot_estado_conversacion` |
| 5 decidir | ⚠️ | **4 de 9 motivos están muertos** (§1.9) |
| 6 validar entrada | ✅ | Solo spam |
| 7 recuperar | ⚠️ | Filtra por `ENFOQUE_PRODUCTO` = **DIPCINTE** (producto equivocado) |
| 8 prompt | ✅ | Inyecta **los 7 hechos siempre**, sin filtrar por momento de venta |
| 9 tools | 🔴 **stub** | `t.cerrar("stub_todas")` — todas las tools, en todos los estados |
| 10 agente | ⚠️ | Pierde `contactoCtx` a partir de la 2.ª iteración (§1.9) |
| 11 validar salida | 🔴 **stub** | La validación real ocurre dentro de `agente.ts`; este paso solo mira si hay texto |
| 12 transicionar | ⚠️ | La máquina avanza porque **el bot habló**, no porque el lead dijo algo (§2) |
| 13 scoring | 🔴 stub | |
| 14 enviar | ✅ | `EnvioControlado`, persistencia en el hilo, `automatico: true` |
| 15 ejecutar | ⚠️ | 2 de 5 acciones son no-op (H1, H2) |
| 16 auditar | 🔴 stub | |

### 1.6 Cuándo escala

Seis motivos: `pidio_humano` · `pregunto_si_es_bot` · `por_cerrar` · `sin_respuesta_en_catalogo` ·
`frustrado` · `error_bot`. Los seis producen el **mismo** efecto: `bot_calificaciones.escalada =
true` + `bot_pausas(motivo: 'escalado_*', hasta: null)`.

`hasta: null` + `decision.ts:35` (`pausa.hasta === null` → saltar) = **el bot no vuelve a
responder nunca**, aunque el lead escriba diez veces más. Ya pasó en producción con un lead real
(el caso «Alan» de `docs/bot-inteligencia-contexto.md` §2.3); se destrabó borrando la fila a mano.

Y del otro lado no hay nadie: `bot_calificaciones` **no tiene un solo lector** en todo el server ni
en el front. No hay ruta `/api/bot/*`, no hay chip en la cola, no hay notificación.

### 1.7 Cuándo registra interés

Nunca (H2). El prompt lo pide (regla 7), la tool valida contra `alias_curso`, la acción se acumula
— y el ejecutor la descarta.

### 1.8 Cómo califica

Lo decide **el LLM**, con una tool de texto libre para el motivo. No hay criterio determinista.
Nadie lee el resultado.

### 1.9 Los cinco defectos de cableado que hay que conocer antes de diseñar nada

1. **`vendedora_activa` está muerto.** `armarHechos()` hardcodea
   `huboSalienteHumanoDespuesDe: null` (`orquestador.ts:635`). Si Luz responde un hilo del bot, el
   bot **le escribe encima**. En producción, en modo automático, hoy.
2. **`frenado` y el kill-switch de base están muertos.** `frenado: false` hardcodeado
   (`orquestador.ts:642`); la tabla `bot_estado` (`modo`, `frenado_motivo`) existe y **nadie la
   lee**: el modo sale de `BOT_MODO` en el `.env`. **Apagar el bot exige editar el `.env` y
   reiniciar.**
3. **`transporteConectado` se calcula y se tira.** `orquestador.ts:626-629` computa el valor real y
   la línea 641 pasa `true` fijo. El bot «responde» con el transporte caído.
4. **El contexto del contacto se pierde en cuanto el bot usa una tool.** `agente.ts:83-95`: el
   bloque `<contacto>` (nombre, país, interés, señales) va como segundo bloque de system **solo en
   `iter === 0`**; de la iteración 2 en adelante el system es el string grande a secas. O sea: el
   bot olvida con quién habla **justo después de actuar**.
5. **El historial no distingue quién escribió.** `orquestador.ts:290-296` mapea todo saliente a
   `assistant`. Si una vendedora humana intervino, el bot cree que eso lo dijo él y sigue el hilo
   como propio. Además ese historial entra al LLM **sin pasar por el guardrail de entrada** (solo
   el último mensaje se sanitiza).

Un sexto, menor pero contaminante: `memoria.ts:124-126` guarda en el campo `familia` **texto crudo
del lead** («el diplomado de inteligencia»), no un código de familia. Ese valor viaja a
`datosEstado.familia` y a la memoria persistida como si fuera un SKU.

---

## 2. Auditoría del flujo actual, etapa por etapa

Formato por etapa: **bien / mal / falta / sobra / riesgo / mejora**.

### 2.1 Saludo

- **Bien**: identidad estable («Kathy Alva, asesora académica»), tono correcto, sin emojis, sin
  voseo, una pregunta por mensaje. Cumple la regla del dueño (el lead no sabe que hay automatismo).
- **Mal**: la regla 0 impone **presentarse + pedir nombre + pedir país + preguntar el área**, un
  dato por mensaje. Son **hasta 4 turnos de peaje antes de entregar una sola cosa de valor**, a
  alguien que ya hizo clic en un anuncio de Inteligencia.
- **Falta**: usar lo que ya se sabe. El pipeline **ya trae** el nombre del perfil de WhatsApp, el
  país por prefijo y el interés derivado del anuncio (`contexto.ts`) — y aun así el prompt manda
  preguntar todo.
- **Sobra**: la pregunta de país cuando el prefijo la contesta; la pregunta de área cuando el
  referral la contesta.
- **Riesgo**: abandono. Cada turno de interrogatorio previo al valor es una salida del embudo.
- **Mejora**: **saludo + entrega en el mismo turno.** El nombre se pide **al cierre** (donde además
  califica: quien da su nombre completo para reservar está comprando), no en la puerta.

### 2.2 Descubrimiento

- **Bien**: existe un clasificador de intención (`clasificarIntencion`, 9 clases) razonable.
- **Mal**: **no se usa para nada**. Se calcula y se loguea (`guardrailsEntrada.ts:224`).
- **Falta**: que el descubrimiento sea **por defecto y refutable**: asumir DIPICOT (viene del
  anuncio) y confirmarlo en una línea, no averiguarlo desde cero.
- **Sobra**: el descubrimiento abierto («¿qué área te interesa?») en un bot de un solo producto.
- **Riesgo**: el bot pregunta lo que la persona ya dijo → se lee como que no la escucharon.
- **Mejora**: `intencion` decide el **primer movimiento** (§4), y el prompt recibe la intención
  clasificada como dato, no como adivinanza.

### 2.3 Identificación del interés

- **Bien**: `interesPropuesto` se deriva del referral del anuncio con la precedencia de #72
  (registrado › formulario › anuncio) y `alias_curso` mapea bien «inteligencia y
  contrainteligencia» → **DIPICOT**.
- **Mal**: **el bot está enfocado en `DIPCINTE`** (H4). Lo que el contexto propone (DIPICOT) y lo
  que el catálogo del bot filtra (DIPCINTE) son dos productos distintos.
- **Falta**: que `registrar_interes` escriba (H2).
- **Riesgo**: el bot cotiza mentalmente un producto de $100 mientras el lead pregunta por uno de
  $150; y el CRM nunca se entera de nada.
- **Mejora**: `ENFOQUE_PRODUCTO = "DIPICOT"`, la plantilla 3 con `familia_curso = 'DIPICOT'`, y
  `registrar_interes` conectado a `confirmarInteresDerivado()` — **la misma función que usa el
  botón «Confirmar» de la vendedora** (`cursos/confirmar.ts`), que resuelve la familia contra el
  catálogo vivo de Cerberus y guarda el nombre crudo del producto. Cero componentes nuevos.

### 2.4 Presentación del diplomado

- **Bien**: la plantilla 3 está escrita, aprobada y es completa (fechas, horario, certificación,
  precio, bono).
- **Mal**: el bot no la puede mandar (H1). Hoy la «presentación» es prosa de un LLM sobre un
  producto que solo conoce por el nombre.
- **Falta**: **temario** — la pregunta inmediata de quien lee un flyer.
- **Riesgo**: alucinación por vacío. El modelo tiene `<contexto_negocio>` genérico y presión
  conversacional; el guardrail cubre cifras y automatismo, **no cubre inventar módulos, duración
  ni docentes**.
- **Mejora**: conectar `mandar_pieza` y cargar el temario como pieza. Y extender el guardrail a
  entidades no afirmables (§6).

### 2.5 Envío del flyer

- **Bien**: la pieza existe y `EnvioControlado` es la puerta correcta.
- **Mal**: no sale. Y la plantilla 3 **no tiene imagen** (`media_archivo` vacío) — el 42 % de las
  secuencias que cierran llevan imagen.
- **Falta**: expansión de `{nombre}`/`{precio}`/`{curso}` en lo que manda el bot (el server ya lo
  hace en `enviar-paso`, el bot no lo usa) y **estampado de procedencia** (`pieza_via: 'bot'`) para
  que el lazo de resultados (#169) pueda medir si el flyer del bot convierte.
- **Riesgo**: el precio vive **dentro** del flyer. Si el flyer cambia y la versión no se estampa,
  se mezclan dos textos y ninguna medición sirve.
- **Mejora**: `mandar_pieza` real, por `enviarMediaYProyectar`/`enviarTextoYProyectar`, con
  `procedencia/pieza.ts` estampando clase, ref y versión.

### 2.6 Manejo de preguntas

- **Bien**: los 7 hechos están en el prompt y son buenos (medidos sobre 1.876 conversaciones).
- **Mal**: se inyectan **los 7 siempre**, sin pasar por `elegirHechos()`/`momentoDeVenta()` — la
  cabeza que el resto de la casa usa para decidir qué corresponde decir. El bot es el único
  consumidor que no la usa.
- **Falta**: el temario, la duración, el cierre de inscripción, los docentes, las formas de pago.
  **Las cinco preguntas más probables después del flyer terminan en escalada.**
- **Sobra**: nada. El prompt es corto y ordenado.
- **Riesgo**: la escalada por `sin_respuesta_en_catalogo` es hoy la **salida más frecuente** y es
  un pozo (H3).
- **Mejora**: cargar la munición (§3) — es más barato y más seguro que cualquier cambio de prompt.

### 2.7 Manejo de objeciones

- **Bien**: los 7 hechos cubren, uno a uno, las objeciones medidas.
- **Mal**: **no hay etapa de objeciones en el flujo**. La regla 5 manda pausar ante «no me
  interesa», y la 6 manda escalar ante precio. Entre esas dos no queda espacio para sostener.
- **Falta**: distinguir **objeción** de **rechazo**. «Está caro» es una objeción con respuesta
  («2 cuotas», «moneda local»); hoy puede caer en «no le interesa» → pausa permanente.
- **Riesgo**: se pierde el lead más recuperable del embudo.
- **Mejora**: estado `objetando` explícito, con un hecho asignado por tipo de objeción y **un
  intento de sostener antes de pausar** (§5).

### 2.8 Solicitud de precio

- **Bien**: el LLM tiene prohibido escribir cifras y el guardrail lo hace cumplir. Correcto y no se
  toca.
- **Mal**: la regla 6 escala y corta. Con H3, «¿cuánto cuesta?» = fin de la conversación.
- **Falta**: la pieza. El precio debería salir por `mandar_pieza` — y la pieza que lo trae
  (plantilla 3) ya está aprobada.
- **Riesgo**: es **el** riesgo. Es la pregunta más frecuente y hoy tiene la peor respuesta posible.
- **Mejora**: **el precio se entrega, no se escala.** Escalar se reserva para intención de pago.

### 2.9 Envío de información / calificación

- **Bien**: la temperatura tiene tres valores claros.
- **Mal**: la decide el LLM. Un dato que sirve para **priorizar la cola de una persona** no puede
  ser una opinión de un modelo barato.
- **Falta**: lectores. Nadie ve la calificación.
- **Mejora**: derivarla de hechos observables (recibió pieza de precio, preguntó por pago, dio
  nombre completo, puso objeción de aplazamiento) — el patrón de `senales/` (ADR 0016: se deriva,
  no se guarda). Y **retirar la tool `calificar`**: menos superficie de alucinación, menos tokens,
  cero pérdida.

### 2.10 Escalamiento

- **Bien**: los seis motivos son los correctos y están bien elegidos.
- **Mal**: los seis hacen lo mismo, ese algo es «pausa permanente», y no avisa a nadie (H3).
- **Falta**: (a) que la escalada **no enmudezca**; (b) que **se vea** en la cola de Hermes; (c) que
  el handoff lleve **ficha** (interés, país, qué se le mandó, qué preguntó).
- **Riesgo**: crítico y silencioso. No se detecta hasta que alguien revisa hilos a mano.
- **Mejora**: los seis motivos se parten en **dos familias** con efectos distintos (§4.4), la
  escalada se sirve como señal derivada en `/api/senales` y se pinta como chip en la cola,
  reutilizando `FranjaEtiquetas` y el orden de `urgenciaSql.ts`.

### 2.11 Seguimiento

- **Bien**: la política está pensada (20/día, 9:00–20:00 Lima, una vez por lead, ADR 0028).
- **Mal**: **no existe**. Solo hay variables de entorno (`BOT_FOLLOWUP_*` en `config.ts`); no hay
  `bot/followup.ts`.
- **Falta**: la pieza de seguimiento está **propuesta, sin aprobar** (plantilla 2: «¿Le gustaría
  realizar su pago de inscripción hoy día?»).
- **Riesgo**: el aplazamiento es la objeción #1 (13 %) y hoy no tiene mecanismo de captura.
- **Mejora**: fase propia (§7, F4). No es MVP: sin H1/H3 resueltos, un follow-up solo agrega
  mensajes a conversaciones que igual no pueden avanzar.

### 2.12 Estado general del flujo

El flujo actual, dibujado como lo vive un lead que llega del anuncio:

```
lead: "hola, info del diplomado de inteligencia"
bot:  saludo + "¿cuál es tu nombre?"            ← turno perdido (el perfil WA ya lo tiene)
lead: "Javier"
bot:  "¿desde qué país me escribes?"            ← turno perdido (el prefijo ya lo dice)
lead: "Perú"
bot:  "¿qué área te interesa?"                  ← turno perdido (el anuncio ya lo dijo)
lead: "el de inteligencia. ¿cuánto cuesta?"
bot:  "Dame un momento, te mando la información" + escalar(por_cerrar)
      → pausa permanente. Nadie avisado. Fin.
```

Cuatro turnos, cero información entregada, un lead caliente en el limbo.

---

## 3. El conocimiento

### 3.1 Qué necesita un vendedor experto de ESTE diplomado

Ordenado por cuántas conversaciones destraba, no por completitud:

| # | Necesita saber | ¿Existe? | Dónde vive / debería vivir |
|---|---|---|---|
| 1 | Qué es y qué promete el diploma | ✅ | **Pieza** — plantilla 3 |
| 2 | Precio vigente y si hay promoción | ✅ (en la pieza) | **Pieza** + **Cerberus** para `{precio}` |
| 3 | Fecha de inicio, días y horario | ✅ (en la pieza) | **Pieza** |
| 4 | Qué certificación es y quién la emite | ✅ (pieza + hecho `certificado`) | **Hecho** + pieza |
| 5 | **Temario / módulos** | 🔴 **NO** | **Pieza** (plantilla de un paso o PDF) |
| 6 | **Duración en semanas** | 🔴 **NO** (solo «120 h») | **Hecho** |
| 7 | **Cierre de inscripción** | 🔴 **NO** | **Hecho** (es lo que crea urgencia legítima) |
| 8 | **Docentes** | 🔴 **NO** | **Hecho** o pieza |
| 9 | Formas de pago (cuotas) | ✅ parcial (hecho `cuotas`) | **Hecho** |
| 10 | **Link de pago / medios concretos** | 🔴 no aprobado | **Pieza** (la propuesta 1 lo tiene, con emojis) |
| 11 | Precio en moneda local | ✅ (hecho `moneda-local`) | **Hecho** + **Cerberus** |
| 12 | Para quién es (perfil) | ✅ (hecho `publico-general`) | **Hecho** |
| 13 | Qué pasa si no puede en vivo | ✅ (hecho `acceso-un-anio`) | **Hecho** |
| 14 | Cómo verificar que somos reales | ✅ (hecho `canal-oficial` + sedes) | **Hecho** + contexto |
| 15 | Qué ofrecer al que dice «más adelante» | ✅ (hecho `proxima-edicion`) | **Hecho** |
| 16 | **Qué edición se está vendiendo** (hay 14) | 🔴 el bot no lo consulta | **Cerberus**, siempre |

**Los cinco huecos rojos (5, 6, 7, 8, 10) son, juntos, la causa principal de escalada.** Cargarlos
cuesta horas de una persona con el dato a mano y no requiere una línea de código.

### 3.2 Qué va como Hecho y qué va como Pieza

La regla, para que nadie tenga que decidirlo caso por caso:

> **Hecho** = una frase que responde una objeción y que el bot **afirma** en su propia voz.
> Editable sin deploy, corto, sin cifras.
> **Pieza** = un mensaje completo que sale **tal cual**, aprobado por una persona. Es el único
> lugar donde puede haber una **cifra**, una **fecha**, un **link** o una **imagen**.

De ahí sale, sin ambigüedad:

- Temario → **Pieza** (es largo y estructurado; además puede llevar PDF).
- Duración, cierre de inscripción, docentes → **Hecho** (una línea, y cambian por edición).
- Precio, link de pago, flyer → **Pieza** (cifra + link + imagen).
- Precio en la moneda del lead → **Cerberus**, resuelto al enviar (`{precio}` por familia DIPICOT →
  última edición activa). Nunca un número cacheado (ADR 0007).

### 3.3 Qué debe venir SIEMPRE de Cerberus

- El **precio vigente** y la **edición activa** de DIPICOT, resueltos en el instante del envío.
- El **nombre del producto** que se guarda como interés (`intereses.curso` es lo que después se
  cotiza — falla ruidoso, nunca inventa un nombre parecido).
- La **ficha del contacto** (si ya es cliente, cuántas compras).

### 3.4 Qué NUNCA debe responder el LLM

Lista cerrada. Todo esto sale de una pieza o escala:

1. Cualquier **cifra** de precio, descuento, promoción o cuota. *(ya lo cubre el guardrail)*
2. Cualquier **fecha** — de inicio, de cierre, de entrega de certificado. *(hoy NO lo cubre nada)*
3. **Cantidad** de módulos, semanas, sesiones o créditos. *(hoy NO lo cubre nada)*
4. **Nombres propios de docentes.** *(hoy NO lo cubre nada)*
5. **Links** de pago o de inscripción.
6. **Validez universitaria, homologación o convalidación.** El contexto ya dice que no son
   certificaciones universitarias: el bot repite eso y nada más.
7. **Promesas de tiempo** («te llamamos en 5 minutos», «te responden hoy»). *(regla 8, sin
   guardrail)*
8. Si es un bot o una persona. *(cubierto por guardrail + regla 3)*

Los puntos **2, 3, 4 y 7 no tienen ninguna defensa hoy**. Ese es el hueco de alucinación real y
está en §6.

---

## 4. El flujo de venta ideal

### 4.1 Los estados

Los 10 estados actuales (`bot/estados.ts`) son un **contador de turnos disfrazado**: se avanza con
la acción `bot_respondio`, o sea porque el bot habló, no porque el lead dijo algo. Estos 9 avanzan
por **hechos del lead**:

| Estado | Significa | Tools habilitadas (llena el `paso9Tools`, hoy stub) |
|---|---|---|
| `nuevo` | Escribió; no sabemos qué quiere | `mandar_pieza(flyer)`, `escalar` |
| `enfocado` | Sabemos que quiere DIPICOT | `mandar_pieza(flyer)`, `escalar` |
| `informado` | **Recibió el flyer** (valor + precio) | `mandar_pieza(temario)`, `escalar` |
| `objetando` | Puso una objeción tipificada | `mandar_pieza(temario\|pago)`, `escalar` |
| `por_cerrar` | Intención de pago explícita | `mandar_pieza(pago)`, `escalar(por_cerrar)` |
| `handoff` | Hay una persona a cargo | ninguna |
| `dormido` | No contestó ≥ 24 h desde `informado`/`objetando` | `mandar_pieza(seguimiento)` × 1 |
| `cerrado_no` | Rechazó o se despidió | ninguna |
| `vendido` | Hay venta atribuida (`conversiones_wa`) | ninguna |

Diferencia clave con lo actual: **`handoff` NO es terminal**, y `escalado`/`pausado` dejan de ser
lo mismo.

### 4.2 Las transiciones (condición explícita, sin ambigüedad)

| # | Desde | Condición (evaluada en código, no por el LLM) | Hacia | Respuesta esperada | Herramientas | CRM |
|---|---|---|---|---|---|---|
| T1 | — | Entrante y **hay** interés derivado (referral/alias) o el texto matchea un alias de DIPICOT | `enfocado` | Saludo breve + **flyer** + 1 pregunta de avance | `mandar_pieza(plantilla:3)` | `registrar_interes(DIPICOT)` |
| T2 | — | Entrante y **no** hay interés derivable | `nuevo` | Saludo + **una** pregunta: «¿sobre qué programa quieres información?» | — | — |
| T3 | `nuevo` | El lead nombra el diploma o pide info genérica | `enfocado` | Confirmación en una línea + **flyer** | `mandar_pieza` | `registrar_interes` |
| T4 | `nuevo` | El lead pide **otro** producto | `handoff` | «Te paso con una asesora que ve ese programa» | `escalar(fuera_de_alcance)` | señal en cola |
| T5 | `enfocado` | El flyer salió (`enviada`) | `informado` | (mismo turno) pregunta de avance | — | — |
| T6 | `informado` | Intención `pregunta_precio` y el flyer ya salió | `informado` | Responde **sin cifra** sobre lo que ya recibió + hecho `cuotas` o `moneda-local` | — | — |
| T7 | `informado`/`objetando` | Objeción tipificada (§5) | `objetando` | El hecho que corresponde + **cierre de prueba** | eventual `mandar_pieza(temario)` | temperatura derivada |
| T8 | cualquiera activo | Pregunta **sin respuesta en el catálogo** (temario, docentes, fechas) | `handoff` | «Déjame confirmarlo con el área académica y te escribo» + **no inventa** | `escalar(sin_respuesta_en_catalogo)` | señal en cola |
| T9 | `informado`/`objetando` | Intención de pago: «cómo pago», «link», «ya quiero», «resérvame» | `por_cerrar` | Confirma + **pieza de pago** + pide nombre completo | `mandar_pieza(pago)` | temperatura `caliente` |
| T10 | `por_cerrar` | Pieza de pago enviada, o el lead pide hablar con alguien | `handoff` | Una oración de transición, sin prometer plazos | `escalar(por_cerrar)` | señal + ficha |
| T11 | cualquiera | «¿eres un bot?» / «¿eres una persona?» | `handoff` | **No responde la pregunta**; una línea de transición | `escalar(pregunto_si_es_bot)` | señal |
| T12 | cualquiera | Pide humano explícito | `handoff` | Una línea | `escalar(pidio_humano)` | señal |
| T13 | cualquiera | Rechazo explícito o despedida (`rechazo.ts`) | `cerrado_no` | Cierre cortés de **una** oración | `pausar` | temperatura `frio` |
| T14 | `handoff` | **El lead escribe** y **ninguna persona respondió** después de la escalada | vuelve a `objetando` | El bot retoma | — | — |
| T15 | `handoff` | Una **persona** respondió en el hilo | `handoff` (se queda) | El bot **calla** (`vendedora_activa`) | — | — |
| T16 | `informado`/`objetando` | ≥ 24 h sin respuesta del lead | `dormido` | — | — | — |
| T17 | `dormido` | Ventana 9:00–20:00 Lima, ≤ 1 vez, cap diario | `objetando` | **Pieza de seguimiento** | `mandar_pieza(plantilla:2)` | — |
| T18 | cualquiera | Venta atribuida en `conversiones_wa` | `vendido` | — | — | — |

**T14 es la corrección de H3** y es la transición que más leads recupera: hoy no existe y por eso
toda escalada es definitiva.
**T15 es la corrección del defecto 1 de §1.9** y es lo que hace seguro a T14: mientras haya una
persona hablando, el bot no vuelve.

### 4.3 El flujo, dibujado

```
lead: "hola, info del diplomado de inteligencia"   (o llega del anuncio, sin decir nada)
      │
      ├─ T1: hay interés derivable → enfocado
      │
bot:  "Hola, soy Kathy Alva, asesora académica de Goberna. Te paso ahora
       toda la información del Diploma de Inteligencia y Contrainteligencia."
      [PIEZA: plantilla 3 — flyer con fechas, horario, certificación, precio, bono]
       "¿Puedes en el horario de 7 a 9 de la noche?"
      → registrar_interes(DIPICOT) · estado = informado
      │
lead: "está un poco caro" / "no puedo a esa hora" / "¿y el temario?"
      │
      ├─ objeción tipificada → objetando: UN hecho + cierre de prueba
      ├─ temario → PIEZA temario (cuando exista) | escalar si no
      │
lead: "¿cómo pago?"
      │
      └─ T9 → por_cerrar
bot:  "Perfecto." [PIEZA: pago] "¿Me confirmas tu nombre completo para reservar tu cupo?"
      → T10 → handoff: escalar(por_cerrar) + chip en la cola + ficha completa
              y el bot NO se apaga (T14)
```

**Turnos hasta la primera entrega de valor: 1** (hoy: 4).
**Turnos hasta el handoff con ficha completa: 3** (hoy: el handoff no lleva ficha ni avisa).

### 4.4 Las dos familias de escalada

Los seis motivos actuales hacen lo mismo. Deben hacer dos cosas distintas:

| Familia | Motivos | Efecto sobre el bot | Efecto en la cola |
|---|---|---|---|
| **Handoff caliente** — hay una venta a punto | `por_cerrar`, `pidio_humano` | Pausa **con vencimiento** (`hasta = ahora + 2 h`); si el lead escribe antes y nadie respondió → T14 | Chip **«Esperando asesor»**, urgencia máxima |
| **Handoff de consulta** — falta un dato | `sin_respuesta_en_catalogo`, `pregunto_si_es_bot`, `frustrado`, `error_bot` | Pausa **con vencimiento** (`hasta = ahora + 2 h`) | Chip **«Consulta pendiente»** |

Ningún motivo produce `hasta: null`. **`hasta: null` queda reservado para `pausar` (rechazo /
despedida)**, que es la única pausa que debe ser definitiva.

### 4.5 Criterios de finalización

Una conversación del bot termina, y solo termina, por:

1. `cerrado_no` — rechazo explícito o despedida (`pausar`, permanente).
2. `vendido` — venta atribuida.
3. `handoff` **con una persona que efectivamente respondió** (T15) — ahí manda ella.
4. `dormido` después del único follow-up y sin respuesta.

Todo lo demás sigue vivo. Hoy, en cambio, **cualquier** escalada termina la conversación.

---

## 5. Manejo de objeciones (específico de DIPICOT)

Tabla operativa. «Qué NO usar» está para prevenir el modo de fallo real: contestar con el hecho
equivocado o con un dato que no tenemos.

| Objeción | Cómo se detecta | Qué usar | Qué NO usar | Respuesta | ¿Escala? |
|---|---|---|---|---|---|
| **Precio / «está caro»** | `pregunta_precio` + `objecion` («caro», «no me alcanza») | Hecho `cuotas` + hecho `moneda-local`. El flyer ya dice que es precio de **promoción**. | Ninguna cifra en el texto. No inventar descuento ni «te consigo un precio». No anclar contra los $250 salvo que la pieza lo diga. | Un hecho + cierre de prueba: «¿Te sirve reservar con la primera cuota?» | No |
| **Horario / «no puedo a esa hora»** | «no puedo», «trabajo», «horario», «GMT», «zona horaria» | Hecho `acceso-un-anio` (grabadas + campus 12 meses) | No calcular la hora en otro huso (cálculo = invención). El flyer dice **GMT-5**. | «Las clases quedan grabadas y el acceso al campus lo tienes por todo un año.» | No |
| **Perfil / «no soy militar ni policía»** | «no soy», «requisitos», «puedo llevarlo si…» | Hecho `publico-general` | No enumerar profesiones que no estén en el hecho. | El hecho tal cual + una pregunta de avance | No |
| **Certificación / «¿es válido?»** | «válido», «reconocido», «aval», «sunedu», «universitario» | Hecho `certificado` + lo que dice la pieza (**120 h, emitida desde EE. UU.**) | **Nunca** «universitario», «homologado», «convalidable». El contexto lo prohíbe explícitamente. | «Es una certificación internacional de Goberna, con código de verificación» | Si insiste en validez universitaria → **sí** |
| **Confianza / «¿son reales?»** | «estafa», «seguros», «confiable», «cómo sé que» | Hecho `canal-oficial` + **sedes del país del lead** (contexto) | No mandar links que no sean del contexto. No prometer factura ni contrato. | Hecho + la sede que corresponde a su país | No |
| **Modalidad** | «virtual», «presencial», «zoom», «grabado» | Contexto de negocio | No prometer material físico ni presencial. **No tenemos sedes físicas de clase.** | «100 % virtual, en vivo por Zoom, y quedan grabadas» | No |
| **Duración / «¿cuánto dura?»** | «cuánto dura», «cuántos meses», «cuántas semanas» | 🔴 **hoy nada**. La pieza solo dice 120 h. | **No traducir 120 h a semanas ni a meses.** Es aritmética sobre un dato que no tenemos. | Hasta que exista el hecho: escalar | **Sí** (hasta cargar el hecho) |
| **Temario / «¿qué se ve?»** | «temario», «módulos», «plan de estudios», «contenido», «syllabus» | 🔴 **hoy nada** | No enumerar módulos plausibles. Es el riesgo #1 de alucinación. | Hasta que exista la pieza: escalar | **Sí** (hasta cargar la pieza) |
| **Docentes** | «quién dicta», «profesores», «docentes» | 🔴 **hoy nada** | Ningún nombre propio, nunca. | Escalar | **Sí** |
| **Tiempo / «no tengo tiempo»** | «no tengo tiempo», «estoy full» | Hecho `acceso-un-anio` | No minimizar la carga («son solo…»): no sabemos la carga. | El hecho + cierre de prueba | No |
| **Aplazamiento / «más adelante»** ⭐ | «después», «más adelante», «la próxima», «ahora no» | Hecho `proxima-edicion` | No inventar que la promo vence (no sabemos si vence). **La urgencia falsa es una invención.** | El hecho + **temperatura tibio + programar follow-up** | No |
| **Utilidad / «¿para qué me sirve?»** | «para qué», «me sirve», «vale la pena» | Lo que dice la pieza + hecho `certificado` (CV, concursos públicos) | No prometer empleo, ascenso ni convalidación. | La promesa de la pieza, sin agrandarla | No |
| **Otro producto** | Nombra un curso que no es DIPICOT | — | No improvisar sobre otro programa | T4: handoff | **Sí** |

⭐ El aplazamiento es la objeción **#1** (13 % del histórico). Es la única cuyo manejo correcto **no
es una respuesta sino un mecanismo**: hecho + calificación + follow-up. Por eso el follow-up, aunque
sea fase 4, es la mejora de conversión más grande que queda después de arreglar el cableado.

---

## 6. Riesgos y el mecanismo que los evita

| # | Riesgo | Cómo se manifiesta hoy | Mecanismo concreto |
|---|---|---|---|
| R1 | **Alucinación de fechas, módulos, duración y docentes** | El guardrail cubre cifras de precio, automatismo, humanidad y voseo — **no** entidades académicas | Capa nueva en `validarSalida()`: **entidades no afirmables** (fecha explícita, «X módulos/semanas/meses», nombre propio precedido de «el profesor/docente/instructor», promesa de plazo «en X minutos/horas»). Misma arquitectura, una lista más, con su red team. **Y cargar la munición (§3.1)**: el guardrail evita el daño, el dato evita la escalada |
| R2 | **Escalada = agujero negro** | `hasta: null` + cero lectores de `bot_calificaciones` | (a) toda pausa por escalada con `hasta = ahora + 2 h`; (b) T14 (retoma si nadie contestó); (c) `bot_calificaciones.escalada` servida como señal derivada en `/api/senales` + chip en la cola |
| R3 | **El bot habla encima de una vendedora** | `huboSalienteHumanoDespuesDe: null` hardcodeado | Poblarlo de verdad desde el hilo (el saliente ya distingue `vendedoraId`); `vendedora_activa` vuelve a vivir. **Es prerequisito de R2**: sin esto, retomar tras una escalada es peligroso |
| R4 | **No hay kill-switch sin deploy** | `BOT_MODO` sale del `.env`; la tabla `bot_estado` existe y nadie la lee | `armarHechos()` lee `bot_estado(modo, frenado_motivo)` por línea; `PUT /api/bot/modo` con el Bearer de cualquier vendedora, como `/api/autorespuesta/modo` |
| R5 | **Contradicción entre turnos** | `contactoCtx` se pierde desde la iteración 2 del tool loop (`agente.ts:83-95`) | Mandar el bloque `<contacto>` en **todas** las iteraciones. Es un cambio de 3 líneas y arregla que el bot olvide el nombre justo después de actuar |
| R6 | **Confusión de autoría** | Todo saliente entra como `assistant`, sea del bot o de una persona | Marcar el autor en el historial; lo escrito por una humana entra rotulado (o directamente activa R3 y el bot no responde) |
| R7 | **Preguntas repetidas** | La máquina avanza porque el bot habló; el interés extraído es texto crudo | Transiciones por hechos del lead (§4.2); `memoria.familia` guarda **código de familia**, no la frase cruda |
| R8 | **Falso positivo del guardrail mata la conversación** | Bloqueo → `escalar(error_bot)` → pausa permanente | Un **reintento** con instrucción correctiva antes de escalar; y `error_bot` en la familia de pausa con vencimiento (§4.4) |
| R9 | **La pieza envejece y miente** | La plantilla 3 dice «inicia el lunes 10 de agosto». El 11 de agosto sigue diciéndolo | `npm run bot:vigencia` (solo lectura): lista piezas cuya fecha textual ya pasó. Se corre en el reporte diario. **Alerta, no bloqueo**: bloquear la única pieza dejaría al bot sin munición |
| R10 | **Escalada innecesaria** | La regla 6 escala ante «precio», que es la pregunta más común | §4.2 T6/T9: el precio se entrega por pieza; se escala en **intención de pago** |
| R11 | **Respuestas largas o técnicas** | Controlado (2–4 oraciones + chunker) | Sin cambio |
| R12 | **Producto equivocado** | `ENFOQUE_PRODUCTO = DIPCINTE` ($100, Ciberinteligencia) | `DIPICOT` en `recuperador.ts`, en `contexto.ts` y en `plantillas.familia_curso`. **Test de paridad**: la familia del enfoque tiene que existir en `alias_curso` y tener al menos una pieza vigente, o CI falla |
| R13 | **Doble canal en el mismo lead** | La auto-respuesta nocturna y el bot pueden pisarse | ADR 0028 ya lo dice («no se prenden las dos a la vez»); verificar que el interruptor de `autorespuesta` esté en `apagada` para la línea del bot |
| R14 | **Sin medición de qué pieza convierte** | El bot manda con `referencia: bot-auto-<clave>`, sin procedencia | Estampar `pieza_clase/ref/version` + `pieza_via: 'bot'` con `procedencia/pieza.ts` — el módulo ya existe y es el mismo que usa la app |

---

## 7. Roadmap

Cada fase es desplegable sola. Ninguna reescribe a la anterior.

### F0 — Alinear el producto y destapar el silencio *(horas)*

- **Objetivo**: que el bot apunte al producto correcto y que ninguna escalada sea definitiva.
- **Problema**: H4 + H3.
- **Componentes**: `bot/recuperador.ts` (`ENFOQUE_PRODUCTO → DIPICOT`), `bot/contexto.ts`
  (`CONTEXTO_NEGOCIO`), `plantillas.familia_curso` de la fila 3, `bot/ejecutar.ts` (pausa con
  vencimiento), `bot/orquestador.ts` (`huboSalienteHumanoDespuesDe` real, `frenado` y
  `transporteConectado` reales, lectura de `bot_estado`).
- **Riesgo**: **bajo**, salvo `vendedora_activa`, que cambia el comportamiento en producción —
  a favor (el bot deja de pisar a las vendedoras).
- **Beneficio**: deja de perderse todo lead que pregunta algo. Vuelve a haber kill-switch.
- **Aceptación**: (a) un lead escalado que vuelve a escribir recibe respuesta; (b) si una vendedora
  responde un hilo del bot, el bot calla; (c) `PUT /api/bot/modo apagado` apaga sin deploy;
  (d) test de paridad de R12 en verde.

### F1 — Conectar `mandar_pieza` y `registrar_interes` *(el salto que hoy no existe)*

- **Objetivo**: que el bot pueda **entregar** y **anotar**.
- **Problema**: H1 y H2.
- **Componentes**: `bot/ejecutar.ts` → resolver la pieza desde `plantillas`/`plantilla_pasos` y
  mandarla por `enviarTextoYProyectar`/`enviarMediaYProyectar` (la puerta de la app, no una nueva);
  `registrar_interes` → `confirmarInteresDerivado()` con `vendedoraId: 'bot'`; expansión de
  `{nombre}`/`{precio}`/`{curso}` con el camino del server; estampado de procedencia (R14);
  guardas de la casa (`archivoSeguro` + `existsSync`, no mandar medio mensaje).
- **Riesgo**: **medio** — es el primer envío de contenido comercial del bot. Mitigación: `BOT_MODO=
  sombra` durante una tarde y revisión de `bot_respuestas.acciones` antes de volver a automático.
- **Beneficio**: el bot puede vender. Sin esto, todo lo demás es cosmética.
- **Aceptación**: un lead de prueba pide info y recibe la plantilla 3 completa; `intereses` tiene la
  fila con el nombre crudo del producto de Cerberus; `envios_wa` tiene `pieza_via = 'bot'`.
- ⚠️ **Nota de negocio**: la plantilla 3 **hardcodea $150**. Antes de F1, decidir si se migra a
  `{precio}` (resuelto contra Cerberus) o se acepta el número fijo con la guarda de R9.

### F2 — La munición completa *(sin código)*

- **Objetivo**: que las cinco preguntas más frecuentes post-flyer dejen de escalar.
- **Problema**: §3.1, huecos 5, 6, 7, 8, 10.
- **Componentes**: **base**, no código. Pieza de **temario**; pieza de **precio/pago** limpia (sin
  emojis, con el link de Openpay), aprobada; **flyer imagen** cargado en la plantilla 3; hechos de
  **duración**, **cierre de inscripción** y **docentes**; aprobar la plantilla 2 (seguimiento).
- **Riesgo**: **bajo**. Todo es contenido revisado por una persona.
- **Beneficio**: el mayor de todo el plan por hora invertida. Cada pieza cargada es una rama de
  escalada que se cierra.
- **Aceptación**: `GET /api/catalogo/piezas?vendedora=bot` devuelve ≥ 4 piezas vigentes de DIPICOT;
  las preguntas «¿temario?», «¿cuánto dura?», «¿cómo pago?» se responden sin escalar.

### F3 — El flujo nuevo *(prompt + estados + tools por estado)*

- **Objetivo**: 1 turno hasta el valor, escalada solo en intención de pago.
- **Problema**: §2.1, §2.8, §2.9.
- **Componentes**: `bot/prompt.ts` (regla 0 y regla 6 reescritas; el nombre se pide al cierre);
  `bot/estados.ts` (los 9 estados y las 18 transiciones); `paso9Tools` deja de ser stub;
  `calificar` **se retira** como tool y pasa a derivarse; el bloque `<contacto>` en todas las
  iteraciones (R5); autoría del historial (R6); intención clasificada como dato del prompt.
- **Riesgo**: **medio-alto** — cambia lo que el lead recibe. Mitigación: modo sombra con los casos
  canónicos de §4.3 y §5 antes de automático.
- **Beneficio**: es donde vive la conversión. Todo lo anterior es condición.
- **Aceptación**: un lead que llega del anuncio recibe el flyer en el **primer** mensaje del bot;
  «¿cuánto cuesta?» no produce escalada; `bot_estado_conversacion` permite contar cuántas
  conversaciones hay en cada estado.

### F4 — Visibilidad del handoff y follow-up

- **Objetivo**: que ninguna escalada quede sin dueño y que el aplazamiento se capture.
- **Problema**: §2.10 (nadie ve la escalada) y §2.11 (no hay seguimiento).
- **Componentes**: escalada como **señal derivada** en `/api/senales` + chip en la cola
  (reutiliza `FranjaEtiquetas` y `urgenciaSql.ts`); `bot/followup.ts` con la política ya escrita
  (1 vez, 9:00–20:00 Lima, cap diario, pieza aprobada).
- **Riesgo**: **medio** — el follow-up es lo único que el bot **inicia**. Mitigación: la política de
  ADR 0028 ya lo acota y la pieza es pre-aprobada.
- **Beneficio**: cierra la fuga del 13 % (aplazamiento) y la de las escaladas huérfanas.
- **Aceptación**: 48 h de follow-up en sombra; una vendedora puede decir «tengo N leads esperando»
  mirando la cola.

### F5 — Medición

- Extender el guardrail con las entidades no afirmables (R1) y su red team.
- `npm run bot:vigencia` (R9).
- El tablero de `resultados/piezas` respondiendo la primera pregunta útil: **¿el flyer del bot
  convierte más o menos que el de la vendedora?** Requiere F1 (procedencia estampada) y semanas de
  acumulación.

---

## 8. Autoverificación — lo que descarté y por qué

Recomendaciones que consideré y **saco** de la propuesta:

| Descartado | Por qué |
|---|---|
| **Que el bot cierre la venta solo** (mandar link, confirmar pago, verificar comprobante) | Depende de una decisión del dueño que no está tomada, y de manejar comprobantes/imágenes que hoy el bot no puede recibir ni interpretar. Además el ticket es de $150: el margen de un cierre humano lo paga. Queda como pregunta abierta, no como propuesta. |
| **Un segundo agente** (uno que conversa, otro que califica) | El volumen no lo justifica y agrega orquestación. La calificación derivada (§2.9) resuelve el mismo problema con **menos** código. |
| **RAG / vectores para el conocimiento del producto** | El corpus son 7 hechos y 3-4 piezas. Un índice sería una segunda fuente de verdad al lado del catálogo — la lección de #37, y el catálogo ya se sirve por API. |
| **Integrar Ivi al prompt del bot** | Ivi devuelve prosa; lo que sale hacia un lead viene del catálogo (ADR 0015). Y el endpoint de Ivi todavía responde 404. |
| **Multi-proveedor de LLM / Vercel AI SDK** | No hay segundo proveedor. YAGNI, ya documentado como trade-off. |
| **Máquina de estados nueva desde cero** | `bot/estados.ts` ya existe con la forma correcta (pura, testeada, persistida). Lo que cambia son **los estados y las condiciones**, no el mecanismo. |
| **Tabla nueva para el handoff** | `bot_calificaciones.escalada` ya guarda el hecho. Lo que falta es un **lector**, no una tabla. |
| **Endpoint nuevo para el estado del bot en la app** | `/api/senales` ya es el lugar donde la app pregunta «qué le pasa a esta conversación». La escalada es una señal más. |
| **Columna `vence_en` en las piezas** | Un script de vigencia (R9) resuelve el 100 % del riesgo real sin migración ni mantenimiento por fila. |
| **Traducir el horario a la zona del lead** | Es aritmética sobre un dato (la zona) que solo tenemos como «probable» por prefijo. Un error acá manda a alguien a la clase equivocada. El flyer dice GMT-5 y eso se repite tal cual. |
| **Crear urgencia con la promo** | No sabemos si la promo vence. Inventar un vencimiento es exactamente la clase de invención que este bot no puede hacer — y además es la que más caro sale cuando el lead vuelve tres semanas después y el precio sigue igual. |

---

## Preguntas que necesitan al dueño (bloquean F1 y F2, no el resto)

1. **¿El bot cierra o escala en el pago?** Hoy escala. La propuesta mantiene escalar, pero **con el
   precio ya entregado y sin silenciarse**. Si se quiere que cierre, es F5 y necesita la pieza de
   pago y una política de comprobantes.
2. **¿Dónde está la imagen oficial del flyer** para cargarla en la plantilla 3?
3. **¿La promo de $150 vence?** Si vence, es la única urgencia legítima que el bot puede usar y hay
   que cargarla como hecho. Si no vence, queda prohibida.
4. **¿El temario oficial existe en algún lado** (PDF, landing, brochure)? Es el hueco de
   conocimiento #1.
5. **El precio de la pieza: ¿fijo ($150) o `{precio}` resuelto contra Cerberus?** Fijo es más simple
   y miente el día que cambie; `{precio}` es correcto y exige que la familia DIPICOT resuelva bien
   la edición activa (14 activas hoy).
