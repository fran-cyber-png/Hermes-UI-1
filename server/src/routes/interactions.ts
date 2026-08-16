import { Router } from "express";
import { db } from "../db/client.js";
import {
  consultarEstadoDeCanales,
  consultarFrescura,
  consultarInteracciones,
} from "../interacciones/consultas.js";

/**
 * LA BANDEJA DE INTERACCIONES — la ruta, sin una línea de SQL.
 *
 * Todo el SQL vive en `interacciones/consultas.ts`, que recibe `db` inyectado y
 * por eso se puede testear contra una base efímera (ADR 0008). Acá queda lo que
 * es HTTP: leer la query, acotar el lote y serializar la respuesta.
 */
export const interactionsRouter = Router();

interactionsRouter.get("/", async (req, res) => {
  const canal = typeof req.query.canal === "string" ? req.query.canal : "";
  const intencion = typeof req.query.intencion === "string" ? req.query.intencion : "";
  const limit = Math.min(Number(req.query.limit) || 40, 100);
  const offset = Number(req.query.offset) || 0;

  // Comentario y mensaje NO son lo mismo, y por eso se pueden separar: a un
  // comentario le respondes en público (y tienes 7 días para el privado); un
  // mensaje ya ES una conversación abierta. Cambia lo que puedes hacer.
  const tipo = req.query.tipo === "comentario" || req.query.tipo === "mensaje" ? req.query.tipo : "";

  const { filas, total } = await consultarInteracciones(db, {
    canal,
    tipo,
    intencion,
    limit,
    offset,
    rango: req.query.rango,
  });

  res.json({ interacciones: filas, total, hayMas: filas.length === limit });
});

/**
 * El estado de todos los canales, en una sola consulta.
 *
 * Incluye los formularios: para el negocio son un canal más. La diferencia
 * entre un formulario y un comentario que dice "más información" es de formato,
 * no de intención.
 */
interactionsRouter.get("/canales", async (req, res) => {
  const { interacciones, formularios, porDia } = await consultarEstadoDeCanales(
    db,
    req.query.rango,
  );

  res.json({ interacciones, formularios, porDia });
});

/**
 * ¿Qué tan viejo es lo que estamos mostrando?
 *
 * Sin esto, una bandeja vacía es una MENTIRA. El filtro por defecto ("les puedo
 * escribir") solo muestra comentarios de los últimos 7 días; si la ingesta lleva
 * 10 días detenida, ese filtro devuelve cero y la pantalla dice "Estás al día"
 * — cuando lo cierto es "no tengo idea, hace 10 días que no miro".
 *
 * Pasó de verdad, y por eso existe este endpoint: 94.371 interacciones en la
 * base, 0 con la ventana abierta, porque el último dato capturado era del 11-jul
 * y era 21-jul.
 *
 * Un estado vacío indistinguible de un pipeline muerto es peor que un error: el
 * error te hace mirar, la calma falsa te hace irte tranquilo.
 */
interactionsRouter.get("/frescura", async (_req, res) => {
  const r = await consultarFrescura(db);

  // 6h es el umbral. La ingesta hoy es manual, pero el compromiso con el vendedor
  // es que lo que ve sea de esta jornada; más que eso y hay que avisarle en la cara.
  const horas = r?.horas == null ? null : Number(r.horas);
  res.json({
    ultimoDato: r?.ultimo_dato ?? null,
    ultimaIngesta: r?.ultima_ingesta ?? null,
    horasDesdeIngesta: horas,
    total: r?.total ?? 0,
    fresca: horas != null && horas < 6,
  });
});
