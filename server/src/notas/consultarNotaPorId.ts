import { eq } from 'drizzle-orm';
import type { db as DbSingleton } from '../db/client.js';
import { notas } from '../db/schema.js';
import type { NotaFila } from './notas.js';

/**
 * LA PÁGINA ENTERA, POR SU ID — el seam que le faltaba a `GET /api/notas/por-link/:token`.
 *
 * Vivía como SQL suelto adentro del router (`db.select().from(notas)…`), que era
 * la última consulta inline de `routes/notas.ts`: el resto del frente ya hablaba
 * con la base por `notas/notas.ts` y `espacios/linkRepositorio.ts`. Acá se muda
 * tal cual, sin tocar una letra del `where` ni de la proyección.
 *
 * Recibe `base` INYECTADO, como todo seam de esta casa (ADR 0008): el router le
 * pasa el singleton, un test con base efímera le pasa la suya.
 *
 * ⚠️ **Devuelve la fila COMPLETA** —`select()` sin proyectar— y eso es parte del
 * contrato de quien la usa: la respuesta de `por-link` sirve la nota entera para
 * que la app la abra y la edite. La proyección recortada de un link ANÓNIMO es
 * otra cosa y vive aparte, en `leerPorToken` (`LinkPublico`: solo título, texto y
 * doc). Recortar acá le sacaría a la app lo que necesita; ensanchar allá dejaría
 * salir por la puerta anónima lo que no tiene que salir.
 *
 * `undefined` = no hay fila con ese id. Quien pregunta decide qué significa: la
 * ruta lo contesta con el MISMO 404 que un token inexistente, a propósito.
 */
export async function consultarNotaPorId(
  base: typeof DbSingleton,
  id: number,
): Promise<NotaFila | undefined> {
  const [nota] = await base.select().from(notas).where(eq(notas.id, id));
  return nota;
}
