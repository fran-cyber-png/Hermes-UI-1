import { test } from "node:test";
import assert from "node:assert/strict";
import type { NextFunction, Request, Response } from "express";
import { credencialValida, exigeServicio, requiereServicio } from "./servicio.js";

test("credencialValida: exacta true; distinta, distinto largo, o vacías false", () => {
  assert.equal(credencialValida("s3cr3t0", "s3cr3t0"), true);
  assert.equal(credencialValida("s3cr3t0", "s3cr3t1"), false); // mismo largo, distinta
  assert.equal(credencialValida("s3cr3t0", "s3cr3t0-mas"), false); // distinto largo
  assert.equal(credencialValida("", "s3cr3t0"), false); // sin token recibido
  assert.equal(credencialValida("s3cr3t0", ""), false); // sin secreto configurado → fail-closed
});

/** Construye req/res falsos para ejercer el middleware sin HTTP real. */
function fakes(header?: string) {
  const req = { headers: header ? { authorization: header } : {} } as unknown as Request;
  let status = 0;
  let body: unknown = null;
  const res = {
    status(c: number) {
      status = c;
      return this;
    },
    json(b: unknown) {
      body = b;
      return this;
    },
  } as unknown as Response;
  let llamado = false;
  const next: NextFunction = () => {
    llamado = true;
  };
  return { req, res, next, get status() {
    return status;
  }, get body() {
    return body;
  }, get llamado() {
    return llamado;
  } };
}

test("requiereServicio: sin Bearer → 401 con el envelope de error", () => {
  process.env.HERMES_ADMIN_SERVICE_TOKEN = "token-de-prueba";
  const f = fakes();
  requiereServicio(f.req, f.res, f.next);
  assert.equal(f.status, 401);
  assert.equal(f.llamado, false);
  assert.deepEqual(f.body, {
    error: { motivo: "credencial_invalida", mensaje: "credencial de servicio inválida o ausente" },
  });
});

test("requiereServicio: token equivocado → 401", () => {
  process.env.HERMES_ADMIN_SERVICE_TOKEN = "token-de-prueba";
  const f = fakes("Bearer otro-token");
  requiereServicio(f.req, f.res, f.next);
  assert.equal(f.status, 401);
  assert.equal(f.llamado, false);
});

test("requiereServicio: token correcto → next(), cuelga req.servicio", () => {
  process.env.HERMES_ADMIN_SERVICE_TOKEN = "token-de-prueba";
  const f = fakes("Bearer token-de-prueba");
  requiereServicio(f.req, f.res, f.next);
  assert.equal(f.llamado, true);
  assert.equal(f.status, 0);
  assert.equal(f.req.servicio, "cerberus");
});

/**
 * 🔴 QUE `req.servicio` SIGNIFIQUE ALGO.
 *
 * `/api/admin` se monta con UN middleware para el router entero, y hasta el
 * 14-ago-2026 nadie leía la identidad que ese middleware dejaba puesta: se
 * asignaba y nada más. O sea que sumar una segunda credencial de servicio —el
 * directorio de personas es el candidato— concedía de yapa TODO `/api/admin`,
 * incluido `?purgar=true`, que es lo único irreversible del router.
 */
test("exigeServicio: deja pasar a la identidad nombrada", () => {
  const req = { servicio: "cerberus" } as unknown as Request;
  let paso = false;
  exigeServicio("cerberus")(req, {} as Response, (() => {
    paso = true;
  }) as NextFunction);
  assert.equal(paso, true);
});

test("🔴 exigeServicio: una credencial de servicio DISTINTA no hereda lo destructivo", () => {
  for (const servicio of ["catalogo", "directorio", undefined]) {
    const req = { servicio } as unknown as Request;
    let status = 0;
    let body: { error?: { motivo?: string } } = {};
    const res = {
      status(c: number) {
        status = c;
        return this;
      },
      json(b: unknown) {
        body = b as typeof body;
        return this;
      },
    } as unknown as Response;
    let paso = false;
    exigeServicio("cerberus")(req, res, (() => {
      paso = true;
    }) as NextFunction);

    assert.equal(paso, false, `${servicio ?? "sin identidad"} no puede purgar una sesión`);
    assert.equal(status, 403);
    assert.equal(body.error?.motivo, "servicio_no_autorizado");
  }
});
