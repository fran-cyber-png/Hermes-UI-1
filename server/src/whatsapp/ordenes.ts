import type { MediaSaliente } from "./transporte.js";
import type { OrdenEnvioMedia } from "./envioControlado.js";
import type { Procedencia } from "../procedencia/pieza.js";

/**
 * LA FORMA DE UNA ORDEN DE `enviarYProyectar`, y su traducción a la de la puerta.
 *
 * Vive aparte de `enviarYProyectar.ts` por una razón práctica y una de diseño:
 * ese módulo importa `db/client.ts` (para clasificar el momento de la venta), que
 * exige `DATABASE_URL` al importarse — o sea que nada de lo que hay ahí se puede
 * interrogar con un test puro. Y esto es justo lo que hay que poder interrogar:
 * la traducción de una orden a otra es donde se perdió un campo en silencio.
 */

/** Lo que toda orden lleva además del mensaje: de dónde salió y quién lo apretó. */
export interface ExtrasDeLaOrden {
  /** La pieza. Omitir = escrito a mano (**la línea de base**, no un hueco). */
  procedencia?: Procedencia;
  /**
   * ¿Lo mandó una MÁQUINA? Ausente o `false` = lo apretó una persona, como
   * siempre (ver `envioControlado.ts`, donde vive la decisión).
   *
   * Estaba en `OrdenEnvio` y **no en estas dos**, así que el único camino que
   * podía marcar un envío como automático era llamar a `EnvioControlado`
   * directo, salteando la proyección del saliente. El bot conversacional (F3)
   * manda por acá: sin este campo, todo lo suyo se auditaba como humano y
   * `ultimoSalienteHumanoEn` (`bot/frenos.ts`) leía sus propios envíos como
   * «hay vendedora activa» — y el bot se callaba solo después de mandar.
   */
  automatico?: boolean;
}

export interface OrdenTexto extends ExtrasDeLaOrden {
  vendedoraId: string;
  numeroPropio: string;
  telefono: string;
  texto: string;
  referencia: string;
}

export interface OrdenMedia extends ExtrasDeLaOrden {
  vendedoraId: string;
  numeroPropio: string;
  telefono: string;
  referencia: string;
  media: MediaSaliente;
  /** El nombre del archivo YA guardado en `RUTA_MEDIA` (lo que el hilo va a servir). */
  archivo: string;
}

/**
 * DE LA ORDEN DE ESTA CAPA A LA DE `EnvioControlado` — **por spread, nunca
 * enumerando**, y por eso es una función con nombre y con test.
 *
 * Acá se enumeraban los campos uno por uno mientras la rama de texto los
 * reenviaba con `{...o}`. Esa asimetría es una trampa silenciosa: agregarle un
 * campo a la orden lo hacía viajar solo por texto y desaparecer en media, **sin
 * error de tipos** (los extras son todos opcionales). Pasó con `automatico`: el
 * texto del bot quedaba marcado como automático y el flyer del MISMO turno como
 * escrito por una persona.
 *
 * `archivo` es lo único que se saca, y no es un campo olvidado: es de la
 * PROYECCIÓN (el nombre con el que el hilo va a servir el adjunto), no de la
 * orden de envío, que lleva la ruta completa adentro de `media`.
 */
export function ordenDeMedia(o: OrdenMedia, procedencia: Procedencia): OrdenEnvioMedia {
  const { archivo: _paraElHilo, ...orden } = o;
  return { ...orden, procedencia };
}
