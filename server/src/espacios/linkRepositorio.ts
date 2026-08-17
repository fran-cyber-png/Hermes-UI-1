import { eq } from "drizzle-orm";
import type { db as DbSingleton } from "../db/client.js";
import { notaLink } from "../db/links.js";
import { notas } from "../db/schema.js";
import { type LinkPublico, nuevoToken, pareceToken } from "./link.js";
import { type Alcance, type ConfiguracionDeLink, estaVigente, type Permiso } from "./linkModelo.js";
import { etiquetaDeToken } from "./auditoriaLink.js";
import { anotar } from "./auditoriaLinkRepositorio.js";
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
export async function leerPorToken(
  base: typeof DbSingleton,
  token: string,
  ahora: Date = new Date(),
  /**
   * QUIÉN LO ESTÁ ABRIENDO, para el registro de auditoría.
   *
   * 🔴 **Default `null`, y el default es el caso importante.** El llamador que no
   * sabe quién es (la ruta anónima `/n/<token>`) no tiene que acordarse de nada:
   * omite el parámetro y el registro anota una apertura sin identidad, que es la
   * verdad. El único que lo pasa es `/api/notas/por-link`, donde hay Bearer. Al
   * revés —un default que asumiera identidad— el registro le atribuiría a alguien
   * las aperturas de desconocidos.
   */
  quien: string | null = null,
): Promise<LinkPublico | null> {
  if (!pareceToken(token)) return null;

  const [fila] = await base
    .select({
      notaId: notas.id,
      texto: notas.texto,
      doc: notas.doc,
      archivadoAt: notas.archivadoAt,
      alcance: notaLink.alcance,
      permiso: notaLink.permiso,
      venceAt: notaLink.venceAt,
    })
    .from(notaLink)
    .innerJoin(notas, eq(notas.id, notaLink.notaId))
    .where(eq(notaLink.token, token));

  if (!fila || fila.archivadoAt) return null;
  // ⚠️ Vencido se ve igual que inexistente desde afuera: decir «esto venció» le
  // confirma a un desconocido que el token existió alguna vez.
  if (!estaVigente({ venceAt: fila.venceAt }, ahora)) return null;

  // «Se abrió» se anota SIN esperar: la respuesta no puede depender de que este
  // UPDATE termine, y si falla, lo que se pierde es un dato de higiene — no la
  // página. Un `catch` vacío acá es correcto y por eso se dice.
  void base
    .update(notaLink)
    .set({ ultimoAccesoAt: ahora })
    .where(eq(notaLink.token, token))
    .catch(() => {});

  // Y la apertura entra al REGISTRO, con la misma política: sin `await`, y sin
  // poder tumbar la lectura (`anotar` nunca lanza).
  //
  // ⚠️ **`ultimo_acceso_at` no se retira aunque el registro lo pueda derivar.**
  // Es lo único que sobrevive a que falte la migración `0029`, y lo lee la lista
  // de páginas sin pagar una consulta más. Que dos lugares tengan la última
  // apertura es aceptable acá —y no es #37— porque **el registro no la reescribe
  // nunca**: los dos se escriben del mismo evento, en la misma línea de código.
  void anotar(base, {
    notaId: fila.notaId,
    etiqueta: etiquetaDeToken(token),
    evento: "usado",
    quien,
    at: ahora,
  });

  const titulo = fila.texto.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";
  return {
    titulo,
    texto: fila.texto,
    doc: fila.doc,
    notaId: fila.notaId,
    alcance: fila.alcance as Alcance,
    permiso: fila.permiso as Permiso,
  };
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
  opciones: { notaId: number; quien: QuienPregunta; config: ConfiguracionDeLink; ahora?: Date },
): Promise<ResultadoLink> {
  const [pagina] = await base
    .select({ vendedoraId: notas.vendedoraId, espacioId: notas.espacioId, archivadoAt: notas.archivadoAt })
    .from(notas)
    .where(eq(notas.id, opciones.notaId));

  if (!pagina || pagina.archivadoAt) return { ok: false, motivo: "no-encontrada" };
  if (!puedeEditar(pagina, opciones.quien)) return { ok: false, motivo: "prohibido" };

  // ⚠️ Si ya tiene link, se RECONFIGURA el que hay en vez de crear otro: el token
  // repartido sigue sirviendo y cambiar de «público» a «solo Goberna» surte
  // efecto sobre el link que la gente ya tiene. Crear uno nuevo dejaría el viejo
  // vivo con las reglas viejas — que es justo lo que alguien intenta arreglar
  // cuando toca esto.
  const ahora = opciones.ahora ?? new Date();
  const yaTiene = await linkDe(base, opciones.notaId);
  if (yaTiene) {
    await base
      .update(notaLink)
      .set({
        alcance: opciones.config.alcance,
        permiso: opciones.config.permiso,
        venceAt: opciones.config.venceAt ?? null,
      })
      .where(eq(notaLink.token, yaTiene));
    // 🔴 **Reconfigurar es un evento propio, no un `creado` repetido.** El token
    // repartido no cambia, así que lo único que queda de «esto estuvo público tres
    // días y después se cerró a Goberna» es esta línea. Sin ella, el registro
    // muestra la configuración de HOY con la fecha de creación, que es la forma
    // más limpia de que una auditoría diga algo falso sin mentir en ningún campo.
    await anotar(base, {
      notaId: opciones.notaId,
      etiqueta: etiquetaDeToken(yaTiene),
      evento: "reconfigurado",
      quien: opciones.quien.vendedoraId,
      alcance: opciones.config.alcance,
      permiso: opciones.config.permiso,
      venceAt: opciones.config.venceAt ?? null,
      at: ahora,
    });
    return { ok: true, token: yaTiene };
  }

  const token = nuevoToken();
  await base.insert(notaLink).values({
    token,
    notaId: opciones.notaId,
    creadoPor: opciones.quien.vendedoraId,
    alcance: opciones.config.alcance,
    permiso: opciones.config.permiso,
    venceAt: opciones.config.venceAt ?? null,
  });
  await anotar(base, {
    notaId: opciones.notaId,
    etiqueta: etiquetaDeToken(token),
    evento: "creado",
    quien: opciones.quien.vendedoraId,
    alcance: opciones.config.alcance,
    permiso: opciones.config.permiso,
    venceAt: opciones.config.venceAt ?? null,
    at: ahora,
  });
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
  opciones: { notaId: number; quien: QuienPregunta; ahora?: Date },
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

  // ⚠️ **El `returning` no es cosmético: es la única chance de saber CUÁL link se
  // cortó.** Después del DELETE la fila no existe, así que su etiqueta no se puede
  // reconstruir — y sin etiqueta, el corte no se puede pegar al link que le
  // corresponde en una página que tuvo varios. Que devuelva vacío es el caso
  // idempotente (no había link), y ahí no hay nada que anotar.
  const [cortado] = await base
    .delete(notaLink)
    .where(eq(notaLink.notaId, opciones.notaId))
    .returning({ token: notaLink.token });

  if (cortado) {
    await anotar(base, {
      notaId: opciones.notaId,
      etiqueta: etiquetaDeToken(cortado.token),
      evento: "cortado",
      quien: opciones.quien.vendedoraId,
      at: opciones.ahora ?? new Date(),
    });
  }
  return { ok: true, token: null };
}
