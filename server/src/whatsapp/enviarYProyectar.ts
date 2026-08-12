import { gestorWhatsapp } from "./wiring.js";
import { puertaDe } from "./gestor.js";
import { proyectarMensaje } from "./proyectar.js";
import { repositorioDrizzle } from "./repositorioDrizzle.js";
import type { ResultadoControlado } from "./envioControlado.js";
import { ordenDeMedia, type OrdenMedia, type OrdenPlantilla, type OrdenTexto } from "./ordenes.js";
import { db } from "../db/client.js";
import { momentoDelEnvio } from "../procedencia/momento.js";
import { A_MANO, aMano, type Procedencia } from "../procedencia/pieza.js";
import { externalIdDeWa } from "../reacciones/dominio.js";

// La FORMA de una orden vive en `ordenes.ts` (sin `db` adentro, para poder
// testearla). Se re-exporta para que quien la importaba de acá siga andando.
export { ordenDeMedia, type OrdenMedia, type OrdenPlantilla, type OrdenTexto };

/**
 * MANDAR Y DEJAR RASTRO — el par indivisible que toda salida de Hermes hace.
 *
 * Un envío que sale y no queda en el hilo es un mensaje fantasma: la vendedora
 * abre el chat, no lo ve, y lo manda de nuevo. Estas dos funciones atan las dos
 * mitades (`EnvioControlado` + proyección del saliente) para que ninguna ruta
 * pueda hacer una sin la otra por olvido.
 *
 * Sigue habiendo **una sola puerta**: acá adentro se llama a `EnvioControlado`,
 * nunca a `transporte.enviarTexto`. La firma sigue siendo de a UNO —un
 * destinatario, un mensaje— porque eso es lo que hace imposible el envío masivo
 * (ver el comentario de `envioControlado.ts`).
 *
 * ══ LA PUERTA ES UNA POR LÍNEA, Y SE ELIGE POR LA ORDEN ══════════════════════
 *
 * Esto decía `whatsapp().envio`, o sea **la PRIMERA línea, siempre**. Con una
 * sola andaba. Con dos, cada envío de la segunda llegaba al transporte de la
 * primera y la guarda #0 lo rechazaba con «envío enrutado a la línea
 * equivocada» — correcto, pero el efecto es que **una vendedora nueva no puede
 * contestarle a nadie**: ve su cola entera y no puede mandar una sola letra.
 *
 * El `wiring.ts` había anotado esta deuda al revés: decía que dejaba a los
 * consumidores viejos «andando contra el primer número» y que lo que no se
 * dejaba pasar era un envío a la línea equivocada. Las dos cosas juntas no
 * dejan un envío mal enrutado: dejan un envío IMPOSIBLE.
 *
 * Se elige por `numeroPropio` de la orden y **no hay caída al primero**: si esa
 * línea no está corriendo, el envío falla con motivo. Caer al primero sería
 * mandarle a un lead de Walter desde el número de Luz — el defecto exacto que
 * la guarda #0 existe para impedir, y que además el lead vería como un
 * desconocido escribiéndole.
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
  const puerta = puertaDe(o.numeroPropio, gestorWhatsapp());
  if (!puerta.ok) return puerta;

  const r = await puerta.envio.enviar({ ...o, procedencia: await conMomento(o) });
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
    // La cita también se proyecta: si no, la vendedora manda una respuesta
    // citando, el lead la ve con su tirita y en Hermes queda un mensaje suelto
    // que no contesta nada. El id se vuelve a prefijar con la MISMA receta con la
    // que se guardan los mensajes — la de `reacciones/dominio.ts`.
    cita: o.cita ? { mensajeExternalId: externalIdDeWa(o.cita.mensajeId) } : null,
  });
  if ("evento" in proy) await repositorioDrizzle.persistir(proy.evento, proy.interaccion);

  return r;
}

/**
 * UNA PLANTILLA APROBADA, y su eco en el hilo.
 *
 * Lo que se proyecta es `cuerpoRenderizado` —la copia local del cuerpo que Meta
 * aprobó—, porque Meta devuelve solo un id. Sin esto, la vendedora abre la
 * conversación y ve que "se mandó algo" sin poder leer qué: el mensaje más
 * importante del día sería el único invisible en el CRM.
 */
export async function enviarPlantillaYProyectar(o: OrdenPlantilla): Promise<ResultadoControlado> {
  const puerta = puertaDe(o.numeroPropio, gestorWhatsapp());
  if (!puerta.ok) return puerta;

  const r = await puerta.envio.enviarPlantilla({ ...o, procedencia: o.procedencia ?? (await conMomento(o)) });
  if (!r.ok) return r;

  const proy = proyectarMensaje({
    idExterno: r.idExterno,
    numeroPropio: o.numeroPropio,
    telefono: o.telefono,
    esMio: true,
    esGrupo: false,
    ocurridoEn: r.ocurridoEn,
    nombreVisible: null,
    texto: o.plantilla.cuerpoRenderizado,
    clase: "texto",
  });
  if ("evento" in proy) await repositorioDrizzle.persistir(proy.evento, proy.interaccion);

  return r;
}

export async function enviarMediaYProyectar(o: OrdenMedia): Promise<ResultadoControlado> {
  const puerta = puertaDe(o.numeroPropio, gestorWhatsapp());
  if (!puerta.ok) return puerta;

  const r = await puerta.envio.enviarMedia(ordenDeMedia(o, await conMomento(o)));
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
