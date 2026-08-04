import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import {
  cargaPorVendedora,
  habilitar,
  leerHabilitados,
  leerHabilitadosDe,
  quitar,
} from "./habilitados.js";

/**
 * EL REPARTO DEL PADRÓN, contra base (ADR 0008).
 *
 * Lo que se verifica acá no es «guarda una fila»: es que el reparto sobreviva a
 * las dos cosas que ya pasaron en producción con el reparto de conversaciones —
 * **el mismo humano escrito de dos formas** y **una reasignación que tiene que
 * pisar, no fallar**.
 */

describe("repartir el padrón", () => {
  test("habilitar deja la fila, y la vendedora la ve", async (t) => {
    const db = await baseDePrueba(t);

    const n = await habilitar(db, {
      contactoIds: [1, 2, 3],
      vendedoraId: "ventas11@grupogoberna.com",
      por: "ventas10@grupogoberna.com",
    });
    assert.equal(n, 3);
    assert.deepEqual((await leerHabilitadosDe(db, "ventas11@grupogoberna.com")).sort(), [1, 2, 3]);
  });

  test("🔴 la grafía no esconde los contactos de su propia dueña", async (t) => {
    const db = await baseDePrueba(t);

    // Escrito como lo empuja Cerberus…
    await habilitar(db, { contactoIds: [7], vendedoraId: "Luz", por: "sup" });
    // …y leído con lo que ella tipea al entrar, que es de donde sale el token.
    assert.deepEqual(await leerHabilitadosDe(db, "luz"), [7]);
    assert.deepEqual(await leerHabilitadosDe(db, "  LUZ  "), [7]);
  });

  test("re-habilitar a otra persona PISA, no falla", async (t) => {
    const db = await baseDePrueba(t);

    await habilitar(db, { contactoIds: [1, 2], vendedoraId: "ventas11", por: "sup" });
    await habilitar(db, { contactoIds: [2], vendedoraId: "ventas12", por: "sup" });

    // El contacto 2 cambió de dueña; el 1 se quedó donde estaba.
    assert.deepEqual(await leerHabilitadosDe(db, "ventas11"), [1]);
    assert.deepEqual(await leerHabilitadosDe(db, "ventas12"), [2]);
  });

  test("un contacto no puede estar habilitado a dos personas a la vez", async (t) => {
    const db = await baseDePrueba(t);

    await habilitar(db, { contactoIds: [5], vendedoraId: "a", por: "sup" });
    await habilitar(db, { contactoIds: [5], vendedoraId: "b", por: "sup" });

    // Es el defecto que el reparto existe para evitar: dos escribiéndole al mismo.
    assert.deepEqual(await leerHabilitadosDe(db, "a"), []);
    assert.deepEqual(await leerHabilitadosDe(db, "b"), [5]);
    assert.equal((await leerHabilitados(db)).length, 1);
  });

  test("un id repetido en el mismo lote no revienta el INSERT", async (t) => {
    const db = await baseDePrueba(t);

    // Sin el `uniq`, Postgres tira «cannot affect row a second time» y un doble
    // clic en la lista se lee como que el reparto no funciona.
    const n = await habilitar(db, { contactoIds: [4, 4, 4], vendedoraId: "a", por: "sup" });
    assert.equal(n, 1);
    assert.deepEqual(await leerHabilitadosDe(db, "a"), [4]);
  });

  test("un lote vacío no escribe nada y no rompe", async (t) => {
    const db = await baseDePrueba(t);
    assert.equal(await habilitar(db, { contactoIds: [], vendedoraId: "a", por: "sup" }), 0);
    assert.equal(await quitar(db, []), 0);
    assert.deepEqual(await leerHabilitados(db), []);
  });

  test("quitar devuelve al pozo común: deja de ser de nadie", async (t) => {
    const db = await baseDePrueba(t);

    await habilitar(db, { contactoIds: [1, 2, 3], vendedoraId: "a", por: "sup" });
    assert.equal(await quitar(db, [2]), 1);

    assert.deepEqual((await leerHabilitadosDe(db, "a")).sort(), [1, 3]);
    assert.deepEqual((await leerHabilitados(db)).sort(), [1, 3]);
  });

  test("quien no tiene nada habilitado ve una lista vacía, no la de otra", async (t) => {
    const db = await baseDePrueba(t);
    await habilitar(db, { contactoIds: [1], vendedoraId: "a", por: "sup" });
    assert.deepEqual(await leerHabilitadosDe(db, "b"), []);
  });

  test("🔴 la carga cuenta a la persona UNA vez, aunque tenga dos grafías", async (t) => {
    const db = await baseDePrueba(t);

    await habilitar(db, { contactoIds: [1, 2], vendedoraId: "Luz", por: "sup" });
    await habilitar(db, { contactoIds: [3], vendedoraId: "luz", por: "sup" });
    await habilitar(db, { contactoIds: [4], vendedoraId: "ventas11", por: "sup" });

    const carga = await cargaPorVendedora(db);
    // Sin normalizar, `Luz` y `luz` saldrían como dos personas con la mitad cada
    // una — y el supervisor repartiría mirando un número falso.
    assert.equal(carga.length, 2);
    assert.equal(carga[0].contactos, 3, "las tres de Luz, sumadas");
    assert.equal(carga[1].contactos, 1);
  });

  test("se guarda quién repartió", async (t) => {
    const db = await baseDePrueba(t);
    await habilitar(db, { contactoIds: [9], vendedoraId: "a", por: "ventas10@grupogoberna.com" });

    const [fila] = await db.query.contactoHabilitado.findMany();
    assert.equal(fila.habilitadoPor, "ventas10@grupogoberna.com");
    assert.equal(fila.vendedoraId, "a");
  });

  test("se guarda la grafía que vino, no una normalizada", async (t) => {
    const db = await baseDePrueba(t);
    await habilitar(db, { contactoIds: [1], vendedoraId: "Luz", por: "sup" });

    const [fila] = await db.query.contactoHabilitado.findMany();
    // Reescribirla rompería el cruce con `gestiones` y `estado_conversacion`.
    assert.equal(fila.vendedoraId, "Luz");
  });
});
