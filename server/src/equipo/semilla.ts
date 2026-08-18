import { supervisoresConfigurados } from "../padron/supervisor.js";
import type { PersonaASembrar } from "./repositorio.js";
import { ORDEN, clavePersona } from "./roles.js";

/**
 * EL EQUIPO CON EL QUE NACE LA TABLA.
 *
 * ══ 🔴 ESTA LISTA SALE DE LA BASE, NO DE LA CABEZA DE NADIE ══════════════════
 *
 * La primera versión del análisis nombraba a cinco personas; el censo contra la
 * base encontró **once**, y la que faltaba —`Tracy`— está activa en la rueda,
 * con 10 conversaciones asignadas y la última del mismo día. Sembrar la lista
 * imaginada la habría dejado sin fila, o sea sin rol, o sea con el default.
 *
 * Por eso la lista de acá es el resultado de una MEDICIÓN (15-ago-2026:
 * `luz` 2.355 asignadas · `Sindy` 192 · `ventas12@` 11 · `ventas11@` 11 ·
 * `ventas10@` 10 · `Tracy` 10 · `ventas13@` 1 · `ventas14@` 1, más `usuario1`,
 * `usuario2` y `alan`), y por eso existe `npm run equipo:sembrar`: vuelve a
 * hacer el censo contra la base viva y **dice quién apareció que acá no está**.
 * Una lista escrita a mano envejece sin avisar; una que se puede volver a medir,
 * no.
 *
 * ══ LAS TRES CADENAS DE SERVICIO NO SON PERSONAS ═════════════════════════════
 *
 * `campana` (2.554 envíos), `goberna-admin` (325) y `bot` (261) aparecen en las
 * columnas `vendedora_id` de media base y **no van al equipo**: no se loguean, no
 * tienen cola y darles rol sería inventarles un humano detrás. Lo mismo con todo
 * lo que empiece con `centurion:` — la exclusión va **por prefijo**, no por
 * nombre, porque ahí cada candidatura genera su propia cadena.
 *
 * ══ LAS GRAFÍAS PARTIDAS SON TRES ════════════════════════════════════════════
 *
 * `luz`/`Luz`, `usuario1`/`Usuario1` y `usuario2`/`Usuario2`. **`alan` tiene una
 * sola** — el `alan`/`Alan` que el análisis previo daba por hecho no está en la
 * base. Las demás se anotan como se las vio; el censo del script es el que manda.
 */

/** Las cadenas que NO son personas. `centurion:` se excluye por PREFIJO. */
export const CADENAS_DE_SERVICIO = ["campana", "goberna-admin", "bot"] as const;
export const PREFIJOS_DE_SERVICIO = ["centurion:"] as const;

/** ¿Este `vendedora_id` es una cadena de servicio y no un humano? */
export function esCadenaDeServicio(crudo: string): boolean {
  const id = clavePersona(crudo);
  if (!id) return true;
  if ((CADENAS_DE_SERVICIO as readonly string[]).includes(id)) return true;
  return PREFIJOS_DE_SERVICIO.some((p) => id.startsWith(p));
}

/**
 * ⚠️ **`ventas10@grupogoberna.com` NO ESTÁ EN ESTA LISTA, Y ES A PROPÓSITO.**
 *
 * Qué rol le toca es la pregunta P3 del plan, **sin decidir**: está en
 * `HERMES_SUPERVISORES` y tiene 0 envíos en 30 días. Sin fila, la cascada cae al
 * CSV y esa cuenta conserva **exactamente** lo que tiene hoy; con una fila
 * `vendedora` le sacaríamos el padrón y las campañas sin que nadie lo pidiera, y
 * el síntoma sería un 403 el día que quiera armar una campaña. La siembra no
 * decide lo que el dueño no decidió.
 */
export const EQUIPO_SEMILLA: readonly PersonaASembrar[] = [
  // Los DOS admin (decisión D6). No es uno: con un solo admin, degradarlo o
  // desactivarlo por error deja al equipo sin nadie que pueda arreglarlo.
  { personaId: "usuario1", nombre: "Usuario1", rol: "admin", grafias: ["usuario1", "Usuario1"] },
  { personaId: "alan", nombre: "Alan", rol: "admin", grafias: ["alan"] },

  // Las vendedoras con trabajo medido encima.
  { personaId: "luz", nombre: "Luz", rol: "vendedora", grafias: ["luz", "Luz"] },
  // D7: `usuario2` NO es solo campaña — atiende también la Escuela.
  { personaId: "usuario2", nombre: "Usuario2", rol: "vendedora", grafias: ["usuario2", "Usuario2"] },
  { personaId: "sindy", nombre: "Sindy", rol: "vendedora", grafias: ["Sindy"] },
  // P1: activa en la rueda y sin línea. Que siga trabajando es una decisión de
  // operación; que TENGA fila no lo es — sin ella no tendría rol.
  { personaId: "tracy", nombre: "Tracy", rol: "vendedora", grafias: ["Tracy"] },

  // La rueda del reparto (`ventas1X@`), con su grafía completa: el username de
  // Cerberus ES el correo entero.
  ...(["11", "12", "13", "14"] as const).map((n) => ({
    personaId: `ventas${n}@grupogoberna.com`,
    nombre: `ventas${n}@grupogoberna.com`,
    rol: "vendedora" as const,
    grafias: [`ventas${n}@grupogoberna.com`],
  })),
];

export interface SemillaRevisada {
  /** Lo que se puede sembrar sin quitarle poder a nadie. */
  aSembrar: readonly PersonaASembrar[];
  /**
   * Quiénes están HOY en `HERMES_SUPERVISORES` y la semilla los sembraría con un
   * rol más bajo. No se siembran: se nombran.
   */
  degradarian: readonly string[];
}

/**
 * 🔴 LA SIEMBRA NO LE PUEDE SACAR PODER A NADIE EN SILENCIO.
 *
 * Una fila `activa` **gana sobre el CSV** —tiene que ganar, o dar de baja a
 * alguien desde el panel sería decorativo—, así que sembrar a una persona como
 * `vendedora` mientras está en `HERMES_SUPERVISORES` le saca el padrón, «El
 * negocio» y las campañas **en el próximo restart**, sin un error y sin un log
 * que alguien vaya a mirar. Y el `.env` de VPS1 no se puede leer desde acá: esta
 * lista se escribió sin verlo.
 *
 * Así que la comprobación se hace en tiempo de arranque, contra el entorno real:
 * quien quede por debajo de lo que el CSV le da hoy **no se siembra** y se
 * nombra. Perder la fila es reversible desde el panel; perder el permiso sin
 * enterarse, no.
 */
export function revisarSemilla(
  semilla: readonly PersonaASembrar[],
  env: NodeJS.ProcessEnv,
): SemillaRevisada {
  const enElCsv = new Set(supervisoresConfigurados(env).map(clavePersona));
  const aSembrar: PersonaASembrar[] = [];
  const degradarian: string[] = [];
  for (const p of semilla) {
    const id = clavePersona(p.personaId);
    if (enElCsv.has(id) && ORDEN[p.rol] < ORDEN.supervisor) degradarian.push(id);
    else aSembrar.push(p);
  }
  return { aSembrar, degradarian };
}
