/**
 * QUÉ LE CORRESPONDE A ESTA CONVERSACIÓN — el vocabulario compartido.
 *
 * ══ POR QUÉ ESTE MÓDULO EXISTE ═══════════════════════════════════════════════
 *
 * La misma cabeza decide en dos lugares: de día, cuando la vendedora mira el
 * panel y quiere despachar de un clic; de noche, cuando la auto-respuesta
 * (#125) atiende sola. Si cada uno tuviera su propio criterio, la vendedora
 * vería sugerida una cosa y el sistema mandaría otra — y nadie podría explicar
 * por qué.
 *
 * Así que el criterio vive UNA vez, acá, puro y sin IO. Los dos consumidores:
 *
 *   · **de día** — `sugerencias/sugerir.ts` traduce `intencionesSugeridas()` a
 *     las dos secuencias del panel derecho;
 *   · **de noche** — `autorespuesta/plantillas.ts` elige el acuse fuera de
 *     horario con `momentoDeVenta()` y el `ContextoPlantilla` de acá.
 *
 * Los dos hablan del mismo estado y usan el mismo clasificador. Lo que cambia
 * es qué hacen con él, que es exactamente lo que debe cambiar.
 */

/**
 * El contexto MÍNIMO de una conversación: lo único que la auto-respuesta sabe
 * cuando decide, a las 3 de la mañana, qué acuse mandar.
 *
 * Vive acá y no en `autorespuesta/` porque es vocabulario, no implementación: si
 * cada lado tuviera su copia, un campo agregado de un lado no llegaría al otro y
 * las dos cabezas empezarían a divergir sin que nadie lo note.
 */
import type { LineaDeNegocio } from "../negocio/lineaDeNegocio.js";

export interface ContextoPlantilla {
  /** Nadie le habló nunca desde Hermes. */
  esPrimerContacto: boolean;
  /** El curso registrado como interés, si lo hay. */
  curso: string | null;
}

/** Todo lo que se sabe de la conversación para decidir qué mandarle. */
export interface EstadoDeVenta extends ContextoPlantilla {
  /** El último mensaje de la persona pide información (precio, temario, info). */
  pidioInfo: boolean;
  /** Ya se le mandó el precio (detector de `senales/cotizacion.ts`). */
  cotizada: boolean;
  /** Cotizada + sin respuesta + N días (`senales/enfriamiento.ts`). */
  enfriada: boolean;
  /** Ya se le mandó material: una imagen o el temario. */
  vioMaterial: boolean;
  /**
   * De qué NEGOCIO es (`negocio/lineaDeNegocio.ts`). La Escuela vende cursos;
   * Consultoría vende un diagnóstico de campaña. Sin esto, a un lead de
   * consultoría se le proponía la secuencia de un curso — que es contestarle
   * otra cosa de la que preguntó.
   */
  negocio: LineaDeNegocio;
}

/**
 * Las INTENCIONES posibles. Son pocas a propósito: son las cosas que una
 * vendedora de la Escuela hace de verdad, medidas en el histórico.
 */
export const INTENCIONES = [
  "presentarse",
  "flyer",
  "temario",
  "precio",
  "seguimiento",
  "reactivar",
] as const;
export type Intencion = (typeof INTENCIONES)[number];

/** El rótulo humano de cada intención, para el «por qué» del panel. */
export const ROTULO_INTENCION: Record<Intencion, string> = {
  presentarse: "Presentarte",
  flyer: "Mandar el flyer",
  temario: "Mandar el temario",
  precio: "Pasar el precio",
  seguimiento: "Hacer seguimiento",
  reactivar: "Reactivar",
};

export interface Sugerido {
  intencion: Intencion;
  /** Por qué corresponde, en castellano. Va debajo del botón. */
  porque: string;
}

/**
 * EL MOMENTO DE LA VENTA — el clasificador compartido, y la única lista de
 * «dónde está esta conversación».
 *
 * Es lo que de verdad se comparte entre el día y la noche: los dos preguntan lo
 * mismo («¿en qué punto está?») y responden distinto («qué le mando» vs. «qué
 * acuse le doy»). Separarlo del `qué mandar` es lo que permite que la
 * auto-respuesta lo use sabiendo la mitad de las cosas.
 *
 * El orden es el de la venta, de lo más avanzado a lo más nuevo: lo específico
 * gana. Una conversación fría es fría aunque además sea el primer contacto de
 * la semana.
 */
export const MOMENTOS_DE_VENTA = [
  "enfriada",
  "cotizada",
  "material-sin-precio",
  "primer-contacto",
  "pidiendo-info",
  "en-conversacion",
] as const;

export type MomentoDeVenta = (typeof MOMENTOS_DE_VENTA)[number];

/**
 * QUÉ SIGNIFICA CADA MOMENTO, en una línea y para quien no vive en este repo.
 *
 * Existe porque **Ivi es Python y no puede importar este archivo** (H9): el
 * vocabulario se publica como dato en `/api/catalogo/vocabulario`, y una lista
 * de seis slugs sin explicación no alcanza para que el otro lado elija bien.
 *
 * Es un `Record` sobre `MomentoDeVenta` a propósito, igual que
 * `intencionesSugeridas()`: agregar un momento y no decir qué significa **no
 * compila**. Ese gate es lo que impide que el dato publicado envejezca en
 * silencio mientras el enum crece.
 *
 * NO es texto que se le muestre a un cliente ni a la vendedora (para ella está
 * `PORQUE_DEL_MOMENTO` en el front, en su voz): es documentación del contrato.
 */
export const DESCRIPCION_MOMENTO: Record<MomentoDeVenta, string> = {
  enfriada: "Ya se le mandó el precio y dejó de contestar hace días.",
  cotizada: "Ya tiene el precio y todavía está tibia: falta que decida.",
  "material-sin-precio": "Vio material (flyer o temario) pero nunca se le pasó el precio.",
  "primer-contacto": "Nadie le habló nunca desde Hermes.",
  "pidiendo-info": "Su último mensaje pide información (precio, temario, info).",
  "en-conversacion": "Conversación abierta, sin ninguna señal fuerte.",
};

export function momentoDeVenta(e: EstadoDeVenta): MomentoDeVenta {
  if (e.enfriada) return "enfriada";
  if (e.cotizada) return "cotizada";
  if (e.vioMaterial) return "material-sin-precio";
  if (e.esPrimerContacto) return "primer-contacto";
  if (e.pidioInfo) return "pidiendo-info";
  return "en-conversacion";
}

/**
 * Completa el estado con lo que la NOCHE no sabe.
 *
 * La auto-respuesta decide con `ContextoPlantilla` —dos campos— porque a las 3
 * a. m. no consulta las señales: su trabajo es acusar recibo, no vender. Los
 * campos que no conoce se asumen `false`, y esa suposición es la correcta:
 * ante la duda, el momento menos avanzado. Nunca al revés — creerla cotizada
 * sin saberlo la mandaría al acuse equivocado.
 */
export function estadoDesdeContexto(ctx: ContextoPlantilla): EstadoDeVenta {
  return {
    esPrimerContacto: ctx.esPrimerContacto,
    curso: ctx.curso,
    pidioInfo: false,
    cotizada: false,
    enfriada: false,
    vioMaterial: false,
    // La auto-respuesta nocturna todavía no mira el primer entrante, así que
    // asume el negocio de siempre. Es el default honesto: `escuela` es el 99 %
    // del volumen, y decir «consultoría» sin evidencia mandaría el guión
    // equivocado. Cuando el acuse nocturno sepa distinguirlos, se pasa acá.
    negocio: "escuela",
  };
}

/**
 * LAS DOS COSAS QUE CORRESPONDEN, en orden. Siempre dos, y siempre **caminos
 * distintos**: el pedido del dueño es *«2 opciones»*, no dos variantes de la
 * misma. Por eso cada momento devuelve un par que se lee distinto de un vistazo
 * — mandar material vs. pedir una respuesta, precio vs. temario.
 *
 * El `switch` es exhaustivo sobre `MomentoDeVenta` a propósito: agregar un
 * momento y olvidarse de decir qué mandar en él no compila.
 */
export function intencionesSugeridas(e: EstadoDeVenta): [Sugerido, Sugerido] {
  switch (momentoDeVenta(e)) {
    // Le pasaste el precio y desapareció. Lo urgente es traerla de vuelta, no
    // repetirle lo mismo.
    case "enfriada":
      return [
        { intencion: "reactivar", porque: "le pasaste el precio y no contestó" },
        { intencion: "precio", porque: "repetirle la inversión, por si se perdió el mensaje" },
      ];

    // Cotizada y todavía tibia: la pelota está de su lado.
    case "cotizada":
      return [
        { intencion: "seguimiento", porque: "ya tiene el precio: falta que decida" },
        { intencion: "temario", porque: "el temario suele ser lo que termina de convencer" },
      ];

    // Vio el material pero nunca le pasaste el precio. Es el hueco más caro del
    // embudo: 696 conversaciones con precio, y muchas más sin él.
    case "material-sin-precio":
      return [
        { intencion: "precio", porque: "ya vio el material y todavía no sabe cuánto cuesta" },
        { intencion: "temario", porque: "si pide más detalle antes de decidir" },
      ];

    // Lo que la vendedora manda 415 veces en el primer mensaje es el flyer.
    case "primer-contacto":
      return [
        { intencion: "flyer", porque: "primer mensaje: es lo que mandás siempre" },
        { intencion: "presentarse", porque: "si preferís abrir presentándote" },
      ];

    // Está preguntando ahora mismo.
    case "pidiendo-info":
      return [
        { intencion: "flyer", porque: "está pidiendo información" },
        { intencion: "temario", porque: "si lo que quiere es el detalle del curso" },
      ];

    // Ninguna señal fuerte: seguir la conversación o mandarle el material.
    case "en-conversacion":
      return [
        { intencion: "seguimiento", porque: "para retomar la conversación" },
        { intencion: "flyer", porque: "por si todavía no vio el material" },
      ];
  }
}
