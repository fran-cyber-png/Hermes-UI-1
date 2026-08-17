import { asc, eq } from "drizzle-orm";
import type { db as DbSingleton } from "../db/client.js";
import { notaLinkEvento } from "../db/links.js";
import type { Alcance, Permiso } from "./linkModelo.js";
import type { AnotacionDeLink, EventoAnotado, EventoDeLink, MotivoDeCorte } from "./auditoriaLink.js";

/**
 * EL REGISTRO DE AUDITORÍA DE LOS LINKS, CONTRA LA BASE. Las reglas puras (el
 * vocabulario, el resumen, los filtros) viven en `auditoriaLink.ts`.
 *
 * ══ 🔴 ANOTAR NUNCA PUEDE TUMBAR LO QUE ESTÁ ANOTANDO ═══════════════════════
 *
 * Cada `anotar()` cuelga de una acción que ya pasó: el link ya se creó, la página
 * ya se sirvió, el corte ya se hizo. Si la escritura del registro fallara hacia
 * afuera, un problema de la tabla de auditoría se convertiría en un link que no se
 * puede crear o —peor— en una página compartida que deja de abrir. **Lo que se
 * pierde cuando esto falla es una línea del registro; lo que no se puede perder es
 * la acción.** Por eso traga el error y lo dice por log.
 *
 * ⚠️ **La asimetría con la lectura es deliberada.** `historialDe` NO degrada a una
 * lista vacía en silencio: devuelve `sinTabla` y la pantalla lo dice. En una
 * superficie de auditoría, «no pasó nada» y «no te lo puedo contar» son respuestas
 * opuestas, y mostrar la primera cuando la verdad es la segunda es la única forma
 * de que este frente sea peor que no existir. Es el mismo criterio del catálogo de
 * piezas (ADR 0023) y de la cascada de roles (ADR sobre `equipo/cascada.ts`).
 */

/** 42P01 = `undefined_table`. Falta la migración `0029`. */
function faltaLaTabla(e: unknown): boolean {
  return (e as { code?: string })?.code === "42P01";
}

/**
 * ANOTAR que algo le pasó a un link. **Nunca lanza.**
 *
 * Devuelve qué hizo para que el llamador pueda decidir —hoy nadie lo mira, y está
 * bien: es información para un test y para un log, no para una rama de negocio.
 */
export async function anotar(
  base: typeof DbSingleton,
  anotacion: AnotacionDeLink,
): Promise<"anotado" | "sin_tabla" | "fallo"> {
  try {
    await base.insert(notaLinkEvento).values({
      notaId: anotacion.notaId,
      etiqueta: anotacion.etiqueta,
      evento: anotacion.evento,
      quien: anotacion.quien,
      alcance: anotacion.alcance ?? null,
      permiso: anotacion.permiso ?? null,
      venceAt: anotacion.venceAt ?? null,
      motivo: anotacion.motivo ?? null,
      at: anotacion.at,
    });
    return "anotado";
  } catch (e) {
    if (faltaLaTabla(e)) return "sin_tabla";
    // Se dice, y se dice con la causa: `err.message` de drizzle imprime el SQL,
    // no el motivo (ver CLAUDE.md §Gotchas).
    console.error("[auditoria-link] no se pudo anotar el evento", {
      evento: anotacion.evento,
      notaId: anotacion.notaId,
      causa: (e as { cause?: unknown })?.cause ?? e,
    });
    return "fallo";
  }
}

/**
 * ANOTAR VARIOS CORTES DE UNA — lo que necesitan sacar a un miembro y archivar un
 * espacio, que cortan N links en una transacción (ADR 0048).
 *
 * ⚠️ Va **después** de la transacción del corte y no adentro: si el insert del
 * registro se hiciera dentro, un fallo suyo revertiría el corte, y quedaría una
 * puerta abierta al mundo porque no se pudo escribir una línea de auditoría. El
 * corte manda; el registro acompaña.
 */
export async function anotarCortes(
  base: typeof DbSingleton,
  cortes: { notaId: number; etiqueta: string }[],
  contexto: { quien: string | null; motivo: MotivoDeCorte; at: Date },
): Promise<void> {
  for (const corte of cortes) {
    await anotar(base, {
      notaId: corte.notaId,
      etiqueta: corte.etiqueta,
      evento: "cortado",
      quien: contexto.quien,
      motivo: contexto.motivo,
      at: contexto.at,
    });
  }
}

export interface Historial {
  eventos: EventoAnotado[];
  /**
   * 🔴 `true` = **no se pudo saber**, y la pantalla TIENE que decirlo. Sin este
   * campo, una migración sin aplicar se ve idéntica a un link que nadie abrió
   * nunca — y en un registro de auditoría esa confusión es el peor resultado
   * posible: se concluye que no pasó nada.
   */
  sinTabla: boolean;
}

/**
 * EL HISTORIAL DE UNA PÁGINA, del más viejo al más nuevo.
 *
 * Ordenado ASC porque el resumen lo lee así (el `creado` es el primero) y porque
 * darlo vuelta para la pantalla es una línea; al revés, `resumirLink` tendría que
 * saber en qué orden le llegan las cosas.
 *
 * ⚠️ **Sin tope de filas, a propósito y con su límite anotado**: el historial de
 * UNA página con un link que se abrió unas decenas de veces son unas decenas de
 * filas. El día que un link de la Libreta se pegue en un grupo grande y esto pase
 * a miles, lo que corresponde es paginar acá —no en el navegador— y el síntoma va
 * a ser que el modal tarda en abrir.
 */
export async function historialDe(base: typeof DbSingleton, notaId: number): Promise<Historial> {
  try {
    const filas = await base
      .select()
      .from(notaLinkEvento)
      .where(eq(notaLinkEvento.notaId, notaId))
      .orderBy(asc(notaLinkEvento.at), asc(notaLinkEvento.id));

    return {
      sinTabla: false,
      eventos: filas.map((f) => ({
        id: f.id,
        notaId: f.notaId,
        etiqueta: f.etiqueta,
        // El `evento` y el `motivo` viajan tal cual: son `text` en la base, y un
        // valor que esta versión no conoce (un server nuevo, un dato sembrado a
        // mano) tiene que poder LEERSE. Quien lo pinta decide qué hacer con lo
        // desconocido — y cae en una frase honesta, nunca en un throw.
        evento: f.evento as EventoDeLink,
        quien: f.quien,
        alcance: f.alcance as Alcance | null,
        permiso: f.permiso as Permiso | null,
        venceAt: f.venceAt,
        motivo: f.motivo as MotivoDeCorte | null,
        at: f.at,
      })),
    };
  } catch (e) {
    if (faltaLaTabla(e)) return { eventos: [], sinTabla: true };
    throw e;
  }
}
