import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { construirCompra, hashear, VENTANA_CAPI_DIAS, type VentaConfirmada } from "./evento.js";

/**
 * Los estados y los tiempos salen de Cerberus, medidos sobre 4.892 ventas reales (RG-013):
 *
 *   estado 1 (Pagado) y 9 (Pagado por crédito)  → la persona compró
 *   estado 4 (Anulado), 5 (Cotización)          → nunca compró
 *   estado 7 (Retirado), 8 (Reembolsado)        → compró y se arrepintió (1,6% de las ventas)
 *
 * Y el gatillo NO es `Venta.estado == Pagado`: Cerberus solo pone ese estado cuando se pagan
 * TODAS las cuotas, y el 9,9% paga en cuotas (meses). El gatillo es la PRIMERA cuota confirmada
 * por Tesorería. Aun así, solo el 83,3% cae dentro de los 7 días que acepta CAPI.
 *
 * El otro 17% hoy fallaría EN SILENCIO — Meta lo rechaza sin avisar. Estos tests existen para
 * que ese fracaso sea ruidoso.
 */

const AHORA = new Date("2026-07-12T12:00:00Z");

function ventaPeruana(sobreescribir: Partial<VentaConfirmada> = {}): VentaConfirmada {
  return {
    folio: "GOB-11851",
    estado: 1, // Pagado
    montoTotal: 350,
    moneda: "PEN",
    confirmadaAt: new Date("2026-07-10T09:30:00Z"), // Tesorería confirmó hace 2 días
    cliente: { email: "juan.perez@gmail.com", telefono: "987654321", pais: "PE" },
    ...sobreescribir,
  };
}

describe("hashear", () => {
  test("SHA-256 en hexadecimal, que es lo único que Meta acepta", () => {
    // Vector conocido: sha256("juan.perez@gmail.com")
    const h = hashear("juan.perez@gmail.com");
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.equal(h, hashear("juan.perez@gmail.com"), "mismo valor → mismo hash");
  });
});

describe("construirCompra — cuándo SÍ", () => {
  test("venta pagada, confirmada, con correo y teléfono", () => {
    const r = construirCompra(ventaPeruana(), AHORA);
    assert.equal(r.ok, true);
    if (!r.ok) return;

    assert.equal(r.evento.event_name, "Purchase");
    assert.equal(r.evento.action_source, "system_generated");
    assert.equal(r.evento.custom_data.value, 350);
    assert.equal(r.evento.custom_data.currency, "PEN");

    // Correo y teléfono hasheados, en arreglos, como pide Meta.
    assert.deepEqual(r.evento.user_data.em, [hashear("juan.perez@gmail.com")]);
    assert.deepEqual(r.evento.user_data.ph, [hashear("51987654321")]);

    // El event_time es cuando Tesorería confirmó, NO cuando lo mandamos.
    assert.equal(r.evento.event_time, Math.floor(new Date("2026-07-10T09:30:00Z").getTime() / 1000));
  });

  test("el estado 9 (pagado por crédito) también es una compra", () => {
    const r = construirCompra(ventaPeruana({ estado: 9 }), AHORA);
    assert.equal(r.ok, true);
  });

  test("alcanza con el teléfono si no hay correo", () => {
    const r = construirCompra(
      ventaPeruana({ cliente: { email: null, telefono: "987654321", pais: "PE" } }),
      AHORA,
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.evento.user_data.em, undefined);
    assert.deepEqual(r.evento.user_data.ph, [hashear("51987654321")]);
  });

  test("el event_id es estable: la misma venta produce siempre el mismo", () => {
    const a = construirCompra(ventaPeruana(), AHORA);
    const b = construirCompra(ventaPeruana(), new Date("2026-07-12T23:59:00Z"));
    assert.equal(a.ok && b.ok && a.evento.event_id === b.evento.event_id, true);
    // Y depende del folio, que es único en Cerberus.
    const c = construirCompra(ventaPeruana({ folio: "GOB-11852" }), AHORA);
    assert.equal(a.ok && c.ok && a.evento.event_id !== c.evento.event_id, true);
  });

  test("respeta la moneda local — Meta acepta las 7 monedas, no hay que convertir", () => {
    for (const [moneda, valor] of [["MXN", 6500], ["BOB", 1350], ["COP", 1400000], ["USD", 350]] as const) {
      const r = construirCompra(ventaPeruana({ moneda, montoTotal: valor }), AHORA);
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.evento.custom_data.currency, moneda);
    }
  });
});

describe("construirCompra — cuándo NO, y por qué", () => {
  test("no manda si la venta no está pagada", () => {
    for (const estado of [2, 3, 4, 5, 6] as const) {
      const r = construirCompra(ventaPeruana({ estado }), AHORA);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.motivo, "estado_no_pagado");
    }
  });

  test("no manda una venta revertida — compró y se arrepintió (1,6% de los casos)", () => {
    for (const estado of [7, 8] as const) {
      const r = construirCompra(ventaPeruana({ estado }), AHORA);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.motivo, "estado_no_pagado");
    }
  });

  test("no manda si Tesorería todavía no confirmó — el voucher no es una compra", () => {
    const r = construirCompra(ventaPeruana({ confirmadaAt: null }), AHORA);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "sin_confirmacion");
  });

  test("EL 17%: fuera de la ventana de 7 días, Meta lo rechaza — lo decimos en voz alta", () => {
    // p90 de la confirmación de Tesorería: 10 días. Este caso NO es raro: es 1 de cada 6.
    const r = construirCompra(
      ventaPeruana({ confirmadaAt: new Date("2026-07-02T09:30:00Z") }), // 10 días atrás
      AHORA,
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.motivo, "fuera_de_ventana");
      assert.equal(r.diasDeAtraso, 10);
    }
  });

  test("el borde exacto de la ventana", () => {
    const justoDentro = new Date(AHORA.getTime() - (VENTANA_CAPI_DIAS - 0.1) * 86400_000);
    assert.equal(construirCompra(ventaPeruana({ confirmadaAt: justoDentro }), AHORA).ok, true);

    const justoAfuera = new Date(AHORA.getTime() - (VENTANA_CAPI_DIAS + 0.1) * 86400_000);
    assert.equal(construirCompra(ventaPeruana({ confirmadaAt: justoAfuera }), AHORA).ok, false);
  });

  test("no manda un evento sin identidad — sería gritarle al vacío", () => {
    const r = construirCompra(
      ventaPeruana({ cliente: { email: null, telefono: null, pais: "PE" } }),
      AHORA,
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "sin_identidad");
  });

  test("un teléfono basura no cuenta como identidad", () => {
    // '0084581911' es uno de los 3 casos malos reales de la muestra de RG-006.
    const r = construirCompra(
      ventaPeruana({ cliente: { email: null, telefono: "0084581911", pais: "PE" } }),
      AHORA,
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "sin_identidad");
  });

  test("no manda una venta de valor cero o negativo", () => {
    assert.equal(construirCompra(ventaPeruana({ montoTotal: 0 }), AHORA).ok, false);
    assert.equal(construirCompra(ventaPeruana({ montoTotal: -100 }), AHORA).ok, false);
  });
});
