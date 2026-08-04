import { VENDEDORA_ID_DEL_BOT } from "../bot/frenos.js";
import type { FilaPorVendedora } from "./porVendedora.js";

/**
 * QUIÉN ES UNA PERSONA EN EL CUADRO «EQUIPO» DEL DASHBOARD.
 *
 * ══ EL PROBLEMA ══════════════════════════════════════════════════════════
 *
 * El cuadro «Equipo» sale de un `DISTINCT vendedora_id` sobre `envios_wa` y
 * `conversiones_wa` (`dashboard/porVendedora.ts`), y esa columna **no guarda
 * solo personas**. Medido en VPS1 el 4-ago-2026:
 *
 *   goberna-admin  325 envíos   ← la sala de leads (docs/prompt-sala-de-leads.md)
 *   bot            212 envíos   ← el bot comercial
 *   Usuario1        78 envíos   ← persona
 *   alan             3 envíos   ← persona
 *
 * O sea que la pantalla que se lee como «cómo viene el equipo» ponía a dos
 * actores automáticos arriba de todo, con avatar de iniciales y ring de «vos»
 * disponible, y **537 de los 620 envíos de `envios_wa` no los mandó nadie**.
 * Quien mira esa lista para saber cómo va su gente estaba leyendo, sobre todo,
 * software.
 *
 * ══ POR QUÉ UNA LISTA DE ACTORES Y NO UN PADRÓN DE PERSONAS ══════════════
 *
 * Lo intuitivo es al revés: tener la lista de las vendedoras y quedarse con
 * ésas. **No hay ninguna tabla que la tenga completa y estable**, y las tres
 * candidatas fallan cada una por su lado:
 *
 *   · `numero_vendedora` (lo que empuja Cerberus) — no tiene a `alan` ni a
 *     `Usuario1`, que mandaron mensajes esta semana. Filtrar por acá los borra.
 *   · `reparto_rueda` — son solo las cinco de la línea del bot, por diseño.
 *   · `sesiones_cerberus` — los tiene, pero **se purga a los 14 días**
 *     (`cerberus/sesionStore.ts`). Un padrón que caduca haría desaparecer a
 *     `alan` del cuadro dos semanas después de su último login, sin un solo
 *     síntoma: exactamente la clase de fallo mudo contra la que este repo
 *     escribe tests.
 *
 * La lista de actores automáticos, en cambio, **la escribe Hermes mismo**: son
 * dos constantes de su propio código, no filas que alguien mantiene. Y falla
 * hacia el lado correcto — ante un id desconocido asume **persona**, así que
 * puede colarse un actor nuevo (se arregla agregándolo acá), pero **nunca
 * puede borrar del cuadro a una vendedora real**. Entre las dos formas de
 * equivocarse, ésta es la barata.
 *
 * ⚠️ **No es el mismo padrón que `reparto/destino.ts`** y no debe unificarse
 * con él. Aquél contesta «¿a quién se le puede pasar una conversación **de esta
 * línea**?» —y por eso es rueda + mapa, acotado y fail-closed—; éste contesta
 * «¿este id es un humano, en cualquier línea?». Son preguntas distintas con
 * respuestas distintas: `alan` no es destino válido en ninguna línea y sin
 * embargo es una persona que trabajó hoy.
 */

/**
 * Los `vendedora_id` con los que firma el SOFTWARE, no una persona.
 *
 *   · `bot` — el bot comercial (`bot/frenos.ts`, y el mismo id que ya usan
 *     `bot/reenganche.ts` y `bot/correrReenganche.ts` como `vendedora_id <> 'bot'`
 *     para separar «contestó una persona» de «contestó el bot»).
 *   · `goberna-admin` — la sala de leads. El id está elegido **a propósito**
 *     para no ser `bot` (`docs/prompt-sala-de-leads.md`: «atribuir siempre a un
 *     id distinto de `bot`, así se activa el freno»), lo cual tiene todo el
 *     sentido allá y es justo lo que lo disfrazó de vendedora acá.
 *
 * Si aparece un tercero, se agrega **acá y en ningún otro lado**.
 */
export const ACTORES_DE_SISTEMA: readonly string[] = [VENDEDORA_ID_DEL_BOT, "goberna-admin"];

/**
 * ¿Este `vendedora_id` es software?
 *
 * Normaliza los dos lados por lo de siempre: en producción el mismo actor puede
 * venir con otra grafía, y una comparación exacta lo dejaría pasar como persona
 * sin avisar (`reparto/destino.ts#mismaVendedora`, `cola/asignadaSql.ts`).
 */
export function esActorDeSistema(vendedoraId: string): boolean {
  const limpio = vendedoraId.trim().toLowerCase();
  if (!limpio) return false;
  return ACTORES_DE_SISTEMA.some((a) => a.toLowerCase() === limpio);
}

/**
 * Lo automático, agregado — el renglón al pie del cuadro.
 *
 * **Solo mensajes.** `conversaciones_*` es un `count(DISTINCT telefono)` por
 * vendedora, así que sumarlo entre dos actores cuenta dos veces a quien
 * atendieron los dos, y `ventas_*` de un actor de sistema es siempre 0 hoy.
 * Un número que no se puede sumar sin mentir no se suma: se omite.
 */
export interface Automaticos {
  mensajes_hoy: number;
  mensajes_7d: number;
  /** Quiénes son, para el `title`. Sin esto el renglón es un número sin dueño. */
  quienes: string[];
}

/**
 * Parte las filas en las dos cosas que el cuadro tiene que decir por separado.
 *
 * **Lo automático no se descarta, se aparta.** Borrarlo dejaría el cuadro
 * diciendo «el equipo mandó 83 mensajes» cuando salieron 620, y esa resta
 * invisible es peor que el ruido que vino a sacar — es el mismo argumento por
 * el que `comoVaElReparto` trae a las inactivas: una lectura cuyos números no
 * cierran no sirve para leer nada. Va como renglón, no como fila: el software
 * no es un miembro del equipo, pero sus mensajes sí salieron.
 *
 * Puro y sin base a propósito: la decisión es una comparación de strings, y el
 * SQL de `porVendedora.ts` es el mandado (mismo corte que `senales/cotizacion.ts`
 * frente a `consultarSenales.ts`).
 */
export function separarEquipo(filas: readonly FilaPorVendedora[]): {
  equipo: FilaPorVendedora[];
  automaticos: Automaticos | null;
} {
  const equipo: FilaPorVendedora[] = [];
  const deSistema: FilaPorVendedora[] = [];
  for (const f of filas) (esActorDeSistema(f.vendedora) ? deSistema : equipo).push(f);

  if (deSistema.length === 0) return { equipo, automaticos: null };

  const automaticos: Automaticos = {
    mensajes_hoy: deSistema.reduce((n, f) => n + f.mensajes_hoy, 0),
    mensajes_7d: deSistema.reduce((n, f) => n + f.mensajes_7d, 0),
    quienes: deSistema.map((f) => f.vendedora).sort((a, b) => a.localeCompare(b, "es")),
  };

  // Nada que contar todavía: `null` y no un renglón en cero. Un «0 automáticos»
  // es la misma clase de ruido que el chip del bot con conteo 0 (`cola/botSql.ts`).
  if (automaticos.mensajes_hoy === 0 && automaticos.mensajes_7d === 0) {
    return { equipo, automaticos: null };
  }
  return { equipo, automaticos };
}
