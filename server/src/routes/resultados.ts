import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { requiereVendedora } from "../auth/sesion.js";
import { consultarResultados } from "../resultados/consultarResultados.js";
import {
  VENTANA_HORAS_POR_DEFECTO,
  VENTANA_VENTA_DIAS_POR_DEFECTO,
} from "../resultados/loQuePaso.js";
import { MUESTRA_MINIMA } from "../resultados/medicion.js";
import { ruta } from "../lib/ruta.js";

/**
 * QUÉ PIEZA CIERRA VENTAS Y CUÁL SOLO GASTA MENSAJES — `GET /api/resultados/piezas`.
 *
 * ══ POR QUÉ UN ENDPOINT Y NO UNA PANTALLA (todavía) ══════════════════════════
 *
 * La épica pide que la respuesta sea **una consulta**. Un endpoint lo es, y lo
 * es para todos: el script del dueño, Ivi cuando le toque, y la pantalla que
 * algún día se dibuje encima sin recalcular nada.
 *
 * Una pantalla hoy sería una tabla vacía durante semanas —la procedencia se
 * empieza a acumular recién con este deploy— y encima quedaría desalineada con
 * el frente 2, que va a reorganizar el catálogo entero. Construir la vista antes
 * de que haya qué mirar es la forma más cara de equivocarse.
 *
 * Lo que sí existe hoy es el consumidor: `npm run piezas:resultados`, que imprime
 * esto mismo en la terminal. Un dato que nadie mira no sirve, así que el dato
 * nace con alguien que lo mire.
 *
 * ══ LO QUE ESTE ENDPOINT NO HACE ═════════════════════════════════════════════
 *
 * **No devuelve textos de conversación.** Devuelve conteos por pieza. El corpus
 * (contexto, pieza, resultado) que va hacia Ivi es otro frente y tiene su propia
 * anonimización en el borde; esta ruta no es esa puerta.
 */
export const resultadosRouter = Router();
resultadosRouter.use(requiereVendedora);

const consulta = z.object({
  /** Cuántos días atrás mirar. 30 por defecto. */
  dias: z.coerce.number().int().min(1).max(365).default(30),
  /** Filtrar por vendedora. Sin esto, el equipo entero. */
  vendedora: z.string().max(80).optional(),
  /** La ventana de «contestó a esto», en horas. */
  horas: z.coerce.number().int().min(1).max(24 * 30).default(VENTANA_HORAS_POR_DEFECTO),
  /** La ventana de «después de esto hubo una venta», en días. */
  diasVenta: z.coerce.number().int().min(1).max(180).default(VENTANA_VENTA_DIAS_POR_DEFECTO),
});

resultadosRouter.get("/piezas", ruta(async (req, res) => {
  const parsed = consulta.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ ok: false, message: "parámetros inválidos", detalle: parsed.error.issues });
    return;
  }
  const { dias, vendedora, horas, diasVenta } = parsed.data;
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

  const r = await consultarResultados(db, {
    desde,
    vendedoraId: vendedora,
    ventanas: { horas, diasVenta },
  });

  res.json({
    ...r,
    desde: desde.toISOString(),
    dias,
    /** El umbral bajo el cual un porcentaje no decide nada. Viaja para que el gate no se reinvente. */
    muestraMinima: MUESTRA_MINIMA,
    /**
     * Por qué la columna de ventas puede venir en blanco. Se dice acá, en la
     * respuesta, y no en un comentario del código: quien la consuma tiene que
     * poder distinguir «no compró» de «no lo sabemos» sin leer el repo.
     */
    ...(r.seSabeDeVentas
      ? {}
      : {
          sinAtribucionDeVentas:
            "la atribución de ventas todavía no está conectada (conversiones_wa está vacía; " +
            "depende del PR #165). «¿compró?» viene en null, que NO es cero.",
        }),
  });
}));
