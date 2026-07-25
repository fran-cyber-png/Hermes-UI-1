import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import express, { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { requiereVendedora } from "../auth/sesion.js";
import { ficha } from "../cerberus/ficha.js";
import { RUTA_MEDIA, nombreSeguro } from "../whatsapp/mediaDir.js";
import { enviarMediaYProyectar, enviarTextoYProyectar } from "../whatsapp/enviarYProyectar.js";
import { resolverCurso } from "../plantillas/catalogo.js";
import { agruparEnFamilias } from "../plantillas/familias.js";
import { catalogoActivo } from "../plantillas/catalogo.js";
import { expandirCuerpo, exigeCurso } from "../plantillas/expandir.js";
import {
  aprobarPlantilla,
  archivarPlantilla,
  crearPlantilla,
  editarPlantilla,
  listarPlantillas,
  obtenerPlantilla,
  sumarUso,
  type PasoPlantilla,
} from "../plantillas/repositorio.js";

/**
 * PLANTILLAS-SECUENCIA — «un clic manda la secuencia completa».
 *
 * ══ POR QUÉ NO HAY UN `POST /:id/enviar` QUE MANDE LOS CUATRO ════════════════
 *
 * Porque un endpoint que recibe «mandá esta secuencia» y se va a mandar cuatro
 * mensajes en un bucle del server ES un bot: la vendedora no puede frenarlo, no
 * ve dónde va, y el server decide solo el ritmo. Eso es exactamente lo que
 * `CLAUDE.md` prohíbe («un envío = una acción humana»).
 *
 * En cambio: **`POST /:id/enviar-paso` manda UN mensaje**. El clic de la
 * vendedora arranca un bucle que vive EN SU PANTALLA, espacia los mensajes, le
 * muestra «enviando 2 de 4» y se corta en cuanto ella aprieta cancelar. El
 * server nunca tiene una lista de destinatarios ni una lista de mensajes
 * pendientes que sobreviva a la pantalla: si la app se cierra, no queda nada
 * mandándose solo. La forma del código es la política.
 *
 * Las tres guardas duras de esta ruta:
 *   1. **Una propuesta no se manda.** El minado propone; una persona aprueba.
 *   2. **Un paso con imagen pendiente no se manda.** No se manda medio mensaje.
 *   3. Todo sale por `EnvioControlado` (vía `enviarYProyectar`), con vendedora
 *      del token, auditoría y freno por ban.
 */
export const plantillasRouter = Router();
plantillasRouter.use(requiereVendedora);

const pasoSchema = z.object({
  texto: z.string().max(4000).nullable().optional(),
  media: z
    .object({
      archivo: z.string().min(1).max(200),
      mime: z.string().min(1).max(120),
      clase: z.enum(["imagen", "video", "audio", "documento"]),
      nombre: z.string().max(200).nullable().optional(),
    })
    .nullable()
    .optional(),
  mediaPendiente: z.boolean().optional(),
});

const plantillaSchema = z.object({
  nombre: z.string().min(1).max(80),
  familiaCurso: z.string().max(40).nullable().optional(),
  pasos: z.array(pasoSchema).min(1).max(10),
});

/** El nombre de archivo se revalida SIEMPRE: nada de `..`, nada de rutas. */
function archivoSeguro(nombre: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(nombre) && !nombre.includes("..");
}

function aPasos(pasos: z.infer<typeof pasoSchema>[]): PasoPlantilla[] {
  return pasos.map((p, i) => ({
    orden: i + 1,
    texto: p.texto?.trim() || null,
    media: p.media
      ? {
          archivo: p.media.archivo,
          mime: p.media.mime,
          clase: p.media.clase,
          nombre: p.media.nombre ?? null,
        }
      : null,
    mediaPendiente: !p.media && (p.mediaPendiente ?? false),
  }));
}

/** Un paso sin texto y sin archivo no es un mensaje: es un hueco. */
function pasosValidos(pasos: PasoPlantilla[]): boolean {
  return pasos.every((p) => Boolean(p.texto) || Boolean(p.media) || p.mediaPendiente);
}

// ── El catálogo agrupado por familia, para elegir a qué curso ata la plantilla ──
//
// UNA fila por diploma con su última edición (#129), no cinco «Diploma de
// Especializaci…» truncadas e indistinguibles.
plantillasRouter.get("/cursos", async (_req, res) => {
  try {
    const productos = await catalogoActivo();
    res.json({
      familias: agruparEnFamilias(productos).map((f) => ({
        familia: f.familia,
        nombre: f.nombreCorto,
        ediciones: f.ediciones,
        ultimaEdicionSku: f.ultima.sku,
      })),
    });
  } catch (err) {
    res.status(502).json({ ok: false, message: (err as Error).message });
  }
});

/**
 * SUBIR EL ARCHIVO DE UN PASO (el flyer, el temario en PDF).
 *
 * Va al MISMO directorio por el que ya pasa todo adjunto saliente (`RUTA_MEDIA`),
 * con el mismo saneado de nombre. Devuelve la referencia que se guarda en el
 * paso — la base nunca ve bytes, y el flyer se sube UNA vez aunque lo usen cinco
 * plantillas.
 *
 * No envía nada: subir un archivo no es mandarlo.
 */
plantillasRouter.post(
  "/media",
  express.raw({ type: () => true, limit: "32mb" }),
  async (req, res) => {
    const bytes = req.body as Buffer;
    const mime = req.headers["content-type"] ?? "application/octet-stream";
    const nombre = typeof req.query.nombre === "string" ? req.query.nombre : "archivo";

    if (!bytes?.length) {
      res.status(400).json({ ok: false, message: "el cuerpo tiene que ser el archivo crudo" });
      return;
    }

    const clase = mime.startsWith("image/")
      ? "imagen"
      : mime.startsWith("video/")
        ? "video"
        : mime.startsWith("audio/")
          ? "audio"
          : "documento";

    const archivo = nombreSeguro(`tpl-${Date.now()}-${nombre}`);
    await writeFile(join(RUTA_MEDIA, archivo), bytes);

    res.status(201).json({ ok: true, media: { archivo, mime, clase, nombre } });
  },
);

plantillasRouter.get("/", async (req, res) => {
  res.json({ plantillas: await listarPlantillas(db, req.vendedoraId!) });
});

plantillasRouter.post("/", async (req, res) => {
  const parsed = plantillaSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, message: "plantilla inválida (nombre o pasos)" });
    return;
  }
  const pasos = aPasos(parsed.data.pasos);
  if (!pasosValidos(pasos)) {
    res.status(400).json({ ok: false, message: "cada paso necesita texto o un archivo" });
    return;
  }
  const cuerpos = pasos.map((p) => p.texto ?? "").join("\n");
  if (exigeCurso(cuerpos) && !parsed.data.familiaCurso) {
    res
      .status(400)
      .json({ ok: false, message: "para usar {curso} o {precio} hay que atar la plantilla a un curso" });
    return;
  }

  const plantilla = await crearPlantilla(db, req.vendedoraId!, {
    nombre: parsed.data.nombre.trim(),
    familiaCurso: parsed.data.familiaCurso ?? null,
    pasos,
  });
  res.status(201).json({ ok: true, plantilla });
});

plantillasRouter.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ ok: false, message: "id inválido" });
    return;
  }
  const parsed = plantillaSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, message: "cambios inválidos" });
    return;
  }
  const pasos = parsed.data.pasos ? aPasos(parsed.data.pasos) : undefined;
  if (pasos && !pasosValidos(pasos)) {
    res.status(400).json({ ok: false, message: "cada paso necesita texto o un archivo" });
    return;
  }

  const plantilla = await editarPlantilla(db, req.vendedoraId!, id, {
    ...(parsed.data.nombre !== undefined ? { nombre: parsed.data.nombre.trim() } : {}),
    ...(parsed.data.familiaCurso !== undefined ? { familiaCurso: parsed.data.familiaCurso } : {}),
    ...(pasos ? { pasos } : {}),
  });
  if (!plantilla) {
    res.status(404).json({ ok: false, message: "esa plantilla no existe o no es tuya" });
    return;
  }
  res.json({ ok: true, plantilla });
});

/** Aprobar una propuesta minada: el acto humano que la vuelve enviable. */
plantillasRouter.post("/:id/aprobar", async (req, res) => {
  const id = Number(req.params.id);
  const plantilla = Number.isInteger(id) ? await aprobarPlantilla(db, req.vendedoraId!, id) : null;
  if (!plantilla) {
    res.status(404).json({ ok: false, message: "esa plantilla no existe o no es tuya" });
    return;
  }
  res.json({ ok: true, plantilla });
});

plantillasRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const ok = Number.isInteger(id) ? await archivarPlantilla(db, req.vendedoraId!, id) : false;
  if (!ok) {
    res.status(404).json({ ok: false, message: "esa plantilla no existe o no es tuya" });
    return;
  }
  res.json({ ok: true });
});

/**
 * PREPARAR: la vista previa de lo que va a salir, con las variables ya resueltas.
 *
 * Es lo que la vendedora ve ANTES de apretar. Resolver acá y no en el momento
 * del envío tiene un motivo: que lo que revisó sea exactamente lo que sale.
 */
const prepararSchema = z.object({
  clave: z.string().min(1),
  telefono: z.string().max(20).optional(),
  personaNombre: z.string().max(120).nullable().optional(),
});

plantillasRouter.post("/:id/preparar", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = prepararSchema.safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) {
    res.status(400).json({ ok: false, message: "faltan la plantilla o la conversación" });
    return;
  }

  const plantilla = await obtenerPlantilla(db, req.vendedoraId!, id);
  if (!plantilla) {
    res.status(404).json({ ok: false, message: "esa plantilla no existe o no es tuya" });
    return;
  }

  const telefono = parsed.data.telefono ?? parsed.data.clave.split(":")[2] ?? "";
  const [f, curso] = await Promise.all([
    telefono ? ficha(telefono).catch(() => null) : Promise.resolve(null),
    resolverCurso(plantilla.familiaCurso),
  ]);

  const nombre =
    (f && f.estado === "cliente" ? f.nombre : null) || parsed.data.personaNombre || null;

  const pasos = plantilla.pasos.map((p) => {
    const { texto, faltantes } = expandirCuerpo(p.texto ?? "", {
      nombre,
      curso: curso?.nombre ?? null,
      precio: curso?.precio ?? null,
      moneda: curso?.moneda ?? null,
    });
    return {
      orden: p.orden,
      texto: p.texto ? texto : null,
      faltantes,
      media: p.media,
      mediaPendiente: p.mediaPendiente,
    };
  });

  res.json({
    plantilla: { id: plantilla.id, nombre: plantilla.nombre, estado: plantilla.estado },
    pasos,
    total: pasos.length,
    enviable: plantilla.estado === "aprobada" && pasos.every((p) => !p.mediaPendiente),
  });
});

/**
 * ENVIAR **UN** PASO. Una llamada = un mensaje = una fila de auditoría.
 *
 * El bucle, el espaciado y el botón de cancelar viven en la pantalla de la
 * vendedora. Acá no hay nada que siga corriendo cuando ella cierra la app.
 */
const enviarPasoSchema = z.object({
  clave: z.string().min(1),
  orden: z.number().int().min(1).max(10),
  telefono: z.string().min(6).max(20),
  numeroPropio: z.string().min(6).max(20),
  personaNombre: z.string().max(120).nullable().optional(),
  /** El último paso suma el uso: la plantilla se usó cuando terminó de salir. */
  ultimo: z.boolean().optional(),
});

plantillasRouter.post("/:id/enviar-paso", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = enviarPasoSchema.safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) {
    res.status(400).json({ ok: false, message: "datos del envío incompletos" });
    return;
  }

  const plantilla = await obtenerPlantilla(db, req.vendedoraId!, id);
  if (!plantilla) {
    res.status(404).json({ ok: false, message: "esa plantilla no existe o no es tuya" });
    return;
  }

  // GUARDA 1 — una propuesta no se manda. El minado sugiere; una persona aprueba.
  if (plantilla.estado !== "aprobada") {
    res.status(409).json({
      ok: false,
      message: "esta secuencia es una propuesta: revisala y aprobala antes de mandarla",
    });
    return;
  }

  const paso = plantilla.pasos.find((p) => p.orden === parsed.data.orden);
  if (!paso) {
    res.status(404).json({ ok: false, message: "ese paso no existe en la secuencia" });
    return;
  }

  // GUARDA 2 — no se manda medio mensaje: si el paso pide una imagen, va con ella.
  if (paso.mediaPendiente) {
    res.status(409).json({
      ok: false,
      message: `al paso ${paso.orden} le falta la imagen — cargala antes de mandar la secuencia`,
    });
    return;
  }

  const curso = await resolverCurso(plantilla.familiaCurso);
  const f = await ficha(parsed.data.telefono).catch(() => null);
  const nombre =
    (f && f.estado === "cliente" ? f.nombre : null) || parsed.data.personaNombre || null;

  const { texto, faltantes } = expandirCuerpo(paso.texto ?? "", {
    nombre,
    curso: curso?.nombre ?? null,
    precio: curso?.precio ?? null,
    moneda: curso?.moneda ?? null,
  });

  const comun = {
    vendedoraId: req.vendedoraId!,
    numeroPropio: parsed.data.numeroPropio,
    telefono: parsed.data.telefono,
    referencia: parsed.data.clave,
  };

  let r;
  if (paso.media) {
    if (!archivoSeguro(paso.media.archivo)) {
      res.status(400).json({ ok: false, message: "el archivo del paso no es válido" });
      return;
    }
    const ruta = join(RUTA_MEDIA, paso.media.archivo);
    if (!existsSync(ruta)) {
      res.status(409).json({
        ok: false,
        message: `el archivo del paso ${paso.orden} ya no está en el server — volvé a cargarlo`,
      });
      return;
    }
    r = await enviarMediaYProyectar({
      ...comun,
      archivo: paso.media.archivo,
      media: {
        ruta,
        clase: paso.media.clase as "imagen" | "video" | "audio" | "documento",
        mime: paso.media.mime,
        nombre: paso.media.nombre,
        texto: paso.texto ? texto : null,
      },
    });
  } else {
    r = await enviarTextoYProyectar({ ...comun, texto });
  }

  if (!r.ok) {
    res.status(409).json({ ok: false, message: r.motivo, orden: paso.orden });
    return;
  }

  if (parsed.data.ultimo) await sumarUso(db, plantilla.id);

  res.json({ ok: true, idExterno: r.idExterno, orden: paso.orden, faltantes });
});
