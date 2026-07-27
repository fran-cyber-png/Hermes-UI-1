import { test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarMensaje } from "../pruebas/sembrar.js";
import { procesarLote, type EventoGuardado } from "./puenteIcarus.js";

/**
 * EL PUENTE TEMPORAL, sobre la forma real de `icarus.cerberus_events`: una fila = un payload
 * crudo de Cerberus. Lo que se fija acá es que el puente **no interpreta nada por su cuenta** —
 * pasa por el mismo camino que el webhook— y que un lote mezclado (ventas, catálogo, basura)
 * no lo detiene ni le hace perder una venta.
 */

const NUMERO_PROPIO = "51986394450";

function payloadVenta(id: string, telefono: string, extra: Record<string, unknown> = {}) {
  return {
    source: "cerberus",
    event_type: "sale.created",
    event_id: `cerberus:sale:${id}:created`,
    event_timestamp: "2026-07-27T12:00:00-05:00",
    external_sale_id: id,
    external_sale_folio: `GOB-${id}`,
    idempotency_key: `MANUAL-${id}`,
    cliente: { external_client_id: "1", nombre_completo: "P", telefono, telefonos: [telefono] },
    venta: {
      fecha_venta: "2026-07-27T11:00:00-05:00",
      monto_total: "100.00",
      moneda: "USD",
      medio: "pagado",
      origen: "whatsapp",
      estado: 1,
      estado_pago: "pagado_completo",
      vendedor: "ana",
    },
    ...extra,
  };
}

const LOTE: EventoGuardado[] = [
  { id: 1, payload: payloadVenta("101", "51987654321") }, // matchea
  { id: 2, payload: payloadVenta("102", "51911111111") }, // no matchea
  { id: 3, payload: { source: "cerberus", event_type: "products.sync", event_id: "p1" } },
  { id: 4, payload: { hola: "no soy un evento" } }, // basura
];

test("dry-run mide y NO escribe una sola fila", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51987654321", numeroPropio: NUMERO_PROPIO });

  const r = await procesarLote(db, LOTE);

  assert.equal(r.leidos, 4);
  assert.equal(r.noSonVenta, 1, "products.sync no es una venta");
  assert.equal(r.invalidos, 1, "la basura se cuenta, no se traga");
  assert.equal(r.atribuidas.telefono_e164, 1);
  assert.equal(r.sinAtribuir.sin_conversacion, 1);
  assert.equal(r.ultimoId, 4, "el cursor avanza aunque el evento no sea una venta");

  const [{ n }] = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM conversiones_wa`);
  assert.equal(n, 0, "dry-run no escribe");
});

test("con --aplicar proyecta, y correrlo dos veces no duplica nada", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51987654321", numeroPropio: NUMERO_PROPIO });

  await procesarLote(db, LOTE, { aplicar: true });
  await procesarLote(db, LOTE, { aplicar: true });

  const [{ n }] = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM conversiones_wa`);
  assert.equal(n, 1);

  const [{ n: sin }] = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM ventas_no_atribuidas`,
  );
  assert.equal(sin, 1, "la venta que no matchea queda contada una sola vez");

  const [fila] = await db.execute<{ fuente_venta: string; folio: string }>(
    sql`SELECT fuente_venta, folio FROM conversiones_wa`,
  );
  assert.equal(fila.fuente_venta, "puente-icarus", "la fila dice de dónde salió: el puente se apaga");
  assert.equal(fila.folio, "GOB-101");
});

test("un payload que no valida no detiene el lote: la venta siguiente entra igual", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51987654321", numeroPropio: NUMERO_PROPIO });

  const r = await procesarLote(
    db,
    [{ id: 1, payload: { roto: true } }, { id: 2, payload: payloadVenta("101", "51987654321") }],
    { aplicar: true },
  );

  assert.equal(r.invalidos, 1);
  assert.equal(r.atribuidas.telefono_e164, 1);
  assert.equal(r.ejemplosInvalidos.length, 1, "el motivo queda escrito, no se pierde");
});
