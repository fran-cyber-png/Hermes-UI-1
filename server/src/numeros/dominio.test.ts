import { test } from "node:test";
import assert from "node:assert/strict";
import {
  esquemaUpsert,
  normalizarNumero,
  estadoSesionAContrato,
  estadoVinculacionAContrato,
} from "./dominio.js";

test("normalizarNumero: dígitos, mínimo 8, y prefija 51 a un móvil peruano de 9", () => {
  assert.equal(normalizarNumero("51986394450"), "51986394450");
  assert.equal(normalizarNumero("+51 986 394 450"), "51986394450");
  assert.equal(normalizarNumero("986394450"), "51986394450"); // 9 dígitos, móvil PE
  assert.equal(normalizarNumero("123"), null); // muy corto
  assert.equal(normalizarNumero(""), null);
});

test("esquemaUpsert: defaults sensatos y etiqueta obligatoria", () => {
  const ok = esquemaUpsert.parse({ etiqueta: "Escuela" });
  assert.equal(ok.proposito, "escuela");
  assert.equal(ok.activo, true);
  assert.deepEqual(ok.vendedoras, []);
  assert.equal(ok.referencia, null);

  const conTodo = esquemaUpsert.parse({
    etiqueta: " Campaña ",
    proposito: "campana",
    referencia: " ad_123 ",
    activo: false,
    vendedoras: ["ana", "bea"],
  });
  assert.equal(conTodo.etiqueta, "Campaña");
  assert.equal(conTodo.referencia, "ad_123");
  assert.equal(conTodo.activo, false);
  assert.deepEqual(conTodo.vendedoras, ["ana", "bea"]);

  assert.equal(esquemaUpsert.safeParse({ etiqueta: "" }).success, false);
  assert.equal(esquemaUpsert.safeParse({ etiqueta: "X", proposito: "otro" }).success, false);
});

test("estadoSesionAContrato: mapea cada estado del transporte, y el ban se ve", () => {
  assert.deepEqual(estadoSesionAContrato({ estado: "conectado", telefono: "519" }), {
    estado: "conectado",
    ban: null,
  });
  assert.deepEqual(estadoSesionAContrato({ estado: "conectando" }), { estado: "desconectado", ban: null });
  assert.deepEqual(estadoSesionAContrato({ estado: "desconectado", motivo: "x" }), {
    estado: "desconectado",
    ban: null,
  });
  assert.deepEqual(estadoSesionAContrato({ estado: "cerrada", motivo: "x" }), {
    estado: "sin_vincular",
    ban: null,
  });
  assert.deepEqual(estadoSesionAContrato({ estado: "sin-vincular", qr: null, codigo: null }), {
    estado: "sin_vincular",
    ban: null,
  });
  assert.deepEqual(estadoSesionAContrato({ estado: "baneado", codigo: "451", expira: "2026-07-25" }), {
    estado: "baneado",
    ban: { codigo: "451", expira_at: "2026-07-25" },
  });
});

test("estadoVinculacionAContrato: el QR pasa como esperando_qr; arranque como vinculando", () => {
  assert.deepEqual(estadoVinculacionAContrato({ estado: "inactivo" }), { estado: "expirado" });
  assert.deepEqual(estadoVinculacionAContrato({ estado: "esperando", numero: "519" }), {
    estado: "vinculando",
  });
  assert.deepEqual(estadoVinculacionAContrato({ estado: "qr", numero: "519", qr: "data:img" }), {
    estado: "esperando_qr",
    qr: "data:img",
  });
  assert.deepEqual(estadoVinculacionAContrato({ estado: "conectado", numero: "519", jid: "519@s" }), {
    estado: "conectado",
    jid: "519@s",
  });
  assert.deepEqual(estadoVinculacionAContrato({ estado: "error", numero: "519", motivo: "boom" }), {
    estado: "error",
    motivo: "boom",
  });
});
