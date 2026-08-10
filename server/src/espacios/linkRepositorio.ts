import { eq } from "drizzle-orm";
import type { db as DbSingleton } from "../db/client.js";
import { notaLink, notas } from "../db/schema.js";
import { type LinkPublico, nuevoToken, pareceToken } from "./link.js";
import { puedeEditar, type QuienPregunta } from "./visibilidad.js";

/**
 * EL LINK PÚBLICO, CONTRA LA BASE (ADR 0047). Las reglas puras viven en
 * `link.ts`; acá el IO, con `db` inyectado como todo seam de esta casa.
 */

/**
 * LEER UNA PÁGINA POR SU TOKEN — **la única función de todo el repo que sirve
 * contenido sin preguntar quién es quien pregunta.**
 *
 * Por eso hace exactamente tres cosas y ninguna más:
 *
 * 1. **Descarta lo que no tiene forma de token antes de tocar la base.** Sin esto,
 *    `/n/<cualquier cosa>` es una consulta gratis por request desde afuera del
 *    perímetro.
 * 2. **Devuelve `null` para todo lo que no sea un acierto exacto** — token que no
 *    existe, página archivada, o link cortado. Los tres casos se ven igual desde
 *    afuera a propósito: distinguirlos le diría a un desconocido si un token
 *    *existió*, que es justo lo que no tiene por qué saber.
 * 3. **Proyecta SOLO texto y doc.** No sale la autora, ni el espacio, ni las
 *    fechas, ni el id. Ver `LinkPublico`.
 *
 * ⚠️ **Una página archivada deja de servirse por el link**, y eso no es un extra:
 * archivar es lo más parecido a «sacala de circulación» que tiene la Libreta, y si
 * el link sobreviviera, archivar dejaría de significar eso justo para el público
 * más amplio que la página tuvo.
 */
export async function leerPorToken(base: typeof DbSingleton, token: string): Promise<LinkPublico | null> {
  if (!pareceToken(token)) return null;

  const [fila] = await base
    .select({ texto: notas.texto, doc: notas.doc, archivadoAt: notas.archivadoAt })
    .from(notaLink)
    .innerJoin(notas, eq(notas.id, notaLink.notaId))
    .where(eq(notaLink.token, token));

  if (!fila || fila.archivadoAt) return null;

  const titulo = fila.texto.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";
  return { titulo, texto: fila.texto, doc: fila.doc };
}

export type ResultadoLink =
  | { ok: true; token: string | null }
  | { ok: false; motivo: "no-encontrada" | "prohibido" };

/** ¿Esta página ya tiene link? `null` = no tiene. */
export async function linkDe(base: typeof DbSingleton, notaId: number): Promise<string | null> {
  const [fila] = await base.select({ token: notaLink.token }).from(notaLink).where(eq(notaLink.notaId, notaId));
  return fila?.token ?? null;
}

/**
 * ABRIR el link de una página. **Idempotente**: si ya tiene, devuelve el que
 * tiene y no crea otro.
 *
 * Es lo que hace segura la pantalla: dos clics en «Crear link» no reparten dos
 * URLs distintas de lo mismo —lo que dejaría una viva después de cortar la otra—,
 * y el botón no necesita saber si ya existía.
 *
 * **Quien puede editar la página puede abrirle el link**, que en un espacio es
 * cualquier miembro. Reservarlo a la autora dejaría una página del equipo que solo
 * una persona puede compartir.
 */
export async function abrirLink(
  base: typeof DbSingleton,
  opciones: { notaId: number; quien: QuienPregunta },
): Promise<ResultadoLink> {
  const [pagina] = await base
    .select({ vendedoraId: notas.vendedoraId, espacioId: notas.espacioId, archivadoAt: notas.archivadoAt })
    .from(notas)
    .where(eq(notas.id, opciones.notaId));

  if (!pagina || pagina.archivadoAt) return { ok: false, motivo: "no-encontrada" };
  if (!puedeEditar(pagina, opciones.quien)) return { ok: false, motivo: "prohibido" };

  const yaTiene = await linkDe(base, opciones.notaId);
  if (yaTiene) return { ok: true, token: yaTiene };

  const token = nuevoToken();
  await base.insert(notaLink).values({ token, notaId: opciones.notaId, creadoPor: opciones.quien.vendedoraId });
  return { ok: true, token };
}

/**
 * CORTAR el link. **Borra la fila** — no marca un flag (ver `db/links.ts`).
 *
 * Idempotente: cortar algo que no tiene link es `ok` con `token: null`. La
 * vendedora que aprieta «Cortar» dos veces no puede recibir un error, porque el
 * estado que quería ya es el que hay.
 */
export async function cortarLink(
  base: typeof DbSingleton,
  opciones: { notaId: number; quien: QuienPregunta },
): Promise<ResultadoLink> {
  const [pagina] = await base
    .select({ vendedoraId: notas.vendedoraId, espacioId: notas.espacioId })
    .from(notas)
    .where(eq(notas.id, opciones.notaId));

  // ⚠️ Acá NO se exige que la página esté viva: si se archivó con el link
  // abierto, cortarlo tiene que seguir siendo posible. Lo contrario dejaría filas
  // imposibles de limpiar por el camino más fácil de llegar a ellas.
  if (!pagina) return { ok: false, motivo: "no-encontrada" };
  if (!puedeEditar(pagina, opciones.quien)) return { ok: false, motivo: "prohibido" };

  await base.delete(notaLink).where(eq(notaLink.notaId, opciones.notaId));
  return { ok: true, token: null };
}
