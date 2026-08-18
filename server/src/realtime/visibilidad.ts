import type { EventoPublico, EventoRT } from './bus.js';

/**
 * QUÉ VE CADA VENDEDORA EN EL TIEMPO REAL — la regla, pura y en un solo lugar.
 *
 * ══ EL INVARIANTE, TAL CUAL LO PIDIÓ EL DUEÑO ═══════════════════════════════
 *
 *   ve el contenido de una conversación  ⟺  es su dueña, o supervisa
 *
 * Nada más. Y acá se aplica al único dato de conversación que este canal
 * transporta: **el teléfono del lead** (y `direccion`, que es «te escribieron a
 * vos, ahora»). Ver `docs/auditoria-aislamiento-de-chats-2026-08-17.md` §0.1.
 *
 * ══ 🔴 FALLA CERRADO, Y ESA ES LA DECISIÓN ══════════════════════════════════
 *
 * Sólo se sirve completo lo que se puede AFIRMAR que es tuyo. Una conversación
 * **sin dueña** (`duena: null`) no se le nombra a nadie salvo a quien supervisa,
 * aunque la COLA sí se la muestre a varias por su rama de línea huérfana
 * (`cola/asignadaSql.ts` §lineaAlcanzableSql).
 *
 * Que las dos reglas no coincidan ahí es deliberado, y el motivo es que
 * responden preguntas distintas: la cola decide **qué se lista** —y esa
 * concesión existe para que el archivo de las líneas retiradas no desaparezca—,
 * esto decide **qué se nombra**. Copiar acá `lineaAlcanzableSql` sería una
 * segunda implementación en TypeScript de un predicado que hoy vive en SQL, o
 * sea #37, la cicatriz más repetida del repo, **en una frontera** — donde
 * divergir falla hacia ABIERTO y sin un solo síntoma.
 *
 * ⚠️ **Lo que cuesta, escrito para que nadie lo descubra debugueando**: a una
 * conversación sin dueña **no le suena la campanita a nadie**, y eso incluye el
 * PRIMER mensaje de un lead nuevo — el reparto (`asignarSiHaceFalta`) corre
 * DESPUÉS de persistir, así que en ese instante todavía no hay fila
 * (`webhook/whatsapp.ts`, y el orden es a propósito: un lead perdido no vuelve).
 * El webhook lo compensa con un segundo aviso cuando la asignación recién
 * ocurre; fuera de ese camino —whatsmeow, una línea sin rueda, lo anterior al
 * 4-ago— la fila **aparece igual en la cola** (el evento recortado la sigue
 * invalidando) y lo único que falta es el sonido.
 *
 * ══ NORMALIZA LOS DOS LADOS ═════════════════════════════════════════════════
 *
 * 🔴 En producción el mismo humano tiene DOS grafías vivas: Cerberus empuja
 * `Luz` a `numero_vendedora` y ella entra al login como `luz`. Comparar exacto
 * no da error: da que Luz **no reconoce sus propias conversaciones** y se queda
 * sin campanita para siempre, sin nada que investigar. Es la misma cicatriz de
 * `cola/asignadaSql.ts §esMiaSql`, `reparto/destino.ts §mismaVendedora` y
 * `espacios/visibilidad.ts`.
 */

/** Quién está escuchando el stream. Se arma UNA vez, en el handshake. */
export interface QuienEscucha {
  /** El `vendedoraId` del token. `undefined` en un request sin sesión de vendedora. */
  vendedoraId: string | undefined;
  /**
   * ¿Manda sobre el trabajo de las demás? Llega RESUELTO (`mandaEnElEquipo`),
   * igual que `veTodo` en `fronteraDeAsignacionSql`: acá no se lee el entorno ni
   * se consulta la tabla `equipo` — este archivo es una regla, no una puerta.
   */
  veTodo: boolean;
}

/** `Luz`, ` luz `, `LUZ` son la misma persona. Se aplica a los DOS lados, siempre. */
function normalizar(id: string | null | undefined): string {
  return (id ?? '').trim().toLowerCase();
}

/**
 * ¿Esta conversación es de quien escucha?
 *
 * Exportada para que el test pueda interrogarla sola, y porque nombrar la
 * pregunta es la mitad de la regla.
 */
export function esSuya(duena: string | null, quien: QuienEscucha): boolean {
  if (quien.veTodo) return true;
  const mia = normalizar(quien.vendedoraId);
  // Sin identidad no se afirma nada. Un `''` de los dos lados NO puede empatar:
  // eso convertiría un token de servicio en dueño de todo lo no atribuido.
  if (!mia) return false;
  return normalizar(duena) === mia;
}

/**
 * QUÉ SE LE MANDA A ESTA VENDEDORA — la única traducción de `EventoRT` a lo que
 * viaja por el cable.
 *
 * Nunca devuelve `null`: **el evento recortado igual se manda**. Callarlo del
 * todo dejaría la cola de quien no es dueña sin refrescar, y ese es justo el
 * caso en que una conversación sin dueña le tiene que aparecer — la frontera
 * está en lo que se NOMBRA, no en lo que se avisa.
 */
export function eventoPara(e: EventoRT, quien: QuienEscucha): EventoPublico {
  // Un cambio de estado (sesión arriba/abajo, lead de landing) no identifica a
  // nadie: no lleva teléfono, ni clave, ni nombre. Sale tal cual.
  if (e.tipo === 'estado') return { tipo: 'estado' };

  // Sin teléfono no hay nada que proteger: es el «refrescá la pantalla» pelado
  // de los ✓✓ (`whatsapp/wiring.ts`, que lo manda `null` explícitamente).
  if (e.telefono && esSuya(e.duena, quien)) {
    return { tipo: 'mensaje', canal: e.canal, telefono: e.telefono, direccion: e.direccion };
  }

  return { tipo: 'mensaje', canal: e.canal };
}
