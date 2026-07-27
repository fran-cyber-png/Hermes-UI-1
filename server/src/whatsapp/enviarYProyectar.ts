import { whatsapp } from "./wiring.js";
import { proyectarMensaje } from "./proyectar.js";
import { repositorioDrizzle } from "./repositorioDrizzle.js";
import type { MediaSaliente } from "./transporte.js";
import type { ResultadoControlado } from "./envioControlado.js";
import { db } from "../db/client.js";
import { momentoDelEnvio } from "../procedencia/momento.js";
import { A_MANO, aMano, type Procedencia } from "../procedencia/pieza.js";

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
 *
 * ══ Y AHORA TAMBIÉN: DE QUÉ PIEZA SALIÓ (épica #169) ═════════════════════════
 *
 * La ruta declara la **pieza** (o no declara nada, y eso significa «lo escribió
 * la vendedora», que es la línea de base). El **momento de la venta** lo pone
 * este módulo, no la ruta: si cada ruta tuviera que acordarse de clasificarlo,
 * la que se olvide produciría filas sin momento que después nadie puede
 * comparar — y un hueco así se lee como dato. Acá es imposible olvidarse, que
 * es exactamente el argumento por el que mandar y proyectar ya viven juntos.
 */

/** Lo que toda orden lleva además del mensaje: de dónde salió. */
interface ConProcedencia {
  /** La pieza. Omitir = escrito a mano (**la línea de base**, no un hueco). */
  procedencia?: Procedencia;
}

export interface OrdenTexto extends ConProcedencia {
  vendedoraId: string;
  numeroPropio: string;
  telefono: string;
  texto: string;
  referencia: string;
}

/**
 * Completa la procedencia con el momento de la venta, clasificado con la MISMA
 * cabeza que decide qué mandar (`sugerencias/estado.ts`). Best-effort: nunca
 * frena un envío.
 */
async function conMomento(o: {
  referencia: string;
  procedencia?: Procedencia;
}): Promise<Procedencia> {
  const momento = await momentoDelEnvio(db, o.referencia);
  const p = o.procedencia ?? A_MANO;
  return p.tipo === "a-mano" ? aMano(momento) : { ...p, momento };
}

export async function enviarTextoYProyectar(o: OrdenTexto): Promise<ResultadoControlado> {
  const r = await whatsapp().envio.enviar({ ...o, procedencia: await conMomento(o) });
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

export interface OrdenMedia extends ConProcedencia {
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
    procedencia: await conMomento(o),
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
