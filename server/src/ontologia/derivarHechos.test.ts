import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { dePago, deVenta, fecha } from "./derivarHechos.js";

describe("fecha — Cerberus manda de todo", () => {
  test("una fecha simple", () => {
    assert.equal(fecha("2026-07-11")?.toISOString().slice(0, 10), "2026-07-11");
  });

  test("una fecha con hora, en el formato de MySQL", () => {
    assert.equal(fecha("2026-07-11 14:02:00")?.toISOString().slice(0, 10), "2026-07-11");
  });

  test("null, vacío y basura dan null en vez de un Date inválido", () => {
    for (const v of [null, undefined, "", "   ", "no soy una fecha"]) {
      assert.equal(fecha(v), null, `${JSON.stringify(v)} debería dar null`);
    }
  });

  test("'0000-00-00' da null: es el null de MySQL disfrazado de fecha", () => {
    // Parsearlo fecharía un hecho en el año 0 y ensuciaría toda serie temporal para siempre.
    assert.equal(fecha("0000-00-00"), null);
    assert.equal(fecha("0000-00-00 00:00:00"), null);
  });
});

describe("deVenta — VentaCreada", () => {
  const venta = {
    folio_venta: "GOB-11851",
    fecha_venta: "2026-03-14",
    monto_total: "900.00",
    codigo_moneda: "3",
    codigo_cliente: "4821",
    estado: "1",
  };

  test("una venta produce exactamente un hecho", () => {
    const r = deVenta(venta);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.hechos.length, 1);
      assert.equal(r.hechos[0].tipo, "VentaCreada");
      assert.equal(r.hechos[0].sujetoId, "GOB-11851");
      assert.equal(r.hechos[0].claveNatural, "venta:GOB-11851");
    }
  });

  test("ocurridoAt es fecha_venta, nunca now()", () => {
    const r = deVenta(venta);
    if (r.ok) assert.equal(r.hechos[0].ocurridoAt.toISOString().slice(0, 10), "2026-03-14");
  });

  test("NO convierte la moneda: hornear una tasa en un hecho es una mentira futura", () => {
    const r = deVenta(venta);
    if (r.ok) {
      assert.equal(r.hechos[0].payload.montoTotal, 900);
      assert.equal(r.hechos[0].payload.codigoMoneda, "3");
      assert.equal(r.hechos[0].payload.montoUsd, undefined);
    }
  });

  test("una venta ANULADA no produce VentaAnulada — Cerberus no guarda cuándo se anuló", () => {
    // Es la regla central de este módulo. `fecha_edicion` no sirve: 4.849 de 6.448 ventas SANAS
    // también la tienen posterior. Significa "alguien tocó esto", no "se anuló acá".
    const anulada = { ...venta, estado: "4", fecha_edicion: "2026-06-10" };
    const r = deVenta(anulada);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.hechos.length, 1);
      assert.equal(r.hechos[0].tipo, "VentaCreada");
      assert.ok(!r.hechos.some((h) => String(h.tipo).includes("Anulada")));
    }
  });

  test("el estado va como contexto, marcado como 'al derivar' — no como hecho fechado", () => {
    const r = deVenta({ ...venta, estado: "7" });
    if (r.ok) assert.equal(r.hechos[0].payload.estadoAlDerivar, 7);
  });

  test("sin folio no hay hecho: no se podría referenciar", () => {
    const r = deVenta({ ...venta, folio_venta: null });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "sin_sujeto");
  });

  test("sin fecha no hay hecho, y se distingue de una fecha rota", () => {
    const sinFecha = deVenta({ ...venta, fecha_venta: null });
    assert.equal(sinFecha.ok, false);
    if (!sinFecha.ok) assert.equal(sinFecha.motivo, "sin_fecha");

    const rota = deVenta({ ...venta, fecha_venta: "0000-00-00" });
    assert.equal(rota.ok, false);
    if (!rota.ok) assert.equal(rota.motivo, "fecha_invalida");
  });
});

describe("dePago — PagoRegistrado y PagoConfirmado son hechos DISTINTOS", () => {
  const pago = {
    codigo_pago: "5159",
    codigo_cuota: "4427",
    fecha_pago: "2025-12-18",
    fecha_confirmacion: null as string | null,
    monto_pagado: "900.00",
    codigo_moneda: "3",
  };

  test("un pago sin confirmar da UN hecho, no dos", () => {
    // 5.239 de 7.255 pagos están así. No es un dato faltante: ese paso no ocurrió.
    const r = dePago(pago);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.hechos.length, 1);
      assert.equal(r.hechos[0].tipo, "PagoRegistrado");
    }
  });

  test("un pago confirmado da DOS hechos, con fechas distintas", () => {
    const r = dePago({ ...pago, fecha_confirmacion: "2025-12-28" });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.hechos.map((h) => h.tipo), ["PagoRegistrado", "PagoConfirmado"]);
      assert.equal(r.hechos[0].ocurridoAt.toISOString().slice(0, 10), "2025-12-18");
      assert.equal(r.hechos[1].ocurridoAt.toISOString().slice(0, 10), "2025-12-28");
    }
  });

  test("PagoRegistrado se marca autoreportado: la fecha la tipea un asesor a mano", () => {
    const r = dePago(pago);
    if (r.ok) assert.equal(r.hechos[0].payload.autoreportada, true);
  });

  test("la latencia se calcula UNA vez, en el hecho: es LA métrica del lazo", () => {
    const r = dePago({ ...pago, fecha_confirmacion: "2025-12-28" });
    if (r.ok) assert.equal(r.hechos[1].payload.latenciaDias, 10);
  });

  test("una latencia de 0 días es válida y no se confunde con ausencia", () => {
    const r = dePago({ ...pago, fecha_confirmacion: "2025-12-18" });
    if (r.ok) {
      assert.equal(r.hechos.length, 2);
      assert.equal(r.hechos[1].payload.latenciaDias, 0);
    }
  });

  test("fecha_confirmacion en '0000-00-00' NO produce PagoConfirmado", () => {
    const r = dePago({ ...pago, fecha_confirmacion: "0000-00-00" });
    if (r.ok) assert.equal(r.hechos.length, 1);
  });

  test("los dos hechos comparten claveNatural pero difieren en tipo: el UNIQUE es (tipo, clave)", () => {
    // Si el UNIQUE fuera solo la clave, el segundo hecho pisaría al primero en silencio.
    const r = dePago({ ...pago, fecha_confirmacion: "2025-12-28" });
    if (r.ok) {
      assert.equal(r.hechos[0].claveNatural, r.hechos[1].claveNatural);
      assert.notEqual(r.hechos[0].tipo, r.hechos[1].tipo);
    }
  });

  test("sin código de pago no hay hecho", () => {
    const r = dePago({ ...pago, codigo_pago: null });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "sin_sujeto");
  });
});
