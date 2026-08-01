import type { MomentoDeVenta } from "../sugerencias/estado.js";

/**
 * LOS DATOS QUE CIERRAN VENTAS Y CASI NUNCA SE DICEN.
 *
 * ══ DE DÓNDE SALE ESTA LISTA ═════════════════════════════════════════════════
 *
 * De la minería de las 1.876 conversaciones reales (issue #153), §7 «Agregar:
 * los hechos que hoy no se dicen». No es una lluvia de ideas: es un conteo.
 *
 *   | Hecho que desbloquea                                  | se dijo en |
 *   |-------------------------------------------------------|-----------:|
 *   | «El acceso al campus lo tiene por todo un año»         |  **1** vez |
 *   | «Se puede pagar en 2 cuotas»                           |  **2**     |
 *   | «Este es nuestro canal oficial, verifíquenos»          |  **1**     |
 *   | «Es para público general, no solo policías ni militares» | **3**    |
 *   | «Las clases quedan grabadas»                           |    263 (14%) |
 *
 * En los transcripts, **cada uno de estos, cuando por fin se dijo, desbloqueó
 * la conversación en el acto**: una persona pagó menos de un minuto después de
 * que le concedieran las dos cuotas; otra contestó «Ah super» al enterarse del
 * acceso por un año. No son argumentos de venta: son datos que la vendedora ya
 * tiene y no usa porque no los tiene a mano.
 *
 * ══ POR QUÉ ESTO ES UN *DEFAULT*, NO EL CATÁLOGO ═════════════════════════════
 *
 * Lo que hoy cierra ventas cambia —cambia el producto, cambian las objeciones,
 * cambia el país— así que el catálogo vivo está en la tabla `hechos` y se edita
 * sin tocar código ni desplegar. Esta lista es el punto de partida: se siembra
 * con `npm run hechos:sembrar`, y mientras la tabla esté vacía (o todavía no
 * exista, porque falta el `db:push`) el endpoint la sirve tal cual, degradado
 * pero útil, en vez de mostrar un bloque vacío.
 *
 * ══ QUÉ NO SON ══════════════════════════════════════════════════════════════
 *
 * **No son plantillas de secuencia.** Una plantilla son varios mensajes que
 * salen espaciados por `EnvioControlado`; esto es UNA línea que se pega en la
 * caja para que la vendedora la lea, la edite y la mande ella. Poner texto en
 * el composer no es enviar (la regla de #45), y acá esa distinción es la razón
 * de ser del bloque: son munición para una conversación viva, no un despacho.
 */

export interface Hecho {
  /** Slug estable. Es la identidad: renombrar el rótulo no rompe nada. */
  clave: string;
  /** Lo que se lee en el chip. Corto — entra en 360 px. */
  rotulo: string;
  /** La frase que se pega en la caja. Una línea, en la voz de la vendedora. */
  texto: string;
  /**
   * En qué momentos de la venta corresponde ofrecerlo. Vacío = en todos.
   * Los momentos son los de `sugerencias/estado.ts`: una sola cabeza decide
   * dónde está la conversación, y de ahí sale tanto qué secuencia sugerir como
   * qué dato recordar.
   */
  momentos: MomentoDeVenta[];
  /** Menor primero dentro del mismo momento. */
  orden: number;
}

export const CATALOGO_POR_DEFECTO: readonly Hecho[] = [
  {
    clave: "cuotas",
    rotulo: "Se puede en 2 cuotas",
    texto:
      "El pago se puede hacer en 2 cuotas: la primera para reservar tu lugar y la segunda antes de que empiece. Si te sirve así, te paso el link de la primera.",
    // Después del precio es cuando la plata frena: ahí es donde este dato
    // desbloqueó una venta en menos de un minuto (#153 §4.5).
    momentos: ["cotizada", "enfriada"],
    orden: 1,
  },
  {
    clave: "acceso-un-anio",
    rotulo: "Acceso por todo un año",
    texto:
      "Las clases quedan grabadas y el acceso al campus lo tienes por todo un año: entras cuando puedas, las veces que quieras. Si un día no llegas en vivo, no pierdes la clase.",
    // Contesta la objeción de agenda (6%) y es la frase que hizo decir «Ah super».
    momentos: ["cotizada", "enfriada", "material-sin-precio", "pidiendo-info", "en-conversacion"],
    orden: 2,
  },
  {
    clave: "publico-general",
    rotulo: "Es para público general",
    texto:
      "El diplomado es para público general: no hace falta ser policía ni militar. Hay abogados, funcionarios, consultores, empresarios y estudiantes cursando.",
    // «¿Me sirve a mí?» es el 10% de las preguntas y las conversaciones que
    // arrancan por el fit llegan al triple de mensajes propios (#153 §4.4).
    momentos: ["primer-contacto", "pidiendo-info", "material-sin-precio", "en-conversacion"],
    orden: 3,
  },
  {
    clave: "canal-oficial",
    rotulo: "Somos el canal oficial",
    texto:
      "Este es nuestro canal oficial. Puedes verificarnos en nuestras redes y en el canal de WhatsApp de la Escuela antes de pagar nada.",
    // La desconfianza es el 8% de las preguntas y no se contesta con adjetivos:
    // quien recibió la prueba de existencia pagó minutos después.
    momentos: ["primer-contacto", "pidiendo-info", "cotizada", "en-conversacion"],
    orden: 4,
  },
  {
    clave: "moneda-local",
    rotulo: "Precio en tu moneda",
    texto:
      "Te lo puedo pasar en tu moneda local para que no tengas sorpresas con el cambio ni comisiones del banco.",
    // La queja de precio casi siempre es la MONEDA, no la cifra («¿por qué me
    // cobras en dólares?»), y México es el 30% de las personas.
    momentos: ["cotizada", "enfriada", "material-sin-precio"],
    orden: 5,
  },
  {
    clave: "certificado",
    rotulo: "El certificado y su validez",
    texto:
      "Al terminar recibes el certificado con código de verificación, que sirve para tu currículum y para concursos públicos.",
    momentos: ["cotizada", "pidiendo-info", "material-sin-precio", "en-conversacion"],
    orden: 6,
  },
  {
    clave: "proxima-edicion",
    rotulo: "Aviso de la próxima edición",
    texto:
      "Si esta edición no te queda cómoda, te anoto para avisarte apenas abra la próxima. ¿Te sirve que te escriba?",
    // La objeción #1 es el APLAZAMIENTO (13%), y es la más blanda de todas:
    // esta gente no dijo que no, dijo «ahora no». Hoy la frase es todo lo que
    // hay; la lista de espera de verdad es el follow-up (ver el ADR 0017).
    momentos: ["enfriada", "cotizada", "en-conversacion"],
    orden: 7,
  },
] as const;
