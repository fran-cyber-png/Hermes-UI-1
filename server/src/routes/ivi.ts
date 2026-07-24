import { Router } from 'express';
import { z } from 'zod';
import { requiereVendedora } from '../auth/sesion.js';
import { ErrorIvi, preguntarleAIvi, turnoHistorialSchema } from '../ivi/cliente.js';
import type { RespuestaIvi, TurnoHistorial } from '../ivi/cliente.js';

/**
 * EL PROXY A IVI. La app de la vendedora pregunta acá (`POST /api/ivi/preguntar`);
 * Hermes le pregunta a Ivi con el token de servicio, que la vendedora nunca ve.
 *
 * Detrás de `requiereVendedora`: `usuario` sale del token (el `vendedoraId`), no del
 * body — no se puede suplantar. Fail-closed y ruidoso: cualquier fallo del cliente se
 * traduce a un 502 con motivo; NUNCA se inventa una respuesta ni se muestra un fallo
 * como «Ivi no encontró datos».
 */

const cuerpoPreguntarSchema = z.object({
  pregunta: z.string().min(1, { error: 'La pregunta no puede estar vacía.' }),
  historial: z.array(turnoHistorialSchema).optional(),
});

/** La firma del cliente. Se inyecta para los tests; en producción es `preguntarleAIvi`. */
type PreguntarAIvi = (
  pregunta: string,
  usuario: string,
  historial?: TurnoHistorial[],
) => Promise<RespuestaIvi>;

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
      const respuesta = await preguntar(cuerpo.data.pregunta, req.vendedoraId!, cuerpo.data.historial);
      res.json({ ok: true, respuesta });
    } catch (err) {
      // Fail-closed: un fallo se reporta como fallo, con su clase — jamás como «no hay datos».
      if (err instanceof ErrorIvi) {
        res.status(502).json({ ok: false, codigo: err.codigo, message: err.message });
        return;
      }
      console.error('ivi: error inesperado consultando a Ivi', err);
      res.status(502).json({ ok: false, codigo: 'desconocido', message: 'No se pudo consultar a Ivi.' });
    }
  });

  return r;
}
