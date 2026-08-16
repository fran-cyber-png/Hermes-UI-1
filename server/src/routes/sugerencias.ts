import { Router } from "express";
import { db } from "../db/client.js";
import { requiereVendedora } from "../auth/sesion.js";
import { ruta } from "../lib/ruta.js";
import { ficha } from "../cerberus/ficha.js";
import { consultarSugerencias } from "../sugerencias/consultarSugerencias.js";
import { resolverCurso } from "../plantillas/catalogo.js";
import { expandirCuerpo } from "../plantillas/expandir.js";

/**
 * LAS DOS RESPUESTAS LISTAS PARA MANDAR — `GET /api/sugerencias?clave=…`.
 *
 * Devuelve como máximo dos, cada una con su **vista previa YA resuelta**
 * (`{nombre}`, `{curso}`, `{precio}` contra Cerberus en el momento): sin eso, un
 * clic mandaría algo que la vendedora no leyó, y con la vista previa además
 * puede tocar el texto y editarlo en el composer antes de mandar.
 *
 * Solo lee. El envío sigue siendo el mismo de siempre:
 * `POST /api/plantillas/:id/enviar-paso`, uno por vez, por `EnvioControlado`.
 */
export const sugerenciasRouter = Router();
sugerenciasRouter.use(requiereVendedora);

sugerenciasRouter.get("/", ruta(async (req, res) => {
  const clave = typeof req.query.clave === "string" ? req.query.clave : "";
  if (!clave.startsWith("conv:")) {
    res
      .status(400)
      .json({ ok: false, message: "hace falta la clave de una conversación (?clave=conv:…)" });
    return;
  }

  const { estado, sugerencias } = await consultarSugerencias(db, {
    clave,
    vendedoraId: req.vendedoraId!,
  });

  const telefono = clave.split(":")[2] ?? "";
  const personaNombre = typeof req.query.nombre === "string" ? req.query.nombre : null;
  const f = telefono ? await ficha(telefono).catch(() => null) : null;
  const nombre = (f && f.estado === "cliente" ? f.nombre : null) || personaNombre || null;

  const salida = [];
  for (const s of sugerencias) {
    const curso = await resolverCurso(s.plantilla.familiaCurso);
    const primero = s.plantilla.pasos[0];
    const { texto, faltantes } = expandirCuerpo(primero?.texto ?? "", {
      nombre,
      curso: curso?.nombre ?? null,
      precio: curso?.precio ?? null,
      moneda: curso?.moneda ?? null,
    });
    salida.push({
      plantillaId: s.plantilla.id,
      nombre: s.plantilla.nombre,
      intencion: s.intencion,
      rotulo: s.rotulo,
      porque: s.porque,
      totalPasos: s.plantilla.pasos.length,
      conImagen: s.plantilla.pasos.some((p) => Boolean(p.media)),
      vistaPrevia: { texto, faltantes },
      // El orden de los pasos, para que el bucle del cliente no tenga que
      // adivinarlo (y no exista ninguna forma de mandarlos desordenados).
      pasos: s.plantilla.pasos.map((p) => ({ orden: p.orden, conImagen: Boolean(p.media) })),
    });
  }

  res.json({ sugerencias: salida, estado });
}));
