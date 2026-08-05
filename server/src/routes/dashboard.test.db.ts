import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { firmarSesion } from "../auth/sesion.js";
import { dashboardRouter } from "./dashboard.js";

/**
 * LA PUERTA DE «EL NEGOCIO» — el cableado, no la regla.
 *
 * La regla («¿quién es supervisor?») está en `dashboard/personal.test.ts` y el
 * recorte SQL en `personal.test.db.ts`. Acá se prueba lo único que ninguno de
 * los dos puede ver: que la ruta **use** la regla. Es la lección de ADR 0024 —la
 * decisión estaba testeada hasta el hueso y el defecto vivía en el cableado—
 * aplicada de entrada.
 *
 * ══ POR QUÉ ESTE ARCHIVO ES `.test.db.ts` SI NO TOCA LA BASE ═════════════════
 *
 * `routes/dashboard.ts` importa el singleton `db`, que **revienta al importarse**
 * sin `DATABASE_URL`. Los tests puros corren sin esa variable; la corrida con
 * base la tiene (`ci.yml` la setea justamente por esto, y lo dice en un
 * comentario). No hay nada que fingir: el archivo se lee entero antes de que
 * corra el primer `test()`.
 *
 * ══ LO QUE ACÁ NO SE PRUEBA, Y DÓNDE SE PRUEBA ══════════════════════════════
 *
 * `GET /` **no** se puede probar acá: consulta el singleton, que apunta a otra
 * base que la del test (`baseDePrueba` clona un template y devuelve SOLO su
 * `db` — «nunca se usa el singleton acá», dice su docblock). Sembrar de un lado
 * y leer del otro daría un verde que no significa nada.
 *
 * Lo que ese camino hace está cubierto en dos mitades: **que el recorte recorte**
 * en `dashboard/personal.test.db.ts` (radar, embudo y «qué piden», contra una
 * base de verdad), y **que la ruta lo pase a los cinco seams**, con un `curl` con
 * dos tokens contra staging — está en el runbook del PR. Es un hueco declarado,
 * no uno que nadie miró.
 *
 * Por lo mismo, TODOS los casos de acá terminan en **403**: es la única respuesta
 * que la ruta da sin tocar la base. El camino positivo —que el supervisor pase—
 * queda del lado de `recorteDelDashboard`, que es la función que decide y tiene
 * sus ocho tests puros; acá sería un request que se cuelga esperando una consulta
 * contra una base que este harness no monta.
 */

const SUPERVISOR = "ventas10@grupogoberna.com";
const VENDEDORA = "ventas11@grupogoberna.com";

interface Respuesta {
  status: number;
  json: Record<string, unknown> | null;
}

/** Levanta el router con un token de vendedora, hace UN request y cierra. */
async function pedir(vendedoraId: string, supervisores: string | null): Promise<Respuesta> {
  const antes = process.env.HERMES_SUPERVISORES;
  if (supervisores === null) delete process.env.HERMES_SUPERVISORES;
  else process.env.HERMES_SUPERVISORES = supervisores;

  const app = express();
  app.use(express.json());
  app.use("/api/dashboard", dashboardRouter);

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  try {
    const resp = await fetch(`http://127.0.0.1:${port}/api/dashboard/negocio`, {
      headers: { authorization: `Bearer ${firmarSesion(vendedoraId)}` },
    });
    const json = (await resp.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: resp.status, json };
  } finally {
    server.close();
    await once(server, "close");
    if (antes === undefined) delete process.env.HERMES_SUPERVISORES;
    else process.env.HERMES_SUPERVISORES = antes;
  }
}

/**
 * 🔴 Es 403 y no un recorte, y ésa es la decisión: no existe una versión
 * personal de «cuánto factura cada curso». O se ve la facturación de la Escuela
 * o no se ve. El motivo viaja con el mismo nombre que en `/api/padron`
 * (`no_es_supervisor`), para que las dos fronteras se lean igual desde afuera.
 */
test("GET /negocio: una vendedora que no es supervisora come 403", async () => {
  const r = await pedir(VENDEDORA, SUPERVISOR);

  assert.equal(r.status, 403);
  assert.equal(r.json?.motivo, "no_es_supervisor");
});

/**
 * FAIL-CLOSED, heredado del padrón: sin la variable NADIE es supervisor — ni
 * siquiera quien lo era ayer. Una config que se borra tiene que cerrar la
 * puerta, no abrirla; al revés es la fuga que este frente vino a cerrar, y es el
 * fallo que nadie investiga porque se ve como que funciona.
 */
test("GET /negocio: sin HERMES_SUPERVISORES no entra nadie", async () => {
  const r = await pedir(SUPERVISOR, null);

  assert.equal(r.status, 403);
  assert.equal(r.json?.motivo, "no_es_supervisor");
});

/**
 * Un token sin vendedora tampoco pasa. No debería llegar hasta acá
 * (`requiereVendedora`), y justamente por eso es el caso que nadie iría a mirar
 * si un día llega.
 */
test("GET /negocio: una vendedora que no está en la lista tampoco entra por parecido", async () => {
  // `ventas1@…` no es `ventas10@…`: la comparación es por igualdad normalizada,
  // no por prefijo. Un `startsWith` acá abriría la puerta de par en par.
  const r = await pedir("ventas1@grupogoberna.com", SUPERVISOR);

  assert.equal(r.status, 403);
});
