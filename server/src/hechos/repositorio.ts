import { asc, eq } from "drizzle-orm";
import type { db } from "../db/client.js";
import { hechos as tabla } from "../db/schema.js";
import { CATALOGO_POR_DEFECTO, type Hecho } from "./catalogo.js";
import type { MomentoDeVenta } from "../sugerencias/estado.js";

/**
 * EL CATÁLOGO VIVO, y su degradación honesta.
 *
 * La tabla `hechos` es la fuente de verdad; el catálogo medido de #153 es el
 * punto de partida. Tres situaciones, y ninguna deja el bloque vacío:
 *
 *   · **tabla con filas** → manda la tabla (alguien la editó: se respeta).
 *   · **tabla vacía** → el catálogo por defecto. Es lo que pasa el día uno,
 *     antes de sembrar: mejor la munición medida que un hueco.
 *   · **tabla que no existe** (falta el `db:push`) → el catálogo por defecto, y
 *     `editable: false` viaja al cliente para que la UI no ofrezca guardar algo
 *     que se va a perder. Degrada, no rompe — el patrón de la casa.
 */

export interface CatalogoDeHechos {
  hechos: Hecho[];
  /** `false` = la tabla no está: se está sirviendo el default, y no se puede editar. */
  editable: boolean;
  /** De dónde salió lo que se está sirviendo. Va al cliente para que lo pueda decir. */
  origen: "tabla" | "defecto" | "sin-tabla";
}

function normalizarMomentos(v: unknown): MomentoDeVenta[] {
  return Array.isArray(v) ? (v.filter((x) => typeof x === "string") as MomentoDeVenta[]) : [];
}

export async function leerCatalogo(base: typeof db): Promise<CatalogoDeHechos> {
  try {
    const filas = await base
      .select()
      .from(tabla)
      .where(eq(tabla.activo, true))
      .orderBy(asc(tabla.orden), asc(tabla.clave));

    if (filas.length === 0) {
      return { hechos: [...CATALOGO_POR_DEFECTO], editable: true, origen: "defecto" };
    }
    return {
      hechos: filas.map((f) => ({
        clave: f.clave,
        rotulo: f.rotulo,
        texto: f.texto,
        momentos: normalizarMomentos(f.momentos),
        orden: f.orden,
      })),
      editable: true,
      origen: "tabla",
    };
  } catch {
    // La tabla todavía no existe (falta el `db:push`). Se dice, no se finge.
    return { hechos: [...CATALOGO_POR_DEFECTO], editable: false, origen: "sin-tabla" };
  }
}

/**
 * EL CATÁLOGO PARA EDITARLO — el de arriba, más lo APAGADO.
 *
 * Función aparte y no un parámetro de `leerCatalogo` a propósito: aquella está
 * en el camino de la venta (el panel de la vendedora y el bot la llaman en cada
 * conversación) y no se le agrega una rama para servir a una pantalla de
 * mantenimiento. Acá el criterio es el contrario: se quiere ver TODO.
 *
 * Sin esto, apagar un dato lo volvía invisible para siempre —«borrar es apagar»
 * (`DELETE /api/hechos/:clave` escribe `activo = false`), pero `leerCatalogo`
 * filtra por `activo`, así que nada podía volver a prenderlo desde la app.
 *
 * Degrada igual que su gemela: sin tabla, el catálogo de fábrica y `editable:
 * false`. Ahí todo viaja como activo, porque el default no tiene apagados.
 */
export interface HechoEditable extends Hecho {
  activo: boolean;
}

export interface CatalogoParaEditar {
  hechos: HechoEditable[];
  editable: boolean;
  origen: "tabla" | "defecto" | "sin-tabla";
}

export async function leerCatalogoParaEditar(base: typeof db): Promise<CatalogoParaEditar> {
  try {
    const filas = await base.select().from(tabla).orderBy(asc(tabla.orden), asc(tabla.clave));

    if (filas.length === 0) {
      return {
        hechos: CATALOGO_POR_DEFECTO.map((h) => ({ ...h, activo: true })),
        editable: true,
        origen: "defecto",
      };
    }
    return {
      hechos: filas.map((f) => ({
        clave: f.clave,
        rotulo: f.rotulo,
        texto: f.texto,
        momentos: normalizarMomentos(f.momentos),
        orden: f.orden,
        activo: f.activo,
      })),
      editable: true,
      origen: "tabla",
    };
  } catch {
    return {
      hechos: CATALOGO_POR_DEFECTO.map((h) => ({ ...h, activo: true })),
      editable: false,
      origen: "sin-tabla",
    };
  }
}

/** Siembra el catálogo medido. Idempotente por `clave`: correrlo dos veces no duplica. */
export async function sembrarCatalogo(base: typeof db): Promise<number> {
  let n = 0;
  for (const h of CATALOGO_POR_DEFECTO) {
    await base
      .insert(tabla)
      .values({ clave: h.clave, rotulo: h.rotulo, texto: h.texto, momentos: h.momentos, orden: h.orden })
      .onConflictDoNothing({ target: tabla.clave });
    n++;
  }
  return n;
}
