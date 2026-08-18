import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { firmarSesion } from "../auth/sesion.js";
import { perimetroApi } from "../auth/perimetro.js";
import { cargarLineasVedadas } from "../numeros/cargarLineasVedadas.js";
import { lineasVedadasPara, PROPOSITO_CAMPANA } from "../numeros/campana.js";
import { whatsappRouter } from "./whatsapp.js";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarMensaje } from "../pruebas/sembrar.js";
import { hiloDe } from "../whatsapp/hilo.js";

/**
 * 🔴 EL TEST DEL CABLEADO DE LA FRONTERA DE CAMPAÑA EN LAS RUTAS.
 *
 * La regla ya tiene su test puro y su paridad SQL. Lo que ninguno de los dos ve
 * es si el handler llegó a PREGUNTAR — que es exactamente cómo se descubrió la
 * fuga del SSE (ADR 0059): la regla estaba escrita y el handler nunca miraba el
 * request. Acá se levanta el montaje real (perímetro → `cargarLineasVedadas` →
 * router) y se miran los códigos y los cuerpos que salen.
 *
 * ⚠️ Es `*.test.db.ts` **aunque casi no toque la base**: `routes/whatsapp.ts`
 * importa `db/client.js`, que revienta AL IMPORTARSE sin `DATABASE_URL`, y el
 * job de tests puros del CI no la define.
 */

const ESCUELA = "51984429504";
const CAMPANA = "51963139984";
const LEAD_DE_CAMPANA = "51900000002";

/** El mapa `numeros_wa` + `numero_vendedora` tal cual está en producción. */
const LINEAS = [
  { numero: ESCUELA, proposito: "vendedora", vendedoras: ["Luz"] },
  { numero: CAMPANA, proposito: PROPOSITO_CAMPANA, vendedoras: ["Usuario2"] },
];

const ALEX = firmarSesion("alex"); // supervisor de ventas
const BETTO = firmarSesion("usuario2"); // atiende la campaña

async function conElServidor(fn: (base: string) => Promise<void>) {
  const app = express();
  app.use(perimetroApi);
  // Como en `index.ts`: sin esto `req.body` es `undefined` y las rutas que leen
  // el `numeroPropio` del cuerpo pasarían la guarda por el motivo equivocado.
  app.use(express.json());
  app.use(cargarLineasVedadas(async (id) => lineasVedadasPara(LINEAS, id)));
  app.use("/api/whatsapp", whatsappRouter);
  const server = app.listen(0);
  await once(server, "listening");
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, "close");
  }
}

const con = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

describe("las rutas de WhatsApp frenan la línea de campaña", () => {
  test("🔴 el hilo con la línea de campaña explícita: 403, y lo dice", async () => {
    await conElServidor(async (base) => {
      const r = await fetch(
        `${base}/api/whatsapp/conversacion/${LEAD_DE_CAMPANA}?numeroPropio=${CAMPANA}`,
        con(ALEX),
      );
      assert.equal(r.status, 403);
      assert.equal(((await r.json()) as { motivo?: string }).motivo, "linea_de_campana");
    });
  });

  /**
   * ⚠️ **LOS CASOS QUE PASAN SE MIDEN CON `/reaccionar`, Y NO ES CAPRICHO.**
   *
   * Lo que hay que probar es que la guarda NO se disparó. Cualquier ruta que
   * siga de largo hasta consultar la base usaría el **singleton** `db` (no el
   * `db` inyectado de `baseDePrueba`), y ese pool de `postgres.js` deja el
   * socket abierto: el proceso de test **no termina nunca** — un cuelgue en CI,
   * no un fallo. `/reaccionar` pregunta primero por la línea viva y contesta
   * 409 sin tocar Postgres, así que sirve de sonda limpia.
   *
   * Se afirma «no es 403», no «es 200»: el 409 dice que el pedido llegó al
   * handler, que es exactamente lo que este archivo mide.
   */
  const reaccionar = (base: string, token: string, numeroPropio: string) =>
    fetch(`${base}/api/whatsapp/reaccionar`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ numeroPropio, telefono: LEAD_DE_CAMPANA, mensajeId: "x", emoji: "👍" }),
    });

  test("quien atiende la campaña NO se frena — el recorte es por línea, no un apagón", async () => {
    await conElServidor(async (base) => {
      const r = await reaccionar(base, BETTO, CAMPANA);
      assert.notEqual(r.status, 403);
    });
  });

  test("la línea de la Escuela no se frena para nadie", async () => {
    await conElServidor(async (base) => {
      const r = await reaccionar(base, ALEX, ESCUELA);
      assert.notEqual(r.status, 403);
    });
  });

  test("🔴 ENVIAR a un lead de la campaña: 403 antes de tocar el transporte", async () => {
    await conElServidor(async (base) => {
      const r = await fetch(`${base}/api/whatsapp/enviar`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ALEX}`, "Content-Type": "application/json" },
        body: JSON.stringify({ numeroPropio: CAMPANA, telefono: LEAD_DE_CAMPANA, texto: "hola" }),
      });
      assert.equal(r.status, 403);
    });
  });

  test("reaccionar y editar sobre la campaña también: 403", async () => {
    await conElServidor(async (base) => {
      for (const ruta of ["reaccionar", "editar"]) {
        const r = await fetch(`${base}/api/whatsapp/${ruta}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${ALEX}`, "Content-Type": "application/json" },
          body: JSON.stringify({ numeroPropio: CAMPANA, telefono: LEAD_DE_CAMPANA, mensajeId: "x" }),
        });
        assert.equal(r.status, 403, `POST /${ruta}`);
      }
    });
  });
});

describe("el hilo SIN línea explícita se sirve, y la campaña se cae adentro", () => {
  test("🔴 un 403 ahí escondería también la conversación de la Escuela con la MISMA persona", async (t) => {
    const db = await baseDePrueba(t);
    // La misma persona le escribió a las dos líneas: es el caso que obliga a
    // filtrar por dentro en vez de rechazar el pedido entero.
    await sembrarMensaje(db, { personaId: "51911111111", texto: "por la Escuela", numeroPropio: ESCUELA });
    await sembrarMensaje(db, { personaId: "51911111111", texto: "por la campaña", numeroPropio: CAMPANA });

    const paraAlex = (await hiloDe(db, "51911111111", undefined, true, [CAMPANA])) as unknown as {
      texto: string | null;
    }[];
    assert.deepEqual(
      paraAlex.map((m) => m.texto),
      ["por la Escuela"],
    );

    const paraBetto = (await hiloDe(db, "51911111111", undefined, true, [])) as unknown as { texto: string | null }[];
    assert.equal(paraBetto.length, 2, "sin líneas vedadas se sirve todo, como siempre");
  });
});
