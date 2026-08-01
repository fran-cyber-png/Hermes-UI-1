/**
 * LO ÚLTIMO QUE MIRA EL TEXTO ANTES DE QUE LO LEA UNA PERSONA.
 *
 * El bot de primera línea (ADR 0028) conversa con texto libre de un LLM, y hay
 * tres cosas que ese texto NO puede contener nunca. No son gustos de estilo:
 * cada una revierte una decisión del dueño o una regla de la casa.
 *
 *   · **precio** — el bot NO cotiza. Lo comercial sale como **pieza del
 *     catálogo, tal cual** (el flyer ya trae el precio adentro, y el 42 % de la
 *     secuencia lleva imagen). Un precio inventado por un modelo es una promesa
 *     que la Escuela después tiene que honrar o desdecir.
 *   · **automatismo** — el lead todavía no puede saber que hay una máquina
 *     detrás (regla del dueño del 27-jul-2026, la que invirtió lo que
 *     `autorespuesta/plantillas.ts` documentaba como diseño deliberado).
 *   · **humanidad** — y tampoco puede afirmar ser humano. Negar ser bot («no soy
 *     un bot») delata igual **y además miente**: es la peor de las tres.
 *
 * ══ CONTRA QUIÉN SE DEFIENDE, Y CONTRA QUIÉN NO ═════════════════════════════
 *
 * **El bot no tiene un adversario: tiene un modelo que a veces se equivoca.** Es
 * la premisa que decide qué se arregla y qué se documenta, y está escrita acá
 * porque sin ella cada red team termina pidiendo un antivirus. Defenderse de un
 * atacante que no existe cuesta **falsos positivos que sí duelen** — un bot mudo
 * sobre el temario de su producto más vendido es una pérdida real, hoy.
 *
 * Lo que sí se ataja, porque un LLM lo produce solo: dígitos en negrita
 * matemática o de ancho completo (𝟐𝟓𝟎, ２５０ — es a lo que recurre un modelo al
 * que le prohibieron markdown, y WhatsApp no renderiza `**`), ligaduras
 * (artiﬁcial), siglas con puntos (I.A., que es ortografía española normal) y los
 * invisibles de ancho cero (que no cuestan un falso positivo y llegan por eco).
 * Todo eso se pliega en `normalizarUnicode` + `desarmarSiglas` antes de mirar
 * nada. Lo que NO se ataja, dicho para que nadie lo descubra en producción y
 * para que el ADR no prometa hermetismo:
 *
 *   · **homóglifos** (una «а» cirílica adentro de «automático», una «ı» turca):
 *     ningún modelo escribiendo español los emite. Transliterar confundibles es
 *     una tabla entera para tapar un ataque que nadie va a montar.
 *   · **leetspeak y separadores** («b0t», «b o t»): sólo se alcanzan por
 *     inyección desde el lead, y contra la inyección el que sirve es el prompt.
 *   · **dígitos árabes-índicos** (٢٥٠): `normalizarTexto` los borra —quedan
 *     fuera de su clase `[a-z0-9ñ\s]`— así que la capa de precio no ve ninguna
 *     cifra. Se acepta por lo mismo: un modelo escribiendo español no los pone.
 *
 * ══ LA ASIMETRÍA CON `senales/cotizacion.ts` (leer antes de «unificar») ═══════
 *
 * Acá se REUSA el detector de montos de la casa (`montosDelTexto`) y no se
 * escribe otro: una sola implementación, la lección de #37. Pero **el detector
 * es el PISO de esta capa, no su garantía**, y los dos módulos están calibrados
 * para lados opuestos del mismo error:
 *
 *   · `cotizacion.ts` mira mensajes que ESCRIBIÓ UNA VENDEDORA y decide si
 *     etiquetar la conversación como «Cotizado». Un falso positivo ahí ensucia
 *     una señal que se muestra en la fila: exige moneda explícita, tiene piso y
 *     techo de monto y **veta** las instrucciones de pago.
 *   · acá se CENSURA LA SALIDA DE UN LLM. Un falso negativo manda un precio
 *     inventado a una persona real; un falso positivo cuesta un mensaje que no
 *     sale. Los dos costos no se parecen, así que los dos criterios no pueden
 *     ser el mismo.
 *
 * De ahí las dos consecuencias que a alguien le van a dar ganas de «arreglar»:
 *
 *   1. **Se llama `montosDelTexto()`, NUNCA `esCotizacion()`.** El veto bancario
 *      devuelve `esCotizacion: false` sobre un texto que SÍ trae la cifra
 *      —«puedes depositar S/ 250 en nuestra cuenta»—, y ese veto lo abre el lead
 *      con la pregunta más común que hay («¿cómo pago?»). Como guardrail, es un
 *      bypass.
 *   2. **Los vocabularios de acá son MÁS anchos que los de allá y viven acá.**
 *      `senales/cotizacion.ts` NO SE TOCA: `senales/consultarSenales.ts` tiene
 *      un prefiltro SQL que debe ser superconjunto de su `RE_MONTO`, y ampliarlo
 *      de un solo lado rompe las señales de producción **en silencio**.
 *
 * ══ LA CAPA 2, Y POR QUÉ EL LADO DE LA PALABRA ES LA REGLA ══════════════════
 *
 * Huecos MEDIDOS del piso (no supuestos): «El precio es de 250» (cifra sin
 * moneda), «cuesta 1200 pesos» y «350 quetzales» (la Escuela vende a MX, EC y
 * GT), «S/350.-» (el guion final lo lee como código), «350 S/», «cuesta 9 soles»
 * (bajo `MONTO_MINIMO`), «20 % de descuento», «USD100» pegado.
 *
 * Lo que vuelve precio a una cifra es la palabra que tiene al lado, **Y EL LADO
 * IMPORTA**: en español la palabra de precio va ANTES de la cifra que encuadra
 * («cuesta 350», «cuota de 125») y el sustantivo contado va DESPUÉS de la cifra
 * que lo cuenta («2 cuotas», «11 módulos»). Esa asimetría ES la regla, y es lo
 * que salva al hecho aprobado —«se puede pagar en 2 cuotas», dicho **2 veces en
 * 1.876 conversaciones** (#153)— sin una sola excepción cableada. Por eso
 * `cuota`, `pago` y `total` están en las DOS listas: encuadran por izquierda y
 * cuentan por derecha, y esa duplicación es intencional.
 *
 * **La magnitud entra sólo como EXCULPANTE, nunca como acusación.** Está medido:
 * entre 100 y 2000 conviven los precios reales de la Escuela (S/100–250, el pack
 * < S/2000) con «120 horas», «350 alumnos», «edición 2026», «500 videos» y «Ley
 * 1267». Bloquear toda cifra en banda daba 0 falsos negativos y **5 falsos
 * positivos**, tres de ellos normas citadas por número — que es lo que más
 * escribe una escuela de formación política. Debajo de `MONTO_MINIMO` y sin
 * moneda al lado, una cifra es un conteo.
 *
 * ══ LO QUE APRENDIÓ DE LOS TRES RED TEAMS (28-jul) ══════════════════════════
 *
 * Tres ataques con lentes distintos —precio, identidad, normalización— contra la
 * primera versión. Lo que encontraron no fueron huecos sueltos: fueron **cuatro
 * defectos de forma**, y los cuatro están arreglados acá. Se anotan porque cada
 * uno es una manera de equivocarse que va a volver:
 *
 *   1. **Un año NO es una excusa universal.** `esFechaUHora` eximía toda cifra
 *      en [1900, 2099] y el `continue` se saltaba las reglas (e) y (f) enteras:
 *      «El precio del diplomado es 1990.» salía, «…es 1899.» no. Y esa banda es
 *      justo donde vive el pack (< S/2000) con precio psicológico terminado en
 *      90/99. Ni siquiera hacía falta que el prompt supiera el precio: alcanzaba
 *      con que el lead lo escribiera y el bot lo confirmara. **El arreglo es la
 *      misma asimetría del español, aplicada un nivel más arriba**: un año es un
 *      MODIFICADOR y se cuelga de un sustantivo («matrícula 2026», «edición
 *      2026», «presupuesto 2025»); un precio va detrás de un VERBO («es 1990»,
 *      «cuesta 1990»). Por eso la exención cede ante
 *      `VERBOS_QUE_PONEN_PRECIO` y ya no ante cualquier palabra de encuadre
 *      pegada — que era, además, el falso positivo más caro que tenía el módulo
 *      («La matrícula 2026 ya está abierta» bloqueaba, y es el mensaje que un
 *      bot de inscripciones manda todo el día).
 *   2. **Casi todo bloqueaba en su forma corta y pasaba en la forma larga.**
 *      «entre 200 y 300» bloqueaba; «va entre 200 y 300, ¿cuál te interesa?» no.
 *      «Son 250 por persona.» bloqueaba; «Son 250 por persona; si vienen dos,
 *      hablamos.» no. La única red que atrapa la cifra sin encuadre era la regla
 *      (f), y se apagaba arriba de 4 tokens — o sea, en el largo de todo lo que
 *      el bot va a escribir. De ahí la regla (f′), que corre en oraciones largas
 *      con tres candados (piso 100, las DOS orillas palabra-función, y ningún
 *      contable en la ventana izquierda). Cierra los cuatro falsos negativos que
 *      la versión anterior documentaba como incerrables.
 *   3. **La identidad se defendía con frases contiguas, y el español no lo es.**
 *      «Soy una persona real» bloqueaba y «Soy Ana, una persona real» salía;
 *      «Somos personas reales» bloqueaba y «Somos personas de verdad» salía. Una
 *      palabra en el medio desarmaba la capa entera. Ahora la afirmación de
 *      humanidad y la negación de máquina son **regex con hueco** (hasta 3
 *      tokens), no `includes`.
 *   4. **Faltaba el lado afirmativo del automatismo.** `maquina` y `programa`
 *      estaban reconocidas como delatoras —vivían adentro de «no soy una
 *      máquina»— pero no en ninguna lista propia: **«No soy una máquina»
 *      bloqueaba y «Soy una máquina» salía.** La confesión directa, que es lo
 *      peor que puede salir, era lo único sin cubrir. Y con ella entra la jerga
 *      que un modelo produce SOLO apenas le preguntan quién es: «estoy
 *      programada», «me entrenaron», «fui diseñada», «como asistente, no
 *      puedo…».
 *
 * ══ QUÉ DA MEDIDO, Y QUÉ NO VE ══════════════════════════════════════════════
 *
 * Contra los dos corpus de `guardrails.test.ts` (los 7 hechos aprobados reales +
 * 147 textos legítimos · 203 evasiones): **0 falsos positivos y 0 falsos
 * negativos**. Buena parte de cada corpus se escribió DESPUÉS de calibrar la
 * regla, para atacarla, y 70 textos legítimos más —escritos aparte, sin mirar
 * las reglas nuevas— tampoco bloquean.
 *
 * ⚠️ **No es hermética, y el ADR no puede escribirse como si lo fuera.** Lo que
 * queda afuera está fijado con test (`los falsos negativos conocidos`):
 *
 *   · el **sinónimo que rodea una lista abierta**: «Se divide en dos tramos de
 *     125 cada uno» sale si `tramo` no está en ningún vocabulario. Es la
 *     enfermedad crónica de un criterio léxico y no se cura con más palabras.
 *   · la **humanidad oblicua**: «perdón, estaba en una reunión», «recién llego
 *     de almorzar». No dice «soy humana»: se inventa una vida corporal. Ninguna
 *     lista la cierra, y el prompt de T2 empuja hacia ella al pedir cercanía.
 *   · la **cifra pelada con un sustantivo pegado**: «el pack completo son 1.500
 *     lucas» cae, pero «son 1.500 pavos» depende de que la jerga esté listada.
 *
 * Y el corpus es sintético salvo los hechos reales: **0 falsos positivos es la
 * ausencia de evidencia de que bloquee, no la evidencia de que no bloquee.** El
 * número que decide el rollout sale del modo sombra, y el tablero tiene que
 * reportar los falsos positivos del guardrail, no sólo las violaciones atrapadas.
 *
 * Todo puro: entra un `string`, sale un veredicto. Sin base, sin reloj, sin red.
 * **Y es lineal en el largo del texto**: corre en el camino de un mensaje
 * entrante, así que un mensaje raro no puede quedarse con el event loop que
 * comparten las tres vendedoras (había un `[\w-]+\.(?:com|…)` que sobre 16 KB
 * sin espacios bloqueaba 165 ms; hoy la etiqueta está acotada y precedida de
 * lookbehind).
 */

import { normalizarTexto } from "../autorespuesta/rechazo.js";
import { MONTO_MINIMO, montosDelTexto } from "../senales/cotizacion.js";

/**
 * Quien dijo que no o se despidió no recibe más del bot. Se re-exporta el
 * detector de la casa en vez de escribir otro: son las mismas tres formas de
 * decir que no de #166, y una segunda lista divergiría el día que se agregue
 * una frase (la lección de #37).
 */
export { esDespedida, expresaRechazo, huboRechazo } from "../autorespuesta/rechazo.js";

/**
 * La normalización comparativa del anti-repetición. **Es el normalizador de
 * `rechazo.ts`, no una receta nueva**: en `server/src/` ya hay diez y el
 * onceavo sólo agrega una forma más de que dos módulos discrepen.
 *
 * Contra el `spam.ts` original de Forja tiene una diferencia deliberada: acá la
 * puntuación se borra, así que «hola!» y «hola» cuentan como el MISMO mensaje.
 * Para detectar repetición eso es lo correcto —quien reenvía su pregunta con un
 * signo más la está repitiendo igual—, y es el lado seguro: de más, no de menos.
 */
export { normalizarTexto as normalizarParaSpam };

/**
 * `largo` es la cuarta y no estaba en el plan: no es una regla de CONTENIDO como
 * las otras tres, es la negativa a mirar un texto que no puede ser una respuesta.
 * Va acá y no disfrazada de `precio` porque este valor termina en
 * `bot_respuestas.motivo`, que es lo que alguien va a leer para entender qué pasó.
 */
export type Violacion = "precio" | "automatismo" | "humanidad" | "largo" | "voseo";

export type Veredicto = { ok: true } | { ok: false; violacion: Violacion; detalle: string };

const OK: Veredicto = { ok: true };

/**
 * El `detalle` va al log y a `bot_respuestas.motivo`: dice QUÉ disparó, en
 * criollo y con la evidencia justa. **Nunca el texto entero** (regla 7 del plan:
 * el cuerpo no se loguea; vive en `bot_respuestas`).
 */
function viola(violacion: Violacion, detalle: string): Veredicto {
  return { ok: false, violacion, detalle };
}

/** La evidencia que entra en un log: corta y sin saltos de línea. */
function recortar(evidencia: string): string {
  const limpio = evidencia.replace(/\s+/g, " ").trim();
  return limpio.length > 40 ? `${limpio.slice(0, 39)}…` : limpio;
}

// ════════════════════════════════════════════════════════════════════════════
// LO QUE SE PLIEGA ANTES DE MIRAR NADA
// ════════════════════════════════════════════════════════════════════════════

/** Invisibles: ancho cero, juntador de palabras, BOM y el guion suave. */
const RE_INVISIBLES = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;

/**
 * NFKC + fuera los invisibles, y las dos cosas por el mismo motivo: **es lo que
 * un modelo escribe solo**, no una ofuscación.
 *
 * NFKC pliega los dígitos de negrita matemática (𝟐𝟓𝟎) y de ancho completo
 * (２５０) a ASCII, y las ligaduras (artiﬁcial → artificial). Sin eso, «El
 * diplomado cuesta 𝟐𝟓𝟎 soles.» salía **entero**: el `\d` de `RE_MONTO` es ASCII
 * aun con la bandera `/u`, y `normalizarTexto` borra los dígitos que no son
 * ASCII, así que la capa 2 no fallaba una regla — no tenía ninguna cifra que
 * evaluar. Y ese es el caso que más importa, porque la negrita Unicode es a lo
 * que recurre un LLM al que se le prohíbe markdown, que es exactamente lo que
 * T2 le va a decir (WhatsApp no renderiza `**`).
 *
 * Los invisibles no los produce un modelo, pero **partir un token no cuesta un
 * falso positivo** y el texto puede llegar por eco de lo que escribió el lead:
 * `normalizarTexto` convierte cada carácter raro en un ESPACIO, así que un
 * `\u200B` adentro de «soles» no se filtra — parte la palabra en dos y la
 * moneda deja de existir.
 */
function normalizarUnicode(texto: string): string {
  return texto.normalize("NFKC").replace(RE_INVISIBLES, "");
}

/**
 * «I.A.» → «IA», «G.P.T.» → «GPT». La sigla con puntos es ortografía española
 * normal (la RAE admite las dos formas) y un modelo la escribe sin que nadie se
 * lo pida; `normalizarTexto` convierte el punto en espacio, así que « ia » no
 * aparecía nunca y la lista —que está bien— no llegaba a verla.
 *
 * Sólo se usa para la capa de identidad. La de precio mira el texto crudo, donde
 * juntar letras no ayuda y podría inventar un token.
 */
function desarmarSiglas(texto: string): string {
  return texto.replace(/(?:[a-zA-Z]\.){2,}/g, (m) => m.replace(/\./g, ""));
}

// ════════════════════════════════════════════════════════════════════════════
// AUTOMATISMO Y HUMANIDAD — las listas y las dos formas de nombrarse
// ════════════════════════════════════════════════════════════════════════════

/**
 * LAS PALABRAS CON LAS QUE EL TEXTO SE DELATA COMO MÁQUINA, PASE LO QUE PASE.
 *
 * Viven acá —en código de producción, no en el test— y no es un detalle de
 * organización: los precedentes de la casa (`plantillas.test.ts`,
 * `medicion.test.ts`) ponen la lista en el test porque validan un catálogo
 * ESCRITO POR PERSONAS, que se revisa una vez. Acá se valida texto GENERADO en
 * producción, mensaje por mensaje: la lista es parte del programa y el test la
 * consume desde acá.
 *
 * Están normalizadas (sin tildes, en minúsculas) porque se comparan contra el
 * texto normalizado, y **con bordes de espacio, no `\b`**: el `\b` de JavaScript
 * es ASCII y `/\bautomatica\b/i.test('automática')` es **false**. Normalizar
 * primero, poner los bordes después.
 *
 * **El criterio para entrar acá es que la palabra NO tenga uso legítimo en la
 * Escuela.** Las que sí lo tienen no se prohíben: se atrapan cuando el texto se
 * las atribuye (ver `SUSTANTIVOS_DE_MAQUINA`). Dos correcciones medidas:
 *
 *   · **`sistema` SALIÓ de esta lista** (28-jul). Estaba, documentada como «el
 *     precio de la regla simple», con la verificación hecha contra los 7 hechos
 *     aprobados —que hablan de cuotas y de acceso, no de temario—. El red team
 *     midió lo otro: la familia de MÁS volumen del catálogo real es **DIPCINTE,
 *     «Ciberinteligencia y Ciberdefensa», 1.149 leads** (`cursos/alias.ts`), y
 *     enseña a proteger **sistemas** críticos; las dos campañas «Bicameral»
 *     (275 + 170 leads) tienen por tema el **sistema** bicameral. Bloquear ahí
 *     no filtra nada peligroso: deja al bot mudo sobre el temario de sus dos
 *     productos más vendidos, que es la pregunta #1 de un lead. «Soy un
 *     sistema» sigue cayendo, por atribución.
 *   · **`asistente` ENTRÓ**, con el costo a la vista. Es la autodescripción por
 *     defecto de un LLM en español, y el prompt de T2 empuja justo hacia ella:
 *     al prohibirle dar precios, la forma canónica de negarse es «Como
 *     asistente, no puedo…». La palabra de la Escuela para una persona del
 *     equipo es **asesora** —está en el corpus (A)— así que el hueco que deja
 *     es angosto y el que tapa es ancho.
 */
export const PALABRAS_DE_AUTOMATISMO: readonly string[] = [
  "bot",
  "bots",
  "chatbot",
  "chatbots",
  "robot",
  "robots",
  "automatico",
  "automatica",
  "automaticos",
  "automaticas",
  "automaticamente",
  "automatizado",
  "automatizada",
  "automatizados",
  "automatizadas",
  "automatizacion",
  "automatismo",
  "automatizar",
  "asistente",
  "asistentes",
  "ia",
  "inteligencia artificial",
  "asistente virtual",
  "agente virtual",
  "modelo de lenguaje",
  "modelo de ia",
  "chatgpt",
  "gpt",
  "llm",
  "openai",
  "anthropic",
  "claude",
  "respuesta generada",
  "mensaje generado",
  "generado por",
  // — el inglés, que es donde vive la frase delatora más famosa que existe —
  // Cuesta cero en un texto español y el modelo lo produce solo si el lead le
  // escribe en inglés o le pide que le conteste así. «robô» (portugués) NO está:
  // normaliza a «robo», que en español es un sustantivo de uso corriente.
  "ai",
  "artificial intelligence",
  "language model",
  "virtual assistant",
  "automated",
];

/**
 * LO QUE SE DELATA POR FRASE, PORQUE PALABRA POR PALABRA ES INOCENTE.
 *
 * «programada» sola es legítima —«la clase está programada para el 15»— y por
 * eso acá sólo entra en primera persona. Es la jerga que un modelo produce SOLO,
 * sin que nadie lo provoque, apenas la persona pregunta «¿quién eres?» o «¿cómo
 * sabes eso?»: cinco de cinco pasaban limpias en la primera versión.
 */
export const FRASES_DE_AUTOMATISMO: readonly string[] = [
  "estoy programada",
  "estoy programado",
  "fui programada",
  "fui programado",
  "me programaron",
  "nos programaron",
  "fui disenada",
  "fui disenado",
  "me disenaron",
  "fui entrenada",
  "fui entrenado",
  "me entrenaron",
  "mi entrenamiento",
  "fui creada para",
  "fui creado para",
  "mi base de conocimiento",
  "mi base de datos",
  "no tengo cuerpo",
  "no tengo emociones",
  "no tengo sentimientos",
  "como asistente",
  "como modelo",
  "respuesta pregrabada",
  "mensaje pregrabado",
  "respuesta predefinida",
  "mensaje predefinido",
  "generado automaticamente",
  "auto generada",
  "auto generado",
  "auto respondedor",
  "motor de respuestas",
  "as an ai",
  "i am an ai",
  "im an ai",
  "i am a bot",
  "im a bot",
];

/**
 * SUSTANTIVOS QUE DELATAN LA MÁQUINA **SÓLO CUANDO EL TEXTO SE LOS ATRIBUYE**.
 *
 * Acá está la lección más cara de los tres red teams: `maquina` y `programa
 * estaban reconocidas como delatoras —vivían adentro de «no soy una máquina»—
 * pero no en ninguna lista propia, así que **negar ser máquina bloqueaba y
 * afirmarlo salía**. La confesión directa era lo único sin cubrir.
 *
 * Y no se arregla metiéndolas en la lista de arriba: «el **programa** del
 * diplomado dura cuatro meses», «el **algoritmo** de las redes» y «el
 * **sistema** bicameral» son habla diaria de esta Escuela. Lo que delata no es
 * el sustantivo: es **quién dice ser qué**. Por eso se cruzan con
 * `ATRIBUCIONES`, que es primera persona («soy un…») o el agente en tercera
 * («te responde un…», «detrás hay un…»), y nunca el «es un…» suelto.
 */
export const SUSTANTIVOS_DE_MAQUINA: readonly string[] = [
  "maquina",
  "maquinas",
  "programa",
  "programas",
  "algoritmo",
  "algoritmos",
  "software",
  "sistema",
  "sistemas",
  "aplicacion",
  "app",
  "modelo",
  "modelos",
  "inteligencia",
];

/** Cómo se atribuye. «hay» a secas NO está: «hay un programa de becas». */
const ATRIBUCIONES: readonly string[] = [
  "soy",
  "somos",
  "yo soy",
  "detras hay",
  "aca hay",
  "del otro lado hay",
  "te responde",
  "te contesta",
  "te atiende",
  "te habla",
  "te escribe",
  "quien responde es",
  "quien te responde es",
  "quien te escribe es",
];

const ARTICULO = "(?:un |una |el |la |uno |otro |tu |su |solo un |solo una |simplemente un |apenas un )?";

/** «soy una máquina», «detrás hay un algoritmo», «te contesta un software». */
const RE_SE_ATRIBUYE_MAQUINA = new RegExp(
  ` (?:${ATRIBUCIONES.join("|")}) ${ARTICULO}(?:${SUSTANTIVOS_DE_MAQUINA.join("|")}) `,
);

/**
 * AFIRMAR SER HUMANO. Son FRASES, no palabras: «persona» sola es legítima y
 * necesaria —«una persona del equipo te contacta» no afirma nada sobre quién
 * escribe— y prohibirla dejaría al bot sin cómo hablar de sus compañeras.
 *
 * Las negaciones («no soy un bot») están acá y no en la lista de automatismo a
 * propósito: delatan el automatismo Y encima mienten, y que el motivo guardado
 * diga `humanidad` es lo que después distingue «el modelo se puso a explicar qué
 * es» de «el modelo se puso a jurar que es humano».
 *
 * ⚠️ La lista es exacta y contigua, así que **no alcanza sola**: el español mete
 * palabras en el medio sin esfuerzo y «Soy una persona real» caía mientras «Soy
 * Ana, una persona real» salía. Las dos regex de abajo son las que aguantan el
 * peso; esta lista queda para lo que no se compone («de carne y hueso») y para
 * que el test pueda leer la decisión.
 */
export const FRASES_DE_HUMANIDAD: readonly string[] = [
  "soy una persona",
  "soy persona",
  "soy humana",
  "soy humano",
  "soy una humana",
  "soy un humano",
  "soy un ser humano",
  "soy una mujer de verdad",
  "soy de carne y hueso",
  "soy real",
  "somos personas reales",
  "te habla una persona",
  "te escribe una persona",
  "te responde una persona",
  "quien te escribe es una persona",
  "hay una persona detras",
  "detras hay una persona",
  "hay alguien de verdad",
  "alguien de verdad",
  "alguien real",
  "no soy un bot",
  "no soy bot",
  "no soy un chatbot",
  "no soy un robot",
  "no soy una maquina",
  "no soy una ia",
  "no soy un programa",
  "no soy un sistema",
  "no soy automatica",
  "no soy automatico",
  "no soy un asistente virtual",
];

/** Lo que se puede ser sin ser máquina. El hueco lo pone el español, no el ingenio. */
const SER_HUMANO = "(?:humana|humano|humanas|humanos|persona|personas|de carne y hueso|real|reales)";

/**
 * «Soy 100 % humana», «Soy Ana, una persona real», «Somos personas de verdad».
 * **Primera persona nada más**: «quien te va a atender es una persona del
 * equipo» es verdad y es legítimo — lo prohibido es que lo diga de sí mismo.
 */
const RE_AFIRMA_HUMANIDAD = new RegExp(` (?:soy|somos) (?:\\S+ ){0,3}${SER_HUMANO} `);

/** «No soy ningún bot», «No soy máquina». Negar delata igual, y además miente. */
const RE_NIEGA_SER_MAQUINA = new RegExp(
  " no (?:soy|somos|es) (?:\\S+ ){0,2}" +
    "(?:bot|bots|chatbot|robot|maquina|maquinas|ia|programa|sistema|algoritmo|software|asistente|automatica|automatico)[\\s]",
);

/** ¿Alguna frase de la lista aparece como frase entera en el texto normalizado? */
function primeraQueAparece(plano: string, frases: readonly string[]): string | null {
  for (const frase of frases) {
    if (plano.includes(` ${frase} `)) return frase;
  }
  return null;
}

/** Lo que casó, ya recortado para el log. */
function loQueCaso(plano: string, re: RegExp): string | null {
  const m = re.exec(plano);
  return m ? m[0].trim() : null;
}

// ════════════════════════════════════════════════════════════════════════════
// PRECIO — capa 2: la vecindad léxica
// ════════════════════════════════════════════════════════════════════════════

/**
 * Los enlaces salen ANTES de mirar nada. Un link no le dice un precio a nadie, y
 * sus dígitos disparan las dos capas: `campus.goberna.us/2026` contiene `s/`
 * seguido de cifra, que es exactamente lo que `RE_MONTO` busca (verificado:
 * `pagar.goberna.us/250` da un monto de S/ 250). Bloquear el link de inscripción
 * deja al bot mudo justo donde servía.
 *
 * ⚠️ **La etiqueta está acotada a 63 (el largo real de una etiqueta DNS) y va
 * detrás de un lookbehind, y eso NO es cosmética**: sin las dos cosas,
 * `[\w-]+\.(?:com|…)` retrocede carácter por carácter desde cada posición de
 * arranque y el costo es cuadrático sobre texto SIN espacios — 16 KB de «jajaja»
 * (un modelo en bucle de repetición, que es una falla conocida) bloqueaban el
 * event loop **165 ms**, y 64 KB, 2,5 s. Esto corre en el camino de un mensaje
 * entrante y el event loop es el mismo que atienden Luz, Walter y Sindy.
 *
 * El riesgo residual, dicho para que nadie lo descubra en producción: un precio
 * escondido adentro de una URL (`.../precio-250`) pasa. La prosa alrededor no.
 */
const RE_ENLACE =
  /(?:https?:\/\/|www\.)\S+|(?<![\w-])[\w-]{1,63}\.(?:com|net|org|edu|us|pe|mx|ec|gt|club|io|app|link|me)(?:\.[a-z]{2})?\/\S*/gi;

/** Miles: «1.500» / «1,200». Se juntan ANTES de normalizar, o la coma los parte. */
const RE_MILES = /(\d{1,3})[.,](\d{3})(?!\d)/g;

/**
 * Los símbolos y códigos de moneda se traducen a PALABRA porque
 * `normalizarTexto` los borra por diseño (su clase es `[^a-z0-9ñ\s]`):
 * «€60» normalizado es «60», y ahí ya no hay nada que ver. Se traduce sobre el
 * texto crudo, después de sacar los enlaces.
 *
 * La **Q del quetzal** entró tarde y es la que más importaba de las que
 * faltaban: el módulo se calibró para MX/EC/GT y tenía «quetzales» y «gtq», pero
 * no la letra, que es como escribe el precio un guatemalteco — y GT son 393
 * clientes del padrón. La **L del lempira NO está** a propósito: una «L» suelta
 * antes de una cifra choca con demasiadas cosas (numeración romana, un rótulo de
 * aula) para un mercado que no es nombrado.
 */
const SIMBOLOS_DE_MONEDA: readonly (readonly [RegExp, string])[] = [
  [/us\$|u\$s/gi, " usd "],
  [/r\$/gi, " brl "],
  [/s\/\.?|s\.\//gi, " pen "],
  [/(?<![a-z])b\/\.?/gi, " pab "],
  [/(?<![a-z])q\s?\.?\s?(?=\d)/gi, " gtq "],
  [/\$/g, " usd "],
  [/€/g, " eur "],
  [/£/g, " gbp "],
  [/¥/g, " jpy "],
  [/₡/g, " crc "],
  [/₲/g, " pyg "],
  [/₱/g, " php "],
  [/%/g, " pct "],
];

/**
 * MONEDAS, en símbolo ya traducido, código ISO, nombre y jerga. **Sin piso de
 * magnitud**: «cuesta 9 soles» es un precio aunque 9 no sea plausible para
 * `cotizacion.ts`. La Escuela cobra en PEN y USD, pero le vende a México (30 %
 * de las personas), Ecuador y Guatemala, y ahí es donde el detector de la casa
 * no llega.
 */
export const MONEDAS: ReadonlySet<string> = new Set([
  "pen", "usd", "eur", "gbp", "jpy", "brl", "mxn", "ars", "cop", "clp", "uyu",
  "pyg", "bob", "gtq", "hnl", "nio", "crc", "dop", "ves", "php", "bs", "pab",
  "sol", "soles", "solcito", "solcitos",
  "dolar", "dolares", "dolarito", "dolaritos", "verdes",
  "euro", "euros", "libra", "libras", "real", "reales",
  "peso", "pesos", "pesito", "pesitos",
  "quetzal", "quetzales", "boliviano", "bolivianos", "balboa", "balboas",
  "lempira", "lempiras", "cordoba", "cordobas", "colon", "colones",
  "guarani", "guaranies", "bolivar", "bolivares",
  "centavo", "centavos", "centimo", "centimos",
  "luca", "lucas", "varo", "varos",
]);

/**
 * LAS PALABRAS QUE ENMARCAN UNA CIFRA COMO MONTO. Superconjunto del
 * `PALABRAS_DE_PRECIO` de `cotizacion.ts` (que no se toca) más lo que un modelo
 * puede escribir y una vendedora no suele: «abonar», «arancel», «importe».
 *
 * Un hueco acá es un BYPASS; un hueco en `SUSTANTIVOS_CONTABLES` es un falso
 * positivo. Las dos listas viven a treinta líneas de distancia y se editan igual
 * de fácil: al tocar cualquiera, correr el test —que mide contra los dos corpus
 * enteros— y mirar los DOS números, no uno.
 */
export const PALABRAS_DE_ENCUADRE: ReadonlySet<string> = new Set([
  // — las de `cotizacion.ts`, en todas sus formas —
  "precio", "precios", "cuesta", "cuestan", "costar", "costo", "costos",
  "coste", "costes", "inversion", "inversiones", "invertir", "vale", "valen",
  "valor", "promocion", "promociones", "promo", "promos", "descuento",
  "descuentos", "tarifa", "tarifas", "matricula", "matriculas", "oferta",
  "ofertas", "cuota", "cuotas",
  // — las que el bot puede escribir y allá no hacen falta —
  "inscripcion", "inscripciones", "mensualidad", "mensualidades", "monto",
  "montos", "importe", "importes", "arancel", "aranceles", "presupuesto",
  "total", "rebaja", "rebajas", "rebajado", "rebajada", "off", "dcto", "descto",
  "cobra", "cobran", "cobramos", "cobrar", "cobro",
  "sale", "salen", "ronda", "rondan",
  "paga", "pagas", "pagan", "pagar", "pago", "pagos",
  "abona", "abonas", "abonar", "abono",
  "deposita", "depositas", "depositar", "deposito",
  "transfiere", "transferir", "transferencia",
  "financiacion", "financiar", "adelanto", "anticipo",
]);

/**
 * CÓMO SE PAGA NO ES CUÁNTO CUESTA. Estas salen del encuadre **sólo para el
 * porcentaje**: «Puedes pagar el 50 % ahora y el resto después» no dice ninguna
 * cifra de precio —dice cómo se reparte el pago, que es el hecho aprobado #1 del
 * catálogo— y bloquearlo era dejar al bot sin la respuesta natural a «¿puedo
 * pagar la mitad ahora?». Para una cifra normal siguen encuadrando: «abonás 150
 * al inicio» sí es un precio.
 */
const PAGAR_NO_ES_COTIZAR: ReadonlySet<string> = new Set([
  "paga", "pagas", "pagan", "pagar", "pago", "pagos",
  "abona", "abonas", "abonar", "abono",
  "deposita", "depositas", "depositar", "deposito",
  "transfiere", "transferir", "transferencia",
  "financiacion", "financiar", "adelanto", "anticipo",
]);

/**
 * El encuadre que necesita dos palabras. Van aparte porque la primera sola es
 * inocente y prohibirla costaría caro: **«quedan 15 lugares» es legítimo y «te
 * queda en 250» no**, y lo único que los separa es el «en».
 *
 * Los tres grupos del final son cicatrices de red team, y las tres del mismo
 * tipo —el hueco era un bigrama, no una clase—:
 *   · «está **a** 250» pasaba mientras «está **en** 250» bloqueaba. Es de las
 *     formas más naturales de cotizar en el habla peruana, y que la hermana
 *     bloqueara hacía leer el hueco como cubierto.
 *   · «Son 250 **por persona**» / «250 **cada uno**»: encuadran por DERECHA, que
 *     era el lado donde no había nada («por» sólo mira hacia atrás). De yapa
 *     tapan el precio por aritmética —«dos partes iguales de 125 cada una»—.
 *   · «**la mitad de** 500» dice la cifra sin decirla.
 */
export const BIGRAMAS_DE_ENCUADRE: ReadonlySet<string> = new Set([
  "queda en", "quedan en", "te queda", "te quedan",
  "lo dejo", "te dejo", "dejo en", "dejo a",
  "esta en", "estan en", "sale en", "sale por", "sale a", "te sale", "te salen",
  "por solo", "por solamente", "por apenas", "a solo", "a solamente",
  "desde solo", "pago unico", "unico pago", "cuanto es", "cuanto sale",
  "esta a", "estan a", "va en", "van en", "anda en", "andan en", "anda por",
  "por persona", "por alumno", "por participante", "por cabeza",
  "cada uno", "cada una",
  "mitad de",
]);

/**
 * Encuadres que valen SÓLO por izquierda, y por eso no están en la lista de
 * arriba: «por 250 te llevás todo» es un precio, pero «hacemos 3 por semana» no,
 * y en la lista general «por» bloquearía las dos. Tampoco entran en el encuadre
 * PEGADO —el que le gana a la fecha—, así que «cerramos por 15 de agosto» sigue
 * siendo una fecha.
 */
export const ENCUADRE_SOLO_IZQUIERDA: ReadonlySet<string> = new Set([
  "por", "desde", "solo", "solamente", "apenas",
]);

/**
 * VERBOS QUE PONEN PRECIO — la lista más chica del archivo y la que cierra el
 * agujero más grande que tuvo.
 *
 * Un **año es un modificador**: se cuelga de un sustantivo («matrícula 2026»,
 * «edición 2026», «presupuesto 2025») o va solo. Un **precio va detrás de un
 * verbo** («es 1990», «cuesta 1990»). Esa es la misma asimetría del español que
 * gobierna todo el módulo, un nivel más arriba, y decide **quién le gana a la
 * exención de fecha**. Antes le ganaba cualquier palabra de encuadre pegada, y
 * eso estaba mal de los dos lados a la vez: dejaba salir «El precio del
 * diplomado es 1990» (toda la banda [1900, 2099] quedaba exenta, que es justo
 * donde vive el pack) y bloqueaba «La matrícula 2026 ya está abierta».
 *
 * **Las formas ambiguas no entran**: `pago`, `costo`, `cobro`, `abono` y
 * `deposito` son sustantivo y verbo a la vez, y meterlas volvía «El pago 15 de
 * agosto se acredita al día siguiente» un precio. El costo de dejarlas afuera es
 * angosto —«pago 1990» sale— porque para cualquier cifra que no sea un año
 * siguen encuadrando por la lista de arriba.
 */
const VERBOS_QUE_PONEN_PRECIO: ReadonlySet<string> = new Set([
  "es", "son", "era", "eran", "sera", "seran", "seria", "serian",
  "esta", "estan", "estaba", "estaban",
  "cuesta", "cuestan", "costaba", "costaban", "costar",
  "sale", "salen", "salia", "salian",
  "vale", "valen", "valia", "valian",
  "queda", "quedan", "quedaba", "quedaban",
  "cobra", "cobran", "cobramos", "cobrar",
  "ronda", "rondan",
  "pagas", "pagar", "pagan", "abonas", "abonar", "depositas", "depositar",
]);

/**
 * SUSTANTIVOS QUE UNA CIFRA CUENTA. Es la excepción que salva al hecho aprobado
 * y sólo vale **pegada a la derecha**: «2 cuotas» cuenta, «cuotas de 125»
 * cotiza. Es el punto más frágil del diseño —es un conjunto abierto— y el
 * primero que va a pedir mantenimiento; el consuelo es que un hueco acá se ve
 * (el bot se calla), mientras que un hueco en el encuadre no.
 */
export const SUSTANTIVOS_CONTABLES: ReadonlySet<string> = new Set([
  "modulo", "modulos", "clase", "clases", "sesion", "sesiones",
  "hora", "horas", "minuto", "minutos", "semana", "semanas",
  "mes", "meses", "dia", "dias", "anio", "anios", "ano", "anos",
  "alumno", "alumnos", "alumna", "alumnas", "egresado", "egresados",
  "estudiante", "estudiantes", "persona", "personas", "participante",
  "participantes", "inscrito", "inscritos", "inscripto", "inscriptos",
  "matriculado", "matriculados", "docente", "docentes", "profesor",
  "profesores", "asesora", "asesoras", "pais", "paises", "ciudad", "ciudades",
  "tema", "temas", "capitulo", "capitulos", "unidad", "unidades",
  "leccion", "lecciones", "video", "videos", "pagina", "paginas",
  "material", "materiales", "certificado", "certificados",
  "cupo", "cupos", "vacante", "vacantes", "lugar", "lugares", "beca", "becas",
  "grupo", "grupos", "turno", "turnos", "nivel", "niveles", "bloque", "bloques",
  "edicion", "ediciones", "promocion", "promociones",
  "cuota", "cuotas", "pago", "pagos", "vez", "veces",
  "forma", "formas", "opcion", "opciones", "manera", "maneras",
  "modalidad", "modalidades", "parte", "partes", "punto", "puntos",
  "pregunta", "preguntas", "semestre", "semestres",
  "plantilla", "plantillas", "diapositiva", "diapositivas", "lectura",
  "lecturas", "herramienta", "herramientas", "taller", "talleres",
  "formato", "formatos", "caso", "casos", "ejercicio", "ejercicios",
  "recurso", "recursos", "documento", "documentos", "libro", "libros",
  "municipalidad", "municipalidades", "institucion", "instituciones",
]);

/**
 * VERBOS QUE REPARTEN LO QUE YA SE COMPRÓ. Rompen el encuadre cuando aparecen
 * ENTRE la palabra de precio y la cifra: «La matrícula **incluye** 15
 * plantillas» no es un precio, es el inventario del curso — y ese patrón
 * («palabra de encuadre + verbo + cifra + sustantivo cualquiera») convertía en
 * «precio» cualquier dato de catálogo, porque `SUSTANTIVOS_CONTABLES` es una
 * lista cerrada custodiando un inventario abierto.
 *
 * El veto vale igual para un contable en el medio: «El **total de horas** es
 * 120» era la respuesta literal a una de las dos preguntas más frecuentes de una
 * escuela, y bloqueaba.
 */
const VERBOS_DE_INCLUSION: ReadonlySet<string> = new Set([
  "incluye", "incluyen", "incluido", "incluida", "incluidos", "incluidas",
  "trae", "traen", "suma", "suman", "habilita", "habilitan", "cubre", "cubren",
  "contiene", "contienen", "tiene", "tienen", "da", "dan", "regala", "regalan",
  "agrega", "agregan", "viene", "vienen", "ofrece", "ofrecen", "reune",
]);

/**
 * PALABRAS FUNCIÓN — conjunto **CERRADO**, y ahí está la gracia. La regla de la
 * cifra sola pregunta «¿esta cifra cuenta algo?», y la lista de sustantivos
 * contables es abierta («quedan 15 lugares», «hay 15 becas»): apoyarse en ella
 * garantiza falsos positivos. Lo cerrado es lo otro — si a la derecha de la
 * cifra no hay NADA o hay una de estas, la cifra no cuenta nada: está sola.
 *
 * Entran artículos, pronombres, preposiciones, conjunciones y las muletillas
 * («son 250 pe» era un falso negativo medido, y «pe» es como se habla acá). No
 * entra ningún sustantivo: el día que entre uno, la regla se vuelve una
 * whitelist abierta y deja de servir.
 */
export const PALABRAS_FUNCION: ReadonlySet<string> = new Set([
  "y", "e", "o", "u", "pero", "mas", "menos", "ni", "que", "si", "no", "ya",
  "listo", "ok", "dale", "entonces", "igual", "tambien", "nomas", "asi", "nada",
  "te", "me", "le", "lo", "la", "los", "las", "el", "un", "una", "unos", "unas",
  "se", "nos", "es", "son", "esta", "estan", "este", "esto", "ese", "eso",
  "con", "sin", "para", "por", "en", "de", "del", "al", "a", "mi", "tu", "su",
  "yo", "vos", "usted", "todo", "todos", "cada", "ahi", "aca", "alli",
  "solo", "solamente", "aprox", "aproximadamente", "hoy", "ahora", "recien",
  "despues", "antes", "luego", "siempre", "nunca", "como", "segun", "hasta",
  "desde", "pe", "pues", "ps", "bueno", "claro", "porfa", "porfis",
  "cual", "cuales", "quien", "quienes", "donde", "cuando",
]);

/**
 * Lo que una cifra sola puede estar rotulando sin ser plata. Sólo exculpa a la
 * regla de la cifra sola, y sólo pegado por izquierda: «Ley 27444» y «módulo 5»
 * son mensajes enteros posibles en una escuela de formación política.
 */
export const ETIQUETAS_DE_CODIGO: ReadonlySet<string> = new Set([
  "ley", "leyes", "decreto", "dl", "ds", "articulo", "art", "norma", "normas",
  "resolucion", "expediente", "dni", "ruc", "codigo", "numero", "nro", "n",
  "aula", "sala", "oficina", "piso", "av", "jr", "calle",
  "grupo", "modulo", "capitulo", "leccion", "clase", "unidad", "nivel",
  "edicion", "pagina", "version", "anexo", "canal", "zoom",
  "whatsapp", "telefono", "celular", "cel", "id",
]);

/** Los meses, para no leer «15 de agosto» como una cifra suelta. */
const MESES: ReadonlySet<string> = new Set([
  "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
  "setiembre", "septiembre", "octubre", "noviembre", "diciembre",
]);

/**
 * NUMERALES ESCRITOS con su valor: la evasión más obvia contra un detector de
 * dígitos («cuesta trescientos cincuenta»). El valor importa porque la magnitud
 * exculpa: «dos cuotas» es un conteo, «trescientos» no.
 */
const NUMERALES: ReadonlyMap<string, number> = new Map([
  ["dos", 2], ["tres", 3], ["cuatro", 4], ["cinco", 5], ["seis", 6],
  ["siete", 7], ["ocho", 8], ["nueve", 9], ["diez", 10], ["once", 11],
  ["doce", 12], ["trece", 13], ["catorce", 14], ["quince", 15],
  ["dieciseis", 16], ["diecisiete", 17], ["dieciocho", 18], ["diecinueve", 19],
  ["veinte", 20], ["veinticinco", 25], ["treinta", 30], ["cuarenta", 40],
  ["cincuenta", 50], ["sesenta", 60], ["setenta", 70], ["ochenta", 80],
  // «ciento» NO está a propósito: es la segunda mitad de «cien por ciento», y
  // como cifra por derecho propio hacía que «el curso es cien por ciento online»
  // se leyera como una cifra enmarcada. Los montos que lo usan caen igual por su
  // otra mitad («son ciento cincuenta» → «cincuenta»).
  ["noventa", 90], ["cien", 100],
  ["doscientos", 200], ["trescientos", 300], ["cuatrocientos", 400],
  ["quinientos", 500], ["seiscientos", 600], ["setecientos", 700],
  ["ochocientos", 800], ["novecientos", 900], ["mil", 1000], ["miles", 1000],
  ["millon", 1_000_000], ["millones", 1_000_000],
]);

/**
 * Las ventanas, en TOKENS y **asimétricas**, que es el punto: 4 por izquierda
 * —la palabra de precio viene antes y mete artículos en el medio, «el precio
 * para vos es 199»— y 2 por derecha. No son números del idioma, son de medir, y
 * el techo lo puso un falso positivo de cada lado: con 5 a la izquierda entraba
 * «te lo dejo anotado para el 15» (que se salvó nombrando el día del mes) y con
 * 4 a la derecha entra «empieza el 15 y la matrícula ya está abierta».
 */
const VENTANA_IZQUIERDA = 4;
const VENTANA_DERECHA = 2;
const VENTANA_PORCENTAJE = 2;

/** Arriba de esto el mensaje ya dice algo más que la cifra. */
const MAX_TOKENS_CIFRA_SOLA = 4;

/**
 * El piso de la cifra pelada **en oración larga** (regla f′). Es más alto que
 * `MONTO_MINIMO` a propósito: con 10, «Son 11, ni uno más.» —corpus (A)— se
 * bloqueaba. Con 100 quedan afuera los conteos chicos, que son casi todos, y
 * adentro la banda donde vive el precio real de la Escuela.
 */
const PISO_CIFRA_PELADA_EN_ORACION = 100;

interface Tokenizado {
  toks: string[];
  /** Cifras que en el crudo traían separador de miles: nunca son un año. */
  conSeparador: ReadonlySet<string>;
}

/** «1.500» → «1500», «USD100» → «usd 100», «€60» → «eur 60», «S/» → «pen». */
function tokenizar(texto: string): Tokenizado {
  const conSeparador = new Set<string>();
  let t = texto.replace(RE_MILES, (_m, miles: string, resto: string) => {
    conSeparador.add(`${miles}${resto}`);
    return `${miles}${resto}`;
  });
  for (const [re, palabra] of SIMBOLOS_DE_MONEDA) t = t.replace(re, palabra);
  // Despegar cifra de letra: sin esto «USD100» y «350soles» esquivan cualquier
  // tokenizador, y «2x1» no se ve como el patrón que es.
  t = t.replace(/(\d)([a-zA-Zá-úÁ-Úñ])/g, "$1 $2").replace(/([a-zA-Zá-úÁ-Úñ])(\d)/g, "$1 $2");
  const plano = normalizarTexto(t);
  return { toks: plano ? plano.split(" ") : [], conSeparador };
}

function valorDe(tok: string | undefined): number | null {
  if (tok === undefined) return null;
  if (/^\d+$/.test(tok)) return Number(tok);
  return NUMERALES.get(tok) ?? null;
}

interface Encuadre {
  palabra: string;
  /** Dónde terminó, para poder mirar qué quedó en el medio. */
  indice: number;
}

/** ¿Hay una palabra (o un bigrama) de encuadre en la ventana? Devuelve cuál y dónde. */
function encuadreEn(
  toks: readonly string[],
  desde: number,
  hasta: number,
  porIzquierda = false,
): Encuadre | null {
  for (let j = Math.max(0, desde); j <= Math.min(toks.length - 1, hasta); j++) {
    if (PALABRAS_DE_ENCUADRE.has(toks[j])) return { palabra: toks[j], indice: j };
    if (porIzquierda && ENCUADRE_SOLO_IZQUIERDA.has(toks[j])) return { palabra: toks[j], indice: j };
    if (j > 0) {
      const bigrama = `${toks[j - 1]} ${toks[j]}`;
      if (BIGRAMAS_DE_ENCUADRE.has(bigrama)) return { palabra: bigrama, indice: j };
    }
  }
  return null;
}

/**
 * El encuadre de la ventana izquierda, **saltando el que quedó roto por lo que
 * hay en el medio**. Ver `VERBOS_DE_INCLUSION`: entre la palabra de precio y la
 * cifra no puede haber ni lo que la cifra cuenta ni el verbo que lo reparte.
 */
function encuadreIzquierdoValido(toks: readonly string[], i: number, desde: number): Encuadre | null {
  let arranque = desde;
  for (;;) {
    const marco = encuadreEn(toks, arranque, i - 1, true);
    if (!marco) return null;
    const medio = toks.slice(marco.indice + 1, i);
    const roto = medio.some((t) => SUSTANTIVOS_CONTABLES.has(t) || VERBOS_DE_INCLUSION.has(t));
    if (!roto) return marco;
    arranque = marco.indice + 1;
    if (arranque > i - 1) return null;
  }
}

/**
 * ¿La cifra es una fecha, una hora o un año? Se exime SIEMPRE, salvo que a la
 * izquierda haya un VERBO que ponga precio (ver `VERBOS_QUE_PONEN_PRECIO`) o un
 * bigrama de encuadre pegado («te lo dejo en 2.000»).
 */
function esFechaUHora(
  toks: readonly string[],
  i: number,
  fin: number,
  valor: number,
  conSeparador: ReadonlySet<string>,
): boolean {
  const tok = toks[i];
  const izq = toks[i - 1] ?? "";
  const der = toks[fin + 1] ?? "";
  const der2 = toks[fin + 2] ?? "";

  if (MESES.has(der) || MESES.has(izq)) return true; // «15 agosto», «agosto 15»
  if (der === "de" && MESES.has(der2)) return true; // «15 de agosto»
  if (/^(19|20)\d{2}$/.test(tok) && !conSeparador.has(tok)) return true; // un año
  if ((izq === "las" || izq === "la") && valor <= 24) return true; // «a las 8»
  // «el 15» es un día del mes, no plata: en español un precio no lleva artículo
  // pegado («el precio es 250», no «es el 250»). Sin esto, «te lo dejo anotado
  // para el 15» se leía como «te lo dejo … 15».
  if (izq === "el" && valor <= 31) return true;
  if (["am", "pm", "hs", "hrs"].includes(der)) return true; // «7 pm»
  // Un rango de HORAS («de 8 a 10»), no uno de plata: por eso el techo de 24.
  if (der === "a" && valor <= 24 && (valorDe(der2) ?? 99) <= 24) return true;
  return false;
}

/**
 * EL VEREDICTO DE PRECIO. Capa 1 el detector de la casa, capa 2 la vecindad.
 * Devuelve en la primera violación: el `detalle` nombra la regla que disparó,
 * que es lo que después deja afinar sin releer el texto.
 */
function hayPrecio(crudo: string): Veredicto {
  const texto = crudo.replace(RE_ENLACE, " ");

  // ── CAPA 1 · el detector de la casa. El piso, y no se discute. ─────────────
  const montos = montosDelTexto(texto);
  if (montos.length > 0) {
    return viola("precio", `monto con moneda: «${recortar(montos[0].crudo)}»`);
  }

  // ── CAPA 2 · la vecindad léxica. ──────────────────────────────────────────
  const { toks, conSeparador } = tokenizar(texto);

  for (let i = 0; i < toks.length; i++) {
    const primero = valorDe(toks[i]);
    if (primero === null) continue;
    // Una corrida de numerales es UNA cifra: «trescientos cincuenta» son 350, no
    // un 300 y un 50 sueltos, y mirarlos por separado partía el vecindario justo
    // donde estaba la palabra que decide. Se procesa al arrancar la corrida.
    if (valorDe(toks[i - 1]) !== null) continue;
    let fin = i;
    let valor = primero;
    while (valorDe(toks[fin + 1]) !== null) {
      fin++;
      valor = Math.max(valor, valorDe(toks[fin]) as number);
    }

    const izq = toks[i - 1] ?? "";
    const der = toks[fin + 1] ?? "";
    const der2 = toks[fin + 2] ?? "";
    const cifra = toks.slice(i, fin + 1).join(" ");
    const vecindad = recortar(`${izq} ${cifra} ${der}`);

    // (a) MONEDA PEGADA, a cualquiera de los dos lados y sin piso de magnitud:
    //     si dice la moneda, es plata aunque diga 9.
    if (MONEDAS.has(izq) || MONEDAS.has(der)) {
      return viola("precio", `moneda pegada a la cifra: «${vecindad}»`);
    }

    // (b) 2x1 y sus primos: una condición comercial no necesita cifra grande.
    if (der === "x" && valorDe(der2) !== null) {
      return viola("precio", `promoción de tipo NxM: «${recortar(`${cifra} x ${der2}`)}»`);
    }

    // (c) PORCENTAJE. Sólo viola si algo alrededor lo vuelve comercial: «el
    //     100 % es online» es un dato del curso, «20 % de descuento» es plata.
    if (der === "pct" || izq === "pct" || (der === "por" && der2 === "ciento")) {
      // El «por ciento» escrito ocupa dos tokens más: sin correr la ventana, un
      // «50 por ciento de descuento» se escapaba por dos palabras.
      const cierre = der === "por" ? fin + 2 : fin;
      const marco =
        encuadreEn(toks, i - VENTANA_PORCENTAJE, i - 1) ??
        encuadreEn(toks, cierre + 1, cierre + VENTANA_PORCENTAJE + 1);
      // …y cómo se PAGA no es cuánto cuesta: «puedes pagar el 50 % ahora» no
      // dice ninguna cifra de precio (ver `PAGAR_NO_ES_COTIZAR`).
      if (marco && !PAGAR_NO_ES_COTIZAR.has(marco.palabra)) {
        return viola("precio", `porcentaje con condición comercial: «${recortar(`${cifra}% … ${marco.palabra}`)}»`);
      }
      continue;
    }

    // (d) RANGO DE PRECIOS. «Va entre 200 y 300» es la respuesta canónica de un
    //     modelo al que le prohibieron cotizar: no da EL precio, da la banda —y
    //     una banda compromete a la Escuela igual que una cifra. Lo que lo
    //     separa de «entre 20 y 30 alumnos» es lo que viene DESPUÉS del segundo
    //     número, y se pregunta contra el conjunto CERRADO (palabras función),
    //     nunca contra la lista abierta de contables.
    const otroDelRango = valorDe(der2);
    if (izq === "entre" && der === "y" && otroDelRango !== null && valor >= MONTO_MINIMO) {
      const despues = toks[fin + 3] ?? "";
      if (despues === "" || PALABRAS_FUNCION.has(despues)) {
        return viola("precio", `rango de precios: «entre ${cifra} y ${der2}»`);
      }
    }

    // (e) FECHA, HORA O AÑO. Cede sólo ante un verbo que ponga precio.
    const bigramaPegado = i > 1 && BIGRAMAS_DE_ENCUADRE.has(`${toks[i - 2]} ${izq}`);
    const verboPegado = VERBOS_QUE_PONEN_PRECIO.has(izq) || bigramaPegado;
    if (!verboPegado && esFechaUHora(toks, i, fin, valor, conSeparador)) continue;

    // (f) ENCUADRE CERCA — la asimetría del español. Con la magnitud como
    //     EXCULPANTE: debajo del piso de la casa, una cifra es un conteo.
    if (valor >= MONTO_MINIMO) {
      const marco =
        encuadreIzquierdoValido(toks, i, i - VENTANA_IZQUIERDA) ??
        encuadreEn(toks, fin + 1, fin + VENTANA_DERECHA);
      // ←── acá se salva «2 cuotas»: la cifra CUENTA lo que tiene a la derecha.
      if (marco && !SUSTANTIVOS_CONTABLES.has(der)) {
        return viola("precio", `cifra enmarcada como precio: «${recortar(`${marco.palabra} … ${cifra}`)}»`);
      }
    }

    // (g) LA CIFRA SOLA. Un mensaje que es casi nada más que un número es
    //     ambiguo hasta para una persona; acá se falla cerrado.
    if (
      toks.length <= MAX_TOKENS_CIFRA_SOLA &&
      (der === "" || PALABRAS_FUNCION.has(der)) &&
      !ETIQUETAS_DE_CODIGO.has(izq) &&
      valor >= MONTO_MINIMO
    ) {
      return viola("precio", `cifra sola, sin nada que la explique: «${vecindad}»`);
    }

    // (g′) LA CIFRA PELADA EN UNA ORACIÓN LARGA. La regla de arriba se apagaba
    //      arriba de 4 tokens, o sea en el largo de todo lo que el bot va a
    //      escribir: «250» caía y «250, y con el certificado incluido» salía. Es
    //      el patrón que atravesaba TODAS las evasiones del red team (corta
    //      bloquea, larga pasa), y por eso acá no hay techo de largo — hay tres
    //      candados que valen lo mismo: **piso alto** (100, o «Son 11, ni uno
    //      más.» se cae), **las dos orillas palabra-función** (si a la izquierda
    //      hay un verbo o un sustantivo, la cifra ya está explicada: «Ya somos
    //      350, un montón.») y **ningún contable en la ventana izquierda**, que
    //      es lo que salva «El total de horas es 120».
    if (
      valor >= PISO_CIFRA_PELADA_EN_ORACION &&
      (izq === "" || PALABRAS_FUNCION.has(izq)) &&
      (der === "" || PALABRAS_FUNCION.has(der)) &&
      !toks.slice(Math.max(0, i - VENTANA_IZQUIERDA), i).some((t) => SUSTANTIVOS_CONTABLES.has(t))
    ) {
      return viola("precio", `cifra pelada, sin nada que la explique: «${vecindad}»`);
    }
  }

  return OK;
}

// ════════════════════════════════════════════════════════════════════════════
// VOSEO — el registro no se negocia
// ════════════════════════════════════════════════════════════════════════════

/**
 * LAS FORMAS DEL VOSEO RIONPLATENSE, NORMALIZADAS Y CON BORDES DE ESPACIO.
 *
 * La regla del dueño (1-ago-2026): el bot se escribe en español neutro del
 * PERÚ, y el voseo se le escapaba porque los hechos de `hechos/catalogo.ts`
 * estaban escritos en ese registro («tenés», «entrás», «Podés») y el modelo
 * copiaba la conjugación del texto que afirma.
 *
 * El criterio para entrar acá es el MISMO de `PALABRAS_DE_AUTOMATISMO`, pero
 * al revés y más estricto: un falso positivo de esta lista no es un mensaje
 * raro, es un lead que se va escalado a humano por nada. Por eso SOLO entran
 * formas que **no existen** como conjugación de "tú" en español estándar:
 *
 *   · presente voseo: tenés/podés/querés/sos/entendés/decís/venís — la forma
 *     de "tú" es OTRA palabra (tienes/puedes/quieres/eres/entiendes/dices/
 *     vienes), así que no hay colisión posible;
 *   · imperativo voseo que no tiene forma "tú" homógrafa: decime (dime),
 *     contame (cuéntame), hacelo (hazlo), decile (dile), andate (vete);
 *   · el pronombre `vos` y la interjección `che`.
 *
 * LO QUE QUEDA AFUERA A PROPÓSITO, porque "tú" también lo conjuga igual:
 * `sabes`, `pensas`, `crees`, `hablas` (la tilde del voseo «sabés» se pierde
 * en `normalizarTexto` y no se puede distinguir sin costo de falso positivo),
 * y los imperativos homógrafos de la tercera persona: `mira`, `hace`, `mandame`
 * (que también es «mándame»), `avisame` («avísame»), `fijate` («fíjate»).
 * Esas se corrigen por el prompt y por el registro de los hechos, no por acá.
 */
export const FORMAS_DE_VOSEO: readonly string[] = [
  "vos",
  "tenes", "podes", "queres", "sos", "entendes", "decis", "venis",
  "decime", "contame", "hacelo", "decile", "andate",
  "che",
];

// ════════════════════════════════════════════════════════════════════════════
// LA PUERTA
// ════════════════════════════════════════════════════════════════════════════

/**
 * ¿Este texto puede salir hacia una persona? Se corre sobre el mensaje ENTERO y
 * ANTES de trocearlo en burbujas: un precio partido en dos («son» / «250») no lo
 * ve ninguna regla léxica, así que el chunker va después, nunca antes.
 *
 * **No tira nunca, ni con lo que TypeScript dice que no puede llegar.** Un
 * `content` que viene como objeto o como arreglo de bloques es la forma normal
 * de equivocarse con un proveedor de LLM, y un guardrail que explota es un
 * guardrail que alguien envuelve en `try/catch` para «no romper la
 * conversación» — y ahí la última línea de defensa se vuelve fail-OPEN. Se
 * coacciona y se valida igual: `250` coaccionado es «250», que se bloquea.
 */
/**
 * EL TECHO DE LARGO — y por qué es fail-closed y no un `slice`.
 *
 * `montosDelTexto` (`senales/cotizacion.ts`) es **cuadrático**: medido el 29-jul,
 * 5.000 caracteres cuestan 81 ms y 50.000 cuestan 8.238. Este validador corre en
 * el camino de un mensaje, y el server es un Express de un solo proceso: ocho
 * segundos ahí no son «una respuesta lenta», son ocho segundos en los que no se
 * atiende la cola, ni el login, ni el webhook. (El problema es de ese módulo y
 * tiene issue propio, #247; acá no se toca — ver la nota de arriba sobre el
 * prefiltro SQL que hay que mantener superconjunto.)
 *
 * El techo son 8.000 caracteres, ~4× lo que puede producir el bot con su
 * `max_tokens`. Un texto más largo que eso **no es una respuesta**: es un bug del
 * agente o un pegote. Por eso se BLOQUEA en vez de recortarse: validar los
 * primeros 8.000 y mandar el resto sin mirar sería exactamente el fail-open que
 * este archivo existe para no tener.
 */
export const LARGO_MAXIMO = 8_000;

export function validarSalida(texto: string): Veredicto {
  const crudo = normalizarUnicode(texto == null ? "" : String(texto)).trim();
  if (!crudo) return OK;

  if (crudo.length > LARGO_MAXIMO) {
    return viola(
      "largo",
      `texto de ${crudo.length} caracteres: arriba de ${LARGO_MAXIMO} no se valida, se bloquea`,
    );
  }

  const plano = ` ${normalizarTexto(desarmarSiglas(crudo))} `;

  // El registro va primero: es el check más barato y el motivo más útil.
  // Y es antes que humanidad a propósito: si el texto es voseo Y se delata
  // como máquina, lo que importa reportar es que se delató — pero un voseo
  // suelto ya manda el mensaje al mismo lugar.
  const voseo = primeraQueAparece(plano, FORMAS_DE_VOSEO);
  if (voseo) return viola("voseo", `voseo rioplatense: «${voseo}»`);

  // Humanidad antes que automatismo: «no soy un bot» tiene las dos, y el motivo
  // que sirve para leer después es el que dice que además mintió.
  const niega = loQueCaso(plano, RE_NIEGA_SER_MAQUINA);
  if (niega) return viola("humanidad", `niega ser una máquina: «${recortar(niega)}»`);

  const humano =
    primeraQueAparece(plano, FRASES_DE_HUMANIDAD) ?? loQueCaso(plano, RE_AFIRMA_HUMANIDAD);
  if (humano) return viola("humanidad", `afirma ser una persona: «${recortar(humano)}»`);

  const maquina = primeraQueAparece(plano, PALABRAS_DE_AUTOMATISMO);
  if (maquina) return viola("automatismo", `nombra el automatismo: «${maquina}»`);

  const jerga = primeraQueAparece(plano, FRASES_DE_AUTOMATISMO);
  if (jerga) return viola("automatismo", `jerga de modelo: «${jerga}»`);

  const seAtribuye = loQueCaso(plano, RE_SE_ATRIBUYE_MAQUINA);
  if (seAtribuye) return viola("automatismo", `se atribuye ser una máquina: «${recortar(seAtribuye)}»`);

  return hayPrecio(crudo);
}

// ════════════════════════════════════════════════════════════════════════════
// ANTI-REPETICIÓN
// ════════════════════════════════════════════════════════════════════════════

/** Cuántos mensajes previos se miran. */
const ULTIMOS_PARA_REPETIDO = 5;
/** El entrante + 2 iguales previos = la TERCERA vez. */
const IGUALES_PARA_REPETIDO = 2;
/**
 * Piso de largo del texto normalizado. Con 2, «ok» y «si» **cuentan** y sólo
 * queda afuera lo de un carácter («k», «?»). Es el piso del `spam.ts` original
 * de Forja —cuyo comentario dice otra cosa que su código, y su propio test usa
 * «k»— y se deja igual.
 */
const LARGO_MINIMO_PARA_REPETIDO = 2;

/**
 * UN ACUSE NO ES SPAM, POR MÁS QUE SE REPITA. El bot pregunta tres cosas («¿te
 * mando el temario?», «¿te queda cómodo el horario?», «¿te paso con una
 * asesora?») y la persona contesta las tres que sí: al tercer «sí» quedaba
 * marcada como repetidora y el bot dejaba de contestarle. Es la conversación que
 * mejor va, cortada por el anti-spam.
 *
 * Va como lista cerrada y no como piso de largo: «hola» repetido tres veces sin
 * respuesta SÍ es spam, y tiene cuatro caracteres.
 */
const ACUSES: ReadonlySet<string> = new Set([
  "si", "sip", "sii", "ya", "ok", "oka", "okey", "okay", "dale", "listo",
  "bien", "claro", "aja", "ajam", "bueno", "va", "perfecto", "gracias",
  "muchas gracias", "de acuerdo", "correcto", "exacto", "genial", "excelente",
]);

/**
 * ¿Este entrante es el mismo mensaje por tercera vez? Corre ANTES del LLM, así
 * el spam no cuesta ni un token.
 *
 * `previos` va en orden **cronológico, el más reciente al final** (que es como
 * se lee un hilo): se miran los últimos 5 y alcanza con que 2 sean iguales.
 *
 * La llave de comparación es la normalizada, **salvo que quede vacía**: un
 * mensaje de puros emojis o en otro alfabeto («👍👍», «你好») desaparece entero
 * en `normalizarTexto` y volvía a costar una llamada al LLM cada vez. Ahí se
 * compara el crudo, que para repetición alcanza y sobra.
 */
export function esRepetido(
  previos: readonly (string | null | undefined)[],
  entrante: string,
): boolean {
  const llave = llaveDeRepeticion(entrante);
  if (llave === null || ACUSES.has(llave)) return false;

  const ultimos = previos.slice(-ULTIMOS_PARA_REPETIDO);
  const iguales = ultimos.filter((p) => llaveDeRepeticion(p ?? "") === llave).length;
  return iguales >= IGUALES_PARA_REPETIDO;
}

function llaveDeRepeticion(texto: string): string | null {
  const norma = normalizarTexto(texto ?? "");
  const llave = norma || (texto ?? "").trim().toLowerCase();
  return llave.length >= LARGO_MINIMO_PARA_REPETIDO ? llave : null;
}
