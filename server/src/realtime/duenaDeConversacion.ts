import { eq } from 'drizzle-orm';
import { conversacionAsignada } from '../db/reparto.js';
import { porQueFallo } from '../lib/porQueFallo.js';
import type { DuenaDelEvento } from './bus.js';
import type { db as Base } from '../db/client.js';

/**
 * DE QUIÉN ES ESTA CONVERSACIÓN — la lectura que el tiempo real necesita antes
 * de nombrarle un lead a alguien.
 *
 * ══ POR QUÉ ACÁ Y NO REUSANDO `duenoSql` ════════════════════════════════════
 *
 * `cola/asignadaSql.ts` arma FRAGMENTOS para una consulta que ya tiene el CTE
 * `todo` y el alias `ca` — no se puede invocar suelto. Y su `duenoSql` es un
 * `COALESCE(ca.vendedora_id, cl.vendedora_id)` donde `cl` es el ruteo por CURSO
 * de los leads de formulario (`lead:<id>`, `cursoRuteoJoinSql`): un lead no
 * emite por este bus —no tiene mensaje— así que esa rama no aplica y traerla
 * sería copiar SQL que acá nunca da distinto de `null`.
 *
 * Lo que sí se comparte es la TABLA y la forma de la clave. Si algún día el
 * dueño de una conversación deja de ser `conversacion_asignada.vendedora_id`,
 * **éste es el segundo lugar que hay que tocar** — igual que `lineaAlcanzable`
 * es el segundo lector de `numero_vendedora`.
 *
 * ══ 🔴 NUNCA TIRA, Y ESO ES ESTRUCTURAL ═════════════════════════════════════
 *
 * Corre adentro de la ingesta, con un lead esperando del otro lado. Un rechazo
 * acá no sería un evento sin dueña: sería el MENSAJE perdido (`persistir`
 * devuelve antes de escribir la interacción). Por eso atrapa todo y devuelve
 * `null`, que bajo la regla de `visibilidad.ts` es fail-closed: el evento sale
 * recortado, la cola igual se refresca, y nadie ve un teléfono que no le toca.
 *
 * ⚠️ **Sin la migración del reparto tampoco tira**: `conversacion_asignada` es
 * de `0015` y este archivo no puede asumirla — la cola misma la trata como
 * opcional (`conAsignacion`). Sin tabla, todo es `null`.
 */
export async function duenaDeConversacion(base: typeof Base, clave: string): Promise<DuenaDelEvento> {
  if (!clave) return null;
  try {
    const [fila] = await base
      .select({ vendedoraId: conversacionAsignada.vendedoraId })
      .from(conversacionAsignada)
      .where(eq(conversacionAsignada.clave, clave));
    return fila?.vendedoraId ?? null;
  } catch (e: unknown) {
    // `err.message` de drizzle dice el SQL, no la causa — por eso `porQueFallo`.
    console.error(`[realtime] no se pudo resolver la dueña de «${clave}» — ${porQueFallo(e)}`);
    return null;
  }
}

/**
 * La clave de la conversación, tal cual la arman el webhook (`webhook/whatsapp.ts`)
 * y la cola. Se escribe acá para que los emisores no la repitan cada uno a su modo:
 * una clave armada distinto no da error, da **cero filas** — o sea una campanita
 * que no suena y nadie sabe por qué.
 */
export function claveDeConversacion(canal: string, personaId: string, numeroPropio: string | null | undefined): string {
  return `conv:${canal}:${personaId}:${numeroPropio ?? ''}`;
}
