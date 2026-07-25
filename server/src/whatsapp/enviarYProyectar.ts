import { whatsapp } from "./wiring.js";
import { proyectarMensaje } from "./proyectar.js";
import { repositorioDrizzle } from "./repositorioDrizzle.js";
import type { MediaSaliente } from "./transporte.js";
import type { ResultadoControlado } from "./envioControlado.js";

/**
 * MANDAR Y DEJAR RASTRO — el par indivisible que toda salida de Hermes hace.
 *
 * Un envío que sale y no queda en el hilo es un mensaje fantasma: la vendedora
 * abre el chat, no lo ve, y lo manda de nuevo. Estas dos funciones atan las dos
 * mitades (`EnvioControlado` + proyección del saliente) para que ninguna ruta
 * pueda hacer una sin la otra por olvido.
 *
 * Sigue habiendo **una sola puerta**: acá adentro se llama a `whatsapp().envio`,
 * nunca a `transporte.enviarTexto`. La firma sigue siendo de a UNO —un
 * destinatario, un mensaje— porque eso es lo que hace imposible el envío masivo
 * (ver el comentario de `envioControlado.ts`).
 */

export interface OrdenTexto {
  vendedoraId: string;
  numeroPropio: string;
  telefono: string;
  texto: string;
  referencia: string;
}

export async function enviarTextoYProyectar(o: OrdenTexto): Promise<ResultadoControlado> {
  const r = await whatsapp().envio.enviar(o);
  if (!r.ok) return r;

  // D10: el saliente se persiste SOLO con el idExterno del envío real, para que
  // sea idempotente contra el eco del transporte.
  const proy = proyectarMensaje({
    idExterno: r.idExterno,
    numeroPropio: o.numeroPropio,
    telefono: o.telefono,
    esMio: true,
    esGrupo: false,
    ocurridoEn: r.ocurridoEn,
    nombreVisible: null,
    texto: o.texto,
    clase: "texto",
  });
  if ("evento" in proy) await repositorioDrizzle.persistir(proy.evento, proy.interaccion);

  return r;
}

export interface OrdenMedia {
  vendedoraId: string;
  numeroPropio: string;
  telefono: string;
  referencia: string;
  media: MediaSaliente;
  /** El nombre del archivo YA guardado en `RUTA_MEDIA` (lo que el hilo va a servir). */
  archivo: string;
}

export async function enviarMediaYProyectar(o: OrdenMedia): Promise<ResultadoControlado> {
  const r = await whatsapp().envio.enviarMedia({
    vendedoraId: o.vendedoraId,
    numeroPropio: o.numeroPropio,
    telefono: o.telefono,
    referencia: o.referencia,
    media: o.media,
  });
  if (!r.ok) return r;

  const proy = proyectarMensaje({
    idExterno: r.idExterno,
    numeroPropio: o.numeroPropio,
    telefono: o.telefono,
    esMio: true,
    esGrupo: false,
    ocurridoEn: r.ocurridoEn,
    nombreVisible: null,
    texto: o.media.texto ?? null,
    clase: "multimedia",
    media: {
      clase: o.media.clase,
      archivo: o.archivo,
      mime: o.media.mime,
      nombre: o.media.nombre ?? null,
    },
  });
  if ("evento" in proy) await repositorioDrizzle.persistir(proy.evento, proy.interaccion);

  return r;
}
