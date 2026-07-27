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

/**
 * Los tres GEN* REALES del catálogo (26-jul-2026) son cursos que no tienen NADA
 * que ver entre sí. Si algún día el prefijo volviera a ser la familia, los tres
 * caerían en la misma bolsa «GEN» y el Dashboard mostraría 738 personas
 * interesadas en un curso que no existe.
 */
test("Bicameral, Cartografía y Dirección Corporativa NO caen en una bolsa «GEN»", () => {
  const familias = [
    familiaDeProducto("GEN5C4BE8", "Diploma de especialización Bicameral 1").familia,
    familiaDeProducto("GEN15527B", "Diploma intensivo en entrenamiento de Cartografía Electoral 1").familia,
    familiaDeProducto("GENCDE6AE", "Diploma Élite Internacional En Dirección Corporativa De Seguridad").familia,
  ];
  assert.equal(new Set(familias).size, 3, "tres cursos distintos, tres familias distintas");
  assert.equal(familias.includes("GEN"), false, "«GEN» no es una familia: es un prefijo sin dueño");
});

/**
 * EL SKU CON SUFIJO DE DESAMBIGUACIÓN. En el catálogo vivo conviven
 * `DIPICOT003-6B5D` y `DIPCOCO003-EB71` con sus hermanos sin sufijo. Con el
 * patrón viejo (`^([A-Z]+)(\d+)$`) esos SKUs no matcheaban y la familia
 * terminaba siendo el SKU entero: la edición 3 de Inteligencia quedaba fuera de
 * DIPICOT, invisible para `ultimaEdicion` y como fila propia en el selector.
 */
test("un SKU con sufijo `-XXXX` sigue siendo de su familia, con su edición", () => {
  const f = familiaDeProducto("DIPICOT003-6B5D", "Diploma de Especialización en Inteligencia y Contrainteligencia 3");
  assert.equal(f.familia, "DIPICOT");
  assert.equal(f.edicion, 3);
  assert.equal(familiaDeProducto("DIPCOCO002-BFA8", "Diploma de Contraterrorismo 2").familia, "DIPCOCO");
});

test("el Foro de Estado es un evento del catálogo y tiene familia como cualquier otro", () => {
  const f = familiaDeProducto("EVGLINTEST003", "Foro De Estado Perú 2026");
  assert.equal(f.familia, "EVGLINTEST");
  assert.equal(f.edicion, 3);
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
