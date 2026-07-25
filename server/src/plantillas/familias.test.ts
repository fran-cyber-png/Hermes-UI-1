import test from "node:test";
import assert from "node:assert/strict";
import type { ProductoCatalogo } from "../cerberus/productos.js";
import {
  agruparEnFamilias,
  familiaDeProducto,
  precioVigente,
  ultimaEdicion,
} from "./familias.js";

const producto = (p: Partial<ProductoCatalogo> & { sku: string; nombre: string }): ProductoCatalogo => ({
  id: p.sku,
  precioNormal: 250,
  precioPromocion: 0,
  moneda: "S/",
  ...p,
});

/** Los tres nombres reales de la misma familia, medidos contra Cerberus (#129). */
const DIPICOT = [
  producto({ sku: "DIPICOT011", nombre: "Diploma de Especialización en Inteligencia y Contrainteligencia 11" }),
  producto({ sku: "DIPICOT014", nombre: "Diploma de Especialización en Inteligencia y Contrainteligencia 14" }),
  producto({ sku: "DIPICOT026", nombre: "Diploma Internacional de Inteligencia y Contrainteligencia 26" }),
];

test("tres nombres distintos, una sola familia: manda el prefijo del SKU", () => {
  const familias = new Set(DIPICOT.map((p) => familiaDeProducto(p.sku, p.nombre).familia));
  assert.deepEqual([...familias], ["DIPICOT"]);
});

test("la edición sale del sufijo numérico del SKU", () => {
  assert.equal(familiaDeProducto("DIPICOT026", "cualquiera").edicion, 26);
  assert.equal(familiaDeProducto("DIPCPOL025", "cualquiera").edicion, 25);
});

test("los 30 productos sin número no revientan: familia sí, edición null", () => {
  const f = familiaDeProducto("DIPSTC", "Diploma de Director de Comunicaciones");
  assert.equal(f.familia, "DIPSTC");
  assert.equal(f.edicion, null);
});

test("cada GEN* es su propia familia — no se agrupan entre sí", () => {
  const a = familiaDeProducto("GEN9000F6", "Pack genérico");
  const b = familiaDeProducto("GEN5C2G3", "Otro pack");
  assert.equal(a.familia, "GEN9000F6");
  assert.equal(b.familia, "GEN5C2G3");
  assert.notEqual(a.familia, b.familia);
});

test("el nombre corto se queda sin el número de edición (es lo que se trunca hoy)", () => {
  assert.equal(
    familiaDeProducto("DIPICOT026", "Diploma Internacional de Inteligencia y Contrainteligencia 26").nombreCorto,
    "Diploma Internacional de Inteligencia y Contrainteligencia",
  );
  assert.equal(familiaDeProducto("EPCOORP009", "Oratoria para Políticos N° 9").nombreCorto, "Oratoria para Políticos");
});

test("sin SKU, la familia sale del nombre sin acentos ni número", () => {
  const a = familiaDeProducto("", "Diploma de Inteligencia 14");
  const b = familiaDeProducto("", "diploma de inteligéncia 26");
  assert.equal(a.familia, "DIPLOMA DE INTELIGENCIA");
  assert.equal(b.familia, "DIPLOMA DE INTELIGENCIA");
});

test("la última edición es la de mayor número, no la primera del listado", () => {
  const u = ultimaEdicion(DIPICOT, "DIPICOT");
  assert.equal(u?.sku, "DIPICOT026");
});

test("una familia sin productos activos devuelve null — y ese null es el hueco de {precio}", () => {
  assert.equal(ultimaEdicion(DIPICOT, "DIPCPOL"), null);
});

test("el precio vigente prefiere la promoción cuando existe", () => {
  assert.equal(precioVigente(producto({ sku: "X1", nombre: "x", precioNormal: 250, precioPromocion: 199 })), 199);
  assert.equal(precioVigente(producto({ sku: "X1", nombre: "x", precioNormal: 250, precioPromocion: 0 })), 250);
});

test("agrupar da UNA fila por diploma, con su última edición y cuántas tiene", () => {
  const catalogo = [
    ...DIPICOT,
    producto({ sku: "DIPCPOL025", nombre: "Diploma de Consultor Político 25" }),
    producto({ sku: "DIPCPOL024", nombre: "Diploma de Consultor Político 24" }),
  ];
  const familias = agruparEnFamilias(catalogo);
  assert.equal(familias.length, 2, "cinco productos, dos diplomas");
  const icot = familias.find((f) => f.familia === "DIPICOT")!;
  assert.equal(icot.ultima.sku, "DIPICOT026");
  assert.equal(icot.ediciones, 3);
  assert.doesNotMatch(icot.nombreCorto, /\d/, "el nombre corto no lleva número: por eso se distinguían mal");
});
