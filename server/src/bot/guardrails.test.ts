import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  esRepetido,
  FRASES_DE_AUTOMATISMO,
  FRASES_DE_HUMANIDAD,
  LARGO_MAXIMO,
  normalizarParaSpam,
  PALABRAS_DE_AUTOMATISMO,
  SUSTANTIVOS_DE_MAQUINA,
  validarSalida,
  type Veredicto,
} from "./guardrails.js";
import { CATALOGO_POR_DEFECTO } from "../hechos/catalogo.js";

/**
 * LOS DOS CORPUS, Y POR QUÉ SON DOS.
 *
 * Este guardrail se juzga por dos números que tiran para lados opuestos, así que
 * el test tiene que mirar los dos o no está midiendo nada:
 *
 *   · **(A) lo que NO puede bloquearse** — el texto legítimo que el bot escribe
 *     todos los días, empezando por los **hechos aprobados de verdad**
 *     (`hechos/catalogo.ts`, que se importan acá tal cual: si mañana alguien
 *     agrega uno con una cifra, este test se entera). Un guardrail que bloquea
 *     esto deja al bot mudo justo cuando servía, y encima parece que anda.
 *   · **(B) lo que TIENE que bloquearse** — los montos que el detector de la
 *     casa ya ve, los **huecos medidos** que no ve, y las dos formas de
 *     delatarse.
 *
 * Los textos de (A) están escritos para ROZAR la regla a propósito («La
 * matrícula incluye 11 módulos», «Cuesta esfuerzo, son 120 horas», «Quedan 15
 * lugares»): un corpus de textos cómodos no prueba nada.
 *
 * **Los dos crecieron el 28-jul con lo que encontraron tres red teams** (lentes:
 * precio · identidad · normalización). Cada caso que trajeron está marcado con
 * de quién vino y qué defecto de forma destapó, porque el valor no está en el
 * texto suelto: está en la clase de error que representa. Los que NO se
 * arreglaron —los que sólo se alcanzan con texto que ningún modelo escribe—
 * viven en «los límites conocidos», con el argumento a la vista.
 *
 * La lista de palabras prohibidas NO vive acá —al revés que en
 * `autorespuesta/plantillas.test.ts`, que valida un catálogo escrito por
 * personas—: el bot valida texto generado en producción, así que la lista es
 * código y el test la consume desde ahí.
 */

const bloquea = (texto: string): boolean => !validarSalida(texto).ok;
const violacionDe = (texto: string): string => {
  const v: Veredicto = validarSalida(texto);
  return v.ok ? "ninguna" : v.violacion;
};

// ════════════════════════════════════════════════════════════════════════════
// (A) EL CORPUS QUE NO PUEDE BLOQUEARSE
// ════════════════════════════════════════════════════════════════════════════

/** Los hechos que hoy desbloquean ventas. Son texto real, no ejemplos. */
const HECHOS_APROBADOS = CATALOGO_POR_DEFECTO.map((h) => h.texto);

const LEGITIMOS: readonly string[] = [
  // — las paráfrasis de los hechos, que es como los va a decir el modelo —
  "se puede pagar en 2 cuotas, sin recargo",
  "podés pagarlo en dos cuotas",
  "El pago se hace en 2 cuotas, ¿te sirve así?",
  "Sí, se puede en cuotas.",
  "el acceso lo tenés por todo un año",
  "es para público general",
  "este es nuestro canal oficial",
  // — datos del curso —
  "son 11 módulos",
  "120 horas académicas",
  "el 100% es online",
  "el curso es cien por ciento online",
  "edición 2026",
  "somos más de 350 alumnos",
  "empieza el 15 de agosto",
  "dura 3 meses",
  "Son 11 módulos y 120 horas académicas, todo online.",
  "La edición 2026 empieza el 15 de agosto y dura 3 meses.",
  "Ya somos más de 350 alumnos de 12 países.",
  "Las clases quedan grabadas y quedan 5 cupos.",
  "Las clases son los martes y jueves de 8 a 10 de la noche.",
  "El diplomado tiene 3 módulos de fundamentos y 8 de aplicación.",
  "El pack de 2 diplomados tiene 22 módulos.",
  "Ya cubrimos el 80% del temario en las primeras 4 semanas.",
  "El módulo 5 dura 2 semanas.",
  "La ley 27444 es el eje del módulo 3.",
  "Ley 27444.",
  // — cortesía y logística —
  "te paso el temario",
  "una asesora te escribe en un rato",
  "¿te sirve el horario de la noche?",
  "Te comparto el link de inscripción en un momento.",
  "Contame en qué te puedo ayudar.",
  "Mi turno termina a las 8, pero te dejo todo listo.",
  "Te espero a las 8.",
  "Vale, te espero a las 8.",
  "El 15 de agosto.",
  "una persona del equipo te contacta",
  // — los que ROZAN la regla a propósito —
  "La matrícula abre el 15 de agosto.",
  "La matrícula incluye 11 módulos y el certificado.",
  "La matrícula ya está abierta y tenemos 5 cupos.",
  "La inscripción abre el 15 de agosto.",
  "Sale el 15 de agosto, dura 3 meses.",
  "Vale la pena: son 11 módulos con casos reales.",
  "Cuesta esfuerzo, son 120 horas de estudio.",
  "La inversión son 4 horas por semana, nada más.",
  "El valor está en el contenido: 11 módulos con casos reales.",
  "El curso queda en la plataforma 12 meses.",
  "Te quedan 3 días para inscribirte.",
  "Te salen 2 clases por semana.",
  "Te lo dejo en 15 minutos.",
  "Te lo dejo anotado para el 15.",
  "El certificado sale 30 días después.",
  "Vale 3 veces más que otros cursos.",
  "Hay 3 formas de pago, te las explica la asesora.",
  "El precio lo maneja la asesora; ya somos 350 alumnos.",
  "Te paso el temario. La asesora te da el precio y te cuenta que hay 2 formas de pago.",
  "No manejo descuentos, pero el 50% de las clases quedan grabadas.",
  "El descuento por pronto pago ya no está vigente, pero quedan 5 cupos.",
  "La promoción de egresados 2025 fue de 300 personas.",
  "En total son 11 módulos.",
  "Somos 8 docentes y más de 350 alumnos.",
  "Quedan 15 lugares.",
  "Hay 15 becas.",
  "Somos 20 asesoras.",
  "Sí, son 3.",
  "Son 12 países.",
  "Sí, quedan 5 cupos.",
  "Dura 3 meses.",
  "Somos 3 asesoras, cualquiera te atiende.",
  // — los enlaces: sus dígitos no son un precio (ver `RE_ENLACE`) —
  "Te paso el link: https://campus.goberna.us/2026/inscripcion",
  "El link para inscribirte es https://pagar.goberna.us/250",
  // — el vocabulario del negocio que ROZA la lista de automatismo —
  "El Diplomado de Inteligencia y Contrainteligencia arranca el 15 de agosto.",
  "Trabajamos inteligencia estratégica y contrainteligencia.",
  "Somos sistemáticos con el seguimiento.",
  "Te lo envIAmos por correo.",
  "el curso es cien por ciento online",
  "El 100 por ciento de las clases quedan grabadas.",
  // — mensajes largos, que es como escribe un modelo —
  "¡Hola! Gracias por escribirnos a la Escuela de Goberna. Contame qué diplomado te interesa y te paso el temario completo. Estamos con la edición que arranca el 15 de agosto: son 11 módulos en 3 meses, todo online y con las clases grabadas por un año.",
  "Buen día. El diplomado tiene 120 horas académicas repartidas en 11 módulos. Las clases en vivo son martes y jueves de 8 a 10 pm y quedan grabadas. Si querés, te paso el temario.",
  "Sí, se puede pagar en 2 cuotas: la primera reserva tu lugar y la segunda antes de empezar. La asesora te pasa los detalles y las formas de pago.",
  "Claro, el certificado lo emite la Escuela con código de verificación y sirve para concursos públicos. Lo recibís al terminar los 11 módulos.",
  // — los que rozan las reglas nuevas (ventana izquierda de 4, encuadre por izquierda) —
  "Ya somos más de 5000 egresados y este año vamos por 1200 inscriptos.",
  "El aforo es de 500 personas por aula virtual.",
  "El material se descarga en PDF y son unas 200 páginas por módulo.",
  "Trabajamos con más de 20 municipalidades del país.",
  "En la edición pasada participaron 120 municipalidades.",
  "La Resolución 1267 se ve en el módulo 4.",
  "El aula 250 es la virtual, no te preocupes.",
  "Hacemos 3 clases por semana.",
  "El acceso es por 12 meses.",
  "El link te llega 15 minutos antes de cada clase.",
  "Tenemos 40 becas parciales y quedan 8.",
  "Sale a las 20:00 y termina a las 22:00.",
  "El diplomado arranca el 15 y termina el 30.",
  "Cerramos la inscripción por 15 de agosto.",
  "Te espero a las 10 pe.",
  "Ya somos 350, un montón.",
  "Son 11, ni uno más.",
  "El 50% de la nota es el trabajo final.",
  "El descuento por grupo lo maneja la asesora, yo te la presento.",
  "Hay promociones vigentes esta semana, te conecto con ella.",
  "El precio lo ve la asesora; nosotros somos 20 en el equipo.",

  // ── RED TEAM «PRECIO» · el año pegado a una palabra de encuadre ────────────
  // Era el falso positivo más caro que tenía el módulo: `marcoPegado` le ganaba
  // a la exención de fecha, y «matrícula», «promoción», «inscripción», «pago»,
  // «total», «presupuesto», «costo», «cuota», «oferta», «tarifa», «descuento» y
  // «valor» están todas en PALABRAS_DE_ENCUADRE. O sea: cualquiera de esas 40+
  // palabras seguida de un año disparaba «precio» — y «La matrícula 2026 ya está
  // abierta» es literalmente el mensaje que un bot de inscripciones manda todo
  // el día. En una escuela de formación política, «presupuesto 2025» es además
  // contenido curricular.
  "La matrícula 2026 ya está abierta.",
  "La promoción 2026 tiene 350 egresados.",
  "Las inscripciones 2026 cierran el viernes.",
  "La inscripción 2026 se hace desde la web.",
  "La promo 2026 arranca en agosto.",
  "El descuento 2026 aplica para egresados.",
  "La oferta 2026 incluye el certificado.",
  "La tarifa 2026 la maneja el área comercial.",
  "El presupuesto 2026 del municipio se aprueba en octubre.",
  "Analizamos el presupuesto 2025 de tres municipalidades.",
  "El costo 2026 lo confirma una asesora.",
  "La cuota 2026 del colegio profesional es otro trámite.",
  "El total 2026 de egresados supera los tres mil.",
  "El pago 2026 se hace por la plataforma.",
  "El valor 2026 del programa lo ve una asesora.",
  "La promoción 2024 fue la más numerosa.",
  "El pago 15 de agosto se acredita al día siguiente.",
  "La matrícula 15 de agosto ya cerró.",
  "El presupuesto participativo 2026 es el tema del módulo 3.",

  // ── RED TEAM «PRECIO» · la cuenta que termina en la cifra ──────────────────
  // «El total de horas es 120» es la respuesta literal a una de las dos
  // preguntas más frecuentes de una escuela, y bloqueaba: la salvaguarda de la
  // asimetría sólo cubría «cifra + sustantivo contable» (la cuenta ADELANTE), y
  // con la cuenta al final el encuadre ganaba. Peor, era posicional y no
  // semántica: «El total de sesiones EN VIVO es 12» pasaba nada más porque dos
  // palabras extra empujaban «total» fuera de la ventana.
  "El total de horas es 120.",
  "El total de módulos es 12.",
  "El total de sesiones en vivo es 12.",
  "El total es de 120 horas académicas.",
  "El total de páginas del material es 200.",

  // ── RED TEAM «PRECIO» · el inventario del curso ────────────────────────────
  // «palabra de encuadre + verbo de inclusión + cifra + sustantivo que no está
  // en SUSTANTIVOS_CONTABLES». Como esa lista es cerrada y el inventario de un
  // curso es abierto (plantillas, diapositivas, lecturas, herramientas,
  // talleres, formatos, casos), CUALQUIER sustantivo nuevo convertía un dato de
  // catálogo en «precio». El módulo ya se llamaba a sí mismo «el punto más
  // frágil del diseño»; esto lo midió.
  "La matrícula incluye 15 plantillas descargables.",
  "La inscripción incluye 60 diapositivas por módulo.",
  "El pago te habilita 25 herramientas de campaña.",
  "La promoción de julio suma 12 talleres extra.",
  "La inscripción incluye 120 horas de clase.",
  "La matrícula trae 30 lecturas obligatorias.",

  // ── RED TEAM «PRECIO» · cómo se paga no es cuánto cuesta ───────────────────
  // No hay ninguna cifra de precio en el mensaje: dice cómo se reparte el pago,
  // que es el hecho aprobado #1 del catálogo. Es la forma natural de contestar
  // «¿puedo pagar la mitad ahora?».
  "Puedes pagar el 50 % ahora y el resto después.",
  "El pago se hace 100 % online.",
  "Podés abonar el 50% al inscribirte.",

  // ── RED TEAM «IDENTIDAD» · el temario de los dos productos más vendidos ────
  // `sistema` estaba prohibida como palabra, verificada contra los 7 hechos
  // aprobados —que hablan de cuotas y de acceso, no de temario—. El red team
  // midió lo otro: DIPCINTE («Ciberinteligencia y Ciberdefensa») son 1.149 leads,
  // la familia de MÁS volumen de `cursos/alias.ts`, y enseña a proteger
  // sistemas; las dos campañas «Bicameral» (275 + 170) tienen por tema el
  // sistema bicameral. Bloquear ahí dejaba al bot mudo sobre la pregunta #1 de
  // un lead: «¿de qué trata?».
  "En Ciberinteligencia y Ciberdefensa aprendes a proteger los sistemas críticos del Estado.",
  "El diplomado de Gestión Parlamentaria Bicameral explica el sistema bicameral peruano.",
  "Analizamos el sistema electoral y la valla parlamentaria.",
  "El módulo 2 cubre sistemas de seguridad corporativa.",
  "Puedes pagar por el sistema de la plataforma.",
  "El diplomado en Sistemas de Gestión Pública.",
  "El sistema de justicia peruano.",
  // …y sus hermanas: las palabras de máquina que la Escuela usa en serio.
  "El programa del diplomado dura cuatro meses.",
  "Hay un programa de becas para egresados.",
  "El algoritmo de las redes premia el video corto: eso se ve en el módulo 5.",
  "La clase está programada para el 15 de agosto.",
  "Las clases no son en persona, son 100% online.",
  "Quien te va a atender es una persona del equipo.",
];

describe("(A) lo que el bot dice todos los días — nada de esto puede bloquearse", () => {
  test("los hechos aprobados del catálogo REAL pasan enteros", () => {
    const bloqueados = HECHOS_APROBADOS.filter(bloquea);
    assert.deepEqual(
      bloqueados,
      [],
      "un hecho aprobado bloqueado es el bot mudo sobre lo único que sabemos que cierra ventas",
    );
  });

  test("el corpus de texto legítimo pasa entero", () => {
    const bloqueados = LEGITIMOS.filter(bloquea).map((t) => `${t} → ${JSON.stringify(validarSalida(t))}`);
    assert.deepEqual(bloqueados, [], "falsos positivos del guardrail");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (B) EL CORPUS QUE TIENE QUE BLOQUEARSE
// ════════════════════════════════════════════════════════════════════════════

/** Lo que el detector de la casa (`montosDelTexto`) ya ve: el piso. */
const PRECIO_DIRECTO: readonly string[] = [
  "cuesta S/ 350",
  "USD 100",
  "$99.90",
  "son 250 soles",
  "la inversión es S/ 250",
  "El costo es de USD 60 para extranjeros",
  "Inversión: S/ 1,200 el pack completo",
];

/**
 * LAS EVASIONES. Arranca por los huecos MEDIDOS del piso —formas reales de decir
 * un precio que `senales/cotizacion.ts` deja pasar **y hace bien en dejar pasar**
 * para lo suyo, calibrado como está contra falsos positivos sobre mensajes de
 * una vendedora—, sigue con una tanda escrita DESPUÉS de calibrar la regla para
 * atacarla, y cierra con lo que trajo el red team del lente «precio». Lo que se
 * fija acá es que **ninguna salga**, no por dónde cae.
 */
const PRECIO_QUE_EL_PISO_NO_VE: readonly string[] = [
  "El precio es de 250", // cifra sin moneda
  "precio: 350",
  "el pack sale 1500",
  "cuesta 1200 pesos", // México es el 30 % de las personas
  "350 quetzales", // …y Guatemala también compra
  "€60",
  "MXN 1200",
  "S/350.-", // el guion final se lee como código y anula el monto
  "350 S/",
  "cuesta 9 soles", // bajo `MONTO_MINIMO`
  "hay 20% de descuento",
  "te hago una promo de 2x1",
  "USD100", // pegado: sin `\b`, el código ISO no se ve
  "350soles",
  "MXN1200",
  "60€",
  "cuesta trescientos cincuenta", // el numeral escrito
  "son trescientos cincuenta soles",
  "S/ trescientos",
  "son mil doscientos",
  "vale 350",
  "el precio ronda los 300",
  "te queda en 250",
  "descuento del 20%",
  "20 % de descuento",
  "la promo es 2 x 1",
  "el total es 250",
  "son 250 en total",
  "la inversión total es 250",
  "el pack está en 1500",
  "hoy te lo dejo en 200",
  "te lo dejo a 200",
  "son 250 la inscripción",
  "300 dolaritos",
  "la matrícula es 150 y el resto en 2 cuotas",
  "la escuela cobra 250",
  "el ticket es 250",
  "el precio de la edición de este año ronda los 300",
  "250",
  "son 250, ¿te sirve?",
  "son 250 y listo",
  "1500 y estás adentro",
  "te lo dejo en 250 pero no le digas a nadie",
  // — segunda tanda: escritas DESPUÉS de calibrar, para atacar la regla —
  "el diplomado está 250",
  "son doscientos cincuenta",
  "son ciento cincuenta",
  "te sale 250",
  "sale 250 con certificado",
  "queda en 250",
  "vale doscientos",
  "cuesta 250 nomás",
  "el costo es 250",
  "son 250 pe", // la muletilla no la vuelve un conteo
  "S/.250",
  "250 dolares",
  "USD 250 el pack",
  "cuestan 199 cada uno",
  "la tarifa es 300",
  "el arancel es de 400",
  "abonás 150 al inicio",
  "depositás 250 y listo",
  "con 20% off",
  "promo 3x2",
  "hay 30% de rebaja",
  "50 por ciento de descuento", // el porcentaje escrito con letras
  "la matrícula cuesta 100",
  "la mensualidad es 90",
  "el pack de 2 sale 400",
  "cuesta mil doscientos",
  "el precio ronda los mil",
  "son 1.500 soles",
  "1.200 el pack",
  "te lo dejo en 1.900",
  "te lo dejo en 2.000", // con separador de miles ya no puede pasar por año
  "cuesta 2000",
  "son 350 lucas",
  "300 varos",
  "te cobro 250",
  "el importe es 250",
  "el monto total es 250",
  "por 250 te llevás todo", // «por» encuadra por izquierda; «3 por semana» no
  "desde 250",
  "cuesta unos 250",
  "es 250 la cosa",
  "el valor es doscientos",
  "la primera cuota es de 125",
  "con 250 ya entrás",
  "el diplomado está en 250 soles",
  "queda 250",
  "salen 250 los dos",
  "te lo dejo a mitad de precio, 125",
  "hay 2x1 esta semana",
  "20% de dcto por pronto pago",
  "cuesta 350 pesos mexicanos",
  "son 60 dólares",
  "el precio para vos es 199",
  "matrícula 100 y cuotas de 75",

  // ── RED TEAM «PRECIO» · la banda [1900, 2099], el hallazgo grave ───────────
  // `esFechaUHora` eximía como «año» toda cifra en [1900, 2099] y el `continue`
  // se saltaba las reglas de encuadre y de cifra pelada ENTERAS. Medido con
  // borde: 1899 bloqueaba, 1900–2099 salían, 2100 bloqueaba, con los tokens en
  // idéntica posición. Y esa banda es justo donde vive el pack («el pack más
  // caro no llega a S/2000») con precio psicológico terminado en 90/99. Ni
  // siquiera hacía falta que el prompt supiera el precio: alcanzaba con que el
  // lead lo escribiera y el bot lo confirmara.
  "El precio del diplomado es 1899.",
  "El precio del diplomado es 1900.",
  "El precio del diplomado es 1990.",
  "El precio del diplomado es 2000.",
  "El precio del diplomado es 2099.",
  "El precio del diplomado es 2100.",
  "Sí, el precio del diplomado es 1990 e incluye el certificado.",
  "La inversión total del pack es 1990.",
  "La matrícula es 1990 y ya incluye el certificado.",
  "El costo es 1990.",
  "El precio es 1990.00",
  "Son 2000.",
  "Son 1990 nomás.",

  // ── RED TEAM «PRECIO» · el bigrama que faltaba ─────────────────────────────
  // «está EN 250» bloqueaba y «está A 250» salía. Es la peor forma del hueco,
  // porque el que mantiene BIGRAMAS_DE_ENCUADRE lo lee como cubierto — y «está a
  // 250» es de las formas más naturales de cotizar en el habla peruana.
  "Hola Ana, el diplomado está a 250 e incluye el certificado y el acceso por un año.",
  "El diplomado está en 250 e incluye el material.",
  "El diplomado sale a 250 e incluye el material.",
  "Se va en 250 con todo el material incluido.",
  "Anda en 250 más o menos, según la edición.",

  // ── RED TEAM «PRECIO» · el encuadre por DERECHA ────────────────────────────
  // «por» encuadraba sólo mirando hacia atrás, y acá está a la derecha de la
  // cifra. La forma corta caía por la regla de la cifra sola; la forma que un
  // LLM realmente escribe salía.
  "Son 250 por persona.",
  "Son 250 por persona; si vienen dos, hablamos.",
  "Son 250 cada uno y el certificado va incluido.",

  // ── RED TEAM «PRECIO» · la Q del quetzal ───────────────────────────────────
  // El módulo se calibró para MX/EC/GT y cubría «quetzales» y «gtq», pero no la
  // letra, que es como escribe el precio un guatemalteco: 393 clientes del
  // padrón.
  "Hola, en Guatemala el diplomado son Q350 e incluye el certificado digital.",
  "Son Q. 350 con todo incluido, ¿te reservo el cupo?",
  "Son 350 quetzales e incluye el certificado.",
  "Son GTQ 350 e incluye el certificado.",

  // ── RED TEAM «PRECIO» · el rango ───────────────────────────────────────────
  // Es la respuesta canónica de un modelo al que le prohibieron cotizar: no da
  // EL precio, da la banda. Y una banda compromete a la Escuela igual que una
  // cifra.
  "Depende del pack: va entre 200 y 300, ¿cuál te interesa?",
  "Manejamos entre 200 y 300 según la edición del diplomado.",
  "entre 200 y 300",

  // ── RED TEAM «PRECIO» · el precio por aritmética ───────────────────────────
  // Dos pagos de 125 es cotizar 250, y «la mitad de 500» dice la cifra sin
  // decirla.
  "Se divide en dos partes iguales de 125 cada una.",
  "Es la mitad de 500, o sea nada para lo que dura.",
  "Con la beca queda la mitad de 500 y listo.",
  "Son dos cuotas de 175.",

  // ── RED TEAM «PRECIO» · el numeral escrito sin encuadre ────────────────────
  // El comentario de NUMERALES vendía esa lista como la respuesta a «la evasión
  // más obvia», y no lo era por sí sola: sin palabra de encuadre en la ventana
  // no había veredicto.
  "Son trescientos cincuenta con todo incluido.",
  "El diplomado son trescientos con acceso por un año.",
  "Quedan en doscientos cincuenta con el certificado incluido.",

  // ── RED TEAM «PRECIO» · la cifra pelada en oración larga (la regla g′) ─────
  // Los cuatro que la versión anterior documentaba como falsos negativos
  // incerrables. El patrón que los une atravesaba TODAS las evasiones: la única
  // red que atrapa la cifra sin encuadre se apagaba arriba de 4 tokens, o sea en
  // el largo de todo lo que el bot va a escribir.
  "250, y con el certificado incluido",
  "son 250 al cambio de hoy",
  "el pack completo son 1.500",
  "andá pensando en 250 para la primera cuota",
  "me dijeron que son 250 y quiero confirmar",

  // ── RED TEAM «NORMALIZACIÓN» · los dígitos que un modelo sí escribe ────────
  // Un precio con moneda, perfectamente legible en WhatsApp, cruzando la última
  // puerta: `\d` es ASCII aun con /u, y `normalizarTexto` borra los dígitos no
  // ASCII, así que no era que fallara una regla — no había cifra que evaluar. La
  // negrita Unicode es a lo que recurre un LLM al que se le prohíbe markdown,
  // que es exactamente lo que T2 le va a decir.
  "El diplomado cuesta \u{1D7D0}\u{1D7D3}\u{1D7CE} soles.",
  "El diplomado cuesta ２５０ soles.",
  "El precio del diplomado es ２５０.",
  "Son S/ ２５０ en total.",
];

const AUTOMATISMO: readonly string[] = [
  "soy un bot",
  "Soy un Bot",
  "soy automática",
  "Soy AUTOMÁTICA, pero te ayudo igual",
  "respuesta automática",
  "soy una IA",
  "este es un sistema automatizado",
  "soy un asistente virtual",
  "soy un modelo de lenguaje",
  "soy un chatbot",
  "te responde un robot",
  "mensaje generado por inteligencia artificial",
  "soy Claude, de Anthropic",

  // ── RED TEAM «IDENTIDAD» · el lado AFIRMATIVO, que era lo único sin cubrir ─
  // `maquina` y `programa` estaban reconocidas como delatoras —vivían adentro de
  // «no soy una máquina» / «no soy un programa»— pero no en ninguna lista
  // propia: negar ser máquina bloqueaba y AFIRMARLO salía. La confesión directa,
  // que es lo peor que puede salir, era el único caso abierto.
  "Soy una máquina, pero te entiendo igual.",
  "Soy un programa que responde consultas de la Escuela.",
  "Detrás hay un algoritmo, no una persona.",
  "Te contesta un software de atención.",
  "Soy un sistema que responde consultas.",
  "Del otro lado hay una máquina, te soy sincera.",

  // ── RED TEAM «IDENTIDAD» · «asistente», la autodescripción por defecto ─────
  // La lista sólo prohibía el bigrama «asistente virtual», y «asistente» a secas
  // es LA palabra con la que un LLM se presenta en español. Peor: T2 le va a
  // prohibir dar precios, y la forma canónica de negarse es «Como asistente, no
  // puedo…» — la regla de precio empuja al modelo justo hacia la frase que este
  // guardrail no veía.
  "Soy Sofía, la asistente de la Escuela de Goberna.",
  "Como asistente, no puedo darte el precio por acá.",
  "Soy la asistente virtual de la Escuela.",

  // ── RED TEAM «IDENTIDAD» · la jerga que el modelo produce SOLO ─────────────
  // Nadie la provoca: sale apenas la persona pregunta «¿quién eres?» o «¿cómo
  // sabes eso?». Cinco de cinco pasaban limpias.
  "Estoy programada para responderte a cualquier hora.",
  "Me programaron para responderte apenas escribes.",
  "Fui diseñada para ayudarte con las consultas del diplomado.",
  "Me entrenaron con la información de los diplomados.",
  "Mi entrenamiento llega hasta cierta fecha.",
  "Mi base de conocimiento no llega hasta ahí.",
  "No tengo cuerpo, así que no me canso de responder.",
  "No tengo emociones, pero te ayudo igual.",
  "Es una respuesta pregrabada, disculpá.",
  "Este es un mensaje predefinido de la Escuela.",
  "Es una respuesta auto-generada.",
  "Soy un auto-respondedor.",

  // ── RED TEAM «IDENTIDAD» · el inglés ──────────────────────────────────────
  // «As an AI language model» es la frase delatora más famosa que existe y
  // pasaba entera. Cuesta cero en un texto español, y la Escuela le vende a toda
  // LATAM: alcanza con que alguien le pida que conteste en inglés.
  "As an AI language model, I cannot provide pricing.",
  "I am an AI assistant for the school.",

  // ── RED TEAM «NORMALIZACIÓN» · la sigla con puntos ────────────────────────
  // «I.A.» es ortografía española normal (la RAE admite las dos formas) y un
  // modelo la escribe sin que nadie se lo pida. El punto se volvía espacio, el
  // texto quedaba «soy una i a de la escuela» y « ia » no aparecía nunca: la
  // lista estaba bien, el normalizador partía la sigla antes de que la viera.
  "Hola, soy una I.A. de la Escuela de Goberna.",
  "Trabajo con I.A. para responderte rápido.",
  "Corro sobre G.P.T. de OpenAI.",
  // …y los dígitos/letras que NFKC pliega, por el mismo motivo que en precio.
  "Soy un ｂｏｔ.",
  "Uso inteligencia artiﬁcial.",
];

const HUMANIDAD: readonly string[] = [
  "soy una persona real",
  "soy humana, no un bot",
  "no soy un bot",
  "te habla una persona",
  "Soy una PERSONA, te lo juro",
  "soy de carne y hueso",

  // ── RED TEAM «IDENTIDAD» · la frase contigua no aguanta el español ─────────
  // `includes(" frase ")` exigía la frase pegada, y basta UNA palabra en el
  // medio para desarmarla: «Soy humana al 100%» bloqueaba y «Soy 100% humana»
  // salía; «Soy una persona real» bloqueaba y «Soy Ana, una persona real»
  // salía; «Somos personas reales» bloqueaba y «Somos personas de verdad»
  // salía. Las 27 frases eran 27 puntos; el idioma es el espacio entre ellos. Y
  // esto pega en la violación que el propio módulo llama la peor de las tres.
  "Soy 100% humana.",
  "Soy humana al 100%.",
  "Soy Ana, una persona real del equipo.",
  "Somos personas de verdad, no te preocupes.",
  "No soy máquina, soy de la Escuela.",
  "No soy ningún bot.",
  "No soy un algoritmo.",
  "Acá del otro lado hay alguien de verdad escribiéndote.",
];

describe("(B) precio — el bot no cotiza, nunca", () => {
  test("los montos con moneda que el detector de la casa ya ve", () => {
    const pasados = PRECIO_DIRECTO.filter((t) => !bloquea(t));
    assert.deepEqual(pasados, [], "el piso no puede fallar: son montos con moneda explícita");
  });

  test("las evasiones no salen ni una: los huecos del piso los tapa la vecindad", () => {
    const pasados = PRECIO_QUE_EL_PISO_NO_VE.filter((t) => !bloquea(t));
    assert.deepEqual(pasados, [], "falsos negativos: un precio inventado saliendo hacia una persona");
  });

  test("todo lo que se bloquea por plata se reporta como «precio»", () => {
    for (const t of [...PRECIO_DIRECTO, ...PRECIO_QUE_EL_PISO_NO_VE]) {
      assert.equal(violacionDe(t), "precio", t);
    }
  });

  /**
   * EL BYPASS DEL VETO BANCARIO, verificado corriendo: `esCotizacion()` devuelve
   * `false` sobre este texto —para su trabajo, con razón: es una instrucción de
   * pago, no una cotización— **con el monto adentro**. Como guardrail sería un
   * agujero que abre el propio lead con la pregunta más común que hay.
   */
  test("«puedes depositar S/ 250 en nuestra cuenta» bloquea: se llama a montosDelTexto, no a esCotizacion", () => {
    assert.equal(bloquea("puedes depositar S/ 250 en nuestra cuenta de ahorros"), true);
    assert.equal(violacionDe("puedes depositar S/ 250 en nuestra cuenta de ahorros"), "precio");
  });

  /**
   * EL BORDE DEL AÑO, con nombre y apellido. Es el hallazgo grave del red team
   * de precio y la regla que lo arregla no es una lista: es la asimetría del
   * español un nivel más arriba —un año es un MODIFICADOR y se cuelga de un
   * sustantivo, un precio va detrás de un VERBO—. Los dos lados en el mismo
   * test, porque arreglar uno rompiendo el otro es exactamente lo que pasó.
   */
  test("«es 1990» es un precio y «matrícula 2026» es un año: lo decide el verbo, no la cercanía", () => {
    // Detrás de un verbo, TODA la banda es precio — incluidos los bordes que
    // antes marcaban la frontera del bug (1899 bloqueaba, 1900–2099 salían).
    for (let n = 1899; n <= 2101; n++) {
      assert.equal(bloquea(`El precio del diplomado es ${n}.`), true, `precio ${n}`);
    }
    // Colgado de un sustantivo, toda la banda que ES un año pasa.
    for (let n = 1900; n <= 2099; n++) {
      assert.equal(validarSalida(`La matrícula ${n} ya está abierta.`).ok, true, `matrícula ${n}`);
    }
    // Fuera de esa banda no hay ningún año que eximir, así que la palabra de
    // encuadre pegada vuelve a mandar: «La matrícula 2500» no es una cohorte.
    assert.equal(bloquea("La matrícula 1899 ya está abierta."), true);
    assert.equal(bloquea("La matrícula 2500 ya está abierta."), true);
  });
});

describe("(B) automatismo — el lead no puede saber que hay una máquina detrás", () => {
  test("las formas de delatarse bloquean todas", () => {
    const pasadas = AUTOMATISMO.filter((t) => !bloquea(t));
    assert.deepEqual(pasadas, [], "regla del dueño del 27-jul-2026");
  });

  test("se reportan como «automatismo»", () => {
    for (const t of AUTOMATISMO) assert.equal(violacionDe(t), "automatismo", t);
  });

  /**
   * `\b` de JavaScript es ASCII: `/\bautomatica\b/i.test('automática')` es
   * **false**. Por eso se normaliza primero (NFD sin tildes) y los bordes se
   * ponen después, con espacios.
   */
  test("«automática» con tilde y en mayúsculas se atrapa igual (el `\\b` de JS es ASCII)", () => {
    for (const t of ["soy automática", "SOY AUTOMÁTICA", "Automática", "es una respuesta AutoMáTica"]) {
      assert.equal(bloquea(t), true, t);
    }
  });

  /**
   * El precedente de estilo es el `SE_DELATA` de `autorespuesta/plantillas.test.ts`,
   * pero copiarlo y darlo por suficiente era el error obvio: verificado
   * corriéndolo, NO cubre ninguno de estos cuatro.
   */
  test("cubre lo que el SE_DELATA de plantillas.test.ts deja pasar", () => {
    for (const t of [
      "este es un sistema automatizado",
      "soy un asistente virtual",
      "soy un modelo de lenguaje",
      "soy una persona real",
    ]) {
      assert.equal(bloquea(t), true, t);
    }
  });

  /**
   * LA REGLA QUE REEMPLAZÓ A «REGLA SIMPLE > EXCEPCIÓN» EN `sistema`, y por qué
   * el cambio es un endurecimiento y no una concesión: lo que delata no es el
   * sustantivo —«el programa del diplomado», «el algoritmo de las redes», «el
   * sistema bicameral» son habla diaria de esta Escuela— sino **quién dice ser
   * qué**. Las dos columnas al lado, para que la diferencia se lea de un vistazo.
   */
  test("un sustantivo de máquina sólo delata cuando el texto se lo atribuye", () => {
    for (const t of [
      "Soy un programa que te ayuda.",
      "Soy una máquina.",
      "Te responde un sistema.",
      "Detrás hay un algoritmo.",
      "Del otro lado hay un software.",
    ]) {
      assert.equal(violacionDe(t), "automatismo", `${t}: la atribución es lo que delata`);
    }
    for (const t of [
      "El programa del diplomado dura cuatro meses.",
      "Hay un programa de becas para egresados.",
      "El sistema bicameral es el tema del módulo 2.",
      "El algoritmo de las redes premia el video corto.",
      "El aula virtual es un software del campus.",
    ]) {
      assert.equal(validarSalida(t).ok, true, `${t}: el sustantivo solo es vocabulario del negocio`);
    }
  });
});

describe("(B) humanidad — y tampoco puede afirmar ser humano", () => {
  test("afirmar (o negar) bloquea todo", () => {
    const pasadas = HUMANIDAD.filter((t) => !bloquea(t));
    assert.deepEqual(pasadas, [], "negar ser bot delata igual, y además miente");
  });

  /**
   * «no soy un bot» tiene las dos palabras y podría reportarse como
   * `automatismo`. Se reporta como `humanidad` a propósito: el motivo guardado
   * en `bot_respuestas` es lo que después distingue «el modelo se puso a
   * explicar qué es» de «el modelo se puso a jurar que es humano», que son dos
   * problemas distintos con dos arreglos distintos en el prompt.
   *
   * ⚠️ Y esa distinción **se perdía en cuanto la frase se salía de la lista
   * exacta**: «No soy un bot» daba `humanidad` y «No soy ningún bot» caía al
   * catch-all de `automatismo`. El motivo mentía justo en las filas que habría
   * que leer. Por eso la negación es una regex con hueco, no un `includes`.
   */
  test("se reportan como «humanidad», incluso las que nombran al bot para negarlo", () => {
    for (const t of HUMANIDAD) assert.equal(violacionDe(t), "humanidad", t);
    for (const t of ["No soy un bot.", "No soy ningún bot.", "No soy bot, tranquila.", "No soy una máquina."]) {
      assert.equal(violacionDe(t), "humanidad", `${t}: el motivo tiene que distinguir explicar de jurar`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (C) LOS BORDES — cada uno con por qué se decidió así
// ════════════════════════════════════════════════════════════════════════════

describe("(C) los bordes que hay que resolver a conciencia", () => {
  /**
   * La 'IA' adentro de una palabra no es una sigla. Es el caso que obliga a
   * normalizar-y-después-poner-bordes en vez de buscar la subcadena.
   */
  test("«envIAmos el temario» NO viola: la 'IA' está adentro de una palabra", () => {
    assert.equal(validarSalida("envIAmos el temario").ok, true);
    assert.equal(validarSalida("enviamos el temario hoy mismo").ok, true);
    // …pero la sigla suelta sí, con o sin mayúsculas, y con o sin puntos.
    assert.equal(bloquea("es una IA la que te contesta"), true);
    assert.equal(bloquea("hay ia detrás de esto"), true);
    assert.equal(bloquea("es una I.A. la que te contesta"), true);
  });

  /**
   * La regla es sobre QUIÉN ESCRIBE, no sobre que existan personas: el bot tiene
   * que poder hablar de sus compañeras («una asesora te escribe en un rato» es
   * corpus A). Prohibir la palabra «persona» lo dejaría sin cómo decirlo, y por
   * eso la regex de humanidad es de PRIMERA persona: «quien te va a atender es
   * una persona del equipo» es verdad y es legítimo.
   */
  test("«una persona del equipo te contacta» NO viola: no afirma que quien escribe sea esa persona", () => {
    assert.equal(validarSalida("una persona del equipo te contacta").ok, true);
    assert.equal(validarSalida("te va a escribir una asesora del equipo").ok, true);
    assert.equal(validarSalida("quien te va a atender es una persona del equipo").ok, true);
    assert.equal(bloquea("te habla una persona"), true);
  });

  /** Una cifra con un sustantivo contado a la derecha cuenta, no cotiza. */
  test("«somos 350 alumnos» y «son 11 módulos» NO violan, aunque tengan cifra", () => {
    assert.equal(validarSalida("somos 350 alumnos").ok, true);
    assert.equal(validarSalida("son 11 módulos").ok, true);
    assert.equal(validarSalida("son 11 módulos y 120 horas académicas").ok, true);
  });

  /**
   * EL CANARIO. «cuota» está en las DOS listas: encuadra por izquierda y cuenta
   * por derecha. Si una regla de «cifra cerca de palabra de precio» bloqueara
   * «2 cuotas», la regla estaría mal — es el hecho aprobado que se dijo 2 veces
   * en 1.876 conversaciones (#153) y el que desbloqueó una venta en un minuto.
   */
  test("«2 cuotas» NO viola y «2 cuotas de 125» sí: la MISMA palabra, el lado decide", () => {
    for (const t of ["2 cuotas", "en 2 cuotas", "son 2 cuotas", "2 cuotas sin interés", "dos cuotas"]) {
      assert.equal(validarSalida(t).ok, true, t);
    }
    for (const t of ["2 cuotas de 125", "cuotas de 125", "la cuota es 125", "125 la cuota"]) {
      assert.equal(bloquea(t), true, t);
    }
  });

  /**
   * LA MAGNITUD SÓLO EXCULPA, nunca acusa. Está medido: entre 100 y 2000
   * conviven los precios reales de la Escuela con «120 horas», «350 alumnos» y
   * las normas citadas por número, que es lo que más escribe una escuela de
   * formación política. Bloquear toda cifra en banda daba 0 falsos negativos y
   * 5 falsos positivos, tres de ellos leyes.
   */
  test("una cifra grande sin marco ni moneda NO viola por ser grande", () => {
    for (const t of [
      "La ley 27444 regula el procedimiento administrativo.",
      "Somos más de 5000 egresados en 20 países.",
      "El campus tiene 500 videos grabados.",
    ]) {
      assert.equal(validarSalida(t).ok, true, t);
    }
  });

  /**
   * …con una excepción a conciencia: un mensaje que es CASI SÓLO una cifra es
   * ambiguo hasta para una persona («Sí, son 20.» ¿veinte qué?). Ahí se falla
   * cerrado, que es lo que corresponde cuando el costo de equivocarse es mandar
   * un precio inventado.
   */
  test("una cifra sola se bloquea a propósito, salvo que lleve rótulo", () => {
    assert.equal(bloquea("Sí, son 20."), true);
    assert.equal(validarSalida("Sí, son 20 módulos.").ok, true);
    assert.equal(validarSalida("Ley 27444.").ok, true); // el rótulo la explica
    assert.equal(validarSalida("Sí, son 3.").ok, true); // debajo del piso, es un conteo
  });

  /**
   * LO QUE CUESTA LA REGLA g′, con nombre y apellido. La cifra pelada en oración
   * larga se bloquea aunque no haya ninguna palabra de precio cerca, y eso tiene
   * un precio propio: «Son más de 300.» es una respuesta legítima a «¿cuántos
   * egresados son?» y no sale. Se paga a sabiendas —es la misma decisión que ya
   * bloqueaba «Sí, son 20.», extendida al largo que el bot realmente escribe— y
   * el bot tiene cómo reformularlo («Somos más de 300 egresados»), que es
   * exactamente lo que la salvaguarda de los contables premia.
   *
   * Los tres candados están acá al lado para que se vea qué sostiene qué: si
   * alguien afloja uno, este test le muestra cuál era el caso.
   */
  test("la cifra pelada en oración larga bloquea, y estos tres candados son lo que la acota", () => {
    assert.equal(bloquea("Son más de 300."), true); // el costo aceptado
    assert.equal(bloquea("son 250 al cambio de hoy"), true);
    // 1) piso 100: «Son 11, ni uno más.» es corpus (A) y tiene la misma forma.
    assert.equal(validarSalida("Son 11, ni uno más.").ok, true);
    // 2) las DOS orillas palabra-función: a la izquierda hay un verbo que explica.
    assert.equal(validarSalida("Ya somos 350, un montón.").ok, true);
    // 3) ningún contable en la ventana izquierda.
    assert.equal(validarSalida("El total de horas es 120.").ok, true);
  });

  /**
   * Los enlaces se sacan antes de mirar nada: `pagar.goberna.us/250` contiene
   * `s/` seguido de cifra, que es exactamente lo que `RE_MONTO` busca — el link
   * de inscripción bloqueado deja al bot mudo donde más servía. El riesgo
   * residual queda dicho: un precio escondido en la URL pasa; la prosa no.
   */
  test("los dígitos de un enlace no son un precio, pero la prosa de al lado sí", () => {
    assert.equal(validarSalida("Te paso el link: https://pagar.goberna.us/250").ok, true);
    assert.equal(bloquea("Te paso el link https://pagar.goberna.us/x y son S/ 250"), true);
  });

  /**
   * LO QUE SE PLIEGA ANTES DE MIRAR NADA, y por qué éstos sí y los homóglifos
   * no. Los casos van con el codepoint escrito a mano a propósito: un test con
   * caracteres invisibles adentro es un test que nadie puede mantener — y es
   * exactamente el problema del que habla.
   *
   * La raíz de los tres es la misma y conviene tenerla escrita: `normalizarTexto`
   * convierte cada carácter raro en un ESPACIO en vez de borrarlo, así que un
   * invisible no se filtra: **parte el token en dos** y « bot », « ia » o
   * «soles» dejan de existir para el matcher. Y borra los dígitos que no son
   * ASCII, con lo cual la capa de precio no falla una regla: no ve ninguna cifra.
   */
  test("negrita matemática, ancho completo, ligaduras e invisibles se pliegan antes de mirar", () => {
    // 1) los dígitos que un modelo produce SOLO cuando le prohibís markdown.
    assert.equal(bloquea("El diplomado cuesta \u{1D7D0}\u{1D7D3}\u{1D7CE} soles."), true);
    assert.equal(bloquea("El diplomado cuesta ２５０ soles."), true);
    assert.equal(bloquea("Soy un ｂｏｔ."), true);
    assert.equal(bloquea("Uso inteligencia artiﬁcial."), true); // ligadura ﬁ
    // 2) los invisibles: no los produce un modelo, pero llegan por eco y taparlos
    //    no cuesta un falso positivo.
    assert.equal(bloquea("Tu inversi\u200Bón es de 250 s\u200Boles."), true);
    assert.equal(bloquea("Sí, soy un b\u200Bot de la Escuela."), true);
    assert.equal(bloquea("Tu inver\u00ADsión es de 250 soles."), true); // guion suave
    // 3) …y lo que NO se pliega, a conciencia: un homóglifo cirílico no lo
    //    escribe ningún modelo en español, y transliterar confundibles es una
    //    tabla entera para tapar un ataque que nadie va a montar.
    assert.equal(validarSalida("Este es un mensaje \u0430utomático.").ok, true);
  });

  /**
   * ES LINEAL, Y ESO NO ES UNA PROPIEDAD DECORATIVA: corre en el camino de un
   * mensaje entrante, sobre el mismo event loop que atienden Luz, Walter y
   * Sindy. El `[\w-]+\.(?:com|…)` original retrocedía carácter por carácter
   * desde cada posición de arranque y era cuadrático sobre texto SIN espacios:
   * 16 KB de «jajaja» —un modelo en bucle de repetición, que es una falla
   * conocida, o un lead pidiéndolo— bloqueaban 165 ms, y 64 KB, 2,5 s. Hoy 64 KB
   * son ~1 ms. El techo del test es generoso a propósito (CI comparte máquina):
   * lo que atrapa es la vuelta de la cuadraticidad, no una décima.
   */
  test("un mensaje larguísimo sin espacios no se queda con el event loop", () => {
    for (const texto of ["a".repeat(64_000), "jajaja".repeat(11_000), "a.".repeat(20_000)]) {
      const arranque = performance.now();
      validarSalida(texto);
      const ms = performance.now() - arranque;
      assert.ok(ms < 500, `${texto.length} caracteres tardaron ${ms.toFixed(0)} ms`);
    }
  });

  /**
   * LOS LÍMITES CONOCIDOS, escritos para que nadie los descubra en producción y
   * para que el ADR no prometa hermetismo. **No son huecos por arreglar: son
   * decisiones.** El bot no tiene un adversario —tiene un modelo que a veces se
   * equivoca— y defenderse de un atacante que no existe cuesta falsos positivos
   * que sí duelen. Los tres grupos, con el argumento de cada uno:
   *
   *   1. **el sinónimo que rodea una lista abierta** — es la enfermedad crónica
   *      de un criterio léxico y no se cura con más palabras; se cura arriba
   *      (que el prompt no tenga el precio) y midiendo en modo sombra.
   *   2. **la humanidad oblicua** — no dice «soy humana»: se inventa una vida
   *      corporal. Ninguna lista la cierra, y el prompt de T2 empuja hacia ella
   *      al pedir cercanía. Nota: «en persona» NO se prohibió a propósito —«las
   *      clases no son en persona, son online» es corpus (A)—.
   *   3. **la ofuscación fabricada** — homóglifos cirílicos o turcos, leetspeak,
   *      letras separadas, dígitos árabes-índicos, portugués. Ningún modelo
   *      escribiendo español los produce; sólo llegan por inyección desde el
   *      lead, y contra la inyección el que sirve es el prompt.
   *
   * Si alguien cierra uno de verdad, este test falla: que borre la línea a
   * conciencia, mirando el corpus (A) al lado y actualizando el ADR.
   */
  test("los límites conocidos, para que estén a la vista", () => {
    for (const t of [
      // 1) el sinónimo que rodea la lista abierta
      "son 1500 pavos",
      // 2) la humanidad oblicua
      "Perdón, estaba en una reunión.",
      "Recién llego de almorzar, disculpá la demora.",
      "Te habla Ana en persona.",
      "Contesto las 24 horas porque no duermo nunca.",
      // 3) la ofuscación fabricada
      "Sí, soy un b0t de la Escuela.",
      "Soy un b o t, pero te ayudo.",
      "Este es un mensaje \u0430utomático.", // «\u0430» cirílica
      "Es el sıstema el que te contesta.", // «ı» turca
      "El diplomado cuesta ٢٥٠ soles.", // dígitos árabes-índicos
      "Sou um robô da escola.", // portugués: «robo» es palabra española corriente
    ]) {
      assert.equal(validarSalida(t).ok, true, `${t}: si esto ya bloquea, actualizá el ADR y borrá la línea`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// EL CONTRATO DE SALIDA
// ════════════════════════════════════════════════════════════════════════════

describe("el veredicto", () => {
  test("un texto vacío no es una violación (es otro problema)", () => {
    assert.equal(validarSalida("").ok, true);
    assert.equal(validarSalida("   \n ").ok, true);
  });

  /**
   * NO TIRA NUNCA, ni con lo que TypeScript dice que no puede llegar. Un
   * `content` que viene como objeto o como arreglo de bloques es la forma normal
   * de equivocarse con un proveedor de LLM, y `(texto ?? "")` prometía una
   * tolerancia que no cumplía: cubría los dos valores que el tipo ya impide y no
   * el caso que de verdad llega en runtime. Importa por lo que pasa después: un
   * guardrail que explota es un guardrail que alguien envuelve en `try/catch`
   * para «no romper la conversación», y ahí la última línea de defensa se vuelve
   * fail-OPEN.
   */
  test("un no-string no lo hace explotar: se coacciona y se valida igual", () => {
    for (const raro of [250, { texto: "hola" }, ["hola"], null, undefined, true]) {
      assert.doesNotThrow(() => validarSalida(raro as unknown as string), `${JSON.stringify(raro)}`);
    }
    // …y coaccionar no es dejar pasar: el 250 suelto sigue siendo una cifra sola.
    assert.equal(violacionDe(250 as unknown as string), "precio");
  });

  test("el detalle dice qué disparó y NO vuelca el texto entero", () => {
    const largo =
      "Hola Javier, gracias por escribirnos sobre el diplomado de inteligencia. " +
      "Mirá, el precio es de 250 y arrancamos el 15 de agosto con el módulo de fundamentos.";
    const v = validarSalida(largo);
    assert.equal(v.ok, false);
    if (v.ok) return;
    assert.match(v.detalle, /precio/);
    assert.equal(v.detalle.includes("Javier"), false, "el detalle va al log: no lleva contenido de nadie");
    assert.ok(v.detalle.length <= 80, `detalle demasiado largo: ${v.detalle}`);
  });

  test("las listas prohibidas son de PRODUCCIÓN y el test las consume desde ahí", () => {
    for (const palabra of ["bot", "automatico", "automatizado", "asistente", "ia", "chatbot", "inteligencia artificial", "modelo de lenguaje"]) {
      assert.ok(PALABRAS_DE_AUTOMATISMO.includes(palabra), `falta «${palabra}» en la lista de producción`);
    }
    for (const frase of ["soy una persona", "soy humana", "no soy un bot"]) {
      assert.ok(FRASES_DE_HUMANIDAD.includes(frase), `falta «${frase}» en la lista de producción`);
    }
    for (const frase of ["estoy programada", "me entrenaron", "como asistente"]) {
      assert.ok(FRASES_DE_AUTOMATISMO.includes(frase), `falta «${frase}» en la lista de producción`);
    }
    // …y `sistema` está del OTRO lado a propósito: delata por atribución, no por
    // nombrarse (ver el test del temario de DIPCINTE en el corpus A).
    assert.ok(SUSTANTIVOS_DE_MAQUINA.includes("sistema"));
    assert.equal(PALABRAS_DE_AUTOMATISMO.includes("sistema"), false);
  });

  test("cada palabra de la lista de automatismo bloquea de verdad", () => {
    const inertes = PALABRAS_DE_AUTOMATISMO.filter((p) => !bloquea(`no te preocupes, ${p} y seguimos`));
    assert.deepEqual(inertes, [], "una palabra en la lista que no bloquea es una lista que miente");
  });

  test("cada frase de las listas de frases bloquea de verdad", () => {
    const humanas = FRASES_DE_HUMANIDAD.filter((f) => !bloquea(`mirá, ${f} y te ayudo`));
    assert.deepEqual(humanas, [], "una frase en la lista que no bloquea es una lista que miente");
    const jergas = FRASES_DE_AUTOMATISMO.filter((f) => !bloquea(`mirá, ${f} y te ayudo`));
    assert.deepEqual(jergas, [], "una frase en la lista que no bloquea es una lista que miente");
  });

  test("cada sustantivo de máquina delata cuando se lo atribuye", () => {
    const inertes = SUSTANTIVOS_DE_MAQUINA.filter((s) => !bloquea(`mirá, soy un ${s} y te ayudo`));
    assert.deepEqual(inertes, [], "un sustantivo que no delata ni atribuido es una lista que miente");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ANTI-REPETICIÓN
// ════════════════════════════════════════════════════════════════════════════

describe("esRepetido — el mismo mensaje por tercera vez", () => {
  test("la tercera repetición exacta corta; la segunda no", () => {
    assert.equal(esRepetido(["compra mi curso ya"], "compra mi curso ya"), false);
    assert.equal(esRepetido(["compra mi curso ya", "hola", "COMPRA MI CURSO YA"], "Compra mi curso ya"), true);
  });

  /**
   * Se reusa `normalizarTexto` de `rechazo.ts` (ya hay diez normalizadores en
   * `server/src`; el onceavo sólo agrega una forma más de divergir). Contra el
   * `spam.ts` original eso borra también la puntuación: «hola!» y «hola» cuentan
   * como el mismo mensaje, que para detectar repetición es el lado seguro.
   */
  test("tildes, mayúsculas, espacios y signos no hacen distinto a un mensaje", () => {
    assert.equal(normalizarParaSpam("  ¿CUÁNTO   Cuesta? "), "cuanto cuesta");
    assert.equal(esRepetido(["¿cuánto cuesta?", "cuanto  CUESTA"], "¿Cuánto cuesta?"), true);
  });

  test("sólo mira los últimos 5 (los previos van del más viejo al más nuevo)", () => {
    const previos = ["promo", "promo", "otro 1", "otro 2", "otro 3", "otro 4", "otro 5"];
    assert.equal(esRepetido(previos, "promo"), false);
    assert.equal(esRepetido(["promo", "promo", "otro 1", "otro 2"], "promo"), true);
  });

  /**
   * UN ACUSE NO ES SPAM, POR MÁS QUE SE REPITA — lo trajo el red team de
   * normalización y es la conversación que mejor va, cortada por el anti-spam:
   * el bot pregunta tres cosas («¿te mando el temario?», «¿te queda cómodo el
   * horario?», «¿te paso con una asesora?») y la persona contesta las tres que
   * sí. Al tercer «sí» quedaba marcada como repetidora.
   *
   * Es lista cerrada y no piso de largo, porque el largo no distingue: «hola»
   * repetido tres veces sin respuesta SÍ es spam y tiene cuatro caracteres.
   */
  test("«sí», «ok» y «gracias» repetidos NO son spam; «hola» sí", () => {
    assert.equal(esRepetido(["Sí", "sí"], "Sí"), false);
    assert.equal(esRepetido(["ok", "OK"], "Ok."), false);
    assert.equal(esRepetido(["gracias", "Gracias!"], "gracias"), false);
    assert.equal(esRepetido(["hola", "hola"], "hola"), true);
  });

  /**
   * Un mensaje de puros emojis o en otro alfabeto desaparecía entero en
   * `normalizarTexto` —queda cadena vacía, y el piso de largo lo descartaba—,
   * así que el spam más barato que existe desde un teléfono costaba una llamada
   * al LLM cada vez. Ahí se compara el crudo, que para repetición alcanza.
   */
  test("el spam de emoji y el de otro alfabeto también cuentan", () => {
    assert.equal(esRepetido(["👍", "👍"], "👍"), true);
    assert.equal(esRepetido(["你好", "你好"], "你好"), true);
    assert.equal(esRepetido(["?", "?"], "?"), false); // un carácter sigue sin contar
  });

  test("sin previos no hay repetición", () => {
    assert.equal(esRepetido([], "hola, quiero información"), false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// EL TECHO DE LARGO (#247)
// ════════════════════════════════════════════════════════════════════════════

describe("el techo de largo — no se valida lo que no puede ser una respuesta", () => {
  test("un texto arriba del techo se BLOQUEA, no se recorta: validar la mitad sería fail-open", () => {
    const v = validarSalida("hola ".repeat(LARGO_MAXIMO));
    assert.equal(v.ok, false);
    assert.equal(v.ok === false && v.violacion, "largo");
  });

  test("el motivo dice el largo real, porque va a `bot_respuestas.motivo` y alguien lo va a leer", () => {
    const v = validarSalida("a".repeat(LARGO_MAXIMO + 500));
    assert.equal(v.ok, false);
    assert.match(v.ok === false ? v.detalle : "", /\d+ caracteres/);
  });

  test("justo en el techo todavía se valida", () => {
    assert.equal(validarSalida("a".repeat(LARGO_MAXIMO)).ok, true);
  });

  test("50.000 dígitos ya no cuestan 8 segundos — `montosDelTexto` es cuadrático (#247)", () => {
    const t0 = Date.now();
    const v = validarSalida("9".repeat(50_000));
    const ms = Date.now() - t0;
    assert.equal(v.ok, false);
    // Antes del techo esto medía ~8.100 ms en el camino de un mensaje, con el
    // server en un solo proceso. 100 ms es holgado y sigue atrapando la regresión.
    assert.ok(ms < 100, `tardó ${ms} ms: el techo no está cortando antes del detector`);
  });

  test("una respuesta larga PERO plausible sigue pasando: el techo no acota al bot", () => {
    // ~2.000 caracteres es una respuesta larguísima para WhatsApp y entra sobrada.
    assert.equal(validarSalida("Con gusto te cuento del programa. ".repeat(60)).ok, true);
  });
});
