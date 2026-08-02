import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { baseDePrueba } from "../pruebas/base.js";
import { intereses } from "../db/schema.js";
import type { ProductoCatalogo } from "../cerberus/productos.js";
import { registrarInteresDeFamilia, tieneInteresRegistrado } from "./registrarFamilia.js";

/**
 * EL INTERÉS QUE ESCRIBE EL BOT ES EL MISMO QUE ESCRIBE UNA VENDEDORA.
 *
 * Ahora hay dos caminos que registran un interés a partir de una familia (el
 * clic en «Confirmar» y el bot conversacional), y `intereses.curso` es lo que
 * después se cotiza. Si el bot guardara el nombre corto del alias en vez del
 * nombre crudo del producto, esa conversación quedaría con un curso que no
 * existe en el catálogo — y recién se notaría al intentar facturarla.
 *
 * Lo único que cambia entre los dos caminos es **quién firma**.
 */

const CLAVE = "conv:whatsapp:51961506674:51984429504";

/** Dos ediciones de DIPICOT y una de otra familia, como las devuelve Cerberus. */
const CATALOGO: ProductoCatalogo[] = [
  {
    id: "1901",
    sku: "DIPICOT011",
    nombre: "Diploma de Especialización en Inteligencia y Contrainteligencia 11",
    precioNormal: 250,
    precioPromocion: 250,
    moneda: "",
  },
  {
    id: "1908",
    sku: "DIPICOT026",
    nombre: "Diploma Internacional de Inteligencia y Contrainteligencia 26",
    precioNormal: 250,
    precioPromocion: 250,
    moneda: "",
  },
  {
    id: "1738",
    sku: "EPCOORP009",
    nombre: "Curso de Especialización Oratoria para Políticos 9",
    precioNormal: 150,
    precioPromocion: 150,
    moneda: "",
  },
];

test("🔴 el bot registra con `vendedora_id = 'bot'`, no a nombre de una persona", async (t) => {
  const db = await baseDePrueba(t);

  const r = await registrarInteresDeFamilia(db, {
    clave: CLAVE,
    familia: "DIPICOT",
    vendedoraId: "bot",
    catalogo: async () => CATALOGO,
  });

  assert.equal(r.ok, true);
  const [fila] = await db.select().from(intereses).where(eq(intereses.clave, CLAVE));
  // Quién lo afirmó es parte del dato: una ficha que dice «lo registró Luz»
  // cuando lo registró la máquina es una atribución falsa.
  assert.equal(fila.vendedoraId, "bot");
  // Y `intereses.vendedora_id` es `text` sin FK: «bot» entra sin migración.
});

test("guarda el nombre CRUDO de la última edición, con el producto atado", async (t) => {
  const db = await baseDePrueba(t);

  const r = await registrarInteresDeFamilia(db, {
    clave: CLAVE,
    familia: "DIPICOT",
    vendedoraId: "bot",
    catalogo: async () => CATALOGO,
  });

  assert.equal(r.ok && r.curso, "Diploma Internacional de Inteligencia y Contrainteligencia 26");
  const [fila] = await db.select().from(intereses).where(eq(intereses.clave, CLAVE));
  // El 1908 literal a propósito: es la 026, no la 011 que también es DIPICOT.
  assert.equal(fila.productoId, "1908");
  assert.equal(fila.sku, "DIPICOT026");
});

test("registrar dos veces la misma familia no duplica la fila", async (t) => {
  const db = await baseDePrueba(t);
  const orden = {
    clave: CLAVE,
    familia: "DIPICOT",
    vendedoraId: "bot",
    catalogo: async () => CATALOGO,
  };

  assert.equal((await registrarInteresDeFamilia(db, orden)).ok, true);
  assert.equal((await registrarInteresDeFamilia(db, orden)).ok, true);

  const filas = await db.select().from(intereses).where(eq(intereses.clave, CLAVE));
  assert.equal(filas.length, 1, "el `unique (clave, curso)` y el onConflictDoNothing alcanzan");
});

test("si la familia no tiene ninguna edición activa, NO se registra nada parecido", async (t) => {
  const db = await baseDePrueba(t);

  const r = await registrarInteresDeFamilia(db, {
    clave: CLAVE,
    familia: "DIPICOT",
    vendedoraId: "bot",
    catalogo: async () => CATALOGO.filter((p) => p.sku.startsWith("EPCOORP")),
  });

  assert.equal(r.ok === false && r.codigo, "sin_producto");
  assert.equal((await db.select().from(intereses).where(eq(intereses.clave, CLAVE))).length, 0);
});

test("si Cerberus no responde, falla distinto de «no hay producto» y no escribe", async (t) => {
  const db = await baseDePrueba(t);

  const r = await registrarInteresDeFamilia(db, {
    clave: CLAVE,
    familia: "DIPICOT",
    vendedoraId: "bot",
    catalogo: async () => {
      throw new Error("timeout");
    },
  });

  assert.equal(r.ok === false && r.codigo, "catalogo_caido");
  assert.equal((await db.select().from(intereses).where(eq(intereses.clave, CLAVE))).length, 0);
});

test("dos familias distintas en la misma conversación son dos intereses", async (t) => {
  const db = await baseDePrueba(t);
  const comun = { clave: CLAVE, vendedoraId: "bot", catalogo: async () => CATALOGO };

  await registrarInteresDeFamilia(db, { ...comun, familia: "DIPICOT" });
  await registrarInteresDeFamilia(db, { ...comun, familia: "EPCOORP" });

  const filas = await db.select().from(intereses).where(eq(intereses.clave, CLAVE));
  assert.equal(filas.length, 2, "nombrar otro curso es un dato nuevo, no un duplicado");
});

test("`tieneInteresRegistrado` ve lo asentado (es lo que frena la confirmación manual)", async (t) => {
  const db = await baseDePrueba(t);
  assert.equal(await tieneInteresRegistrado(db, CLAVE), false);
  await registrarInteresDeFamilia(db, {
    clave: CLAVE,
    familia: "DIPICOT",
    vendedoraId: "bot",
    catalogo: async () => CATALOGO,
  });
  assert.equal(await tieneInteresRegistrado(db, CLAVE), true);
});
