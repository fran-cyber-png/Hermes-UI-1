import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { describe, test } from "node:test";
import express from "express";
import { firmarSesion } from "../auth/sesion.js";
import { perimetroApi } from "../auth/perimetro.js";
import { cargarRol, type LectorDeEquipo } from "../equipo/cargarRol.js";
import { cargarLineasVedadas } from "../numeros/cargarLineasVedadas.js";
import { lineasVedadasPara, PROPOSITO_CAMPANA } from "../numeros/campana.js";
import type { LecturaDeEquipo } from "../equipo/cascada.js";
import { emitirRT } from "../realtime/bus.js";
import { streamRouter } from "./stream.js";

/**
 * 🔴 EL TEST DEL CABLEADO — la regla pura ya tiene el suyo (`realtime/visibilidad.test.ts`).
 *
 * Existe porque la fuga NO estaba en una regla mal escrita: estaba en que
 * `routes/stream.ts` **nunca miraba el request**. La identidad estaba ahí
 * (`perimetroApi` deja `req.vendedoraId`, `cargarRol` deja `req.rolResuelto`) y
 * el handler reenviaba el evento crudo igual. Un defecto así no lo ve ningún
 * test de la función pura — es la lección de ADR 0024, otra vez.
 *
 * Por eso acá se levanta el montaje REAL de `index.ts` (perímetro → cargarRol →
 * router), se conectan DOS vendedoras al mismo tiempo y se mira **los bytes que
 * salieron por cada cable** ante un único evento.
 */

const LUZ = firmarSesion("Luz"); // con mayúscula: es lo que se tipea en producción
const SINDY = firmarSesion("ventas11@grupogoberna.com");
const JEFA = firmarSesion("estephano");

const EQUIPO: Record<string, LecturaDeEquipo> = {
  luz: { estado: "ok", fila: { personaId: "luz", nombre: "Luz", rol: "vendedora", activa: true } },
  "ventas11@grupogoberna.com": {
    estado: "ok",
    fila: { personaId: "ventas11@grupogoberna.com", nombre: "Sindy", rol: "vendedora", activa: true },
  },
  estephano: {
    estado: "ok",
    fila: { personaId: "estephano", nombre: "Estephano", rol: "supervisor", activa: true },
  },
};

const leer: LectorDeEquipo = async (id) => EQUIPO[id.trim().toLowerCase()] ?? { estado: "ok", fila: null };

/** La línea de campaña de producción y quiénes la atienden (`numeros_wa` + `numero_vendedora`). */
const CAMPANA = "51963139984";
const LINEAS = [
  { numero: "51984429504", proposito: "vendedora", vendedoras: ["Luz", "ventas11@grupogoberna.com"] },
  { numero: CAMPANA, proposito: PROPOSITO_CAMPANA, vendedoras: ["Usuario2"] },
];
/** El mismo cálculo que hace `numeros/repositorio.ts` en producción, sin base. */
const leerVedadas = async (id: string) => lineasVedadasPara(LINEAS, id);
const BETTO = firmarSesion("usuario2");

/** Sin `HERMES_SUPERVISORES` ni `HERMES_ADMINS`: el rol sale sólo de la tabla. */
const ENV: NodeJS.ProcessEnv = {};

/**
 * Conecta N clientes al stream, emite lo que diga `emitir`, y devuelve lo que
 * cada uno recibió. El SSE no termina nunca: se corta con `AbortController`
 * después de darle al bus un tick para propagar.
 */
async function loQueRecibeCadaUna(
  tokens: string[],
  emitir: () => void,
): Promise<Array<Array<Record<string, unknown>>>> {
  const app = express();
  app.use(perimetroApi);
  app.use(cargarRol(leer, ENV));
  app.use(cargarLineasVedadas(leerVedadas));
  app.use("/api/stream", streamRouter);

  const server = app.listen(0);
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const control = new AbortController();

  try {
    const recibido: string[] = tokens.map(() => "");
    const lectores: Array<Promise<void>> = [];
    for (const [i, token] of tokens.entries()) {
      const r = await fetch(`${base}/api/stream`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: control.signal,
      });
      assert.equal(r.status, 200);
      const lector = r.body!.getReader();
      /**
       * ⚠️ El bucle se ACUMULA, no se espera: el stream no cierra hasta el
       * abort de más abajo. Devolver esta promesa desde un `async` que
       * `Promise.all` recolecta la haría ADOPTAR — y ahí el test se cuelga
       * esperando un lector que sólo termina después del abort, que viene
       * después de ese await. (Pasó; por eso está escrito.)
       */
      lectores.push(
        (async () => {
          const dec = new TextDecoder();
          try {
            for (;;) {
              const { done, value } = await lector.read();
              if (done) break;
              recibido[i] += dec.decode(value, { stream: true });
            }
          } catch {
            // el abort llega como error de lectura; es la salida esperada
          }
        })(),
      );
    }

    // Las tres suscripciones ya están; recién ahí se emite.
    emitir();
    await new Promise((r) => setTimeout(r, 50));
    control.abort();
    await Promise.all(lectores);

    return recibido.map((crudo) =>
      crudo
        .split("\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => JSON.parse(l.slice(6)) as Record<string, unknown>),
    );
  } finally {
    control.abort();
    // 🔴 `server.close()` SOLO deja de aceptar conexiones: espera a que las
    // abiertas terminen, y un SSE no termina nunca (tiene su propio keep-alive).
    // Sin `closeAllConnections` el test cuelga hasta el timeout de la suite.
    server.closeAllConnections();
    server.close();
    await once(server, "close");
  }
}

describe("GET /api/stream — el evento se recorta por dueña", () => {
  test("🔴 el teléfono del lead de Luz NO sale por el cable de Sindy", async () => {
    const [deLuz, deSindy] = await loQueRecibeCadaUna([LUZ, SINDY], () =>
      emitirRT({
        tipo: "mensaje",
        canal: "whatsapp",
        telefono: "51987654321",
        direccion: "entrante",
        duena: "luz",
        linea: "51984429504",
      }),
    );

    assert.deepEqual(deLuz, [
      { tipo: "mensaje", canal: "whatsapp", telefono: "51987654321", direccion: "entrante" },
    ]);
    // Sindy se entera de que algo se movió —su cola se refresca— y de nada más.
    assert.deepEqual(deSindy, [{ tipo: "mensaje", canal: "whatsapp" }]);
  });

  test("quien supervisa lo recibe entero", async () => {
    const [deJefa] = await loQueRecibeCadaUna([JEFA], () =>
      emitirRT({
        tipo: "mensaje",
        canal: "whatsapp",
        telefono: "51987654321",
        direccion: "entrante",
        duena: "luz",
        linea: "51984429504",
      }),
    );
    assert.equal(deJefa[0].telefono, "51987654321");
  });

  test("🔴 la grafía no importa: `Luz` en la tabla y `luz` en el token son la misma", async () => {
    // El token dice `Luz` (lo que se tipea) y el reparto guardó `luz`. Con
    // comparación exacta esto no da error: da que Luz se queda sin su propia
    // campanita, para siempre y sin síntoma.
    const [deLuz] = await loQueRecibeCadaUna([LUZ], () =>
      emitirRT({
        tipo: "mensaje",
        canal: "whatsapp",
        telefono: "51987654321",
        duena: "luz",
        linea: "51984429504",
      }),
    );
    assert.equal(deLuz[0].telefono, "51987654321");
  });

  test("sin dueña se recorta para todas menos quien supervisa — falla CERRADO", async () => {
    const [deLuz, deJefa] = await loQueRecibeCadaUna([LUZ, JEFA], () =>
      emitirRT({
        tipo: "mensaje",
        canal: "whatsapp",
        telefono: "51987654321",
        duena: null,
        linea: "51984429504",
      }),
    );
    assert.deepEqual(deLuz, [{ tipo: "mensaje", canal: "whatsapp" }]);
    assert.equal(deJefa[0].telefono, "51987654321");
  });

  test("🔴 el lead de la CAMPAÑA no sale por el cable de quien supervisa la Escuela", async () => {
    // La única frontera que el rol no abre (`numeros/campana.ts`): Estephano es
    // supervisor y `esSuya` le daría `true` de entrada. Quien atiende la
    // campaña —usuario2— sí lo recibe entero, que es lo que prueba que el
    // recorte es por LÍNEA y no un apagón.
    const [deJefa, deBetto] = await loQueRecibeCadaUna([JEFA, BETTO], () =>
      emitirRT({
        tipo: "mensaje",
        canal: "whatsapp",
        telefono: "51900112233",
        direccion: "entrante",
        duena: "usuario2",
        linea: CAMPANA,
      }),
    );
    assert.deepEqual(deJefa, [{ tipo: "mensaje", canal: "whatsapp" }]);
    assert.equal(deBetto[0].telefono, "51900112233");
  });

  test("el evento de estado llega igual a todas: no identifica a nadie", async () => {
    const [deLuz, deSindy] = await loQueRecibeCadaUna([LUZ, SINDY], () => emitirRT({ tipo: "estado" }));
    assert.deepEqual(deLuz, [{ tipo: "estado" }]);
    assert.deepEqual(deSindy, [{ tipo: "estado" }]);
  });

  test("sigue siendo del perímetro: sin Bearer no se conecta", async () => {
    const app = express();
    app.use(perimetroApi);
    app.use(cargarRol(leer, ENV));
    app.use("/api/stream", streamRouter);
    const server = app.listen(0);
    await once(server, "listening");
    try {
      const r = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/stream`);
      assert.equal(r.status, 401);
      await r.text();
    } finally {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    }
  });
});
