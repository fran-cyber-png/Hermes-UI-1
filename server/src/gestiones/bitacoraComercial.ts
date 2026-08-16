import { and, desc, eq, inArray } from 'drizzle-orm';
import type { db } from '../db/client.js';
import { gestiones, etiquetas, intereses } from '../db/schema.js';
import { proyectarVenta } from '../atribucion/proyectarVenta.js';
import { conversacionDeClave } from '../atribucion/resolverConversacion.js';
import { ultimasGestionesSql } from '../cola/etapaEfectivaSql.js';
import { normalizarEtapa } from './registrarGestion.js';

/**
 * EL SEAM DE LA BITÁCORA COMERCIAL — historial, etapas, etiquetas, y el asiento
 * de la venta en el embudo.
 *
 * Es lo que `routes/gestiones.ts` consultaba a mano. Es una MUDANZA, no una
 * reescritura: cada consulta es la misma, con los mismos parámetros y el mismo
 * orden, y cada comentario viajó con la suya. Lo único que cambia es de dónde
 * sale la base: todas reciben `db` INYECTADO (el patrón de `registrarGestion` y
 * `consultarSenales`, ADR 0008) — la ruta le pasa el singleton, un test con base
 * efímera le pasa el suyo, nunca al revés. Así la ruta se queda con lo que es
 * suyo: validar el HTTP y serializar.
 */

/** El historial de gestiones de UNA conversación (la etapa actual es la primera). */
export async function historialDeGestiones(
  base: typeof db,
  clave: string,
): Promise<{ gestiones: (typeof gestiones.$inferSelect)[]; etapa: string | null }> {
  const filas = await base
    .select()
    .from(gestiones)
    .where(eq(gestiones.clave, clave))
    .orderBy(desc(gestiones.creadoAt))
    .limit(10);
  return { gestiones: filas, etapa: filas[0] ? normalizarEtapa(filas[0].etapa) : null };
}

/**
 * El mapa clave → etapa actual (normalizada), para el Embudo viejo.
 *
 * El DISTINCT ON canónico vive en el seam (`cola/etapaEfectivaSql.ts`): acá se
 * consume, no se re-escribe — espejarlo a mano es la clase de bug de #37 (este
 * endpoint ya había divergido: le faltaba el desempate por `id`).
 *
 * CANDIDATO A RETIRO: cuando el tablero honesto (#122) llegue a producción, el
 * front lee `etapa_efectiva` de la cola y este mapa pierde su único consumidor.
 */
export async function mapaDeEtapasActuales(base: typeof db): Promise<Record<string, string>> {
  const filas = await base.execute<{ clave: string; etapa_manual: string }>(ultimasGestionesSql);
  return Object.fromEntries(filas.map((f) => [f.clave, normalizarEtapa(f.etapa_manual)]));
}

/** Sacar un interés de una conversación. */
export async function quitarInteres(
  base: typeof db,
  i: { clave: string; curso: string },
): Promise<void> {
  await base
    .delete(intereses)
    .where(and(eq(intereses.clave, i.clave), eq(intereses.curso, i.curso)));
}

// ── Etiquetas (compartidas por el equipo) ──────────────────────────────────

/** Las etiquetas de un puñado de claves, o las de TODAS si no se pide ninguna. */
export async function etiquetasPorClave(
  base: typeof db,
  claves: readonly string[],
): Promise<Record<string, string[]>> {
  const filas = claves.length
    ? await base.select().from(etiquetas).where(inArray(etiquetas.clave, [...claves]))
    : await base.select().from(etiquetas);
  const porClave: Record<string, string[]> = {};
  for (const f of filas) (porClave[f.clave] ??= []).push(f.etiqueta);
  return porClave;
}

/** Poner una etiqueta. Ya normalizada por la ruta (eso es HTTP; acá es dominio). */
export async function agregarEtiqueta(
  base: typeof db,
  e: { clave: string; etiqueta: string; vendedoraId: string },
): Promise<void> {
  await base
    .insert(etiquetas)
    .values({ clave: e.clave, etiqueta: e.etiqueta, vendedoraId: e.vendedoraId })
    .onConflictDoNothing();
}

/** Sacar una etiqueta. */
export async function quitarEtiqueta(
  base: typeof db,
  e: { clave: string; etiqueta: string },
): Promise<void> {
  await base
    .delete(etiquetas)
    .where(and(eq(etiquetas.clave, e.clave), eq(etiquetas.etiqueta, e.etiqueta)));
}

/** Lo que la ruta de venta sabe de la venta que acaba de crear en Cerberus. */
export interface VentaParaElEmbudo {
  vendedoraId: string;
  saveMode: 'venta' | 'cotizacion';
  folio: string | null;
  clave?: string | null;
  canal?: string | null;
  telefono?: string | null;
  personaNombre?: string | null;
  numeroPropio?: string | null;
  montoTotal?: number | null;
  productos: string[];
}

/**
 * LA VENTA MUEVE EL EMBUDO SOLA (lo llama la ruta de venta, no la UI):
 * cotización → intereses (los productos SON el interés) + etapa "cotizado";
 * venta → conversión + etapa "cierre". La acción humana fue registrar la
 * venta; esto solo asienta sus consecuencias.
 */
export async function asentarVentaEnEmbudo(
  base: typeof db,
  v: VentaParaElEmbudo,
): Promise<void> {
  const clave = v.clave?.trim();
  if (!clave) return;

  for (const curso of v.productos.filter(Boolean)) {
    await base
      .insert(intereses)
      .values({ clave, curso: curso.slice(0, 120), vendedoraId: v.vendedoraId })
      .onConflictDoNothing();
  }

  if (v.saveMode === 'venta' && v.telefono) {
    // Por el MISMO seam que el webhook de Cerberus (#161). Antes esta ruta insertaba a mano una
    // fila sin folio ni clave: la venta existía en el panel y no se podía atar ni a la
    // conversación ni a la venta de Cerberus. Ahora sale con la conversación puesta —la
    // vendedora está parada en ella, no hay nada que resolver— y el webhook la completa
    // después con el id, el monto y la moneda, sobre la MISMA fila (dedup por folio).
    //
    // ⚠️ Si Cerberus no devolvió folio (respuesta no-JSON), la fila queda sin llave natural y el
    // webhook de esa venta creará la suya: una venta contada dos veces. Es el único hueco, y se
    // cierra el día que `crearVenta` devuelva siempre el folio.
    await proyectarVenta(base, {
      externalSaleId: null,
      folio: v.folio,
      vendedoraId: v.vendedoraId,
      montoTotal: v.montoTotal ?? null,
      // La moneda queda para el webhook: acá solo tenemos el id de moneda de Cerberus, y un ISO
      // adivinado sobre ventas en USD/PEN/MXN/BOB/DOP/COP es plata mal contada.
      moneda: null,
      medio: null,
      origen: null,
      estado: null,
      estadoPago: null,
      cliente: {
        cerberusClienteId: null,
        nombre: v.personaNombre ?? null,
        dni: null,
        correo: null,
        pais: null,
        telefonos: [v.telefono],
      },
      conversacion: conversacionDeClave(clave),
      ocurridaAt: new Date(),
      fuente: 'hermes',
    });
  }

  await base.insert(gestiones).values({
    vendedoraId: v.vendedoraId,
    clave,
    canal: v.canal ?? 'whatsapp',
    personaId: v.telefono ?? null,
    personaNombre: v.personaNombre ?? null,
    numeroPropio: v.numeroPropio ?? null,
    etapa: v.saveMode === 'venta' ? 'cierre' : 'cotizado',
    notas: v.folio ? `${v.saveMode === 'venta' ? 'Venta' : 'Cotización'} ${v.folio}` : null,
  });
}
