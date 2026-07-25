import test from "node:test";
import assert from "node:assert/strict";
import { COLORES_CATEGORIA } from "../categorias/paleta.js";
import { esCotizacion } from "./cotizacion.js";
import { evaluarEnfriamiento } from "./enfriamiento.js";
import {
  CATALOGO_AUTOMATICAS,
  chocaConCategoriasDefault,
  etiquetasDeSenal,
} from "./etiquetasAutomaticas.js";

const AHORA = new Date("2026-07-25T12:00:00Z");
const haceDias = (d: number) => new Date(AHORA.getTime() - d * 24 * 60 * 60 * 1000);

const cotizacionDe = (texto: string, cuando: Date) => ({
  ...esCotizacion(texto),
  ocurridoEn: cuando.toISOString(),
});

test("sin cotización y sin enfriamiento no hay ninguna etiqueta", () => {
  const r = etiquetasDeSenal({
    cotizacion: null,
    enfriamiento: evaluarEnfriamiento({ cotizadaEn: null, ultimoEntranteEn: null, ahora: AHORA }),
  });
  assert.deepEqual(r, []);
});

test("una cotización fresca deja «Cotizado» sola", () => {
  const r = etiquetasDeSenal({
    cotizacion: cotizacionDe("La inversión es S/250", haceDias(1)),
    corroborada: true,
    enfriamiento: evaluarEnfriamiento({
      cotizadaEn: haceDias(1),
      ultimoEntranteEn: null,
      ahora: AHORA,
    }),
  });
  assert.deepEqual(
    r.map((e) => e.clave),
    ["cotizado"],
  );
  assert.match(r[0].detalle, /flyer|temario/);
});

test("cotizada y muda hace días: las dos, y en ese orden", () => {
  const r = etiquetasDeSenal({
    cotizacion: cotizacionDe("La inversión es S/250", haceDias(6)),
    corroborada: true,
    enfriamiento: evaluarEnfriamiento({
      cotizadaEn: haceDias(6),
      ultimoEntranteEn: null,
      ahora: AHORA,
    }),
  });
  assert.deepEqual(
    r.map((e) => e.clave),
    ["cotizado", "enfriado"],
  );
  assert.match(r[1].detalle, /6 días/);
});

test("una cotización de confianza media y sin corroborar se marca «sin confirmar»", () => {
  const r = etiquetasDeSenal({
    cotizacion: cotizacionDe("S/250", haceDias(1)),
    corroborada: false,
    enfriamiento: evaluarEnfriamiento({
      cotizadaEn: haceDias(1),
      ultimoEntranteEn: null,
      ahora: AHORA,
    }),
  });
  assert.match(r[0].rotulo, /sin confirmar/);
});

test("la misma cotización media, pero corroborada por el flyer, ya no duda", () => {
  const r = etiquetasDeSenal({
    cotizacion: cotizacionDe("S/250", haceDias(1)),
    corroborada: true,
    enfriamiento: evaluarEnfriamiento({
      cotizadaEn: haceDias(1),
      ultimoEntranteEn: null,
      ahora: AHORA,
    }),
  });
  assert.equal(r[0].rotulo, "Cotizado");
});

test("los colores salen de la paleta cerrada — y ninguno es oro", () => {
  for (const [clave, def] of Object.entries(CATALOGO_AUTOMATICAS)) {
    assert.ok(
      (COLORES_CATEGORIA as readonly string[]).includes(def.color),
      `${clave} usa un color fuera de la paleta: ${def.color}`,
    );
    assert.doesNotMatch(def.color, /oro|gold|ambar|amarillo/i);
  }
});

test("ningún rótulo automático choca con una categoría manual por defecto", () => {
  assert.deepEqual(chocaConCategoriasDefault(), []);
});
