import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { claveDeVenta, tokenValido, tipoAceptado, extraerVenta } from "./cerberus.js";

/**
 * El receptor del webhook de Cerberus. Los tests capturan las TRES trampas del contrato real,
 * leídas de su código (no supuestas):
 *
 *   1. La auth es `?token=` en la URL, NO un HMAC en un header.
 *   2. `event_id` NO es idempotente para sale.updated (trae timestamp de microsegundos). La
 *      llave estable de una venta es `external_sale_id`.
 *   3. Cerberus es fire-and-forget: si fallamos, pierde el evento sin reintentar.
 */

describe("tokenValido", () => {
  test("acepta el token correcto", () => {
    assert.equal(tokenValido("secreto-123", "secreto-123"), true);
  });
  test("rechaza el equivocado, el vacío y el ausente", () => {
    assert.equal(tokenValido("otro", "secreto-123"), false);
    assert.equal(tokenValido("", "secreto-123"), false);
    assert.equal(tokenValido(undefined, "secreto-123"), false);
  });
  test("sin secreto configurado NUNCA valida — falla cerrado", () => {
    assert.equal(tokenValido("secreto-123", undefined), false);
    assert.equal(tokenValido("secreto-123", ""), false);
  });
});

describe("tipoAceptado", () => {
  test("los cuatro tipos del contrato", () => {
    for (const t of ["sale.created", "sale.updated", "sale.deleted", "products.sync"]) {
      assert.equal(tipoAceptado(t), true);
    }
  });
  test("rechaza cualquier otra cosa", () => {
    assert.equal(tipoAceptado("sale.whatever"), false);
    assert.equal(tipoAceptado(""), false);
    assert.equal(tipoAceptado(undefined), false);
  });
});

describe("claveDeVenta — LA TRAMPA DE IDEMPOTENCIA", () => {
  test("usa external_sale_id, NO event_id", () => {
    // Estos dos payloads son la MISMA venta, mandada dos veces (Cerberus la reenvía al confirmar
    // el pago). Sus event_id son distintos porque traen timestamp de microsegundos. Si
    // dedupeáramos por event_id, guardaríamos la venta dos veces.
    const primero = { external_sale_id: "1001", event_id: "cerberus:sale:1001:updated:20260710153045123456" };
    const segundo = { external_sale_id: "1001", event_id: "cerberus:sale:1001:updated:20260710160212998877" };
    assert.equal(claveDeVenta(primero), claveDeVenta(segundo), "la misma venta → la misma clave");
  });

  test("ventas distintas → claves distintas", () => {
    assert.notEqual(
      claveDeVenta({ external_sale_id: "1001" }),
      claveDeVenta({ external_sale_id: "1002" }),
    );
  });

  test("cae al folio si no hay id", () => {
    assert.equal(claveDeVenta({ external_sale_folio: "F-1001" }), "F-1001");
  });

  test("sin ninguna de las dos, no hay clave", () => {
    assert.equal(claveDeVenta({}), null);
  });
});

describe("extraerVenta — del payload de Cerberus a lo que el lazo necesita", () => {
  const payload = {
    external_sale_id: "1001",
    external_sale_folio: "GOB-11851",
    venta: {
      estado: 1,
      monto_total: 350.0,
      moneda: "PEN",
      estado_pago: "pagado_completo",
    },
    cliente: {
      correo: "juan@gmail.com",
      telefono: "+51 999888777",
      pais: "Peru",
    },
    cuotas: [
      { numero: 1, estado_pago: "pagada", fecha_vencimiento: "2026-07-10T10:00:00-05:00" },
    ],
  };

  test("saca folio, estado, monto, moneda e identidad", () => {
    const v = extraerVenta(payload);
    assert.equal(v.folio, "GOB-11851");
    assert.equal(v.estado, 1);
    assert.equal(v.montoTotal, 350);
    assert.equal(v.moneda, "PEN"); // ya viene en ISO, no hay que convertir
    assert.equal(v.cliente.email, "juan@gmail.com");
    assert.equal(v.cliente.telefono, "+51 999888777");
    assert.equal(v.cliente.pais, "PE"); // "Peru" → código ISO
  });

  test("la moneda viene en ISO de Cerberus — no la tocamos", () => {
    for (const iso of ["USD", "MXN", "BOB", "COP", "CLP", "DOP"]) {
      const v = extraerVenta({ ...payload, venta: { ...payload.venta, moneda: iso } });
      assert.equal(v.moneda, iso);
    }
  });

  test("un país que no reconocemos deja pais en null, no revienta", () => {
    const v = extraerVenta({ ...payload, cliente: { ...payload.cliente, pais: "Marte" } });
    assert.equal(v.cliente.pais, null);
  });
});
