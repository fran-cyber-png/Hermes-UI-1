/**
 * LA MÁQUINA DE LA SECUENCIA — el estado de «enviando 2 de 4», puro.
 *
 * Vive acá, sin React y sin fetch, porque las reglas que importan son de estado,
 * no de pantalla: qué pasa si cancelo con un mensaje en vuelo, qué se puede
 * reintentar, qué se le dice a la vendedora en cada momento. Todo eso se prueba
 * sin montar nada.
 *
 * ══ LA REGLA HONESTA ═════════════════════════════════════════════════════════
 *
 * **Cancelar no des-envía.** Cuando la vendedora aprieta «Cancelar» hay un
 * mensaje en vuelo hacia WhatsApp: ese sale igual. La máquina lo dice con todas
 * las letras (`cancelando` → «se corta después de este») en vez de fingir un
 * frenazo instantáneo. Prometer que se detiene en seco sería mentir, y la
 * vendedora lo descubriría mirando el chat.
 *
 * Lo que cancelar SÍ garantiza: no sale ni un mensaje más después de ese.
 */

export type EstadoSecuencia =
  | { fase: "lista" }
  | { fase: "enviando"; paso: number; total: number }
  | { fase: "cancelando"; paso: number; total: number }
  | { fase: "terminada"; total: number }
  | { fase: "cancelada"; enviados: number; total: number }
  | { fase: "fallo"; paso: number; total: number; enviados: number; motivo: string };

export type EventoSecuencia =
  | { tipo: "arrancar"; total: number }
  | { tipo: "paso-ok" }
  | { tipo: "paso-fallo"; motivo: string }
  | { tipo: "cancelar" }
  /**
   * El corte llegó en el HUECO entre dos mensajes: no había ninguno en vuelo, así
   * que el paso pendiente no llegó a salir. Es el caso bueno del cancelar —y el
   * más común, porque entre paso y paso hay un segundo y medio de espera.
   */
  | { tipo: "cortar-antes-de-enviar" };

export const INICIAL: EstadoSecuencia = { fase: "lista" };

export function avanzar(estado: EstadoSecuencia, evento: EventoSecuencia): EstadoSecuencia {
  switch (evento.tipo) {
    case "arrancar":
      // Una secuencia vacía no arranca: no hay nada que mandar.
      if (evento.total < 1) return estado;
      return { fase: "enviando", paso: 1, total: evento.total };

    case "paso-ok":
      if (estado.fase === "enviando") {
        return estado.paso >= estado.total
          ? { fase: "terminada", total: estado.total }
          : { fase: "enviando", paso: estado.paso + 1, total: estado.total };
      }
      // Se pidió cancelar mientras este salía: salió, y ahí se corta.
      if (estado.fase === "cancelando") {
        return { fase: "cancelada", enviados: estado.paso, total: estado.total };
      }
      return estado;

    case "paso-fallo":
      if (estado.fase === "enviando") {
        return {
          fase: "fallo",
          paso: estado.paso,
          total: estado.total,
          enviados: estado.paso - 1,
          motivo: evento.motivo,
        };
      }
      if (estado.fase === "cancelando") {
        return { fase: "cancelada", enviados: estado.paso - 1, total: estado.total };
      }
      return estado;

    case "cancelar":
      if (estado.fase === "enviando") {
        return { fase: "cancelando", paso: estado.paso, total: estado.total };
      }
      return estado;

    case "cortar-antes-de-enviar":
      if (estado.fase === "cancelando" || estado.fase === "enviando") {
        // El paso `paso` no salió: salieron los anteriores.
        return { fase: "cancelada", enviados: estado.paso - 1, total: estado.total };
      }
      return estado;
  }
}

/** ¿Hay una secuencia corriendo? (el botón de mandar se apaga, el de cancelar aparece) */
export function estaCorriendo(e: EstadoSecuencia): boolean {
  return e.fase === "enviando" || e.fase === "cancelando";
}

/** ¿Quedó algo a medio camino que valga la pena reintentar? */
export function quedoAMedias(e: EstadoSecuencia): boolean {
  return e.fase === "fallo" || (e.fase === "cancelada" && e.enviados < e.total);
}

/**
 * Lo que se lee en pantalla. En castellano, sin jerga y sin signos de admiración
 * — un envío que salió bien no es una fiesta, es el trabajo.
 */
export function rotulo(e: EstadoSecuencia): string {
  switch (e.fase) {
    case "lista":
      return "";
    case "enviando":
      return `Enviando ${e.paso} de ${e.total}`;
    case "cancelando":
      return `Se corta después de este (${e.paso} de ${e.total})`;
    case "terminada":
      return e.total === 1 ? "Mensaje enviado" : `Los ${e.total} mensajes salieron`;
    case "cancelada":
      return `Cancelada: salieron ${e.enviados} de ${e.total}`;
    case "fallo":
      return `Se cortó en el ${e.paso} de ${e.total}: ${e.motivo}`;
  }
}

/** Cuántos salieron, para la barra de progreso. */
export function enviados(e: EstadoSecuencia): number {
  switch (e.fase) {
    case "lista":
      return 0;
    case "enviando":
    case "cancelando":
      return e.paso - 1;
    case "terminada":
      return e.total;
    case "cancelada":
    case "fallo":
      return e.enviados;
  }
}

/**
 * EL ESPACIADO entre mensajes. No es anti-ban ni warmup (eso está prohibido, y
 * además no funciona): es que cuatro mensajes en el mismo segundo se leen como
 * un bot en la pantalla de quien los recibe, y el punto entero de Hermes es que
 * del otro lado hay una persona escribiendo.
 *
 * Un segundo y medio es más o menos lo que tarda alguien en apretar «enviar»
 * cuatro veces seguidas cuando ya tiene los textos listos.
 */
export const ESPERA_ENTRE_PASOS_MS = 1500;
