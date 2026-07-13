import { and, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { conversiones } from "../db/ontologia.js";
import { ventasParaElLazo } from "../ontologia/ventas.js";
import { capiDesdeEnv } from "./capi.js";
import { construirCompra, type MotivoDescarte } from "./evento.js";

/**
 * EL LAZO. Toma las ventas de Cerberus y le dice a Meta quién compró.
 *
 * Es la razón de ser del sistema: quitarle a Meta la señal de conversión sube el costo mediano por
 * cliente incremental de US$38,16 a US$49,93 — un 31% más caro (RCT con 70.000+ anunciantes,
 * NBER w32765 / Marketing Science 2025). El evento de conversión ES la variable dependiente del
 * modelo de entrega de Meta.
 *
 * ── Los descartes se GUARDAN ──
 * La mitad importante de este worker no es lo que manda: es lo que NO manda, y por qué.
 * Hoy ese fracaso es invisible — Meta rechaza un evento viejo y no avisa. Acá cada descarte
 * queda contado, con su motivo, y sube a la pantalla.
 *
 * El motivo `fuera_de_ventana` es ~1 de cada 6 (el p90 de confirmación de Tesorería es 10 días,
 * la ventana de Meta son 7). **Ese 17% no se arregla con código: se arregla confirmando más
 * rápido.** Por eso tiene que verse.
 */

export type ResumenLazo = {
  evaluadas: number;
  aEnviar: number;
  enviadas: number;
  descartes: Record<MotivoDescarte, number>;
  errores: string[];
  esPrueba: boolean;
};

const MOTIVOS: MotivoDescarte[] = [
  "historico",
  "venta_no_valida",
  "estado_no_pagado",
  "sin_confirmacion",
  "fuera_de_ventana",
  "sin_identidad",
  "valor_invalido",
];

/**
 * Corre el lazo. Idempotente: `event_id = venta:{folio}` es único, así que reenviar la misma
 * venta no crea una conversión nueva ni en nuestra base ni en Meta (dedup de 48 h).
 *
 * `soloRegistrar` evalúa y guarda TODO sin mandarle nada a Meta. Es el modo para mirar los
 * números antes de escribirle a producción — el mismo espíritu del `DECISIONES_MODO=simulacion`
 * que ya existe en las decisiones de pauta.
 */
export async function correrLazo(opciones: { soloRegistrar?: boolean } = {}): Promise<ResumenLazo> {
  const capi = capiDesdeEnv();
  const ahora = new Date();
  const ventas = await ventasParaElLazo();

  const descartes = Object.fromEntries(MOTIVOS.map((m) => [m, 0])) as Record<MotivoDescarte, number>;
  const aMandar: { evento: ReturnType<typeof construirCompra>; folio: string }[] = [];
  const filas: (typeof conversiones.$inferInsert)[] = [];

  for (const venta of ventas) {
    const r = construirCompra(venta, ahora);

    if (!r.ok) {
      descartes[r.motivo] += 1;
      filas.push({
        origenClave: venta.folio,
        origenFuente: "cerberus",
        tipo: "Purchase",
        valor: String(venta.montoTotal),
        moneda: venta.moneda,
        // Sin confirmación no hay fecha de compra: usamos "ahora" solo para poder guardar la fila
        // del descarte. No se manda a ningún lado, así que no distorsiona nada.
        ocurridoEn: venta.confirmadaAt ?? ahora,
        eventId: `venta:${venta.folio}`,
        descarte: r.motivo,
        descarteDetalle: r.diasDeAtraso != null ? { diasDeAtraso: r.diasDeAtraso } : null,
        esPrueba: capi.esPrueba,
      });
      continue;
    }

    aMandar.push({ evento: r, folio: venta.folio });
    filas.push({
      origenClave: venta.folio,
      origenFuente: "cerberus",
      tipo: "Purchase",
      valor: String(venta.montoTotal),
      moneda: venta.moneda,
      ocurridoEn: venta.confirmadaAt!,
      eventId: r.evento.event_id,
      datasetId: process.env.META_PIXEL_ID ?? null,
      esPrueba: capi.esPrueba,
    });
  }

  // Guardamos TODO —lo que va y lo que no— antes de hablar con Meta. Si el envío falla, el
  // registro de por qué cada venta iba o no iba ya está a salvo.
  await guardar(filas);

  const resumen: ResumenLazo = {
    evaluadas: ventas.length,
    aEnviar: aMandar.length,
    enviadas: 0,
    descartes,
    errores: [],
    esPrueba: capi.esPrueba,
  };

  if (opciones.soloRegistrar || aMandar.length === 0) return resumen;

  // De a 100: es el lote que Meta acepta cómodo, y si uno falla no arrastra a los otros 4.700.
  for (let i = 0; i < aMandar.length; i += 100) {
    const lote = aMandar.slice(i, i + 100);
    const eventos = lote.map((x) => (x.evento as { ok: true; evento: never }).evento);

    const res = await capi.enviar(eventos);

    if (!res.ok) {
      resumen.errores.push(res.error ?? "error desconocido");
      await marcarError(
        lote.map((x) => `venta:${x.folio}`),
        res.error ?? "error desconocido",
      );
      continue;
    }

    resumen.enviadas += res.recibidos;
    await marcarEnviadas(
      lote.map((x) => `venta:${x.folio}`),
      res.crudo,
      capi.esPrueba,
    );
  }

  return resumen;
}

async function guardar(filas: (typeof conversiones.$inferInsert)[]): Promise<void> {
  for (let i = 0; i < filas.length; i += 500) {
    await db
      .insert(conversiones)
      .values(filas.slice(i, i + 500))
      .onConflictDoUpdate({
        target: conversiones.eventId,
        // Reevaluar una venta puede cambiar su veredicto: una que ayer estaba `sin_confirmacion`
        // hoy puede estar lista. Pero NUNCA pisamos `enviado_at`: lo que ya se mandó, se mandó.
        set: {
          descarte: sql`excluded.descarte`,
          descarteDetalle: sql`excluded.descarte_detalle`,
          valor: sql`excluded.valor`,
          ocurridoEn: sql`excluded.ocurrido_en`,
        },
        setWhere: sql`${conversiones.enviadoAt} IS NULL`,
      });
  }
}

async function marcarEnviadas(
  eventIds: string[],
  respuesta: unknown,
  esPrueba: boolean,
): Promise<void> {
  await db
    .update(conversiones)
    .set({
      enviadoAt: new Date(),
      metaRespuesta: respuesta,
      // El modo del ÚLTIMO envío. Sin esto, una venta probada y después mandada a producción
      // seguía figurando como prueba — la pantalla mentiría sobre si el lazo está prendido.
      esPrueba,
      intentos: sql`${conversiones.intentos} + 1`,
      descarte: null,
      ultimoError: null,
    })
    .where(inArray(conversiones.eventId, eventIds));
}

async function marcarError(eventIds: string[], error: string): Promise<void> {
  await db
    .update(conversiones)
    .set({ intentos: sql`${conversiones.intentos} + 1`, ultimoError: error })
    .where(and(inArray(conversiones.eventId, eventIds), isNull(conversiones.enviadoAt)));
}
