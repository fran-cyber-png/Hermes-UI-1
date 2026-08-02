/**
 * LA PIEZA QUE EL BOT VA A MANDAR — leerla, decidir si sale, y a qué ritmo (F3).
 *
 * ══ POR QUÉ NO SE REUSA NINGUNO DE LOS DOS LECTORES QUE YA EXISTEN ═══════════
 *
 *   · **`plantillas/repositorio.ts#obtenerPlantilla`** filtra por `visiblePara`
 *     (lo de esa vendedora + las propuestas del minado). El bot firma sus
 *     envíos como `bot` (`frenos.ts`), así que para él una plantilla APROBADA
 *     por Luz no existe: devuelve `null` y el lead no recibe nada, sin error.
 *     Darle al bot un `vendedoraId` prestado sería peor —ver más abajo por qué
 *     el id importa—, y aflojar `visiblePara` le abriría a cada vendedora las
 *     plantillas de las otras.
 *   · **`catalogo/repositorio.ts#leerPiezas`** trae el catálogo ENTERO (todas
 *     las plantillas, todos los pasos, todos los hechos) para publicárselo a
 *     Ivi, y **no lee `media_mime` ni `media_nombre`** porque a la versión de
 *     una pieza solo entra el nombre del archivo. Con eso no se puede mandar un
 *     adjunto: el transporte pide mime.
 *
 * Entonces: una lectura propia, **por id y sin filtro de vendedora**, con lo que
 * hace falta para MANDAR. Es solo lectura y no toca ninguna de las otras dos.
 *
 * ══ LAS CUATRO GUARDAS SON LAS DE LA RUTA, NO UNAS NUEVAS ════════════════════
 *
 * `routes/plantillas.ts` ya decide qué se puede mandar y qué no: una propuesta
 * no se manda, un paso con imagen pendiente tampoco, el nombre de archivo se
 * revalida y el archivo tiene que estar. Si el bot se saltara cualquiera de las
 * cuatro, el mismo paso sería enviable para la máquina y no para la persona —
 * y el que más necesita el freno es el que no mira la pantalla.
 *
 * ══ Y UNA QUINTA, QUE ES DEL BOT ═════════════════════════════════════════════
 *
 * **Con un `{precio}` sin resolver, el bot NO manda.** La ruta sí manda y
 * reporta `faltantes`: para una vendedora ese `[precio]` en pantalla es una
 * señal («completalo a mano»), y ella lo ve antes de apretar. Para un lead es un
 * mensaje roto que ya salió. La misma cadena, dos significados, según haya o no
 * alguien mirando.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { and, asc, eq } from "drizzle-orm";
import type { db as Base } from "../db/client.js";
import { enviosWa, hechos, plantillaPasos, plantillas } from "../db/schema.js";
import { RUTA_MEDIA, archivoSeguro } from "../whatsapp/mediaDir.js";
import { direccionDesdeRef, rotuloDeDireccion, type ClasePieza } from "../piezas/direccion.js";
import { expandirCuerpo, type VariablesPlantilla } from "../plantillas/expandir.js";
import { resolverCurso, type CursoResuelto } from "../plantillas/catalogo.js";

// ── Lo que se lee ────────────────────────────────────────────────────────────

/** Las cuatro clases de adjunto que el transporte sabe mandar. */
export type ClaseDeMedia = "imagen" | "video" | "audio" | "documento";

export interface MediaDelPaso {
  /** Nombre del archivo dentro de `RUTA_MEDIA`. */
  archivo: string;
  mime: string;
  clase: ClaseDeMedia;
  nombre: string | null;
}

export interface PasoDeLaPieza {
  orden: number;
  /** El texto TAL COMO ESTÁ GUARDADO: con sus `{nombre}`/`{curso}`/`{precio}`. */
  texto: string | null;
  media: MediaDelPaso | null;
  /** Pide una imagen que nadie cargó todavía. No se manda medio mensaje. */
  mediaPendiente: boolean;
}

export interface PiezaDelBot {
  clase: ClasePieza;
  /** El id dentro de su clase, textual (`"12"`, `"cuotas"`). */
  id: string;
  /** `aprobada` para una plantilla; `vigente`/`retirada` para un hecho. */
  vigente: boolean;
  /**
   * La familia con la que se resuelve `{curso}`/`{precio}`.
   *
   * ⚠️ Sale de la FILA (`plantillas.familia_curso`), nunca de
   * `ctx.datosEstado.familia`: ese campo del bot mezcla tres vocabularios —el
   * nombre crudo de Cerberus, el nombre corto del alias y texto suelto del
   * lead— bajo un nombre que promete un SKU. Ninguno de los tres es `DIPICOT`.
   */
  familiaCurso: string | null;
  pasos: PasoDeLaPieza[];
}

const CLASES_DE_MEDIA: readonly string[] = ["imagen", "video", "audio", "documento"];

function claseDeMedia(v: string | null): ClaseDeMedia | null {
  return v !== null && CLASES_DE_MEDIA.includes(v) ? (v as ClaseDeMedia) : null;
}

/**
 * La pieza que el bot pidió, con todo lo que hace falta para mandarla.
 *
 * `null` = no existe. Que exista no significa que salga: eso lo decide
 * `prepararEnvio`, que es puro y se puede interrogar sin base.
 */
export async function leerPiezaDelBot(
  base: typeof Base,
  d: { clase: ClasePieza; id: string },
): Promise<PiezaDelBot | null> {
  if (d.clase === "plantilla") return leerPlantilla(base, d.id);
  if (d.clase === "hecho") return leerHecho(base, d.id);
  // `acuse` y `gancho` son del otro frente (la auto-respuesta nocturna) y el
  // recuperador ni siquiera se los muestra al bot. Si alguna vez llega uno, es
  // un bug de quien llama y se trata como «no existe», no como un envío.
  return null;
}

async function leerPlantilla(base: typeof Base, id: string): Promise<PiezaDelBot | null> {
  // El id de una plantilla es un bigserial: si lo que vino no es un entero, no
  // hay fila que buscar (y `eq` contra un NaN es una consulta que no dice nada).
  const numero = Number(id);
  if (!Number.isInteger(numero) || numero <= 0) return null;

  const [fila] = await base.select().from(plantillas).where(eq(plantillas.id, numero));
  if (!fila) return null;

  const filasPaso = await base
    .select()
    .from(plantillaPasos)
    .where(eq(plantillaPasos.plantillaId, numero))
    .orderBy(asc(plantillaPasos.orden));

  return {
    clase: "plantilla",
    id: String(fila.id),
    // Archivada o todavía propuesta = no sale. Es la GUARDA 1 de la ruta: el
    // minado propone, una persona aprueba, y recién ahí se manda.
    vigente: fila.estado === "aprobada" && fila.archivadoAt === null,
    familiaCurso: fila.familiaCurso,
    pasos: filasPaso.map((p) => {
      const clase = claseDeMedia(p.mediaClase);
      return {
        orden: p.orden,
        texto: p.texto,
        media:
          p.mediaArchivo && clase
            ? {
                archivo: p.mediaArchivo,
                mime: p.mediaMime ?? "application/octet-stream",
                clase,
                nombre: p.mediaNombre,
              }
            : null,
        // Misma lectura que `plantillas/repositorio.ts#aPaso`: clase sin archivo
        // = «acá va una imagen y falta cargarla».
        mediaPendiente: !p.mediaArchivo && p.mediaClase !== null,
      };
    }),
  };
}

async function leerHecho(base: typeof Base, clave: string): Promise<PiezaDelBot | null> {
  const [fila] = await base.select().from(hechos).where(eq(hechos.clave, clave));
  if (!fila) return null;
  return {
    clase: "hecho",
    id: fila.clave,
    vigente: fila.activo,
    // Un hecho vale para cualquier curso (por eso está en el bloque de datos de
    // todas las conversaciones). Sin familia, `{curso}`/`{precio}` no se pueden
    // resolver — y si el hecho los usara, la quinta guarda lo frena.
    familiaCurso: null,
    pasos: [{ orden: 1, texto: fila.texto, media: null, mediaPendiente: false }],
  };
}

// ── Lo que se decide (puro) ──────────────────────────────────────────────────

/** Por qué una pieza NO sale. Se loguea tal cual y vuelve al modelo. */
export type MotivoNoSale =
  | "no_existe"
  | "no_vigente"
  | "sin_pasos"
  | "media_pendiente"
  | "archivo_invalido"
  | "archivo_ausente"
  | "paso_vacio"
  | "faltan_variables"
  | "ya_enviada";

/** Un paso listo para salir: el texto YA expandido y el archivo YA verificado. */
export interface PasoListo {
  orden: number;
  /** El texto expandido. `null` = el paso es solo adjunto. */
  texto: string | null;
  media: (MediaDelPaso & { ruta: string }) | null;
  /**
   * El contenido AUTORAL del paso (texto sin resolver + archivo): lo que se
   * hashea para la versión de la pieza. Nunca el texto expandido — con eso cada
   * destinatario sería una versión distinta y el versionado no mediría nada.
   */
  contenido: { texto: string | null; archivo: string | null };
}

export type Preparacion =
  | { ok: true; pasos: PasoListo[] }
  | { ok: false; motivo: MotivoNoSale; detalle: string };

export interface OpcionesPreparar {
  variables: VariablesPlantilla;
  /** Inyectado para poder decidir sin tocar el disco. Por defecto, `existsSync`. */
  existeArchivo?: (archivo: string) => boolean;
}

/**
 * ¿Sale esta pieza, y con qué texto exactamente?
 *
 * Es **todo o nada por pieza**: si un paso no puede salir, no sale ninguno.
 * Mandar «te dejo el flyer 👇» y que el flyer no salga es peor que no mandar
 * nada, y mandar el flyer sin el mensaje que lo presenta también.
 */
export function prepararEnvio(
  pieza: PiezaDelBot | null,
  o: OpcionesPreparar,
): Preparacion {
  if (!pieza) return { ok: false, motivo: "no_existe", detalle: "no hay pieza con ese id" };
  if (!pieza.vigente) {
    return { ok: false, motivo: "no_vigente", detalle: "todavía no está aprobada o fue retirada" };
  }
  if (pieza.pasos.length === 0) {
    return { ok: false, motivo: "sin_pasos", detalle: "la pieza no tiene ningún mensaje" };
  }

  const existe = o.existeArchivo ?? ((archivo: string) => existsSync(join(RUTA_MEDIA, archivo)));
  const listos: PasoListo[] = [];

  for (const paso of pieza.pasos) {
    if (paso.mediaPendiente) {
      return {
        ok: false,
        motivo: "media_pendiente",
        detalle: `al paso ${paso.orden} le falta la imagen`,
      };
    }
    if (paso.media) {
      if (!archivoSeguro(paso.media.archivo)) {
        return {
          ok: false,
          motivo: "archivo_invalido",
          detalle: `el archivo del paso ${paso.orden} no es un nombre válido`,
        };
      }
      if (!existe(paso.media.archivo)) {
        return {
          ok: false,
          motivo: "archivo_ausente",
          detalle: `el archivo del paso ${paso.orden} ya no está en el server`,
        };
      }
    }

    const { texto, faltantes } = expandirCuerpo(paso.texto ?? "", o.variables);
    if (faltantes.length > 0) {
      // LA QUINTA GUARDA. Ver la cabecera: `[precio]` en la pantalla de una
      // vendedora es un aviso; en el chat de un lead es un mensaje roto.
      return {
        ok: false,
        motivo: "faltan_variables",
        detalle: `el paso ${paso.orden} quedaría con ${faltantes.map((f) => `[${f}]`).join(" ")}`,
      };
    }

    const textoFinal = paso.texto ? texto : null;
    if (!textoFinal && !paso.media) {
      return {
        ok: false,
        motivo: "paso_vacio",
        detalle: `el paso ${paso.orden} no tiene ni texto ni archivo`,
      };
    }

    listos.push({
      orden: paso.orden,
      texto: textoFinal,
      media: paso.media ? { ...paso.media, ruta: join(RUTA_MEDIA, paso.media.archivo) } : null,
      contenido: { texto: paso.texto, archivo: paso.media?.archivo ?? null },
    });
  }

  return { ok: true, pasos: listos };
}

// ── El dedupe por conversación ───────────────────────────────────────────────

/**
 * QUÉ PIEZAS YA RECIBIÓ ESTA CONVERSACIÓN — la guarda que faltaba entera.
 *
 * Cubre tres casos que en el chat se ven igual (el lead recibe el mismo flyer
 * dos veces) y vienen de tres lados distintos:
 *
 *   1. el modelo pide la pieza en dos TURNOS seguidos (dentro del mismo turno lo
 *      corta el recolector, en `tools.ts`);
 *   2. dos pipelines corriendo sobre la misma clave;
 *   3. **la vendedora ya se lo mandó a mano** — y ese es el caso que ninguna
 *      guarda del bot podría ver desde adentro.
 *
 * Se pregunta por `(referencia, pieza_clase, pieza_ref)` con `estado = 'enviado'`
 * (lo bloqueado o fallido no llegó, así que no cuenta) y se devuelve el **id**,
 * no la `ref` cruda: los pasos de una secuencia se estampan `12#1`, `12#2`… y lo
 * que importa es si la SECUENCIA ya salió. La traducción la hacen
 * `direccionDesdeRef` y `rotuloDeDireccion`, del vocabulario compartido — un
 * `LIKE '12#%'` acá sería una segunda implementación del separador.
 *
 * ⚠️ **Se consulta DOS veces por turno, y las dos hacen falta.** Antes de armar
 * las tools, para que el modelo se entere y no la pida (así no promete un flyer
 * que no va a llegar); y otra vez antes de mandar, porque entre las dos hay
 * hasta cuatro llamadas al LLM y otro pipeline pudo mandarla en el medio. La
 * primera es de CONVERSACIÓN, la segunda es de SEGURIDAD.
 *
 * El formato del set es el rótulo compartido (`plantilla:12`, `hecho:cuotas`),
 * que es el MISMO con el que el modelo direcciona una pieza en `mandar_pieza`.
 */
export async function piezasYaEnviadas(
  base: typeof Base,
  clave: string,
): Promise<ReadonlySet<string>> {
  const enviadas = new Set<string>();
  try {
    const filas = await base
      .select({ clase: enviosWa.piezaClase, ref: enviosWa.piezaRef })
      .from(enviosWa)
      .where(and(eq(enviosWa.referencia, clave), eq(enviosWa.estado, "enviado")));

    for (const f of filas) {
      const d = direccionDesdeRef(f.clase, f.ref);
      // Sin `orden`: lo que se pregunta es si la SECUENCIA salió, no el paso.
      if (d) enviadas.add(rotuloDeDireccion({ clase: d.clase, id: d.id }));
    }
  } catch (err) {
    // Un freno que se traba en encendido apaga el producto (la misma decisión
    // que `ultimoSalienteHumanoEn`): sin poder preguntar, el bot manda. Pero se
    // grita, porque el precio de equivocarse acá es un flyer repetido.
    console.error(
      `[bot pieza] no se pudo leer qué piezas ya salieron en ${clave} ` +
        `(${(err as Error).message}): se manda igual, puede duplicarse`,
    );
  }
  return enviadas;
}

// ── El ritmo y el despacho ───────────────────────────────────────────────────

/**
 * Lo que espera el bot entre dos mensajes seguidos: 2 a 6 segundos.
 *
 * Vive acá y lo usan los DOS bucles del bot (las burbujas del texto y los pasos
 * de la pieza) para que no haya dos cadencias que puedan separarse. No es
 * anti-ban —eso está prohibido (CLAUDE.md §WhatsApp)—: es que cuatro mensajes
 * en el mismo segundo no los escribió nadie.
 */
export function esperaEntreMensajes(azar: () => number = Math.random): number {
  return 2000 + azar() * 4000;
}

export interface ResultadoDespacho {
  enviados: number;
  /** El paso en el que se cortó, si se cortó. `null` = salieron todos. */
  corte: { orden: number; motivo: string } | null;
}

/**
 * Manda los pasos EN ORDEN, espaciados, y **corta al primer fallo**.
 *
 * Cortar es lo que separa esto del bucle de burbujas (que solo loguea y sigue):
 * los pasos de una secuencia se explican unos a otros —«te dejo el flyer» →
 * flyer → «el temario»—, y si el flyer no salió, mandar el temario detrás deja
 * una conversación que no se entiende. Además, si el que falló fue el primero,
 * lo más probable es que la línea esté caída o baneada: seguir es escribir
 * contra un número muerto.
 *
 * Cancelar no des-envía: el que ya salió, salió. Por eso se cuenta cuántos
 * salieron y no se dice «se envió la pieza» cuando salió la mitad.
 */
export async function despacharPasos(
  pasos: readonly PasoListo[],
  enviar: (paso: PasoListo) => Promise<{ ok: boolean; motivo?: string }>,
  o: {
    esperar?: (ms: number) => Promise<void>;
    azar?: () => number;
    /**
     * ¿Hay que abortar ANTES del próximo paso? Se pregunta entre paso y paso,
     * no una vez al principio.
     *
     * Una secuencia de cuatro pasos con su espaciado tarda entre 6 y 18
     * segundos, y el turno entero puede pasar el minuto. Sin esta pregunta, el
     * kill-switch que la vendedora aprieta a mitad de camino no frena lo que ya
     * arrancó: los pasos que faltan salen igual, con sus adjuntos, después de
     * que ella apagó la línea. Es el mismo argumento con el que el orquestador
     * justifica re-leer el freno antes de mandar, aplicado un nivel más abajo.
     *
     * Devuelve el motivo del corte, o `null` para seguir. Se consulta entre
     * pasos y no durante el envío: **un mensaje en vuelo no se puede
     * des-enviar**, y prometer que sí sería mentir sobre lo que hace el botón.
     */
    abortar?: () => Promise<string | null>;
  } = {},
): Promise<ResultadoDespacho> {
  const esperar = o.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let enviados = 0;

  for (const [i, paso] of pasos.entries()) {
    if (i > 0 && o.abortar) {
      const motivo = await o.abortar();
      if (motivo !== null) return { enviados, corte: { orden: paso.orden, motivo } };
    }
    const r = await enviar(paso);
    if (!r.ok) {
      return { enviados, corte: { orden: paso.orden, motivo: r.motivo ?? "sin motivo" } };
    }
    enviados++;
    if (i < pasos.length - 1) await esperar(esperaEntreMensajes(o.azar));
  }

  return { enviados, corte: null };
}

// ── El precio, con techo propio ──────────────────────────────────────────────

/**
 * Cuánto se le da a Cerberus para decir el curso y el precio.
 *
 * `resolverCurso` trae su propio `AbortSignal.timeout(15_000)`, y quince
 * segundos es una eternidad **acá**: esto corre con el claim del pipeline tomado
 * y detrás de hasta cuatro llamadas al modelo. El techo de afuera es el mismo
 * que usan las fuentes de `bot/contexto.ts` para lo mismo (un `Promise.race`,
 * porque el `AbortSignal` es de adentro y no se puede acortar desde afuera).
 *
 * Vencido el techo, `null`: sin curso no hay `{precio}`, y sin `{precio}` la
 * quinta guarda no deja salir el paso. Callarse porque Cerberus no contestó es
 * lo correcto — el mensaje alternativo dice `[precio]`.
 */
export const TECHO_CURSO_MS = 6000;

export async function cursoConTecho(
  familia: string | null,
  techoMs: number = TECHO_CURSO_MS,
): Promise<CursoResuelto | null> {
  if (!familia) return null;
  let reloj: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      resolverCurso(familia),
      new Promise<null>((resolver) => {
        reloj = setTimeout(() => resolver(null), techoMs);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (reloj) clearTimeout(reloj);
  }
}
