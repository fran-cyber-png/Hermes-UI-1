/**
 * QUÉ LE CORRESPONDE A ESTA CONVERSACIÓN — el vocabulario compartido.
 *
 * ══ POR QUÉ ESTE MÓDULO EXISTE ═══════════════════════════════════════════════
 *
 * La misma cabeza tiene que decidir en dos lugares: de día, cuando la vendedora
 * mira el panel y quiere despachar de un clic; de noche, cuando la
 * auto-respuesta (#125, rama `feat/auto-respuesta`) atiende sola. Si cada uno
 * tuviera su propio criterio, la vendedora vería sugerida una cosa y el sistema
 * mandaría otra — y nadie podría explicar por qué.
 *
 * Así que el criterio vive UNA vez, acá, puro y sin IO.
 *
 * **Punto de unión con `feat/auto-respuesta`**: `autorespuesta/plantillas.ts`
 * define `ContextoPlantilla { esPrimerContacto, curso }` — que es exactamente el
 * subconjunto de `EstadoDeVenta` marcado abajo. Al mergear las dos ramas, ese
 * archivo importa `ContextoPlantilla` de acá y borra el suyo (tres líneas), y
 * `elegir()` puede pasar a filtrar por `intencionesSugeridas()` en vez de por su
 * propio `aplica()`. Nada más cambia: ni la decisión de #125, ni su cola, ni su
 * despachador.
 */

/**
 * El contexto mínimo de una conversación de venta. **Es el mismo tipo que
 * `ContextoPlantilla` de `autorespuesta/plantillas.ts`** (mismos nombres de
 * campo, a propósito): al unir las ramas, uno de los dos desaparece.
 */
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
 * LAS DOS COSAS QUE CORRESPONDEN, en orden. Siempre dos, y siempre **caminos
 * distintos**: el pedido del dueño es *«2 opciones»*, no dos variantes de la
 * misma. Por eso las reglas devuelven siempre un par que se lee distinto de un
 * vistazo — mandar material vs. pedir una respuesta, precio vs. temario.
 *
 * El orden de las reglas es el de la venta, de lo más avanzado a lo más nuevo:
 * lo específico gana. Una conversación fría es fría aunque además sea primer
 * contacto de la semana.
 */
export function intencionesSugeridas(e: EstadoDeVenta): [Sugerido, Sugerido] {
  // 1. Se enfrió: le pasaste el precio y desapareció. Lo urgente es traerla de
  //    vuelta, no repetirle lo mismo.
  if (e.enfriada) {
    return [
      { intencion: "reactivar", porque: "le pasaste el precio y no contestó" },
      { intencion: "precio", porque: "repetirle la inversión, por si se perdió el mensaje" },
    ];
  }

  // 2. Cotizada y todavía tibia: la pelota está de su lado.
  if (e.cotizada) {
    return [
      { intencion: "seguimiento", porque: "ya tiene el precio: falta que decida" },
      { intencion: "temario", porque: "el temario suele ser lo que termina de convencer" },
    ];
  }

  // 3. Vio el material pero nunca le pasaste el precio. Es el hueco más caro
  //    del embudo: 696 conversaciones con precio, y muchas más sin él.
  if (e.vioMaterial) {
    return [
      { intencion: "precio", porque: "ya vio el material y todavía no sabe cuánto cuesta" },
      { intencion: "temario", porque: "si pide más detalle antes de decidir" },
    ];
  }

  // 4. Primer contacto: lo que la vendedora manda 415 veces es el flyer.
  if (e.esPrimerContacto) {
    return [
      { intencion: "flyer", porque: "primer mensaje: es lo que mandás siempre" },
      { intencion: "presentarse", porque: "si preferís abrir presentándote" },
    ];
  }

  // 5. Está preguntando ahora mismo.
  if (e.pidioInfo) {
    return [
      { intencion: "flyer", porque: "está pidiendo información" },
      { intencion: "temario", porque: "si lo que quiere es el detalle del curso" },
    ];
  }

  // 6. Ninguna señal fuerte: seguir la conversación o mandarle el material.
  return [
    { intencion: "seguimiento", porque: "para retomar la conversación" },
    { intencion: "flyer", porque: "por si todavía no vio el material" },
  ];
}
