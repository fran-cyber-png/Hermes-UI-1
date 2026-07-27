import { test } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarCliente, sembrarMensaje } from "../pruebas/sembrar.js";
import { consultarCola } from "./consultarCola.js";

/**
 * EL EX-CLIENTE EN LA COLA (#133) — que la fila sepa quién ya compró SIN una
 * llamada a Cerberus por conversación.
 *
 * Lo que se fija acá es el CABLEADO, no el cálculo: la jerarquía
 * (VIP/recompró/una vez) y la normalización del teléfono ya están fijadas puras
 * en `clientes/nivel.test.ts` y `clientes/padron.test.ts`. Acá se prueba que el
 * dato llega a la fila, que el filtro recorta por él, que el número del chip
 * cuenta lo mismo que el filtro… y sobre todo que **NO marca a quien no
 * corresponde**: un falso positivo le enseña a la vendedora a desconfiar de la
 * marca, y una marca en la que no se confía es peor que ninguna.
 */

type Fila = {
  clave: string;
  persona_id: string | null;
  cliente_nivel: string | null;
  cliente_compras: number | null;
};

const filas = (r: { conversaciones: unknown[] }) => r.conversaciones as Fila[];
const de = (r: { conversaciones: unknown[] }, tel: string) =>
  filas(r).find((f) => f.persona_id === tel);

test("la cola marca a quien ya compró, y no marca a quien no está en el padrón", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51986394450", texto: "hola, quiero info" });
  await sembrarMensaje(db, { personaId: "51900000001", texto: "hola" });
  await sembrarCliente(db, { telefono: "51986394450", pais: "Perú", compras: 1 });

  const r = await consultarCola(db, {});
  assert.equal(de(r, "51986394450")?.cliente_nivel, "compro");
  assert.equal(de(r, "51986394450")?.cliente_compras, 1);
  assert.equal(de(r, "51900000001")?.cliente_nivel, null, "un desconocido no se marca");
});

test("la jerarquía llega entera a la fila: recompró y VIP", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51900000002", texto: "hola" });
  await sembrarMensaje(db, { personaId: "51900000003", texto: "hola" });
  await sembrarCliente(db, { telefono: "51900000002", pais: "PE", compras: 3 });
  await sembrarCliente(db, { telefono: "51900000003", pais: "PE", compras: 5, tier: "vip" });

  const r = await consultarCola(db, {});
  assert.equal(de(r, "51900000002")?.cliente_nivel, "recompro");
  assert.equal(de(r, "51900000002")?.cliente_compras, 3);
  assert.equal(de(r, "51900000003")?.cliente_nivel, "vip");
});

test("el padrón guarda el número LOCAL y la fila igual lo reconoce (Guatemala, 8 dígitos)", async (t) => {
  const db = await baseDePrueba(t);
  // Como llega de WhatsApp: internacional, 502 + 8 dígitos.
  await sembrarMensaje(db, { personaId: "50255551234", texto: "hola" });
  // Como lo guarda el CRM: local, con separadores y sin código de país.
  await sembrarCliente(db, { telefono: "5555-1234", pais: "Guatemala", compras: 2 });

  const r = await consultarCola(db, {});
  assert.equal(de(r, "50255551234")?.cliente_nivel, "recompro");
});

test("NO cruza países aunque compartan los últimos 9 dígitos (#119)", async (t) => {
  const db = await baseDePrueba(t);
  // El peruano que escribe hoy: +51 912 345 678.
  await sembrarMensaje(db, { personaId: "51912345678", texto: "hola" });
  // El cliente del padrón es un mexicano de Veracruz: +52 991 234 5678. Los dos
  // terminan en «912345678» — con la llave de sufijo pelada serían la misma
  // persona, y la vendedora saludaría como cliente a un desconocido.
  await sembrarCliente(db, { telefono: "529912345678", pais: "México", compras: 4 });

  const r = await consultarCola(db, {});
  assert.equal(de(r, "51912345678")?.cliente_nivel, null);
});

test("sin país en el padrón el match sigue siendo por sufijo: no se pierde el cliente de siempre", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51986394450", texto: "hola" });
  await sembrarCliente(db, { telefono: "986394450", pais: null, compras: 1 });

  const r = await consultarCola(db, {});
  assert.equal(de(r, "51986394450")?.cliente_nivel, "compro");
});

test("«Ya compraron» devuelve SOLO los que compraron, y el chip cuenta lo mismo", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51986394450", texto: "hola" });
  await sembrarMensaje(db, { personaId: "51900000004", texto: "hola" });
  await sembrarMensaje(db, { personaId: "51900000005", texto: "hola" });
  await sembrarCliente(db, { telefono: "51986394450", pais: "PE", compras: 2 });

  const todas = await consultarCola(db, {});
  assert.equal(todas.total, 3);
  assert.equal(todas.conteosFiltro?.yaCompraron, 1, "el chip anticipa cuántas filas daría");

  const soloClientes = await consultarCola(db, { intencion: "ya-compraron" });
  assert.equal(soloClientes.total, 1);
  assert.deepEqual(
    filas(soloClientes).map((f) => f.persona_id),
    ["51986394450"],
  );
});

test("un comentario de Facebook nunca se marca: su persona_id no es un teléfono", async (t) => {
  const db = await baseDePrueba(t);
  // Un PSID/comment-id que TERMINA en los mismos 9 dígitos que un cliente real.
  await sembrarMensaje(db, { canal: "facebook", tipo: "comentario", personaId: "77986394450" });
  await sembrarCliente(db, { telefono: "51986394450", pais: "PE", compras: 3 });

  const r = await consultarCola(db, {});
  assert.equal(de(r, "77986394450")?.cliente_nivel, null);
});

test("la marca no se lleva puesto nada de lo que la cola ya servía", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51986394450", texto: "hola" });
  await sembrarCliente(db, { telefono: "51986394450", pais: "PE", compras: 1 });

  const r = await consultarCola(db, {});
  const fila = filas(r)[0] as Fila & { etapa_efectiva: string | null; nivel: number };
  assert.equal(fila.etapa_efectiva, "nuevo");
  assert.equal(fila.nivel, 0, "un entrante sin responder de hoy sigue siendo el nivel más urgente");
  assert.ok(r.desglose && r.desglose.length > 0, "el desglose del embudo sigue saliendo");
  assert.equal(r.sinPadron, undefined, "con la tabla presente no se degrada");
});

test("re-sincronizar al mismo cliente lo actualiza en vez de duplicarlo", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51986394450", texto: "hola" });
  await sembrarCliente(db, { id: 7, telefono: "51986394450", pais: "PE", compras: 1 });
  await sembrarCliente(db, { id: 7, telefono: "51986394450", pais: "PE", compras: 2 });

  const r = await consultarCola(db, {});
  assert.equal(filas(r).length, 1, "una conversación sigue siendo UNA fila");
  assert.equal(de(r, "51986394450")?.cliente_nivel, "recompro");
  assert.equal(de(r, "51986394450")?.cliente_compras, 2);
});
