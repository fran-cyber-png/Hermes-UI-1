import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { describe, test } from "node:test";
import express from "express";
import { firmarSesion } from "../auth/sesion.js";
import { PROPOSITO_CAMPANA } from "../numeros/campana.js";
import {
  CODIGO_OTRO_MODULO,
  deEsteModulo,
  type LectorDeLineasConProposito,
} from "./deEsteModulo.js";
import type { Modulo } from "./modulo.js";

/**
 * EL CANDADO DE MÓDULO, interrogado sin base.
 *
 * El server efímero es loopback y el lector es un seam: se prueba NUESTRO
 * middleware con su decisión, no se sale a ningún servicio. Molde:
 * `routes/miLinea.test.ts`.
 */

const BETTO = "centurion:betto.romero";
const LUZ = "luz";

/** Un server con el candado de un módulo delante de una ruta cualquiera. */
async function levantar(modulo: Modulo, leer: LectorDeLineasConProposito) {
  const app = express();
  app.use("/api/x", deEsteModulo(modulo, leer), (_req, res) => {
    res.json({ ok: true, paso: true });
  });
  const server = app.listen(0);
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return {
    async pedir(token?: string) {
      const r = await fetch(`http://127.0.0.1:${port}/api/x`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      return { status: r.status, cuerpo: (await r.json()) as Record<string, unknown> };
    },
    async cerrar() {
      server.close();
      await once(server, "close");
    },
  };
}

const DE_CAMPANA: LectorDeLineasConProposito = async () => [{ proposito: PROPOSITO_CAMPANA }];
const DE_VENTAS: LectorDeLineasConProposito = async () => [{ proposito: "vendedora" }];

describe("el candado de módulo", () => {
  test("🔴 quien atiende una campaña come 403 en una superficie de ventas", async () => {
    const s = await levantar("ventas", DE_CAMPANA);
    try {
      const r = await s.pedir(firmarSesion(BETTO));
      assert.equal(r.status, 403);
      assert.equal(r.cuerpo.codigo, CODIGO_OTRO_MODULO);
      assert.equal(r.cuerpo.modulo, "ventas", "el 403 dice de qué módulo es la superficie");
      assert.equal(r.cuerpo.paso, undefined, "no tiene que haber llegado al router");
    } finally {
      await s.cerrar();
    }
  });

  test("una vendedora de ventas pasa — el candado es por lado, no un apagón", async () => {
    const s = await levantar("ventas", DE_VENTAS);
    try {
      const r = await s.pedir(firmarSesion(LUZ));
      assert.equal(r.status, 200);
      assert.equal(r.cuerpo.paso, true);
    } finally {
      await s.cerrar();
    }
  });

  /**
   * 🔴 LA SIMETRÍA ES EL FRENTE. Con `soloEscuela` (ADR 0061) esta frase no se
   * podía escribir: la campaña era la excepción y sólo se sabía negar hacia un
   * lado. Hoy no hay ninguna superficie declarada `campana` — este test existe
   * para que la primera que se declare no tenga que estrenar el mecanismo.
   */
  test("y al revés: una vendedora de ventas come 403 en una superficie de campaña", async () => {
    const s = await levantar("campana", DE_VENTAS);
    try {
      const r = await s.pedir(firmarSesion(LUZ));
      assert.equal(r.status, 403);
      assert.equal(r.cuerpo.modulo, "campana");
    } finally {
      await s.cerrar();
    }
  });

  test("sin líneas cae en ventas: se comporta como antes de este frente", async () => {
    const s = await levantar("ventas", async () => []);
    try {
      assert.equal((await s.pedir(firmarSesion("nueva"))).status, 200);
    } finally {
      await s.cerrar();
    }
  });

  /**
   * 🔴 La grafía: en producción el mismo humano tiene dos vivas. Con comparación
   * sin normalizar acá no habría error — habría un operador de campaña entrando
   * al padrón de la Escuela por escribir su usuario con otra caja.
   */
  test("no le importa la grafía con la que entró", async () => {
    const s = await levantar("ventas", DE_CAMPANA);
    try {
      assert.equal((await s.pedir(firmarSesion("CENTURION:Betto.Romero"))).status, 403);
    } finally {
      await s.cerrar();
    }
  });

  test("sin sesión pasa: la puerta es el perímetro, no esto", async () => {
    let consultas = 0;
    const s = await levantar("ventas", async () => {
      consultas += 1;
      return [];
    });
    try {
      assert.equal((await s.pedir()).status, 200);
      assert.equal(consultas, 0, "sin identidad no se paga una consulta a la base");
    } finally {
      await s.cerrar();
    }
  });

  /**
   * 🔴 FAIL-CLOSED. El precio está escrito en el módulo: un parpadeo de Postgres
   * le corta la ficha a la Escuela. Se elige igual, porque dejar pasar ante la
   * duda convierte cada hipo de la base en una fuga sin síntoma.
   */
  test("si la lectura falla, 500 y NO pasa", async () => {
    const s = await levantar("ventas", async () => {
      throw new Error("la base parpadeó");
    });
    try {
      const r = await s.pedir(firmarSesion(LUZ));
      assert.equal(r.status, 500);
      assert.equal(r.cuerpo.paso, undefined);
      assert.equal(r.cuerpo.codigo, undefined, "un fallo NO se disfraza del 403 del módulo");
    } finally {
      await s.cerrar();
    }
  });

  test("y un fallo NO tumba el proceso — Express 4 no atrapa un rechazo async", async () => {
    // Si el middleware devolviera una promesa rechazada, esto sería
    // `unhandledRejection` y el server se caería para todo el equipo.
    const s = await levantar("ventas", async () => {
      throw new Error("otra vez");
    });
    try {
      await s.pedir(firmarSesion(LUZ));
      assert.equal((await s.pedir(firmarSesion(LUZ))).status, 500, "el server sigue vivo");
    } finally {
      await s.cerrar();
    }
  });
});
