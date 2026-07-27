import test from "node:test";
import assert from "node:assert/strict";
import { armarLlaveAtribucion } from "./llave.js";
import { leerEventoCerberus, ventaDeEvento } from "./payload.js";

/**
 * El contrato de Cerberus, contra la forma REAL del emisor
 * (`ceberusapp/sales/icarus_payload.py:321-383`). Los datos son inventados; la FORMA no —
 * incluidos los importes como string, que es como Django serializa un `Decimal`.
 */

const EVENTO = {
  source: "cerberus",
  event_type: "sale.created",
  event_id: "cerberus:sale:12345:created:20260727120000123456",
  event_timestamp: "2026-07-27T12:00:00-05:00",
  external_sale_id: "12345",
  external_sale_folio: "GOB-000123",
  idempotency_key: "MANUAL-2024",
  cliente: {
    external_client_id: "987",
    codigo_cliente: "C-987",
    nombres: "Ada",
    apellidos: "Lovelace",
    nombre_completo: "Ada Lovelace",
    dni: "12345678",
    ocupacion: "Analista",
    pais: "Peru",
    correo: "ada@ejemplo.test",
    telefono: "51987654321",
    correos: ["ada@ejemplo.test"],
    telefonos: ["51987654321", "987654321"],
  },
  venta: {
    fecha_venta: "2026-07-27T11:30:00-05:00",
    fecha_registro: "2026-07-27T11:31:00-05:00",
    monto_total: "1250.00",
    monto_pagado: "1250.00",
    estado_pago: "pagado_completo",
    moneda_id: 1,
    moneda: "USD",
    medio: "pagado",
    medio_label: "Pagado",
    origen: "whatsapp",
    origen_label: "WhatsApp",
    estado: 1,
    estado_label: "Pagado",
    vendedor: "andreecito",
  },
  productos: [{ sku: "DIP-001" }],
  items: [{ external_sale_item_id: "1" }],
};

test("un evento real de Cerberus se lee entero", () => {
  const r = leerEventoCerberus(EVENTO);
  assert.equal(r.ok, true);

  const venta = ventaDeEvento((r as { ok: true; evento: never }).evento, "webhook")!;
  assert.equal(venta.externalSaleId, "12345");
  assert.equal(venta.folio, "GOB-000123");
  assert.equal(venta.vendedoraId, "andreecito");
  assert.equal(venta.montoTotal, 1250);
  assert.equal(venta.moneda, "USD");
  assert.equal(venta.medio, "pagado");
  assert.equal(venta.origen, "whatsapp");
  assert.equal(venta.estado, 1);
  assert.equal(venta.estadoPago, "pagado_completo");
  assert.equal(venta.cliente.cerberusClienteId, 987);
  assert.equal(venta.cliente.nombre, "Ada Lovelace");
  assert.equal(venta.cliente.pais, "Peru", "sin el país, un teléfono local no llega a E.164 (#119)");
  assert.deepEqual(venta.cliente.telefonos, ["51987654321", "987654321"]);
  assert.equal(venta.ocurridaAt.toISOString(), "2026-07-27T16:30:00.000Z");
  assert.equal(venta.fuente, "webhook");
});

test("la conversación vuelve de Cerberus dentro del idempotency_key", () => {
  const clave = "conv:whatsapp:51987654321:51986394450";
  const llave = armarLlaveAtribucion({ vendedoraId: "andreecito", clave });

  const r = leerEventoCerberus({ ...EVENTO, idempotency_key: llave });
  const venta = ventaDeEvento((r as { ok: true; evento: never }).evento, "webhook")!;

  assert.equal(venta.conversacion?.clave, clave);
  assert.equal(venta.conversacion?.numeroPropio, "51986394450");
});

test("una venta cargada a mano en Cerberus no inventa conversación", () => {
  const r = leerEventoCerberus(EVENTO);
  const venta = ventaDeEvento((r as { ok: true; evento: never }).evento, "webhook")!;
  assert.equal(venta.conversacion, null);
});

test("los campos nuevos de Cerberus pasan sin romper nada", () => {
  // Cerberus agregó `division` hace poco. Un campo nuevo del ERP no puede ser una caída nuestra.
  const r = leerEventoCerberus({
    ...EVENTO,
    venta: { ...EVENTO.venta, campo_que_no_existe_todavia: { a: 1 } },
    campo_raiz_nuevo: [1, 2, 3],
  });
  assert.equal(r.ok, true);
});

test("sin event_type o sin event_id se rechaza con el motivo escrito", () => {
  const sinTipo = leerEventoCerberus({ ...EVENTO, event_type: "" });
  assert.equal(sinTipo.ok, false);
  assert.match((sinTipo as { motivo: string }).motivo, /payload inválido/);

  const { event_id: _, ...sinId } = EVENTO;
  const r = leerEventoCerberus(sinId);
  assert.equal(r.ok, false);
  assert.match((r as { motivo: string }).motivo, /event_id/);
});

test("un event_type desconocido se rechaza — no se adivina", () => {
  const r = leerEventoCerberus({ ...EVENTO, event_type: "sale.reticulada" });
  assert.equal(r.ok, false);
  assert.match((r as { motivo: string }).motivo, /sale\.reticulada/);
});

test("un monto que no es un número queda en null, nunca en NaN", () => {
  const r = leerEventoCerberus({ ...EVENTO, venta: { ...EVENTO.venta, monto_total: "" } });
  const venta = ventaDeEvento((r as { ok: true; evento: never }).evento, "webhook")!;
  assert.equal(venta.montoTotal, null);
});

test("products.sync y sale.deleted no son ventas que proyectar", () => {
  for (const tipo of ["products.sync", "sale.deleted"]) {
    const r = leerEventoCerberus({ ...EVENTO, event_type: tipo });
    assert.equal(r.ok, true, tipo);
    assert.equal(ventaDeEvento((r as { ok: true; evento: never }).evento, "webhook"), null, tipo);
  }
});

test("sin external_sale_id no hay llave natural: no se proyecta", () => {
  const r = leerEventoCerberus({ ...EVENTO, external_sale_id: "" });
  assert.equal(r.ok, true);
  assert.equal(ventaDeEvento((r as { ok: true; evento: never }).evento, "webhook"), null);
});

test("un evento sin cliente ni venta se lee igual (Cerberus los omite en sale.deleted)", () => {
  const { cliente: _c, venta: _v, ...pelado } = EVENTO;
  const r = leerEventoCerberus({ ...pelado, event_type: "sale.updated" });
  assert.equal(r.ok, true);

  const venta = ventaDeEvento((r as { ok: true; evento: never }).evento, "puente-icarus")!;
  assert.equal(venta.vendedoraId, null);
  assert.equal(venta.montoTotal, null);
  assert.deepEqual(venta.cliente.telefonos, []);
  // Sin `fecha_venta` cae al timestamp del evento: ubicarlo mal en el tiempo sería peor.
  assert.equal(venta.ocurridaAt.toISOString(), "2026-07-27T17:00:00.000Z");
});

test("los teléfonos no se repiten aunque Cerberus los repita", () => {
  const r = leerEventoCerberus({
    ...EVENTO,
    cliente: { ...EVENTO.cliente, telefonos: ["51987654321", "51987654321", " "] },
  });
  const venta = ventaDeEvento((r as { ok: true; evento: never }).evento, "webhook")!;
  assert.deepEqual(venta.cliente.telefonos, ["51987654321"]);
});
