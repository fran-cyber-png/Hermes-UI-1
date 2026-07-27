import { Router } from 'express';
import { z } from 'zod';
import { requiereVendedora } from '../auth/sesion.js';
import {
  CODIGO_ERROR_IVI,
  ErrorIvi,
  esReintentable,
  preguntarleAIvi,
  turnoHistorialSchema,
} from '../ivi/cliente.js';
import type { PreguntarAIvi } from '../ivi/cliente.js';

/**
 * EL PROXY A IVI. La app de la vendedora pregunta acá (`POST /api/ivi/preguntar`);
 * Hermes le pregunta a Ivi con el token de servicio, que la vendedora nunca ve.
 *
 * Detrás de `requiereVendedora`: `usuario` sale del token (el `vendedoraId`), no del
 * body — no se puede suplantar. Fail-closed y ruidoso: cualquier fallo del cliente se
 * traduce a un 502 con motivo; NUNCA se inventa una respuesta ni se muestra un fallo
 * como «Ivi no encontró datos».
 */

// Topes de tamaño (#98): sin ellos, la pregunta o el historial de la vendedora
// amplifican sin límite lo que Hermes le reenvía a Ivi (y su factura de tokens).
const MAX_CARACTERES_PREGUNTA = 4_000;
const MAX_TURNOS_HISTORIAL = 30;

const cuerpoPreguntarSchema = z.object({
  pregunta: z
    .string()
    .min(1, { error: 'La pregunta no puede estar vacía.' })
    .max(MAX_CARACTERES_PREGUNTA, { error: `La pregunta no puede pasar los ${MAX_CARACTERES_PREGUNTA} caracteres.` }),
  historial: z.array(turnoHistorialSchema).max(MAX_TURNOS_HISTORIAL).optional(),
});

export function iviRouter(preguntar: PreguntarAIvi = preguntarleAIvi): Router {
  const r = Router();

  r.post('/preguntar', requiereVendedora, async (req, res) => {
    const cuerpo = cuerpoPreguntarSchema.safeParse(req.body);
    if (!cuerpo.success) {
      res.status(400).json({ ok: false, message: 'Cuerpo inválido.', detalles: cuerpo.error.issues });
      return;
    }

    try {
      // El usuario es la vendedora autenticada (del token), no lo que venga del body.
      // Un `tipo: SIN_EVIDENCIA` sale POR ACÁ, con 200: Ivi funcionó y no sabe, y eso es una
      // respuesta —la app la muestra tal cual—. Solo un fallo baja al `catch`.
      const respuesta = await preguntar(cuerpo.data.pregunta, req.vendedoraId!, cuerpo.data.historial);
      res.json({ ok: true, respuesta, trazaId: respuesta.trazaId });
    } catch (err) {
      // Fail-closed: un fallo se reporta como fallo, con su clase — jamás como «no hay datos».
      // `reintentable` viaja para que la app no tenga que reimplementar la tabla de códigos
      // (y para que no reintente un fallo de config, que da lo mismo un minuto después).
      if (err instanceof ErrorIvi) {
        console.error(`ivi: ${err.codigo} — ${err.message} [traza ${err.trazaId ?? '—'}]`, err.cause ?? '');
        res.status(502).json({
          ok: false,
          codigo: err.codigo,
          message: err.message,
          reintentable: esReintentable(err.codigo),
          ...(err.trazaId ? { trazaId: err.trazaId } : {}),
        });
        return;
      }
      console.error('ivi: error inesperado consultando a Ivi', err);
      res.status(502).json({
        ok: false,
        codigo: CODIGO_ERROR_IVI.DESCONOCIDO,
        message: 'No se pudo consultar a Ivi.',
        reintentable: esReintentable(CODIGO_ERROR_IVI.DESCONOCIDO),
      });
    }
  });

  return r;
}
