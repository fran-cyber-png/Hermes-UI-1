import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test, describe, after } from "node:test";
import type { NextFunction, Request, Response } from "express";
import { capturarCuerpoCrudo, exigirFirmaWhatsapp, firmaValida } from "./firma.js";

/**
 * La firma es lo único que separa "una venta de Cerberus" de "cualquiera que descubra la URL".
 * Sin esto, alguien podría inventarnos ventas falsas y contaminar la optimización de Meta con
 * conversiones que nunca ocurrieron. Es la puerta, y tiene que cerrar bien.
 */

const SECRETO = "un-secreto-de-prueba";

function firmar(cuerpo: string, secreto = SECRETO): string {
  return "sha256=" + createHmac("sha256", secreto).update(cuerpo, "utf8").digest("hex");
}

describe("firmaValida", () => {
  test("acepta una firma correcta", () => {
    const cuerpo = '{"folio":"GOB-11851"}';
    assert.equal(firmaValida(cuerpo, firmar(cuerpo), SECRETO), true);
  });

  test("rechaza un cuerpo alterado — aunque sea un byte", () => {
    const cuerpo = '{"folio":"GOB-11851","monto":350}';
    const firma = firmar(cuerpo);
    const alterado = '{"folio":"GOB-11851","monto":3500}'; // le agregaron un cero al monto
    assert.equal(firmaValida(alterado, firma, SECRETO), false);
  });

  test("rechaza una firma hecha con OTRO secreto", () => {
    const cuerpo = '{"folio":"GOB-11851"}';
    const firmaAjena = firmar(cuerpo, "secreto-del-atacante");
    assert.equal(firmaValida(cuerpo, firmaAjena, SECRETO), false);
  });

  test("rechaza firma vacía o ausente", () => {
    const cuerpo = '{"folio":"GOB-11851"}';
    assert.equal(firmaValida(cuerpo, "", SECRETO), false);
    assert.equal(firmaValida(cuerpo, undefined, SECRETO), false);
    assert.equal(firmaValida(cuerpo, null, SECRETO), false);
  });

  test("acepta el prefijo 'sha256=' o sin prefijo — distintos emisores lo escriben distinto", () => {
    const cuerpo = '{"folio":"GOB-11851"}';
    const hex = createHmac("sha256", SECRETO).update(cuerpo).digest("hex");
    assert.equal(firmaValida(cuerpo, `sha256=${hex}`, SECRETO), true);
    assert.equal(firmaValida(cuerpo, hex, SECRETO), true);
  });

  test("es resistente a timing: una firma de largo equivocado no explota, devuelve false", () => {
    const cuerpo = '{"folio":"GOB-11851"}';
    assert.equal(firmaValida(cuerpo, "sha256=abc", SECRETO), false);
    assert.equal(firmaValida(cuerpo, "basura", SECRETO), false);
  });

  test("sin secreto configurado NUNCA valida — falla cerrado, no abierto", () => {
    // Si el secreto no está seteado, la puerta se cierra. Jamás se abre por descuido.
    const cuerpo = '{"folio":"GOB-11851"}';
    assert.equal(firmaValida(cuerpo, firmar(cuerpo), ""), false);
    assert.equal(firmaValida(cuerpo, firmar(cuerpo), undefined), false);
  });
});

/**
 * El CABLEADO de la puerta (#107). `firmaValida` estuvo un mes 100 % testeada y
 * con CERO imports en producción — la lección de siempre: la regresión vive en
 * el cableado, no en la unidad. Estos tests ejercitan el middleware que la ruta
 * monta de verdad.
 */
describe("exigirFirmaWhatsapp", () => {
  const secretoOriginal = process.env.WHATSAPP_APP_SECRET;
  after(() => {
    if (secretoOriginal === undefined) delete process.env.WHATSAPP_APP_SECRET;
    else process.env.WHATSAPP_APP_SECRET = secretoOriginal;
  });

  function armar(cuerpoCrudo: string | undefined, firma: string | undefined) {
    const req = {
      cuerpoCrudo,
      headers: firma === undefined ? {} : { "x-hub-signature-256": firma },
    } as unknown as Request;
    let estado: number | null = null;
    const res = {
      sendStatus: (s: number) => {
        estado = s;
      },
    } as unknown as Response;
    let paso = false;
    const next: NextFunction = () => {
      paso = true;
    };
    return { req, res, next, estado: () => estado, paso: () => paso };
  }

  test("con firma válida sobre el CRUDO, el handler corre", () => {
    process.env.WHATSAPP_APP_SECRET = SECRETO;
    const cuerpo = '{"entry":[]}';
    const h = armar(cuerpo, firmar(cuerpo));
    exigirFirmaWhatsapp(h.req, h.res, h.next);
    assert.equal(h.paso(), true);
    assert.equal(h.estado(), null);
  });

  test("firma inválida → 403 y el handler NO corre: nada se guarda", () => {
    process.env.WHATSAPP_APP_SECRET = SECRETO;
    const h = armar('{"entry":[]}', firmar('{"otra":"cosa"}'));
    exigirFirmaWhatsapp(h.req, h.res, h.next);
    assert.equal(h.paso(), false);
    assert.equal(h.estado(), 403);
  });

  test("sin header de firma → 403", () => {
    process.env.WHATSAPP_APP_SECRET = SECRETO;
    const h = armar('{"entry":[]}', undefined);
    exigirFirmaWhatsapp(h.req, h.res, h.next);
    assert.equal(h.estado(), 403);
  });

  test("sin WHATSAPP_APP_SECRET → 403 SIEMPRE, aun con una firma bien hecha (falla cerrado)", () => {
    delete process.env.WHATSAPP_APP_SECRET;
    const cuerpo = '{"entry":[]}';
    const h = armar(cuerpo, firmar(cuerpo));
    exigirFirmaWhatsapp(h.req, h.res, h.next);
    assert.equal(h.paso(), false);
    assert.equal(h.estado(), 403);
  });

  test("sin body crudo capturado → 403 (el crudo faltante no puede validar nada)", () => {
    process.env.WHATSAPP_APP_SECRET = SECRETO;
    const h = armar(undefined, firmar('{"entry":[]}'));
    exigirFirmaWhatsapp(h.req, h.res, h.next);
    assert.equal(h.estado(), 403);
  });

  test("la firma vale sobre los BYTES CRUDOS, no sobre el JSON re-serializado", () => {
    process.env.WHATSAPP_APP_SECRET = SECRETO;
    // Con espacios: `JSON.stringify(JSON.parse(x))` daría otros bytes y otra
    // firma — el motivo exacto por el que existe `capturarCuerpoCrudo`.
    const crudo = '{ "entry" : [ ] }';
    const h = armar(crudo, firmar(crudo));
    exigirFirmaWhatsapp(h.req, h.res, h.next);
    assert.equal(h.paso(), true);
  });
});

describe("capturarCuerpoCrudo", () => {
  function reqDe(url: string): Request {
    return { url } as unknown as Request;
  }

  test("guarda el crudo para /webhook/* y NO para el resto de la API", () => {
    const webhook = reqDe("/webhook/whatsapp");
    capturarCuerpoCrudo(webhook, {} as Response, Buffer.from('{"a":1}'));
    assert.equal(webhook.cuerpoCrudo, '{"a":1}');

    const api = reqDe("/api/conversaciones");
    capturarCuerpoCrudo(api, {} as Response, Buffer.from('{"a":1}'));
    assert.equal(api.cuerpoCrudo, undefined);
  });
});
