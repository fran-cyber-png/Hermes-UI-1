import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import { ruta } from "./ruta.js";

/**
 * 🔴 LO QUE ESTOS TESTS FIJAN ES QUE EL PROCESO SIGA VIVO.
 *
 * No alcanza con afirmar que la respuesta es 500: eso también pasaría con un
 * `try/catch` adentro del handler. Lo que hay que probar es que **el rechazo no
 * se escapa a `unhandledRejection`**, porque ése es el que tumba el server (ver
 * `routes/auth.falloDeBase.test.ts`, donde el defecto ya dejó a las cinco
 * vendedoras sin Hermes). Por eso cada test escucha el evento del proceso.
 */
async function conServidor(montar: (app: express.Express) => void) {
  const app = express();
  montar(app);
  const server: Server = createServer(app);
  server.listen(0);
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    cerrar: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** Cuenta los `unhandledRejection` que ocurran mientras corre `fn`. */
async function rechazosSinManejar(fn: () => Promise<void>): Promise<number> {
  let n = 0;
  const contar = () => { n += 1; };
  process.on("unhandledRejection", contar);
  try {
    await fn();
    // Un `unhandledRejection` se emite en un tick posterior: sin esta espera, el
    // test pasaría aunque el rechazo se estuviera escapando.
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    process.off("unhandledRejection", contar);
  }
  return n;
}

test("un handler async que falla contesta 500 y NO produce unhandledRejection", async () => {
  const s = await conServidor((app) => {
    app.get("/revienta", ruta(async () => {
      throw new Error("Failed query:\nSELECT * FROM interactions WHERE …", {
        cause: new Error('relation "interactions" does not exist'),
      });
    }));
  });

  let estado = 0;
  let cuerpo: unknown = null;
  const n = await rechazosSinManejar(async () => {
    const r = await fetch(`${s.url}/revienta`);
    estado = r.status;
    cuerpo = await r.json();
  });
  await s.cerrar();

  assert.equal(n, 0, "el rechazo se escapó: esto es lo que tumba el proceso");
  assert.equal(estado, 500);
  assert.deepEqual(Object.keys(cuerpo as object).sort(), ["message", "ok"]);
});

test("el cuerpo NO lleva el mensaje del error: con drizzle ese mensaje es el SQL", async () => {
  const s = await conServidor((app) => {
    app.get("/filtra", ruta(async () => {
      throw new Error("Failed query:\nSELECT persona_id, numero_propio FROM interactions", {
        cause: new Error("connection terminated"),
      });
    }));
  });

  const r = await fetch(`${s.url}/filtra`);
  const cuerpo = JSON.stringify(await r.json());
  await s.cerrar();

  assert.ok(!cuerpo.includes("SELECT"), `el SQL viajó al cliente: ${cuerpo}`);
  assert.ok(!cuerpo.includes("interactions"), `un nombre de tabla viajó al cliente: ${cuerpo}`);
  assert.ok(!cuerpo.includes("connection terminated"), "la causa cruda viajó al cliente");
});

test("un throw SÍNCRONO cae en el mismo lugar que un rechazo", async () => {
  const s = await conServidor((app) => {
    app.get("/sincronico", ruta(() => {
      throw new Error("explotó antes de cualquier await");
    }));
  });

  const n = await rechazosSinManejar(async () => {
    const r = await fetch(`${s.url}/sincronico`);
    assert.equal(r.status, 500);
  });
  await s.cerrar();
  assert.equal(n, 0);
});

test("si el handler YA respondió, el fallo posterior se loguea y no se pisa la respuesta", async () => {
  // El patrón real de `webhook/ruta.ts` (contestar primero, trabajar después) y de
  // `POST /api/whatsapp/leido`. Un segundo `res.json()` acá tiraría
  // ERR_HTTP_HEADERS_SENT: otro rechazo, adentro del catch que vino a evitarlos.
  const s = await conServidor((app) => {
    app.get("/ack-primero", ruta(async (_req, res) => {
      res.status(202).json({ ok: true });
      throw new Error("el trabajo de después falló");
    }));
  });

  let estado = 0;
  let cuerpo: unknown = null;
  const n = await rechazosSinManejar(async () => {
    const r = await fetch(`${s.url}/ack-primero`);
    estado = r.status;
    cuerpo = await r.json();
  });
  await s.cerrar();

  assert.equal(n, 0);
  assert.equal(estado, 202, "el 202 que ya se había mandado se conserva");
  assert.deepEqual(cuerpo, { ok: true });
});

test("un handler que anda no se toca: misma respuesta, mismo status", async () => {
  const s = await conServidor((app) => {
    app.get("/anda", ruta(async (_req, res) => {
      res.status(201).json({ recordatorios: [1, 2, 3] });
    }));
  });

  const r = await fetch(`${s.url}/anda`);
  const cuerpo = await r.json();
  await s.cerrar();

  assert.equal(r.status, 201);
  assert.deepEqual(cuerpo, { recordatorios: [1, 2, 3] });
});

test("un error TIPADO del dominio sigue llegando tal cual a la pantalla", async () => {
  // `no_es_supervisor`, `adjunto_muy_pesado`, `modo_retirado`, los ocho de Ivi:
  // son respuestas deliberadas que la UI ramifica. El envoltorio no las toca
  // porque el handler responde y NO lanza.
  const s = await conServidor((app) => {
    app.get("/tipado", ruta(async (_req, res) => {
      res.status(403).json({ ok: false, codigo: "no_es_supervisor" });
    }));
  });

  const r = await fetch(`${s.url}/tipado`);
  const cuerpo = await r.json();
  await s.cerrar();

  assert.equal(r.status, 403);
  assert.deepEqual(cuerpo, { ok: false, codigo: "no_es_supervisor" });
});
