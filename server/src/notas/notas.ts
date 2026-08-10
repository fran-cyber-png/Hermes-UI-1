import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { db as DbSingleton } from '../db/client.js';
import { gestiones, notas } from '../db/schema.js';
import { puedeEditar, type QuienPregunta } from '../espacios/visibilidad.js';
import { visibleParaSql } from '../espacios/visibilidadSql.js';
import { aTextoPlano } from './textoPlano.js';

/**
 * LA LÓGICA DE NOTAS — extraída del router para poder testearla contra una base
 * de verdad (harness #33), como `cola/consultarCola.ts`: recibe `db` INYECTADO —
 * el router le pasa el singleton, el test su base de prueba.
 *
 * ══ YA NO ES «POR AUTORA» — ES POR ESPACIO (ADR 0046) ═══════════════════════
 *
 * Acá decía que v1 es **por autora** y que promoverlo a «del equipo» era otro
 * frente. Ese frente es éste. Ahora quién ve una página lo decide su
 * `espacio_id`, y la regla vive entera en `espacios/visibilidad.ts` (pura) con su
 * gemelo `visibleParaSql`:
 *
 *     se ve  ⟺  (espacio_id IS NULL ∧ autora = yo)   ← la libreta privada
 *            ∨  (espacio_id = E     ∧ soy miembro)   ← un espacio
 *
 * ⚠️ **Sobre una página privada la regla nueva da exactamente lo mismo que la
 * vieja**, así que nadie pierde el candado que tenía: `espacio_id IS NULL` exige
 * ser la autora. Lo que cambia es que en un espacio compartido la autoría deja de
 * ser el candado — si lo siguiera siendo, un espacio del equipo sería una carpeta
 * de solo lectura para todos menos uno.
 *
 * `vendedoraId` sigue siendo **quién la escribió**: es lo que la pantalla muestra
 * («la tocó Sindy») y contra lo que se cuenta el uso. Ya no es quién la ve.
 */

export const LIMITE_TEXTO = 2000;

export type NotaFila = typeof notas.$inferSelect;

export type ResultadoValidacion = { ok: true; texto: string } | { ok: false; motivo: string };

/**
 * trim + no vacío + ≤ 2.000. Los emojis SÍ pasan: una nota nunca viaja a
 * Cerberus, así que la regla latin1 dura #4 del CLAUDE.md no aplica acá.
 */
export function validarTexto(valor: unknown): ResultadoValidacion {
  const texto = typeof valor === 'string' ? valor.trim() : '';
  if (!texto) return { ok: false, motivo: 'el texto de la nota no puede estar vacío' };
  if (texto.length > LIMITE_TEXTO) {
    return { ok: false, motivo: `la nota no puede superar los ${LIMITE_TEXTO} caracteres (tiene ${texto.length})` };
  }
  return { ok: true, texto };
}

/**
 * LA COSTURA ÚNICA entre el documento rico y lo que se indexa.
 *
 * Cuando viene `doc`, el `texto` **se deriva acá y no se le cree al llamador**,
 * aunque mande uno: es la misma regla que `procedencia/desdeElComposer.ts` fija
 * para el hash de una pieza —el server calcula, el navegador no manda
 * derivados—, y por el mismo motivo. Un `texto` de confianza podría venir viejo,
 * recortado o de otra persona, y la nota quedaría bien en pantalla (se pinta
 * desde `doc`) e **invisible en la búsqueda** (que lee `texto`).
 *
 * Sin `doc` se valida el `texto` tal cual: es el camino de las notas de siempre,
 * y el que sigue andando para toda fila con `doc IS NULL`.
 */
export function prepararContenido(entrada: { texto?: unknown; doc?: unknown }): ResultadoValidacion {
  return validarTexto(entrada.doc !== undefined ? aTextoPlano(entrada.doc) : entrada.texto);
}

export interface CambiosEdicion {
  texto?: string;
  /** Solo se incluye si el PATCH lo trajo: omitirlo NO borra el `doc` que había. */
  doc?: unknown;
  fijada?: boolean;
  editadoAt: Date;
}

export type ResultadoEdicion = { ok: true; cambios: CambiosEdicion } | { ok: false; motivo: string };

/**
 * LA REGLA `editado_at`: nace `null` (el insert de `crearNota` no la toca — la
 * columna no tiene default más que null); CUALQUIER PATCH la setea a `ahora`,
 * inyectado como en `cola/urgencia.ts` para no depender del reloj real. Separada
 * de la escritura en base para poder testearse sin IO.
 */
export function prepararEdicion(
  cambios: { texto?: unknown; doc?: unknown; fijada?: unknown },
  ahora: Date,
): ResultadoEdicion {
  const resultado: CambiosEdicion = { editadoAt: ahora };

  // `doc` GANA sobre `texto`: si vienen los dos, el texto se rederiva del doc y
  // el que mandó el llamador se descarta. Ver `prepararContenido`.
  if (cambios.doc !== undefined || cambios.texto !== undefined) {
    const v = prepararContenido(cambios);
    if (!v.ok) return v;
    resultado.texto = v.texto;
    if (cambios.doc !== undefined) resultado.doc = cambios.doc;
  }

  if (cambios.fijada !== undefined) {
    resultado.fijada = Boolean(cambios.fijada);
  }
  if (resultado.texto === undefined && resultado.fijada === undefined) {
    return { ok: false, motivo: 'no hay nada que editar (mandá texto, doc y/o fijada)' };
  }
  return { ok: true, cambios: resultado };
}

/**
 * Una nota tal como la ve la UI: de la tabla `notas` (editable) o HISTÓRICA —
 * el textarea append-only que `RegistrarGestion` tenía antes de #47, vive en
 * `gestiones.notas` (ver ADR 0012). Esas NO se migran (perderían su fecha real,
 * o se duplicarían por cada gestión de la misma conversación): se SURFACEAN acá
 * de solo lectura, para que retirar el textarea no las vuelva invisibles.
 */
export interface NotaListada {
  id: number;
  clave: string;
  vendedoraId: string;
  texto: string;
  /**
   * El documento rico, o `null`. En una histórica de `gestiones` es SIEMPRE
   * null y no puede ser otra cosa: esas nunca pasaron por el editor. Quien las
   * pinte tiene que caer al `texto`, que es el dato original de esa fila.
   */
  doc: unknown;
  fijada: boolean;
  creadoAt: Date;
  editadoAt: Date | null;
  archivadoAt: Date | null;
  origen: 'nota' | 'gestion';
  /**
   * DÓNDE VIVE (ADR 0046). `null` = la libreta privada de su autora. En una
   * histórica de `gestiones` es SIEMPRE null y no puede ser otra cosa: esas
   * filas no tienen columna donde ponerlo.
   */
  espacioId: number | null;
}

/**
 * Las notas de acuerdos que quedaron guardadas en `gestiones.notas` ANTES de
 * #47. Solo lectura: no tienen `id` en la tabla `notas`, así que no hay PATCH
 * posible sobre ellas (el router nunca las expone en /:id).
 */
async function listarNotasHistoricas(
  base: typeof DbSingleton,
  opciones: { clave: string; vendedoraId: string },
): Promise<NotaListada[]> {
  const filas = await base
    .select({ id: gestiones.id, vendedoraId: gestiones.vendedoraId, texto: gestiones.notas, creadoAt: gestiones.creadoAt })
    .from(gestiones)
    .where(and(eq(gestiones.clave, opciones.clave), eq(gestiones.vendedoraId, opciones.vendedoraId), isNotNull(gestiones.notas)));

  return filas
    .filter((f): f is typeof f & { texto: string } => Boolean(f.texto && f.texto.trim()))
    .map((f) => ({
      id: f.id,
      clave: opciones.clave,
      vendedoraId: f.vendedoraId,
      texto: f.texto,
      doc: null,
      fijada: false,
      creadoAt: f.creadoAt,
      editadoAt: null,
      archivadoAt: null,
      origen: 'gestion' as const,
      espacioId: null,
    }));
}

/**
 * Vivas de una conversación (o de la libreta 'general') — fijada primero, luego
 * más nueva primero. Mezcla las notas nuevas (editables) con las históricas de
 * `gestiones` (solo lectura) — ver `NotaListada`.
 *
 * ══ QUÉ DECIDE `espacioId` ══════════════════════════════════════════════════
 *
 *   · **ausente o `null`** → la libreta PRIVADA de quien pregunta
 *     (`espacio_id IS NULL AND vendedora_id = yo`). Es, carácter por carácter, lo
 *     que esta función hacía antes de ADR 0046: un front viejo que no manda el
 *     parámetro sigue viendo exactamente lo suyo.
 *   · **un número** → las páginas de ESE espacio, sin importar quién las escribió.
 *
 * ⚠️ **La membresía se verifica ARRIBA, en la ruta**, y esta función confía. No es
 * descuido: acá no hay a quién preguntarle sin volver a la base, y duplicar el
 * chequeo daría dos lugares decidiendo lo mismo (#37). Lo que sí es
 * responsabilidad de acá es no inventar un tercer camino — por eso solo hay dos
 * ramas y ninguna acepta «todas».
 *
 * ⚠️ **Las históricas de `gestiones` NO entran a un espacio.** Viven en otra tabla,
 * son de solo lectura y siguen siendo por autora: se mezclan solo cuando se pide
 * la libreta privada. En un espacio compartido, mostrarlas sería servir las notas
 * de gestión de una vendedora a todo el equipo por la puerta de atrás.
 */
export async function listarNotas(
  base: typeof DbSingleton,
  opciones: { clave: string; vendedoraId: string; espacioId?: number | null },
): Promise<NotaListada[]> {
  const espacioId = opciones.espacioId ?? null;

  const [nuevas, historicas] = await Promise.all([
    base
      .select()
      .from(notas)
      .where(
        and(
          eq(notas.clave, opciones.clave),
          isNull(notas.archivadoAt),
          espacioId === null
            ? and(isNull(notas.espacioId), eq(notas.vendedoraId, opciones.vendedoraId))
            : eq(notas.espacioId, espacioId),
        ),
      ),
    espacioId === null ? listarNotasHistoricas(base, opciones) : Promise.resolve([]),
  ]);

  const combinadas: NotaListada[] = [...nuevas.map((n) => ({ ...n, origen: 'nota' as const })), ...historicas];

  combinadas.sort((a, b) => {
    if (a.fijada !== b.fijada) return a.fijada ? -1 : 1;
    return b.creadoAt.getTime() - a.creadoAt.getTime();
  });

  return combinadas;
}

/**
 * Búsqueda GIN sobre TODO lo que esta persona puede ver: su libreta privada y
 * las páginas de sus espacios.
 *
 * ══ SE SACÓ EL `clave = 'general'`, Y ERA DEUDA ANOTADA ═════════════════════
 *
 * Estaba clavado acá (`eq(notas.clave, 'general')`) y lo dejaba afuera todo lo
 * anotado dentro de una conversación — el punto 11 de
 * `plan-libreta-que-deberia-tener.md`, que decía que el conjunto oculto tenía
 * tamaño cero y que con espacios pasaría a ser real. Pasó a ser real: buscar en
 * la libreta y no encontrar la página del equipo sería la peor forma de
 * compartir, porque no se ve que falta nada.
 *
 * ⚠️ **El GIN no hay que reindexarlo**: es `to_tsvector('spanish', texto)` y no
 * lleva `clave` ni `espacio_id` adentro, así que la expresión indexada no cambió.
 * Sin el índice Postgres igual contesta bien — degrada a seq scan, no revienta.
 *
 * 🔴 **El filtro de visibilidad NO se puede olvidar acá.** Es la puerta más fácil
 * de la fuga: sin él, escribir «precio» en el buscador devuelve la libreta
 * privada de las cinco vendedoras. Por eso el `WHERE` lo arma `visibleParaSql`,
 * la misma regla que el listado, y no un predicado escrito a mano.
 */
export async function buscarNotas(
  base: typeof DbSingleton,
  opciones: { quien: QuienPregunta; q: string },
): Promise<NotaFila[]> {
  const termino = opciones.q.trim();
  if (!termino) return [];
  return base
    .select()
    .from(notas)
    .where(
      and(
        visibleParaSql(opciones.quien),
        isNull(notas.archivadoAt),
        sql`to_tsvector('spanish', ${notas.texto}) @@ plainto_tsquery('spanish', ${termino})`,
      ),
    )
    .orderBy(desc(notas.fijada), desc(notas.creadoAt));
}

/**
 * Con `doc`, el `texto` se REDERIVA acá — el que venga en `datos.texto` se
 * descarta. Es la costura: no hay forma de insertar una fila cuyo `texto` no sea
 * el aplanado de su `doc`. Ver `prepararContenido`.
 */
export async function crearNota(
  base: typeof DbSingleton,
  datos: { clave: string; vendedoraId: string; texto: string; doc?: unknown; espacioId?: number | null },
): Promise<NotaFila> {
  const { clave, vendedoraId } = datos;
  // `espacioId` va SIEMPRE, y `null` es un valor con significado («mi libreta»),
  // no la ausencia de uno. Por eso no se omite como `doc`: omitirlo lo dejaría al
  // default de la columna, que hoy es null y mañana podría no serlo.
  const espacioId = datos.espacioId ?? null;
  const valores =
    datos.doc === undefined
      ? { clave, vendedoraId, texto: datos.texto, espacioId }
      : { clave, vendedoraId, texto: aTextoPlano(datos.doc), doc: datos.doc, espacioId };

  const [fila] = await base.insert(notas).values(valores).returning();
  return fila;
}

export type ResultadoMutacion = { ok: true; nota: NotaFila } | { ok: false; motivo: 'no-encontrada' | 'prohibido' };

/**
 * ¿PUEDE TOCAR ESTA PÁGINA? — la guarda que comparten las tres mutaciones.
 *
 * Antes de ADR 0046 esto era `existente.vendedoraId !== opciones.vendedoraId` en
 * los tres cuerpos, escrito tres veces. Ahora la regla vive una vez y pura
 * (`espacios/visibilidad.ts`): con tres copias, la próxima mutación que se agregue
 * va a copiar la que esté más cerca, y basta que una quede con la regla vieja
 * para que un espacio compartido sea de solo lectura en esa operación.
 */
function noPuedeTocar(existente: { vendedoraId: string; espacioId: number | null }, quien: QuienPregunta): boolean {
  return !puedeEditar({ vendedoraId: existente.vendedoraId, espacioId: existente.espacioId }, quien);
}

/**
 * Edita — **cualquier miembro del espacio**, no solo la autora (ADR 0046). Sobre
 * una página privada la regla es idéntica a la vieja. Una nota archivada no se
 * toca.
 */
export async function editarNota(
  base: typeof DbSingleton,
  opciones: { id: number; quien: QuienPregunta; cambios: CambiosEdicion },
): Promise<ResultadoMutacion> {
  const [existente] = await base.select().from(notas).where(eq(notas.id, opciones.id));
  if (!existente || existente.archivadoAt) return { ok: false, motivo: 'no-encontrada' };
  if (noPuedeTocar(existente, opciones.quien)) return { ok: false, motivo: 'prohibido' };

  const [fila] = await base.update(notas).set(opciones.cambios).where(eq(notas.id, opciones.id)).returning();
  return { ok: true, nota: fila };
}

/** Setea `archivado_at`. No hay DELETE físico — la fila sigue en la base. */
export async function archivarNota(
  base: typeof DbSingleton,
  opciones: { id: number; quien: QuienPregunta; ahora: Date },
): Promise<ResultadoMutacion> {
  const [existente] = await base.select().from(notas).where(eq(notas.id, opciones.id));
  if (!existente || existente.archivadoAt) return { ok: false, motivo: 'no-encontrada' };
  if (noPuedeTocar(existente, opciones.quien)) return { ok: false, motivo: 'prohibido' };

  const [fila] = await base.update(notas).set({ archivadoAt: opciones.ahora }).where(eq(notas.id, opciones.id)).returning();
  return { ok: true, nota: fila };
}

/**
 * DESHACER un archivado (limpia `archivado_at`). Un solo clic sin confirmar ni
 * poder volver atrás era el problema (review de código del PR #47): esto es el
 * camino de vuelta — el botón «Deshacer» del toast que sigue al archivado.
 */
export async function desarchivarNota(
  base: typeof DbSingleton,
  opciones: { id: number; quien: QuienPregunta },
): Promise<ResultadoMutacion> {
  const [existente] = await base.select().from(notas).where(eq(notas.id, opciones.id));
  if (!existente || !existente.archivadoAt) return { ok: false, motivo: 'no-encontrada' };
  if (noPuedeTocar(existente, opciones.quien)) return { ok: false, motivo: 'prohibido' };

  const [fila] = await base.update(notas).set({ archivadoAt: null }).where(eq(notas.id, opciones.id)).returning();
  return { ok: true, nota: fila };
}
