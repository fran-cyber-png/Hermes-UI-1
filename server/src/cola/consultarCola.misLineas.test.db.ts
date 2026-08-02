import { test } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarComentario, sembrarLineaDeVendedora, sembrarMensaje } from "../pruebas/sembrar.js";
import { consultarCola } from "./consultarCola.js";

/**
 * «LAS MÍAS» — la cola acotada a las líneas que `numero_vendedora` le asigna a
 * quien está logueada.
 *
 * `numero_vendedora` existía poblada desde #50 y **no la leía nadie**: las tres
 * vendedoras y el bot comparten una sola cola, así que cada una lee las
 * conversaciones de las otras para llegar a las suyas.
 *
 * Es un FILTRO, no un permiso (ver `cola/lineas.ts` y el comentario de
 * `numeroVendedora` en `db/schema.ts`), y por eso lo que más se testea acá es el
 * FAIL-OPEN: sin filas asignadas se ve todo. El defecto que hay que impedir es
 * que la primera vendedora que se loguee después del deploy abra una cola vacía
 * y crea que se perdieron las conversaciones.
 */

const ESCUELA = "51986394450";
const WALTER = "51941654039";
const BOT = "51984429504";

type Fila = { persona_nombre: string | null; numero_propio: string | null };

async function sembrarLasTresLineas(db: Awaited<ReturnType<typeof baseDePrueba>>) {
  await sembrarMensaje(db, { personaId: "51900111", personaNombre: "Marta", numeroPropio: ESCUELA });
  await sembrarMensaje(db, { personaId: "51900222", personaNombre: "Jorge", numeroPropio: WALTER });
  await sembrarMensaje(db, { personaId: "51900333", personaNombre: "Luis", numeroPropio: BOT });
}

test("con líneas asignadas, «las mías» recorta a esas — y son varias, no una", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLasTresLineas(db);
  // Luz atiende la línea de la Escuela Y la del bot (así está poblado en prod).
  await sembrarLineaDeVendedora(db, ESCUELA, ["luz"]);
  await sembrarLineaDeVendedora(db, BOT, ["luz"]);
  await sembrarLineaDeVendedora(db, WALTER, ["walter"]);

  const { conversaciones, sinLineasPropias } = await consultarCola(db, {
    misLineas: true,
    vendedoraId: "luz",
  });
  const nombres = (conversaciones as Fila[]).map((c) => c.persona_nombre).sort();
  assert.deepEqual(nombres, ["Luis", "Marta"]);
  assert.equal(sinLineasPropias, undefined);
});

test("SIN líneas asignadas, «las mías» sirve TODO y lo dice", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLasTresLineas(db);
  await sembrarLineaDeVendedora(db, ESCUELA, ["luz"]);

  // Sindy todavía no está en el mapa. Fail-open: ve las tres, y la respuesta
  // trae `sinLineasPropias` para que la pantalla lo pueda decir en vez de
  // mostrar la cola entera fingiendo que el filtro se aplicó.
  const { conversaciones, sinLineasPropias } = await consultarCola(db, {
    misLineas: true,
    vendedoraId: "sindy",
  });
  assert.equal(conversaciones.length, 3);
  assert.equal(sinLineasPropias, true);
});

test("«las mías» sin token no recorta: sin vendedora no hay mapa que leer", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLasTresLineas(db);
  await sembrarLineaDeVendedora(db, ESCUELA, ["luz"]);

  const { conversaciones, sinLineasPropias } = await consultarCola(db, { misLineas: true });
  assert.equal(conversaciones.length, 3);
  assert.equal(sinLineasPropias, true);
});

test("la línea elegida a mano le gana a «las mías»", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLasTresLineas(db);
  await sembrarLineaDeVendedora(db, ESCUELA, ["luz"]);

  // Tocó «Walter» en el selector: quiere ver Walter aunque no sea suyo. Es un
  // filtro, no un permiso — acota lo que se mira, no lo que se puede mirar.
  const { conversaciones } = await consultarCola(db, {
    misLineas: true,
    linea: WALTER,
    vendedoraId: "luz",
  });
  assert.equal(conversaciones.length, 1);
  assert.equal((conversaciones[0] as Fila).persona_nombre, "Jorge");
});

test("con «las mías» puestas, los comentarios de FB/IG se caen — no llegaron por ninguna línea", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLasTresLineas(db);
  await sembrarComentario(db, { canal: "facebook", personaId: "fb:1", personaNombre: "Comentarista" });
  await sembrarLineaDeVendedora(db, ESCUELA, ["luz"]);

  // Mismo recorte que `?linea=`, misma consecuencia: es UNA implementación
  // (`filtroDeLineas`), no dos que pueden divergir.
  const { conversaciones } = await consultarCola(db, { misLineas: true, vendedoraId: "luz" });
  assert.equal(conversaciones.length, 1);
  assert.equal((conversaciones[0] as Fila).persona_nombre, "Marta");
});

test("el total y el desglose también se recortan: la banda cuenta lo suyo", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLasTresLineas(db);
  await sembrarLineaDeVendedora(db, ESCUELA, ["luz"]);
  await sembrarLineaDeVendedora(db, BOT, ["luz"]);

  const { total, desglose } = await consultarCola(db, { misLineas: true, vendedoraId: "luz" });
  assert.equal(total, 2);
  assert.equal((desglose ?? []).reduce((acc, f) => acc + f.n, 0), 2);
});

test("una vendedora con líneas asignadas que nadie usó ve VACÍO, nunca la cola de otra", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLasTresLineas(db);
  // El día uno de un número recién vinculado. Acá el vacío es la respuesta
  // correcta: el mapa SÍ le asigna una línea, solo que todavía no habló nadie.
  // Es distinto de «no tiene ninguna», que es el fail-open de arriba.
  await sembrarLineaDeVendedora(db, "51900000001", ["nueva"]);

  const { conversaciones, sinLineasPropias } = await consultarCola(db, {
    misLineas: true,
    vendedoraId: "nueva",
  });
  assert.equal(conversaciones.length, 0);
  assert.equal(sinLineasPropias, undefined);
});
