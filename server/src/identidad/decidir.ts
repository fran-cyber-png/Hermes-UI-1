/**
 * QUÉ SIGNIFICA ENLAZAR DOS CONTACTOS — la decisión, aparte de la base.
 *
 * El modelo es una ESTRELLA, no una lista de pares: enlazar A con B es hacer que las dos
 * identidades apunten a la misma `ontologia.personas`. Elegirlo así resuelve de una vez
 * tres cosas que si no habría que programar (y probar) una por una:
 *
 *   · **simetría** — no existe «A enlazada a B»; existen «A→P» y «B→P». Desde B se ve A
 *     porque comparten P, no porque se haya escrito una segunda arista.
 *   · **idempotencia** — enlazar dos veces lo mismo es un no-op: ya están las dos en P.
 *   · **ciclos** — no pueden existir. Un ciclo necesita aristas entre nodos del mismo tipo;
 *     acá las aristas van siempre identidad→persona. La forma del grafo lo prohíbe.
 *
 * Lo que sí hay que decidir a mano es el DESTINO de una fusión de dos grupos, y ahí la
 * regla es la misma que ya usa el poblador para su `clave_raiz`: gana el ancla más chica en
 * orden lexicográfico. Si el destino dependiera de en qué ficha estaba parada la vendedora,
 * dos caminos hasta el mismo grupo dejarían dos personas distintas en la base.
 */

/**
 * Techo de identidades por persona.
 *
 * `ontologia.identidades_bloqueadas` existe porque un `informes@` puede colapsar 300
 * personas en una sin que nadie se entere. Acá el mismo desastre entra por otra puerta:
 * clics repetidos sobre la ficha equivocada. Diez es holgado para el caso real (dos
 * números y dos redes) y corta el Frankenstein antes de que se arme.
 */
export const LIMITE_ENLACES = 10;

export type PersonaDelGrafo = { id: number; claveRaiz: string };

/** Un lado del enlace: su identidad y dónde está parada hoy en el grafo. */
export type LadoDelEnlace = {
  /** «tipo:valor» — la identidad de canal (`claveDeIdentidad`). */
  claveIdentidad: string;
  /** La persona a la que apunta HOY con un vínculo activo, o null si nunca se enlazó. */
  persona: PersonaDelGrafo | null;
  /** Cuántas identidades activas cuelgan de esa persona (0 si no tiene persona). */
  identidadesActivas: number;
};

export type DecisionEnlace =
  /** Ninguna tenía persona: se crea una, anclada en `claveRaiz`, y se le cuelgan las dos. */
  | { accion: "crear"; claveRaiz: string }
  /** Una ya tenía persona: la del `lado` indicado se le suma. */
  | { accion: "sumar"; persona: number; lado: "a" | "b" }
  /** Ya comparten persona: no se escribe nada. */
  | { accion: "ya_enlazadas"; persona: number }
  /** Dos grupos distintos: las identidades de `origen` se mudan a `destino`. */
  | { accion: "fusionar"; destino: number; origen: number }
  | { accion: "rechazar"; motivo: "misma_identidad" | "demasiadas_identidades" };

export function decidirEnlace(a: LadoDelEnlace, b: LadoDelEnlace): DecisionEnlace {
  // Enlazar a alguien consigo mismo no es un enlace: o es un clic de más, o son dos claves
  // del mismo humano (le escribió a dos números nuestros) que ya se ven juntas sin enlace.
  if (a.claveIdentidad === b.claveIdentidad) return { accion: "rechazar", motivo: "misma_identidad" };

  if (a.persona && b.persona) {
    if (a.persona.id === b.persona.id) return { accion: "ya_enlazadas", persona: a.persona.id };
    if (a.identidadesActivas + b.identidadesActivas > LIMITE_ENLACES)
      return { accion: "rechazar", motivo: "demasiadas_identidades" };
    // Gana el ancla más chica: determinista, no depende de desde qué ficha se enlazó.
    const [destino, origen] =
      a.persona.claveRaiz <= b.persona.claveRaiz ? [a.persona, b.persona] : [b.persona, a.persona];
    return { accion: "fusionar", destino: destino.id, origen: origen.id };
  }

  const conPersona = a.persona ? a : b.persona ? b : null;
  if (conPersona) {
    if (conPersona.identidadesActivas + 1 > LIMITE_ENLACES)
      return { accion: "rechazar", motivo: "demasiadas_identidades" };
    return { accion: "sumar", persona: conPersona.persona!.id, lado: conPersona === a ? "b" : "a" };
  }

  // Ninguna estaba en el grafo: nace la persona, anclada en la identidad más chica del par.
  const claveRaiz = a.claveIdentidad <= b.claveIdentidad ? a.claveIdentidad : b.claveIdentidad;
  return { accion: "crear", claveRaiz };
}
