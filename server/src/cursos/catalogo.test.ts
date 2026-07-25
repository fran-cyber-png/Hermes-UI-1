import { test } from "node:test";
import assert from "node:assert/strict";
import type { ProductoCatalogo } from "../cerberus/productos.js";
import { elegirUltimaEdicion, familiaDeSku } from "./catalogo.js";

/**
 * QUÉ EDICIÓN SE VENDE HOY — puro, sobre el catálogo de Cerberus (#129).
 *
 * Los SKU y los nombres son literales del catálogo vivo (medido el 25-jul-2026:
 * 111 productos activos, 38 familias). El punto del módulo: la vendedora
 * confirma «Inteligencia y Contrainteligencia» y lo que se registra es el
 * **nombre crudo de la última edición**, que es lo que Cerberus sabe facturar.
 */

const p = (
  id: string,
  sku: string,
  nombre: string,
  precioNormal = 250,
): ProductoCatalogo => ({ id, sku, nombre, precioNormal, precioPromocion: precioNormal, moneda: "" });

const CATALOGO: ProductoCatalogo[] = [
  p("1901", "DIPICOT011", "Diploma de Especialización en Inteligencia y Contrainteligencia 11"),
  p("1905", "DIPICOT014", "Diploma Internacional de Inteligencia y Contrainteligencia"),
  p("1908", "DIPICOT026", "diploma internacional de inteligencia y contrainteligencia 26"),
  p("1909", "DIPCPOL025", "Diploma Internacional del Consultor Político 25", 199),
  p("1733", "EPCOORP004", "Curso de Especialización Oratoria para Políticos 4", 150),
  p("1738", "EPCOORP009", "Curso de Especialización Oratoria para Políticos 9", 150),
  p("2001", "GEN9000F6", "Pago de matrícula", 50),
];

test("familiaDeSku: el prefijo alfabético es la identidad; los GEN* son cada uno lo suyo", () => {
  assert.equal(familiaDeSku("DIPICOT014"), "DIPICOT");
  assert.equal(familiaDeSku("dipicot026"), "DIPICOT");
  assert.equal(familiaDeSku("GEN9000F6"), "GEN9000F6");
  assert.equal(familiaDeSku(""), null);
  assert.equal(familiaDeSku("123"), null);
});

test("elige la ÚLTIMA edición de la familia, con su nombre CRUDO", () => {
  const r = elegirUltimaEdicion(CATALOGO, "DIPICOT");
  assert.equal(r?.sku, "DIPICOT026");
  assert.equal(r?.nombre, "diploma internacional de inteligencia y contrainteligencia 26");
});

test("la edición sale del SKU, no del nombre (hay ediciones sin número en el nombre)", () => {
  // DIPICOT014 no tiene número en el nombre y aun así es la edición 14: si la
  // edición se leyera del nombre, este producto competiría como «sin edición».
  const soloCatorceYOnce = CATALOGO.filter((x) => x.sku === "DIPICOT014" || x.sku === "DIPICOT011");
  assert.equal(elegirUltimaEdicion(soloCatorceYOnce, "DIPICOT")?.sku, "DIPICOT014");
});

test("otra familia, otra última edición", () => {
  assert.equal(elegirUltimaEdicion(CATALOGO, "EPCOORP")?.sku, "EPCOORP009");
  assert.equal(elegirUltimaEdicion(CATALOGO, "DIPCPOL")?.sku, "DIPCPOL025");
});

test("una familia que no está en el catálogo devuelve null — no se sustituye por otra", () => {
  assert.equal(elegirUltimaEdicion(CATALOGO, "DIPOSOC"), null);
  assert.equal(elegirUltimaEdicion([], "DIPICOT"), null);
});

test("sin número de edición gana el código de producto más alto (el más nuevo en Cerberus)", () => {
  const sinNumero = [
    p("1600", "INCOPIE", "Curso de Criminología y Ciencias Forenses"),
    p("1789", "INCOPIE", "Diploma en Criminología y Ciencias Forenses"),
  ];
  assert.equal(elegirUltimaEdicion(sinNumero, "INCOPIE")?.id, "1789");
});

test("un producto sin SKU no se cuela en ninguna familia", () => {
  const raro = [p("999", "", "Producto sin SKU"), ...CATALOGO];
  assert.equal(elegirUltimaEdicion(raro, "DIPICOT")?.sku, "DIPICOT026");
});
