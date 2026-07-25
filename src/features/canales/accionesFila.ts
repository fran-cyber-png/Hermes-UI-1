import { Mail, MailOpen, Pin, PinOff, Star, StarOff, type LucideIcon } from 'lucide-react';

/**
 * EL MENÚ DE LA FILA — qué dice y hacia dónde se abre. Sin DOM, sin React.
 *
 * La cola potenciada (#49) colgó las tres marcas personales (pin, favorita,
 * «no leído») como tres iconos sueltos flotando en la esquina de la fila, y
 * en el hover TAPABAN la hora («hace 44 min»). Acá vive la lógica del reemplazo
 * —una sola flechita que abre un menú, patrón WhatsApp—: los rótulos según el
 * estado de ESA conversación y la decisión de abrir hacia abajo o hacia arriba.
 *
 * El rótulo nombra siempre la ACCIÓN que va a pasar, nunca el estado: en un
 * chat fijado dice «Dejar de fijar», no «Fijado». Lo que ya está puesto se ve
 * en la fila misma (el pin, la estrella, el punto azul), no acá.
 */

export type IdAccionFila = 'fijar' | 'leido' | 'favorita';

/** Las tres marcas personales de la vendedora sobre una conversación. */
export interface EstadoPersonalFila {
  fijada?: boolean;
  favorita?: boolean;
  no_leido?: boolean;
}

export interface AccionFila {
  id: IdAccionFila;
  /** Lo que se lee en el menú: la acción a ejecutar, ya conjugada según el estado. */
  etiqueta: string;
  Icono: LucideIcon;
  /** La marca está puesta ahora mismo (el item deshace en vez de poner). */
  activa: boolean;
  onSeleccionar: () => void;
}

/**
 * Arma las tres acciones para una fila. El orden es el de WhatsApp Web —fijar,
 * no leído, favoritos— y no se reordena por gusto: la vendedora ya tiene el
 * músculo hecho de esa app.
 */
export function armarAccionesFila(
  estado: EstadoPersonalFila,
  handlers: Record<IdAccionFila, () => void>,
): AccionFila[] {
  const fijada = estado.fijada === true;
  const noLeida = estado.no_leido === true;
  const favorita = estado.favorita === true;

  return [
    {
      id: 'fijar',
      etiqueta: fijada ? 'Dejar de fijar' : 'Fijar chat',
      Icono: fijada ? PinOff : Pin,
      activa: fijada,
      onSeleccionar: handlers.fijar,
    },
    {
      id: 'leido',
      etiqueta: noLeida ? 'Marcar como leído' : 'Marcar como no leído',
      Icono: noLeida ? MailOpen : Mail,
      activa: noLeida,
      onSeleccionar: handlers.leido,
    },
    {
      id: 'favorita',
      etiqueta: favorita ? 'Quitar de Favoritos' : 'Añadir a Favoritos',
      Icono: favorita ? StarOff : Star,
      activa: favorita,
      onSeleccionar: handlers.favorita,
    },
  ];
}

/**
 * Alto estimado del panel: tres items de ~28px (`py-1.5` + 12px de texto) más
 * los 12px de `p-1.5` del contenedor. Es una ESTIMACIÓN a propósito — el lado
 * se decide en el clic, antes de que el panel exista y se pueda medir. Si el
 * panel crece (un cuarto item), este número sube con él.
 */
export const ALTO_MENU_PX = 96;

export interface MedidasMenu {
  /** Y del borde superior del disparador (coordenadas de viewport). */
  arribaDisparador: number;
  /** Y del borde inferior del disparador. */
  abajoDisparador: number;
  /** Y donde empieza el área que NO recorta: el scroller de la cola. */
  limiteArriba: number;
  /** Y donde termina esa área. */
  limiteAbajo: number;
  altoMenu: number;
}

/**
 * ¿El panel abre hacia abajo o hacia arriba? La cola vive dentro de un
 * `overflow-y-auto`, así que lo que se pase del borde no se ve: en las últimas
 * filas, abrir hacia abajo es abrir un menú cortado.
 *
 * Abajo es el default y solo se abandona cuando no entra; si no entra en
 * ninguno de los dos lados (ventana enana), gana el que tenga más aire, y el
 * empate lo gana abajo.
 */
export function ladoDelMenu(m: MedidasMenu): 'abajo' | 'arriba' {
  const aireAbajo = m.limiteAbajo - m.abajoDisparador;
  const aireArriba = m.arribaDisparador - m.limiteArriba;
  if (aireAbajo >= m.altoMenu) return 'abajo';
  if (aireArriba >= m.altoMenu) return 'arriba';
  return aireArriba > aireAbajo ? 'arriba' : 'abajo';
}
