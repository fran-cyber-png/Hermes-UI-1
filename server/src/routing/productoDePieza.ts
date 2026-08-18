import { eq, isNull, sql } from "drizzle-orm";
import type { db as Base } from "../db/client.js";
import { aliasCurso } from "../db/schema.js";
import { campanaMeta } from "../db/routing.js";
import { productoLeadSql } from "../dashboard/fuenteLead.js";
import { normalizarTexto } from "../cursos/alias.js";
import { familiaDeSku } from "../cursos/catalogo.js";
import type { ProductoCatalogo } from "../cerberus/productos.js";

/**
 * CORREGIR A QUÉ PRODUCTO PERTENECE UNA PIEZA — «este formulario no es del
 * Consultor Político, es del ChatGPT Pro».
 *
 * ══ EL AGUJERO QUE TAPA, MEDIDO EL 18-AGO-2026 EN PRODUCCIÓN ═════════════════
 *
 * El producto de una pieza se INFIERE de sus palabras, y la inferencia se
 * equivoca de las dos formas posibles:
 *
 *   · **enlaza a lo que no es** — «Programa Premium ChatGPT Pro para consultoría
 *     política 4×4» cae en el Consultor Político porque el alias dice
 *     «consultoria politica»; «Master Agente de Inteligencia Artificial» cae en
 *     Inteligencia y Contrainteligencia por la palabra «inteligencia». Son 4 de
 *     los 22 cursos de formulario.
 *   · **no enlaza nada** — 70 de las 153 campañas, después de que el SKU
 *     resolviera 23.
 *
 * Y ninguna de las dos se arregla tocando el diccionario a la bruta: sacar
 * «consultoria politica» rompe las **trece** campañas del Consultor Político que
 * dependen de ese alias. La corrección tiene que ser **de esa pieza**.
 *
 * ══ 🔴 QUÉ SE ESCRIBE: UNA FILA DE `alias_curso` CON EL TEXTO ENTERO ═════════
 *
 * Ver `decididoAMano` en `cursos/alias.ts`: un alias que es exactamente el
 * nombre de la pieza no puede matchear ninguna otra cosa, gana por la regla de
 * especificidad que ya existía, y le gana al SKU por precedencia explícita. Sin
 * tabla nueva, sin migración y sin un segundo lugar donde diga de qué producto
 * es cada cosa.
 *
 * ⚠️ **Y por eso corregir acá corrige en TODAS las pantallas** — el chip de curso
 * de la cola, el Dashboard y el bot leen ese mismo diccionario. Es la decisión
 * del dueño del 18-ago-2026, tomada sabiendo el alcance: la alternativa era una
 * tabla propia de Routing y dos pantallas afirmando cosas distintas del mismo
 * lead (#37).
 */

/** Qué se puede corregir. El `curso` de un formulario y la campaña de Meta. */
export type TipoDePieza = "campana" | "curso";

export type CodigoCorreccion =
  /** La clave no corresponde a ninguna pieza conocida. */
  | "pieza_desconocida"
  /** La familia no existe: ni en el diccionario ni en el catálogo de Cerberus. */
  | "familia_desconocida"
  /** Es una familia que Hermes no conoce y Cerberus no contestó para confirmarla. */
  | "catalogo_caido";

export type ResultadoCorreccion =
  | { ok: true; texto: string; familia: string | null; nombreCurso: string | null }
  | { ok: false; codigo: CodigoCorreccion; message: string; familias?: string[] };

/**
 * 🔴 EL TEXTO DE LA PIEZA LO RESUELVE EL SERVER, NUNCA VIAJA DESDE EL NAVEGADOR.
 *
 * La pantalla tiene el nombre en pantalla y podría mandarlo — y sería el defecto
 * de siempre: el alias se guarda comparando **texto exacto normalizado**, así
 * que un solo carácter de diferencia (un `×` por una `x`, un espacio doble, una
 * tilde que el navegador normalizó distinto) escribe una fila que **no matchea
 * la pieza**. El `PUT` contestaría `ok`, la pantalla mostraría el producto nuevo
 * y la regla no se aplicaría nunca.
 *
 * Es exactamente la forma del defecto que la auditoría del 12-ago encontró en
 * este mismo frente (se cableaba con una expresión del curso y se matcheaba con
 * otra) y la razón por la que la cita de ADR 0054 manda solo el id.
 */
export async function textoDeLaPieza(
  base: typeof Base,
  tipo: TipoDePieza,
  clave: string,
): Promise<string | null> {
  const limpia = clave.trim();
  if (!limpia) return null;

  if (tipo === "campana") {
    const [fila] = await base
      .select({ nombre: campanaMeta.nombre })
      .from(campanaMeta)
      .where(eq(campanaMeta.campanaId, limpia));
    return fila?.nombre ?? null;
  }

  /**
   * Para un curso la clave ES el texto, pero se confirma contra `leads` con
   * `productoLeadSql` — el MISMO fragmento con el que se lista y con el que la
   * cola matchea el cable. Un curso que no existe en la base no se puede
   * corregir: sería escribir un alias para una pieza que nadie ve.
   */
  const [fila] = await base.execute<{ curso: string }>(sql`
    SELECT ${productoLeadSql} AS curso
      FROM leads
     WHERE ${productoLeadSql} = ${limpia}
     LIMIT 1
  `);
  return fila?.curso ?? null;
}

/**
 * LAS FAMILIAS A LAS QUE SE PUEDE MANDAR UNA PIEZA, con su nombre legible.
 *
 * Sale de dos lados y **el orden importa poco pero la unión importa mucho**:
 *
 *   · **el diccionario** (`alias_curso`) — las 21 familias que ya tienen nombre
 *     cargado. Están siempre, aunque Cerberus no conteste.
 *   · **el catálogo vivo de Cerberus** — las demás. Es lo que permite mandar una
 *     pieza a un producto que todavía no tiene ni un alias (`EPCOGPT`,
 *     `DIPECOC`…), que es justo el caso de los cuatro formularios mal enlazados.
 *
 * ⚠️ **Degrada, no tumba**: con Cerberus caído se ofrecen las conocidas y se
 * dice que la lista está corta. Una pantalla de configuración que no abre porque
 * el ERP está lento es peor que una lista incompleta que lo avisa.
 */
export interface FamiliaElegible {
  familia: string;
  nombre: string;
  /** `true` si ya tiene aliases cargados: es un producto que Hermes sabe nombrar. */
  conocida: boolean;
}

export async function familiasElegibles(
  base: typeof Base,
  catalogo: () => Promise<ProductoCatalogo[]>,
): Promise<{ familias: FamiliaElegible[]; catalogoCaido: boolean }> {
  const delDiccionario = await base
    .select({ familia: aliasCurso.familia, nombreCurso: aliasCurso.nombreCurso })
    .from(aliasCurso)
    .where(eq(aliasCurso.activo, true));

  const por = new Map<string, FamiliaElegible>();
  for (const f of delDiccionario) {
    if (!por.has(f.familia)) por.set(f.familia, { familia: f.familia, nombre: f.nombreCurso, conocida: true });
  }

  let catalogoCaido = false;
  try {
    for (const p of await catalogo()) {
      const familia = familiaDeSku(p.sku);
      if (!familia || por.has(familia)) continue;
      por.set(familia, { familia, nombre: p.nombre, conocida: false });
    }
  } catch {
    // La lista queda con lo que Hermes ya sabe nombrar. Se avisa, no se rompe.
    catalogoCaido = true;
  }

  return {
    familias: [...por.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
    catalogoCaido,
  };
}

/**
 * DEJAR ESTA PIEZA EN ESTE PRODUCTO. `familia: null` **deshace** la corrección y
 * la pieza vuelve a resolverse sola.
 *
 * ⚠️ **Deshacer es `activo = false`, jamás un DELETE.** Un borrado pierde el
 * rastro de que alguien había decidido otra cosa, y encima la siembra de
 * `ALIAS_SEMILLA` podría volver a insertar la fila en el próximo arranque. Es la
 * política que la tabla ya documenta para sacar un alias de circulación.
 */
export async function corregirProductoDePieza(
  base: typeof Base,
  v: {
    tipo: TipoDePieza;
    clave: string;
    /** `null` = deshacer y volver al automático. */
    familia: string | null;
    quien: string;
    catalogo: () => Promise<ProductoCatalogo[]>;
  },
): Promise<ResultadoCorreccion> {
  const texto = await textoDeLaPieza(base, v.tipo, v.clave);
  if (!texto) {
    return {
      ok: false,
      codigo: "pieza_desconocida",
      message:
        v.tipo === "campana"
          ? "esa campaña no está en el catálogo de Meta que tiene Hermes (probá «Actualizar desde Meta»)"
          : "ningún formulario llegó con ese curso",
    };
  }

  if (v.familia === null) {
    await desactivarCorreccion(base, texto);
    return { ok: true, texto, familia: null, nombreCurso: null };
  }

  const pedida = v.familia.trim().toUpperCase();
  const { familias, catalogoCaido } = await familiasElegibles(base, v.catalogo);
  const elegida = familias.find((f) => f.familia.toUpperCase() === pedida);
  if (!elegida) {
    /**
     * ⚠️ **«No existe» y «no se pudo verificar» son dos respuestas distintas.**
     * Con Cerberus caído, la lista solo trae las familias que Hermes ya nombra:
     * decir «esa familia no existe» sobre un producto real mandaría a quien lo
     * lea a buscar el problema en el lugar equivocado.
     */
    if (catalogoCaido) {
      return {
        ok: false,
        codigo: "catalogo_caido",
        message: `«${pedida}» no está entre los productos que Hermes ya conoce, y Cerberus no contestó para confirmar que exista. Probá de nuevo en un rato.`,
      };
    }
    return {
      ok: false,
      codigo: "familia_desconocida",
      message: `«${pedida}» no es un producto del catálogo.`,
      familias: familias.map((f) => f.familia),
    };
  }

  await guardarCorreccion(base, texto, elegida, v.quien);
  return { ok: true, texto, familia: elegida.familia, nombreCurso: elegida.nombre };
}

/**
 * 🔴 UPSERT POR EL TEXTO NORMALIZADO, NO POR LA CADENA CRUDA.
 *
 * El `unique` de la tabla es sobre `alias` tal cual, pero el matcheo compara
 * NORMALIZADO: «ChatGPT Pro 4×4» y «chatgpt pro 4 4» son la misma pieza para
 * `decididoAMano` y dos filas distintas para el índice. Con dos filas, cuál gana
 * depende del orden en que Postgres las devuelva — o sea que corregir dos veces
 * la misma pieza a productos distintos dejaría un resultado al azar.
 *
 * Por eso se busca primero por texto normalizado y se ACTUALIZA la fila que ya
 * describía a esta pieza, en vez de insertar una segunda.
 *
 * ⚠️ Se reactiva (`activo = true`) además de pisar familia y nombre: corregir
 * después de haber deshecho tiene que volver a encender la misma fila.
 */
async function guardarCorreccion(
  base: typeof Base,
  texto: string,
  elegida: FamiliaElegible,
  quien: string,
): Promise<void> {
  const norm = normalizarTexto(texto);
  const existente = await filaDeEstaPieza(base, norm);

  if (existente) {
    await base
      .update(aliasCurso)
      .set({
        familia: elegida.familia,
        nombreCurso: elegida.nombre,
        activo: true,
        corregidoPor: quien,
        corregidoAt: new Date(),
      })
      .where(eq(aliasCurso.id, existente.id));
    return;
  }

  await base
    .insert(aliasCurso)
    .values({
      alias: texto,
      familia: elegida.familia,
      nombreCurso: elegida.nombre,
      activo: true,
      corregidoPor: quien,
      corregidoAt: new Date(),
    })
    // Dos supervisoras corrigiendo la misma pieza a la vez: la segunda actualiza
    // en vez de reventar por el unique. Gana la última, que es lo que se ve.
    .onConflictDoUpdate({
      target: aliasCurso.alias,
      set: {
        familia: elegida.familia,
        nombreCurso: elegida.nombre,
        activo: true,
        corregidoPor: quien,
        corregidoAt: new Date(),
      },
    });
}

async function desactivarCorreccion(base: typeof Base, texto: string): Promise<void> {
  const fila = await filaDeEstaPieza(base, normalizarTexto(texto));
  if (!fila) return;
  await base.update(aliasCurso).set({ activo: false }).where(eq(aliasCurso.id, fila.id));
  // `corregido_por` NO se borra: el rastro de quién había decidido qué sobrevive
  // a que se deshaga la decisión — es la mitad que sirve para preguntar por qué.
}

/**
 * La fila de `alias_curso` que describe a ESTA pieza: la que, normalizada, es
 * igual al texto entero. Es la misma pregunta que hace `decididoAMano` al leer.
 *
 * ⚠️ Se buscan también las inactivas: deshacer y volver a corregir tiene que
 * reencender la fila que ya existía, no crear una segunda que choque con el
 * `unique`.
 *
 * ⚠️ Y se excluyen las de `adId`, por lo mismo que `decididoAMano`: su `alias` es
 * una etiqueta humana y no describe a ninguna pieza.
 */
async function filaDeEstaPieza(
  base: typeof Base,
  textoNormalizado: string,
): Promise<{ id: number } | null> {
  const filas = await base
    .select({ id: aliasCurso.id, alias: aliasCurso.alias })
    .from(aliasCurso)
    .where(isNull(aliasCurso.adId));
  const encontrada = filas.find((f) => normalizarTexto(f.alias) === textoNormalizado);
  return encontrada ? { id: encontrada.id } : null;
}
