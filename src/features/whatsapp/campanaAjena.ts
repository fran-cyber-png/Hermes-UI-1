import { ErrorApi } from '../../lib/datos/cliente';

/**
 * ¿ESTE ERROR ES LA FRONTERA DE CAMPAÑA? (server: `numeros/campana.ts`).
 *
 * ── Cuándo se ve, que es la parte que no es obvia ──────────────────────────
 *
 * Con la frontera puesta, la conversación de una línea de campaña **ya no está
 * en la cola** de quien no la atiende, así que no hay dónde tocar para llegar
 * acá… salvo por una puerta que este repo tiene abierta a propósito: el caché de
 * consultas se persiste en IndexedDB y se restaura **antes del primer render**
 * (ADR 0007). O sea que quien la tenía ayer la ve un instante hoy, la abre, y el
 * server contesta 403.
 *
 * Sin esto la pantalla decía «No se pudo cargar el hilo» con un botón de
 * Reintentar que no puede funcionar nunca: la lectura correcta de un fallo
 * permanente no es un lazo.
 *
 * ⚠️ **Se mira el `motivo`, no el 403 pelado.** Un 403 puede venir de otra cosa
 * (hoy, de `/api/dashboard/negocio`), y afirmar «es de campaña» sobre cualquiera
 * sería inventar una explicación — el defecto que `features/ivi/errores.ts`
 * prohíbe con un test.
 */
export const MOTIVO_CAMPANA = 'linea_de_campana';

export function esDeCampana(error: unknown): boolean {
  if (!(error instanceof ErrorApi)) return false;
  return error.status === 403 && error.cuerpo?.motivo === MOTIVO_CAMPANA;
}
