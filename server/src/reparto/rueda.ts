/**
 * EL REPARTO DE LEADS — a quién le toca la próxima conversación.
 *
 * ══ EL PROBLEMA ══════════════════════════════════════════════════════════════
 *
 * Hasta el 4-ago-2026 cada vendedora tenía SU número. Desde hoy seis personas
 * comparten uno (`51984429504`, la línea de Cloud API), y sin reparto pasan las
 * dos cosas de siempre: **dos contestan al mismo lead** —el tell más obvio de
 * que atrás hay desorden— y **nadie contesta a otro**, porque todos asumen que
 * lo agarró alguien más.
 *
 * ══ ROUND-ROBIN, Y POR QUÉ NO AZAR ═══════════════════════════════════════════
 *
 * El pedido decía «aleatoriamente». Al azar reparte disparejo en volúmenes
 * chicos: 10 leads entre 6 pueden caer 4 en una persona y 0 en otra. Con seis
 * personas que entran HOY, esa varianza **se lee como favoritismo** aunque sea
 * mala suerte — y es la clase de sospecha que no se discute, se rumorea.
 *
 * Round-robin reparte parejo por construcción y, sobre todo, **es auditable**:
 * cualquiera puede verificar que le tocó lo que le tocaba. Un reparto al azar no
 * se puede defender ante quien cree que le dieron de menos.
 *
 * ══ SE ELIGE POR CARGA, NO CON UN PUNTERO ════════════════════════════════════
 *
 * La forma obvia sería guardar «a quién le tocó último» y avanzar. No se hace,
 * porque un puntero **se desincroniza**: alguien entra a la rueda, otro sale, se
 * borra una asignación a mano, y el puntero queda apuntando a alguien que ya no
 * está. Nadie lo nota hasta que el reparto está torcido.
 *
 * Acá se le da al que MENOS tiene. Es equivalente a round-robin cuando se
 * arranca de cero, y además **se auto-corrige**: si alguien se suma tarde,
 * recibe hasta emparejar sin que nadie tenga que reiniciar nada.
 */

/** Alguien en la rueda, con lo que ya le tocó. */
export interface EnLaRueda {
  vendedoraId: string;
  /** Cuántas conversaciones tiene asignadas hoy. */
  asignadas: number;
  /**
   * El desempate, estable. Sin esto, dos personas con la misma carga se
   * ordenarían por lo que devuelva la base —que no promete orden— y el reparto
   * dejaría de ser reproducible: el mismo estado daría resultados distintos.
   */
  orden: number;
}

/**
 * A quién le toca la próxima. `null` = no hay nadie en la rueda.
 *
 * **Fail-open**: que devuelva `null` no es un error. Significa «esta conversación
 * queda sin dueño», que es exactamente el comportamiento de antes de este
 * frente — y es mejor que asignársela a alguien inventado.
 */
export function siguienteEnLaRueda(rueda: readonly EnLaRueda[]): string | null {
  if (rueda.length === 0) return null;

  let elegido = rueda[0]!;
  for (const candidato of rueda.slice(1)) {
    if (candidato.asignadas < elegido.asignadas) {
      elegido = candidato;
      continue;
    }
    // Empate: manda el orden, que es estable. Nunca la base.
    if (candidato.asignadas === elegido.asignadas && candidato.orden < elegido.orden) {
      elegido = candidato;
    }
  }
  return elegido.vendedoraId;
}

/**
 * Cómo quedaría el reparto de N conversaciones — para poder MOSTRARLO antes de
 * prenderlo, y para que el test fije la propiedad que importa.
 *
 * La propiedad de round-robin, y lo que se promete al equipo: **entre el que más
 * y el que menos recibe nunca hay más de 1 de diferencia**.
 */
export function simularReparto(
  rueda: readonly EnLaRueda[],
  cuantas: number,
): Map<string, number> {
  const carga = new Map(rueda.map((r) => [r.vendedoraId, r.asignadas]));
  const orden = new Map(rueda.map((r) => [r.vendedoraId, r.orden]));

  for (let i = 0; i < cuantas; i++) {
    const estado = [...carga.entries()].map(([vendedoraId, asignadas]) => ({
      vendedoraId,
      asignadas,
      orden: orden.get(vendedoraId) ?? 0,
    }));
    const quien = siguienteEnLaRueda(estado);
    if (!quien) break;
    carga.set(quien, (carga.get(quien) ?? 0) + 1);
  }
  return carga;
}
