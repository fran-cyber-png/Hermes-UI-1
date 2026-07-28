import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarMensaje } from "../pruebas/sembrar.js";
import { intereses } from "../db/schema.js";
import { consultarIntereses } from "../gestiones/intereses.js";
import type { ProductoCatalogo } from "../cerberus/productos.js";
import { confirmarInteresDerivado } from "./confirmar.js";
import { sembrarAliasCurso } from "./repositorio.js";

/**
 * DE LA PROPUESTA AL ASIENTO (#102), contra una base de verdad.
 *
 * Las dos mitades del pedido del dueño, cableadas: que **la ficha muestre** el
 * interés derivado del anuncio marcado como tal, y que **confirmarlo con un
 * clic** deje una fila en `intereses` con el nombre CRUDO del producto de
 * Cerberus — el que se puede cotizar, no el nombre corto del chip.
 *
 * El catálogo va inyectado: acá se prueba la regla, no la red de Cerberus.
 */

const TELEFONO = "51999888777";
const MI_NUMERO = "51986394450";
const CLAVE = `conv:whatsapp:${TELEFONO}:${MI_NUMERO}`;

/** Tres ediciones reales de DIPICOT, como las devuelve el catálogo vivo. */
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

async function conversacionDeAnuncio(db: Awaited<ReturnType<typeof baseDePrueba>>) {
  await sembrarAliasCurso(db);
  await sembrarMensaje(db, {
    personaId: TELEFONO,
    numeroPropio: MI_NUMERO,
    texto: "Hola quiero más información",
    origen: { fuente: "anuncio", adId: "1201", titulo: "[JUL] INTELIGENCIA | WSP" },
  });
}

test("la ficha recibe el interés derivado, marcado con su fuente", async (t) => {
  const db = await baseDePrueba(t);
  await conversacionDeAnuncio(db);

  const payload = await consultarIntereses(db, [CLAVE]);

  // No hay NINGÚN interés asentado: la propuesta no es un asiento fantasma.
  assert.deepEqual(payload.intereses[CLAVE], undefined);
  assert.equal(payload.derivados[CLAVE].curso, "Inteligencia y Contrainteligencia");
  assert.equal(payload.derivados[CLAVE].fuente, "anuncio");
});

test("confirmar registra el NOMBRE CRUDO de la última edición, no el del chip", async (t) => {
  const db = await baseDePrueba(t);
  await conversacionDeAnuncio(db);

  const r = await confirmarInteresDerivado(db, {
    clave: CLAVE,
    vendedoraId: "vendedora-prueba",
    catalogo: async () => CATALOGO,
  });

  assert.equal(r.ok, true);
  assert.equal(
    r.ok && r.curso,
    "Diploma Internacional de Inteligencia y Contrainteligencia 26",
    "tiene que ser la última edición (026), con el nombre de Cerberus",
  );

  // Y queda asentado de verdad: la ficha ya lo muestra como interés registrado
  // y deja de proponer (lo registrado manda).
  const payload = await consultarIntereses(db, [CLAVE]);
  assert.deepEqual(payload.intereses[CLAVE], [
    "Diploma Internacional de Inteligencia y Contrainteligencia 26",
  ]);
  assert.equal(payload.derivados[CLAVE], undefined);
});

test("confirmar deja ATADO el producto, no sólo su nombre", async (t) => {
  const db = await baseDePrueba(t);
  await conversacionDeAnuncio(db);

  await confirmarInteresDerivado(db, {
    clave: CLAVE,
    vendedoraId: "vendedora-prueba",
    catalogo: async () => CATALOGO,
  });

  /**
   * EL ESLABÓN QUE FALTABA. Esta función siempre recorrió campaña → familia →
   * última edición → producto, y devolvía `{curso, sku, familia}`; lo que hacía
   * era guardar únicamente el nombre. Con un nombre no se arma una cotización
   * —la orden que va a Cerberus pide `producto_id`—, así que la vendedora tenía
   * que volver a buscar en el catálogo el producto que el sistema ya había
   * resuelto solo.
   *
   * Se afirma el `1908` literal a propósito: es la última edición (026), no la
   * 011 que también matchea la familia.
   */
  const [fila] = await db.select().from(intereses).where(eq(intereses.clave, CLAVE));
  assert.equal(fila.productoId, "1908");
  assert.equal(fila.sku, "DIPICOT026");

  // Y viaja hasta la ficha, que es donde el carrito lo va a leer para precargar.
  const payload = await consultarIntereses(db, [CLAVE]);
  assert.equal(payload.interesesDetalle[CLAVE][0].productoId, "1908");
  assert.equal(payload.interesesDetalle[CLAVE][0].sku, "DIPICOT026");
});

test("confirmar dos veces no duplica el interés", async (t) => {
  const db = await baseDePrueba(t);
  await conversacionDeAnuncio(db);
  const opciones = {
    clave: CLAVE,
    vendedoraId: "vendedora-prueba",
    catalogo: async () => CATALOGO,
  };

  assert.equal((await confirmarInteresDerivado(db, opciones)).ok, true);
  const segunda = await confirmarInteresDerivado(db, opciones);
  assert.equal(segunda.ok, false);
  assert.equal(segunda.ok === false && segunda.codigo, "ya_registrado");

  const payload = await consultarIntereses(db, [CLAVE]);
  assert.equal(payload.intereses[CLAVE].length, 1);
});

test("si Cerberus no tiene la familia, NO se registra nada parecido", async (t) => {
  const db = await baseDePrueba(t);
  await conversacionDeAnuncio(db);

  const r = await confirmarInteresDerivado(db, {
    clave: CLAVE,
    vendedoraId: "vendedora-prueba",
    // Un catálogo sin ninguna edición de DIPICOT.
    catalogo: async () => CATALOGO.filter((p) => p.sku.startsWith("EPCOORP")),
  });

  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.codigo, "sin_producto");
  const payload = await consultarIntereses(db, [CLAVE]);
  assert.equal(payload.intereses[CLAVE], undefined);
});

test("si Cerberus no responde, falla ruidoso y distinto de «no hay producto»", async (t) => {
  const db = await baseDePrueba(t);
  await conversacionDeAnuncio(db);

  const r = await confirmarInteresDerivado(db, {
    clave: CLAVE,
    vendedoraId: "vendedora-prueba",
    catalogo: async () => {
      throw new Error("timeout");
    },
  });

  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.codigo, "catalogo_caido");
  const payload = await consultarIntereses(db, [CLAVE]);
  assert.equal(payload.intereses[CLAVE], undefined);
});

test("un anuncio sin mapeo no se puede confirmar: se registra a mano", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarAliasCurso(db);
  await sembrarMensaje(db, {
    personaId: TELEFONO,
    numeroPropio: MI_NUMERO,
    texto: "hola",
    origen: { fuente: "anuncio", adId: "1201", titulo: "Reel spot antiguo" },
  });

  const r = await confirmarInteresDerivado(db, {
    clave: CLAVE,
    vendedoraId: "vendedora-prueba",
    catalogo: async () => CATALOGO,
  });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.codigo, "sin_mapeo");
});
