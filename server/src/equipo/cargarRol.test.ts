import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { describe, test } from "node:test";
import express, { Router, type Request } from "express";
import { firmarSesion, requiereVendedora } from "../auth/sesion.js";
import { esRutaAbierta, perimetroApi } from "../auth/perimetro.js";
import { ENV_SUPERVISORES } from "../padron/supervisor.js";
import { cargarRol, rolDe, mandaEnElEquipo, type LectorDeEquipo } from "./cargarRol.js";
import { ENV_ADMINS, type LecturaDeEquipo } from "./cascada.js";

/**
 * 🔴 EL TEST DEL FRENTE: que el rol se resuelva TAMBIÉN en `GET /api/auth/yo`.
 *
 * `/api/auth` es un prefijo ABIERTO del perímetro y `routes/auth.ts` monta
 * `requiereVendedora` como handler del propio `/yo` — o sea, DESPUÉS de todo
 * `app.use`. Un `cargarRol` que leyera `req.vendedoraId` lo encontraría
 * `undefined` justo ahí, que es el único lugar por donde el rol baja al front:
 * el panel quedaría invisible para todos, incluido el admin, sin 403 y sin log.
 *
 * Acá se reproduce el montaje EXACTO de `index.ts` (perímetro → cargarRol →
 * routers) con una copia mínima de la forma de `/yo`. No se importa el router de
 * verdad porque `routes/auth.ts` importa el singleton `db`, que tira sin
 * `DATABASE_URL` y encima consultaría Cerberus.
 */

const TOKEN = firmarSesion("Luz"); // se tipea con mayúscula: es lo que pasa en prod

const lector =
  (lectura: LecturaDeEquipo): LectorDeEquipo =>
  async () =>
    lectura;

const CON_FILA = (rol: "admin" | "supervisor" | "vendedora"): LecturaDeEquipo => ({
  estado: "ok",
  fila: { personaId: "luz", nombre: "Luz", rol, activa: true },
});
const SIN_FILA: LecturaDeEquipo = { estado: "ok", fila: null };

/** El montaje real: perímetro, cargarRol, y después los routers. */
async function conApp(
  leer: LectorDeEquipo,
  env: NodeJS.ProcessEnv,
  usar: (base: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(perimetroApi);
  app.use(cargarRol(leer, env));

  // La forma de `routes/auth.ts`: el prefijo está abierto y `/yo` valida el suyo
  // ADENTRO, como handler propio.
  const auth = Router();
  auth.get("/yo", requiereVendedora, (req: Request, res) => {
    res.json({ vendedora: req.vendedoraId, ...rolDe(req) });
  });
  app.use("/api/auth", auth);

  // Una ruta cualquiera detrás del perímetro, para el resto de los casos.
  const cola = Router();
  cola.get("/", (req: Request, res) => res.json({ manda: mandaEnElEquipo(req), ...rolDe(req) }));
  app.use("/api/conversaciones", cola);

  const server = app.listen(0);
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  try {
    await usar(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

const pedir = async (base: string, ruta: string, token: string | null = TOKEN) => {
  const r = await fetch(`${base}${ruta}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { estado: r.status, cuerpo: (await r.json().catch(() => ({}))) as Record<string, unknown> };
};

describe("la trampa: el prefijo abierto de /api/auth", () => {
  test("`/api/auth/yo` SIGUE estando fuera del perímetro — si esto cambia, releé el docblock", () => {
    // La precondición del diseño, fijada: mientras `/api/auth` esté abierto,
    // ningún `app.use` puede contar con que `req.vendedoraId` exista ahí.
    assert.equal(esRutaAbierta("/api/auth/yo"), true);
    assert.equal(esRutaAbierta("/api/conversaciones"), false);
  });

  test("🔴 el rol se resuelve en `/api/auth/yo`, que es por donde baja al front", async () => {
    await conApp(lector(CON_FILA("admin")), {} as NodeJS.ProcessEnv, async (base) => {
      const { estado, cuerpo } = await pedir(base, "/api/auth/yo");
      assert.equal(estado, 200);
      assert.equal(cuerpo.vendedora, "Luz", "el token sigue trayendo la grafía cruda");
      assert.equal(cuerpo.rol, "admin", "sin esto el panel es invisible hasta para el admin");
      assert.equal(cuerpo.personaId, "luz", "y el id viaja canónico");
    });
  });
});

describe("qué anota y qué no", () => {
  test("detrás del perímetro también anota", async () => {
    await conApp(lector(CON_FILA("supervisor")), {} as NodeJS.ProcessEnv, async (base) => {
      const { cuerpo } = await pedir(base, "/api/conversaciones");
      assert.equal(cuerpo.rol, "supervisor");
      assert.equal(cuerpo.manda, true);
    });
  });

  test("sin token no consulta la base — `/api/admin` y `/api/catalogo` no la pagan", async () => {
    let consultas = 0;
    const contando: LectorDeEquipo = async () => {
      consultas++;
      return SIN_FILA;
    };
    await conApp(contando, {} as NodeJS.ProcessEnv, async (base) => {
      const { estado } = await pedir(base, "/api/conversaciones", null);
      assert.equal(estado, 401, "el que rechaza es el perímetro, no cargarRol");
    });
    assert.equal(consultas, 0);
  });

  test("un token que no verifica NO se anota y NO responde 401 por su cuenta", async () => {
    // cargarRol no es una puerta: anota. Un Bearer que no es una sesión válida
    // (por ejemplo el token de servicio de Cerberus) simplemente pasa de largo.
    let consultas = 0;
    const contando: LectorDeEquipo = async () => {
      consultas++;
      return SIN_FILA;
    };
    await conApp(contando, {} as NodeJS.ProcessEnv, async (base) => {
      const { estado } = await pedir(base, "/api/auth/yo", "esto-no-es-un-hmac");
      assert.equal(estado, 401, "el 401 lo pone `requiereVendedora` adentro de /yo");
    });
    assert.equal(consultas, 0);
  });
});

describe("el entorno se INYECTA, no se lee del global", () => {
  test("el break-glass del `.env` llega hasta la anotación", async () => {
    const env = { [ENV_ADMINS]: "Luz" } as unknown as NodeJS.ProcessEnv;
    await conApp(lector(CON_FILA("vendedora")), env, async (base) => {
      const { cuerpo } = await pedir(base, "/api/auth/yo");
      assert.equal(cuerpo.rol, "admin");
      assert.equal(cuerpo.porBreakGlass, true);
    });
  });

  test("y el CSV de supervisores sigue valiendo mientras no haya fila", async () => {
    const env = { [ENV_SUPERVISORES]: "luz" } as unknown as NodeJS.ProcessEnv;
    await conApp(lector(SIN_FILA), env, async (base) => {
      const { cuerpo } = await pedir(base, "/api/conversaciones");
      assert.equal(cuerpo.rol, "supervisor");
      assert.equal(cuerpo.manda, true);
    });
  });
});

describe("nunca tumba el proceso", () => {
  test("un seam que RECHAZA deja el rol sin resolver y el request sigue", async () => {
    // Express 4 no atrapa el rechazo de un middleware async: sería
    // `unhandledRejection` y el proceso abajo, delante de TODA la API.
    const explota: LectorDeEquipo = async () => {
      throw new Error("boom");
    };
    await conApp(explota, {} as NodeJS.ProcessEnv, async (base) => {
      const { estado, cuerpo } = await pedir(base, "/api/conversaciones");
      assert.equal(estado, 200);
      assert.equal(cuerpo.rol, "vendedora", "fail-closed");
      assert.equal(cuerpo.rolNoResuelto, true);
      assert.equal(cuerpo.manda, false);
    });
  });
});

describe("`rolDe` sin middleware", () => {
  test("es fail-closed: un router montado suelto no hereda permisos", () => {
    const req = { headers: {} } as unknown as Request;
    assert.equal(rolDe(req).rol, "vendedora");
    assert.equal(rolDe(req).rolNoResuelto, true);
    assert.equal(mandaEnElEquipo(req), false);
  });
});
