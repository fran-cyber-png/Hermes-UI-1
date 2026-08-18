import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema.js";
import type { DatosUpsert } from "./dominio.js";
import { esIdentidadFederada, esIdentidadFederadaSql } from "./origenIdentidad.js";
import { lineasVedadasPara } from "./campana.js";

/**
 * EL REGISTRO DE NÚMEROS PROPIOS — la copia local del mapa que dueña Cerberus.
 *
 * Es un SEAM: cada función recibe `db` (el de producción o el aislado del test),
 * nunca importa el singleton. Así los tests con base (`*.test.db.ts`) le pasan su
 * propia Postgres efímera. El patrón de la casa (issues #37/#38).
 */

/** El `db` inyectable: lo satisfacen el singleton y la base de prueba por igual. */
type Base = PostgresJsDatabase<typeof schema>;

/**
 * `lower(btrim(columna)) = lower(btrim(valor))` — el mismo candado medido en
 * `cola/asignadaSql.ts`: Cerberus empuja una grafía (`Luz`), el login usa otra
 * (`luz`). Todo cruce contra `numero_vendedora.vendedora_id` compara
 * normalizando los DOS lados, o «¿ya tenés línea?» lee que no cuando sí.
 */
function mismaVendedoraSql(columna: typeof schema.numeroVendedora.vendedoraId, valor: string) {
  return sql`lower(btrim(${columna})) = lower(btrim(${valor}))`;
}

export interface NumeroRow {
  numero: string;
  etiqueta: string;
  proposito: string;
  referencia: string | null;
  activo: boolean;
  vinculadoAt: Date | null;
  vendedoras: string[];
}

function aFila(
  n: typeof schema.numerosWa.$inferSelect,
  vendedoras: string[],
): NumeroRow {
  return {
    numero: n.numero,
    etiqueta: n.etiqueta,
    proposito: n.proposito,
    referencia: n.referencia,
    activo: n.activo,
    vinculadoAt: n.vinculadoAt,
    vendedoras,
  };
}

/** Todos los números, con sus vendedoras asignadas, más viejo primero. */
export async function listarNumeros(db: Base): Promise<NumeroRow[]> {
  const nums = await db.select().from(schema.numerosWa).orderBy(schema.numerosWa.creadoAt);
  const asigs = await db.select().from(schema.numeroVendedora);
  const porNumero = new Map<string, string[]>();
  for (const a of asigs) {
    const lista = porNumero.get(a.numero) ?? [];
    lista.push(a.vendedoraId);
    porNumero.set(a.numero, lista);
  }
  return nums.map((n) => aFila(n, (porNumero.get(n.numero) ?? []).sort()));
}

/**
 * LAS LÍNEAS DE UNA VENDEDORA — el mapa leído desde el otro lado.
 *
 * Existe para el recorte «Las mías» de la cola (`cola/lineas.ts`) y, desde el
 * 15-ago-2026, para la auto-vinculación (`routes/miLinea.ts`): «¿ya tenés una
 * línea?» decide si se puede traer otra. Vive acá, junto a
 * `listarNumeros`/`upsertNumero`, porque el mapa número↔vendedora tiene un solo
 * dueño: si la cola armara su propio `SELECT ... FROM numero_vendedora`, el día
 * que Cerberus agregue una columna de vigencia habría dos lugares que decidir
 * qué cuenta como «suya» (la lección de #37).
 *
 * 🔴 **`lower(btrim(...))` DE LOS DOS LADOS, y no es laxitud.** Es el mismo
 * defecto medido en `cola/asignadaSql.ts`: Cerberus empuja `Luz`,
 * `vendedoraId` es lo que se tipeó al entrar (`luz`). Con `eq()` a secas, Luz
 * con línea asignada leía `[]` acá — y por esta consulta también decide «podés
 * auto-vincular» — así que hubiera terminado con DOS líneas de WhatsApp.
 *
 * Devolver `[]` no es un error: significa «el mapa no le asigna ninguna», y
 * quién decide qué hacer con eso —fail-open, ver `cola/lineas.ts`— es la regla
 * pura, no esta consulta.
 */
export async function lineasDeVendedora(db: Base, vendedoraId: string): Promise<string[]> {
  const filas = await db
    .select({ numero: schema.numeroVendedora.numero })
    .from(schema.numeroVendedora)
    .where(mismaVendedoraSql(schema.numeroVendedora.vendedoraId, vendedoraId));
  return filas.map((f) => f.numero);
}

/**
 * Las líneas de esta persona **con cuántas la atienden** — el dato que separa
 * «su línea» de «la línea del equipo» (ver `numeros/autoVinculacion.ts`).
 *
 * 🔴 **EL CONTEO NO SE FILTRA POR LA VENDEDORA.** La subconsulta cuenta TODAS
 * las filas de `numero_vendedora` de ese número, no sólo las suyas. Si se colara
 * ahí el `WHERE` de la persona, toda línea daría `duenas = 1`, el tope volvería
 * a mirar cualquier línea, y el defecto que este dato existe para arreglar
 * volvería **mudo** — sin error, sin log, sólo el botón que no aparece.
 *
 * Es una consulta aparte de `lineasDeVendedora` por la misma razón que
 * `lineasDeVendedoraConProposito`: responden preguntas distintas y la mayoría de
 * los llamadores no necesita el conteo. Sigue siendo este módulo el único dueño
 * de `numero_vendedora`.
 *
 * ⚠️ **Sin JOIN contra `numeros_wa`, y al revés que `…ConProposito`**: acá la
 * pregunta es «¿cuánta gente comparte esta asignación?», y se responde entera
 * dentro de `numero_vendedora`. Una fila huérfana —asignada a un número que ya
 * no está registrado— igual ocupa cupo si es sólo suya; esconderla con un
 * `innerJoin` dejaría a alguien vinculando una segunda línea sin saberlo.
 */
export async function lineasDeVendedoraConDuenas(
  db: Base,
  vendedoraId: string,
): Promise<{ numero: string; duenas: number }[]> {
  const filas = await db
    .select({
      numero: schema.numeroVendedora.numero,
      duenas: sql<number>`(
        SELECT count(*) FROM ${schema.numeroVendedora} AS todas
         WHERE todas.numero = ${schema.numeroVendedora.numero}
      )`,
    })
    .from(schema.numeroVendedora)
    .where(mismaVendedoraSql(schema.numeroVendedora.vendedoraId, vendedoraId));
  return filas.map((f) => ({ numero: f.numero, duenas: Number(f.duenas) }));
}

/**
 * Las líneas de esta persona **con su propósito**, para poder decidir si ve solo
 * las suyas (`cola/lineas.ts` → `soloSusLineas`).
 *
 * Es una consulta aparte y no un campo más en `lineasDeVendedora` porque las dos
 * responden preguntas distintas —«¿cuáles son las suyas?» vs. «¿qué clase de
 * línea es cada una?»— y la primera la llaman lugares a los que el propósito no
 * les importa. Sigue siendo este módulo el único dueño de `numero_vendedora`.
 *
 * El JOIN es interno a propósito: una asignación a un número que ya no está en
 * `numeros_wa` no puede decidir nada sobre lo que se ve.
 */
export async function lineasDeVendedoraConProposito(
  db: Base,
  vendedoraId: string,
): Promise<{ numero: string; proposito: string }[]> {
  return db
    .select({
      numero: schema.numeroVendedora.numero,
      proposito: schema.numerosWa.proposito,
    })
    .from(schema.numeroVendedora)
    .innerJoin(schema.numerosWa, eq(schema.numerosWa.numero, schema.numeroVendedora.numero))
    .where(mismaVendedoraSql(schema.numeroVendedora.vendedoraId, vendedoraId));
}

export async function obtenerNumero(db: Base, numero: string): Promise<NumeroRow | null> {
  const [n] = await db
    .select()
    .from(schema.numerosWa)
    .where(eq(schema.numerosWa.numero, numero))
    .limit(1);
  if (!n) return null;
  const asigs = await db
    .select()
    .from(schema.numeroVendedora)
    .where(eq(schema.numeroVendedora.numero, numero));
  return aFila(n, asigs.map((a) => a.vendedoraId).sort());
}

/**
 * Upsert declarativo: crea o actualiza el número y REEMPLAZA el set de vendedoras
 * **que Cerberus puede nombrar**. Idempotente por la clave `numero`, así el push de
 * Cerberus tolera reintentos.
 *
 * ⚠️ Dos cosas que este upsert NO hace, y las dos son arreglos de un defecto medido:
 *
 *  1. **No resetea `proposito` ni `activo` cuando vienen ausentes.** Son campos que
 *     Hermes inventó y Cerberus no conoce; con un default, cada push suyo los pisaba
 *     en silencio. El porqué completo está en `dominio.ts`. Sobre una fila NUEVA sí
 *     hay que poner algo, y ahí valen los defaults de la tabla.
 *  2. **No borra las identidades federadas** (`centurion:…`). Ver `origenIdentidad.ts`:
 *     el set de Cerberus no las incluye nunca, así que reemplazarlas a ciegas dejaba
 *     al agente digital sin línea y en 403, sin un solo síntoma.
 */
export async function upsertNumero(
  db: Base,
  numero: string,
  datos: DatosUpsert,
): Promise<NumeroRow> {
  await db.transaction(async (tx) => {
    // Sólo lo que vino se pisa. `undefined` en un `set` de drizzle deja la columna
    // como estaba, así que la omisión se propaga sola hasta el UPDATE.
    const declarado = {
      etiqueta: datos.etiqueta,
      referencia: datos.referencia,
      ...(datos.proposito === undefined ? {} : { proposito: datos.proposito }),
      ...(datos.activo === undefined ? {} : { activo: datos.activo }),
      actualizadoAt: sql`now()`,
    };

    await tx
      .insert(schema.numerosWa)
      .values({
        numero,
        // Una fila nueva sí necesita un valor: acá el default es correcto, porque no
        // hay nada previo que pisar.
        proposito: datos.proposito ?? "escuela",
        activo: datos.activo ?? true,
        ...declarado,
      })
      .onConflictDoUpdate({ target: schema.numerosWa.numero, set: declarado });

    // Se borra sólo lo que Cerberus puede nombrar. Lo federado sobrevive su push.
    await tx
      .delete(schema.numeroVendedora)
      .where(and(eq(schema.numeroVendedora.numero, numero), sql`NOT (${esIdentidadFederadaSql})`));

    // Pero lo que SÍ mandó se inserta tal cual, federado o no: si alguien puso una
    // identidad de otro origen en el cuerpo, es explícito y se honra. Filtrarla acá
    // sería descartarla en silencio, que es el mismo defecto que este arreglo viene
    // a cerrar, con el signo cambiado.
    const unicas = [...new Set(datos.vendedoras)];
    if (unicas.length) {
      await tx
        .insert(schema.numeroVendedora)
        .values(unicas.map((vendedoraId) => ({ numero, vendedoraId })))
        // Una federada que ya estaba sobrevivió al DELETE de arriba: reinsertarla
        // sería un choque de PK, y no tiene nada que actualizar.
        .onConflictDoNothing();
    }
  });

  const fila = await obtenerNumero(db, numero);
  // Recién insertado en la misma transacción: no puede no estar.
  return fila as NumeroRow;
}

/** Baja lógica: activo=false. Devuelve si el número existía. No borra la sesión. */
export async function desactivarNumero(db: Base, numero: string): Promise<boolean> {
  const filas = await db
    .update(schema.numerosWa)
    .set({ activo: false, actualizadoAt: sql`now()` })
    .where(eq(schema.numerosWa.numero, numero))
    .returning({ numero: schema.numerosWa.numero });
  return filas.length > 0;
}

/** Marca la sesión como vinculada (se llama cuando el pareo llega a 'conectado'). */
export async function marcarVinculado(db: Base, numero: string): Promise<void> {
  await db
    .update(schema.numerosWa)
    .set({ vinculadoAt: sql`now()`, actualizadoAt: sql`now()` })
    .where(eq(schema.numerosWa.numero, numero));
}

/**
 * LAS LÍNEAS QUE ESTA PERSONA NO PUEDE VER — la lectura que necesitan las rutas
 * (`numeros/campana.ts` es la regla; esto es quién le pasa los datos).
 *
 * Las consultas de la cola y del Dashboard NO usan esto: preguntan en su propio
 * SQL, adentro de la misma transacción, para no tener una lectura aparte que
 * pueda fallar por su cuenta. Acá hace falta la lista de verdad porque lo que se
 * decide es un **403**, no un `WHERE`.
 *
 * ⚠️ **No atrapa nada.** Si esto tira, la ruta que lo llamó tira, y `lib/ruta.ts`
 * la convierte en 500. Es lo correcto en una frontera: un recorte que no se pudo
 * evaluar no se adivina hacia el lado cómodo.
 */
export async function lineasVedadasDe(db: Base, vendedoraId: string | undefined): Promise<string[]> {
  return lineasVedadasPara(await listarNumeros(db), vendedoraId);
}
