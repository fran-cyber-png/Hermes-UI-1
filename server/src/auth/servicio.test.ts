import { test } from "node:test";
import assert from "node:assert/strict";
import type { NextFunction, Request, Response } from "express";
import { credencialValida, requiereServicio } from "./servicio.js";

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
