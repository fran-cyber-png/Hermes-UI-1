import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { firmarSesion } from "../auth/sesion.js";

/**
 * ⚠️ EL ROUTER SE IMPORTA DINÁMICAMENTE, y no es capricho.
 *
 * `routes/campana.ts` importa el singleton `db/client.ts`, que **lanza al
 * importarse** si no hay `DATABASE_URL`. Con un `import` estático, este archivo
 * ni siquiera carga en un checkout sin `.env` — y lo que se prueba acá (la
 * puerta de supervisor, la traducción de un fallo de Meta) no toca la base ni
 * una vez.
 *
 * La URL es de mentira a propósito: `postgres.js` no conecta hasta la primera
 * consulta, y ninguno de estos tests llega a hacer una.
 */
process.env.DATABASE_URL ??= "postgres://nadie@127.0.0.1:1/no-se-usa";
const { campanaRouter } = await import("./campana.js");
const { cargarRol } = await import("../equipo/cargarRol.js");

/**
 * La puerta de la ruta de campañas: que exija supervisor, que distinga «no sos
 * supervisor» de «no hay ninguno configurado», y que un fallo de Meta NUNCA se
 * vea como «no hay plantillas».
 *
 * Un server efímero en loopback: se prueba NUESTRA ruta + middleware. Meta se
 * corta por env (sin `META_WABA_ID` el cliente falla `falta_config` sin salir a
 * la red), así que no hay una sola request hacia afuera.
 */

const TOKEN = firmarSesion("ana");

async function pedir(
  env: Record<string, string | undefined>,
  token: string | null = TOKEN,
): Promise<{ estado: number; cuerpo: Record<string, unknown> }> {
  const previo = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  // Sin esto el cliente saldría a la red de verdad en el test que espera 502.
  delete process.env.META_WABA_ID;

  const app = express();
  app.use((req, _res, next) => {
    // Middleware mínimo: el perímetro real ya validó el Bearer; acá interesa la
    // regla de supervisor, no el HMAC.
    const auth = req.headers.authorization;
    if (auth === `Bearer ${TOKEN}`) (req as { vendedoraId?: string }).vendedoraId = "ana";
    next();
  });
  /**
   * ⚠️ **La puerta ya no lee `process.env` adentro del handler: lee el rol que
   * `cargarRol` anotó.** Acá se monta con un lector que dice **«la tabla no
   * está»**, que es el estado real de producción hasta que la migración de
   * `equipo` se aplique — y en ese estado la cascada cae al CSV, que es
   * exactamente lo que estos tests fijan. Cuando la tabla exista, quién manda lo
   * dirá una fila y el candado de eso vive en `equipo/cascada.test.ts`.
   */
  app.use(cargarRol(async () => ({ estado: "sin_tabla", fila: null }), process.env));
  app.use("/api/campana", campanaRouter);
  const server = app.listen(0);
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/campana/plantillas`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    return { estado: r.status, cuerpo: (await r.json()) as Record<string, unknown> };
  } finally {
    server.close();
    process.env = previo;
  }
}

test("sin supervisores configurados NADIE entra, y se dice", async () => {
  // Fail-closed: la alternativa —«sin configurar, todos»— convierte una config
  // que falta en una fuga, y es el fallo que nadie investiga porque se ve como
  // que funciona.
  const { estado, cuerpo } = await pedir({ HERMES_SUPERVISORES: undefined });
  assert.equal(estado, 403);
  assert.equal(cuerpo.motivo, "no_es_supervisor");
  assert.equal(cuerpo.sinSupervisores, true, "«no hay ninguno» ≠ «vos no sos»");
});

test("una vendedora que no es supervisora no entra, y NO dice sinSupervisores", async () => {
  const { estado, cuerpo } = await pedir({ HERMES_SUPERVISORES: "otra@grupogoberna.com" });
  assert.equal(estado, 403);
  assert.equal(cuerpo.sinSupervisores, false, "hay supervisores; ella no lo es");
});

test("sin token tampoco", async () => {
  const { estado } = await pedir({ HERMES_SUPERVISORES: "ana" }, null);
  assert.equal(estado, 403);
});

test("la grafía no importa: se compara normalizando los dos lados", async () => {
  // El vendedora_id es lo que se TIPEA al entrar. Un supervisor con una
  // mayúscula distinta no vería un error, vería su pantalla vacía.
  const { estado } = await pedir({ HERMES_SUPERVISORES: "ANA" });
  assert.notEqual(estado, 403);
});

test("🔴 UN FALLO DE META NO SE VE COMO «NO HAY PLANTILLAS»", async () => {
  // Si esto devolviera {plantillas: []}, la pantalla diría que no hay ninguna
  // aprobada — y la reacción razonable a eso es ir a crear una que ya existe.
  const { estado, cuerpo } = await pedir({ HERMES_SUPERVISORES: "ana" });
  assert.equal(estado, 502);
  assert.equal(cuerpo.motivo, "meta_indisponible");
  assert.equal(cuerpo.codigo, "falta_config");
  assert.ok(!("plantillas" in cuerpo), "el cuerpo NO trae una lista vacía");
  assert.match(String(cuerpo.message), /META_WABA_ID/, "dice qué falta, no un error genérico");
});
