import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { baseDePrueba } from "../pruebas/base.js";
import { intereses } from "../db/schema.js";
import type { ProductoCatalogo } from "../cerberus/productos.js";
import { registrarInteres } from "./registrarInteres.js";

/**
 * EL INTERÉS REGISTRADO A MANO, ATADO AL CATÁLOGO.
 *
 * El caso que importa no es el feliz: es qué pasa cuando el vínculo NO se puede
 * verificar. Un `producto_id` inventado se ve verdadero y termina cotizando otra
 * cosa; una fila sin registrar pierde lo único que quedó del chat. Acá se fija
 * que la respuesta sea la tercera: registrar sin atar, y decirlo.
 *
 * El catálogo va inyectado — se prueba la regla, no la red de Cerberus.
 */

const CLAVE = "conv:whatsapp:51999888777:51986394450";
const VENDEDORA = "vendedora-prueba";

const CATALOGO: ProductoCatalogo[] = [
  {
    id: "1908",
    sku: "DIPICOT026",
    nombre: "Diploma Internacional de Inteligencia y Contrainteligencia 26",
    precioNormal: 250,
    precioPromocion: 250,
    moneda: "",
  },
];

async function fila(db: Awaited<ReturnType<typeof baseDePrueba>>) {
  const filas = await db.select().from(intereses).where(eq(intereses.clave, CLAVE));
  return filas[0];
}

test("con productoId, el nombre lo pone el CATÁLOGO y no el navegador", async (t) => {
  const db = await baseDePrueba(t);

  const r = await registrarInteres(db, {
    clave: CLAVE,
    // Lo que mandó el front: un nombre viejo, del caché persistido (ADR 0007).
    curso: "Inteligencia y Contrainteligencia 25",
    productoId: "1908",
    vendedoraId: VENDEDORA,
    catalogo: async () => CATALOGO,
  });

  assert.equal(r.vinculado, true);
  assert.equal(r.motivo, null);
  // Manda el catálogo: `intereses.curso` es lo que después se cotiza, y un
  // nombre que ya no existe no se puede facturar.
  assert.equal(r.curso, "Diploma Internacional de Inteligencia y Contrainteligencia 26");

  const f = await fila(db);
  assert.equal(f.curso, "Diploma Internacional de Inteligencia y Contrainteligencia 26");
  assert.equal(f.productoId, "1908");
  assert.equal(f.sku, "DIPICOT026");
});

test("si el catálogo está caído, SE REGISTRA IGUAL pero sin atar — y lo dice", async (t) => {
  const db = await baseDePrueba(t);

  const r = await registrarInteres(db, {
    clave: CLAVE,
    curso: "Diploma de Inteligencia",
    productoId: "1908",
    vendedoraId: VENDEDORA,
    catalogo: async () => {
      throw new Error("timeout");
    },
  });

  // Lo anotado NO se pierde: es lo único que queda de lo que la vendedora
  // escuchó, y Cerberus se cae seguido (de ahí el techo de 12 s del panel).
  assert.equal(r.curso, "Diploma de Inteligencia");
  // Pero NO se finge el vínculo. Un `producto_id` sin verificar cotiza otra cosa.
  assert.equal(r.vinculado, false);
  assert.equal(r.motivo, "catalogo_caido");

  const f = await fila(db);
  assert.equal(f.curso, "Diploma de Inteligencia");
  assert.equal(f.productoId, null);
  assert.equal(f.sku, null);
});

test("«no se pudo preguntar» y «ese producto no existe» son motivos DISTINTOS", async (t) => {
  const db = await baseDePrueba(t);

  const r = await registrarInteres(db, {
    clave: CLAVE,
    curso: "Un curso que ya no está",
    productoId: "9999",
    vendedoraId: VENDEDORA,
    catalogo: async () => CATALOGO,
  });

  assert.equal(r.vinculado, false);
  // El catálogo contestó y no lo tiene: reintentar no sirve. Con `catalogo_caido`
  // sí sirve. Colapsarlos haría que la UI ofrezca el botón equivocado.
  assert.equal(r.motivo, "producto_inexistente");
  assert.equal((await fila(db)).productoId, null);
});

test("sin productoId es texto libre, y NO se adivina el producto por nombre", async (t) => {
  const db = await baseDePrueba(t);

  const r = await registrarInteres(db, {
    clave: CLAVE,
    // Coincide casi exacto con el del catálogo — y aun así no se ata.
    curso: "Diploma Internacional de Inteligencia y Contrainteligencia 26",
    vendedoraId: VENDEDORA,
    catalogo: async () => CATALOGO,
  });

  assert.equal(r.vinculado, false);
  // `null`, no `producto_inexistente`: nadie pidió atar nada. Buscar por nombre
  // sería una TERCERA derivación, y las dos que ya existen divergen en 6 SKUs.
  assert.equal(r.motivo, null);
  assert.equal((await fila(db)).productoId, null);
});

test("el mismo curso dos veces no duplica ni pisa lo que ya estaba atado", async (t) => {
  const db = await baseDePrueba(t);
  const opciones = {
    clave: CLAVE,
    curso: "Diploma Internacional de Inteligencia y Contrainteligencia 26",
    productoId: "1908",
    vendedoraId: VENDEDORA,
    catalogo: async () => CATALOGO,
  };

  await registrarInteres(db, opciones);
  // Segundo intento con el catálogo caído: el `onConflictDoNothing` protege la
  // fila buena. Sin eso, un reintento con Cerberus caído la dejaría sin producto.
  await registrarInteres(db, { ...opciones, catalogo: async () => { throw new Error("timeout"); } });

  const filas = await db.select().from(intereses).where(eq(intereses.clave, CLAVE));
  assert.equal(filas.length, 1);
  assert.equal(filas[0].productoId, "1908");
});
