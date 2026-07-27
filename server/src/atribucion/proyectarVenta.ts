import { eq, or, sql } from "drizzle-orm";
import type { db } from "../db/client.js";
import { conversionesWa, ventasNoAtribuidas } from "../db/schema.js";
import { normalizarTelefono } from "../whatsapp/identidadWa.js";
import { resolverConversacion, type ConversacionResuelta } from "./resolverConversacion.js";
import type { ResultadoProyeccion, VentaAtribuible } from "./venta.js";

/**
 * EL PROYECTOR — la única puerta por la que una venta entra al CRM.
 *
 * Es **el seam** de todo este frente. Lo llaman dos caminos y van a llamarlo tres:
 *
 *   · `webhook/ruta.ts` — Cerberus avisa la venta en vivo. El camino definitivo.
 *   · `scripts/sincronizarVentas.ts` — el puente temporal, que relee los mismos payloads que
 *     Cerberus ya emitió. Se apaga el día que el webhook llegue, sin tocar este archivo.
 *   · `routes/gestiones.ts` — la vendedora registra la venta desde el chat.
 *
 * ── Las tres garantías ──
 *
 * 1. **Idempotente por la llave natural** (`external_sale_id` = `tb_venta.id`). El mismo evento
 *    dos veces pisa la fila, no la duplica. NO se deduplica por `event_id`: Cerberus reenvía la
 *    misma venta al confirmar el pago y ese id cambia en cada envío.
 * 2. **Nada se pierde.** Lo que no se puede atar a una conversación va a `ventas_no_atribuidas`
 *    con el motivo. Es el denominador: sin él, «atribuimos el 6 %» y «atribuimos el 100 %» se
 *    ven igual.
 * 3. **Una venta está de un lado o del otro, nunca en los dos.** Cuando una venta que no se
 *    pudo atribuir después sí se puede —porque la persona escribió, o porque Cerberus la
 *    reenvió con la llave—, se mueve.
 */

/** El número propio queda en la fila desde el día uno: el equipo vende por VARIOS (#50). */
export interface OpcionesProyeccion {
  /** Reloj inyectable. Nada acá llama a `new Date()` por su cuenta. */
  ahora?: Date;
}

export async function proyectarVenta(
  base: typeof db,
  venta: VentaAtribuible,
  opciones: OpcionesProyeccion = {},
): Promise<ResultadoProyeccion> {
  const ahora = opciones.ahora ?? new Date();
  const conversacion = await resolverConversacion(base, venta);

  if (!conversacion) {
    // Sin llave natural no se puede anotar sin duplicar en cada corrida. Solo pasa por el camino
    // de Hermes —donde siempre hay conversación—, así que en la práctica es inalcanzable; está
    // escrito porque un motivo que no se puede nombrar es un dato que se pierde.
    if (!venta.externalSaleId) return { atribuida: false, motivo: "sin_llave_natural" };

    const motivo = venta.cliente.telefonos.length === 0 ? "sin_telefono" : "sin_conversacion";
    await registrarNoAtribuida(base, venta, venta.externalSaleId, motivo, ahora);
    return { atribuida: false, motivo };
  }

  await guardarConversion(base, venta, conversacion, ahora);
  // La venta pasó de un lado al otro: si estaba anotada como no atribuida, ya no lo está.
  if (venta.externalSaleId) {
    await base
      .delete(ventasNoAtribuidas)
      .where(eq(ventasNoAtribuidas.externalSaleId, venta.externalSaleId));
  }

  return { atribuida: true, como: conversacion.como, clave: conversacion.clave };
}

/**
 * El teléfono con el que la fila queda indexada.
 *
 * Importa más de lo que parece: la **compuerta de Cierre** (`gestiones/registrarGestion.ts:87`)
 * pregunta `WHERE telefono = …` con el teléfono sacado de la clave de la conversación. Si acá
 * guardáramos el teléfono del cliente de Cerberus en vez del de la conversación, la venta
 * existiría y la compuerta seguiría diciendo «a Cierre se llega registrando la venta».
 */
function telefonoDeLaFila(venta: VentaAtribuible, c: ConversacionResuelta): string {
  if (c.canal === "whatsapp") return c.personaId;
  const primero = venta.cliente.telefonos[0];
  return (primero && normalizarTelefono(primero)) || c.personaId;
}

async function guardarConversion(
  base: typeof db,
  venta: VentaAtribuible,
  c: ConversacionResuelta,
  ahora: Date,
): Promise<void> {
  // El ANUNCIO del que vino esa conversación: la otra mitad de la atribución (#128). Se lee del
  // primer mensaje del hilo, que es donde `proyectar` deja el `origen` del click-to-WhatsApp.
  // Es el MISMO criterio que usa el botón «Marcar como interesado» (`routes/contactos.ts:66`).
  const [ev] = await base.execute<{ origen: unknown }>(sql`
    SELECT e.payload->'origen' AS origen
    FROM interactions i
    JOIN events e ON e.id = i.event_id
    WHERE i.canal = ${c.canal} AND i.persona_id = ${c.personaId}
      AND e.payload->>'origen' IS NOT NULL AND e.payload->>'origen' <> 'null'
    ORDER BY i.occurred_at ASC
    LIMIT 1
  `);

  const fila = {
    // `vendedora_id` es NOT NULL desde que la tabla existe. 7.560 de 7.566 eventos reales traen
    // el vendedor; para los 6 que no, un valor explícito y feo es mejor que una cadena vacía
    // que se confundiría con una vendedora sin nombre en el panel por vendedora.
    vendedoraId: venta.vendedoraId ?? "desconocida",
    telefono: telefonoDeLaFila(venta, c),
    nombre: venta.cliente.nombre,
    cerberusClienteId: venta.cliente.cerberusClienteId,
    origen: (ev?.origen as object) ?? null,
    externalSaleId: venta.externalSaleId,
    folio: venta.folio,
    monto: venta.montoTotal == null ? null : String(venta.montoTotal),
    moneda: venta.moneda,
    medio: venta.medio,
    origenVenta: venta.origen,
    estadoVenta: venta.estado,
    estadoPago: venta.estadoPago,
    clave: c.clave,
    canal: c.canal,
    numeroPropio: c.numeroPropio || null,
    atribucion: c.como,
    fuenteVenta: venta.fuente,
    ocurridaAt: venta.ocurridaAt,
    // `iniciada_at` es lo que los paneles usan como eje del tiempo (`dashboard/series.ts`), así
    // que lleva la fecha de la VENTA y no la de la ingesta: un puente que corre hoy sobre
    // ventas de marzo no puede dibujar un pico de ventas hoy.
    iniciadaAt: venta.ocurridaAt ?? ahora,
  };

  // LA MISMA VENTA POR DOS CAMINOS ES UNA SOLA FILA. La vendedora registra la venta desde el
  // chat y Cerberus solo le devuelve el FOLIO; minutos después llega el webhook de esa misma
  // venta, que trae el ID. Sin este paso serían dos conversiones y el panel contaría doble.
  // Por eso las dos llaves buscan, y las dos tienen índice único parcial en la tabla.
  const llaves = [
    venta.externalSaleId ? eq(conversionesWa.externalSaleId, venta.externalSaleId) : null,
    venta.folio ? eq(conversionesWa.folio, venta.folio) : null,
  ].filter((x): x is NonNullable<typeof x> => x !== null);

  const [existente] = llaves.length
    ? await base.select({ id: conversionesWa.id }).from(conversionesWa).where(or(...llaves)).limit(1)
    : [];

  // Lo que se pisa al actualizar: todo menos `origen` (el anuncio, que ya está bien) e `id`.
  const { origen: _origen, ...aPisar } = fila;

  if (existente) {
    await base.update(conversionesWa).set(aPisar).where(eq(conversionesWa.id, existente.id));
    return;
  }

  await base
    .insert(conversionesWa)
    .values(fila)
    // La red por si dos eventos de la misma venta entran a la vez: el índice único parcial
    // convierte la carrera en un UPDATE en vez de una segunda fila.
    .onConflictDoUpdate({
      target: conversionesWa.externalSaleId,
      targetWhere: sql`external_sale_id IS NOT NULL`,
      set: aPisar,
    });
}

async function registrarNoAtribuida(
  base: typeof db,
  venta: VentaAtribuible,
  externalSaleId: string,
  motivo: "sin_telefono" | "sin_conversacion",
  ahora: Date,
): Promise<void> {
  await base
    .insert(ventasNoAtribuidas)
    .values({
      externalSaleId,
      folio: venta.folio,
      vendedoraId: venta.vendedoraId,
      monto: venta.montoTotal == null ? null : String(venta.montoTotal),
      moneda: venta.moneda,
      medio: venta.medio,
      origenVenta: venta.origen,
      estadoVenta: venta.estado,
      estadoPago: venta.estadoPago,
      cerberusClienteId: venta.cliente.cerberusClienteId,
      telefonos: venta.cliente.telefonos.length,
      motivo,
      fuenteVenta: venta.fuente,
      ocurridaAt: venta.ocurridaAt,
      vistaAt: ahora,
    })
    .onConflictDoUpdate({
      target: ventasNoAtribuidas.externalSaleId,
      set: {
        folio: venta.folio,
        vendedoraId: venta.vendedoraId,
        monto: venta.montoTotal == null ? null : String(venta.montoTotal),
        moneda: venta.moneda,
        medio: venta.medio,
        origenVenta: venta.origen,
        estadoVenta: venta.estado,
        estadoPago: venta.estadoPago,
        cerberusClienteId: venta.cliente.cerberusClienteId,
        telefonos: venta.cliente.telefonos.length,
        motivo,
        fuenteVenta: venta.fuente,
        ocurridaAt: venta.ocurridaAt,
        vistaAt: ahora,
      },
    });
}
