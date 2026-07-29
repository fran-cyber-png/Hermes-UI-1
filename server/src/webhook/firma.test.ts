import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test, describe, after } from "node:test";
import express from "express";
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

  test("64 caracteres NO-hex devuelven false, jamás explotan — Buffer.from('z…','hex') trunca en silencio", () => {
    // El chequeo de largo sobre la CADENA dejaba pasar 64 zetas: el decode daba
    // 0 bytes contra 32 y timingSafeEqual tiraba — un 500 desde internet sin
    // credencial. La regresión que fija el hex estricto.
    const cuerpo = '{"folio":"GOB-11851"}';
    assert.equal(firmaValida(cuerpo, "z".repeat(64), SECRETO), false);
    assert.equal(firmaValida(cuerpo, "sha256=" + "z".repeat(64), SECRETO), false);
    assert.equal(firmaValida(cuerpo, "sha256=" + "a".repeat(60) + "zzzz", SECRETO), false);
  });

  test("acepta el cuerpo como Buffer — la firma es de los bytes del cable", () => {
    const cuerpo = Buffer.from('{"folio":"GOB-11851"}');
    assert.equal(firmaValida(cuerpo, firmar(cuerpo.toString("utf8")), SECRETO), true);
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
      cuerpoCrudo: cuerpoCrudo === undefined ? undefined : Buffer.from(cuerpoCrudo),
      path: "/webhook/whatsapp",
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

  test("sin body crudo capturado → 403 SIEMPRE — aun con la firma del VACÍO, que era el bypass", () => {
    process.env.WHATSAPP_APP_SECRET = SECRETO;
    // La versión anterior de este test usaba la firma de un body no-vacío y
    // pasaba POR ACCIDENTE: con `?? ""`, la firma de la CADENA VACÍA validaba —
    // una constante replayable. El caso que importa es exactamente ese.
    const conFirmaDelVacio = armar(undefined, firmar(""));
    exigirFirmaWhatsapp(conFirmaDelVacio.req, conFirmaDelVacio.res, conFirmaDelVacio.next);
    assert.equal(conFirmaDelVacio.paso(), false);
    assert.equal(conFirmaDelVacio.estado(), 403);

    const conOtraFirma = armar(undefined, firmar('{"entry":[]}'));
    exigirFirmaWhatsapp(conOtraFirma.req, conOtraFirma.res, conOtraFirma.next);
    assert.equal(conOtraFirma.estado(), 403);
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
  function reqDe(path: string): Request {
    return { path } as unknown as Request;
  }

  test("captura para el webhook EN CUALQUIER CASO del path, y no para el resto", () => {
    for (const path of ["/webhook/whatsapp", "/WEBHOOK/whatsapp", "/Webhook/WhatsApp"]) {
      const req = reqDe(path);
      capturarCuerpoCrudo(req, {} as Response, Buffer.from('{"a":1}'));
      assert.equal(req.cuerpoCrudo?.toString("utf8"), '{"a":1}', path);
    }
    for (const path of ["/api/conversaciones", "/webhook/cerberus", "/webhook/landing", "/webhookLoQueSea"]) {
      const req = reqDe(path);
      capturarCuerpoCrudo(req, {} as Response, Buffer.from('{"a":1}'));
      assert.equal(req.cuerpoCrudo, undefined, path);
    }
  });
});

/**
 * LA APP REAL — sin dobles (la observación H5 de la revisión adversaria): el
 * parser de verdad con su `verify`, el middleware de verdad, requests HTTP de
 * verdad. Los dos bypasses confirmados (el caso del path y el 500 del hex)
 * pasaban TODOS los tests de unidad; estos los fijan contra el cableado.
 */
describe("el webhook con la app express de verdad", () => {
  const secretoOriginal = process.env.WHATSAPP_APP_SECRET;
  after(() => {
    if (secretoOriginal === undefined) delete process.env.WHATSAPP_APP_SECRET;
    else process.env.WHATSAPP_APP_SECRET = secretoOriginal;
  });

  async function conAppReal(
    fn: (base: string, cuerpoVisto: () => unknown) => Promise<void>,
  ): Promise<void> {
    process.env.WHATSAPP_APP_SECRET = SECRETO;
    const app = express();
    app.use(express.json({ verify: capturarCuerpoCrudo }));
    let visto: unknown = null;
    // Handler stub: el real (`recibirWhatsapp`) importa la base y acá se prueba
    // la PUERTA, no la ingesta. La puerta es lo que este PR cablea.
    app.post("/webhook/whatsapp", exigirFirmaWhatsapp, (req, res) => {
      visto = req.body;
      res.sendStatus(200);
    });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    try {
      await fn(`http://127.0.0.1:${port}`, () => visto);
    } finally {
      server.close();
      await once(server, "close");
    }
  }

  const CUERPO = '{"entry":[{"id":"x"}]}';

  test("firma válida → 200 y el body llega al handler", async () => {
    await conAppReal(async (base, visto) => {
      const r = await fetch(`${base}/webhook/whatsapp`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-hub-signature-256": firmar(CUERPO) },
        body: CUERPO,
      });
      assert.equal(r.status, 200);
      assert.deepEqual(visto(), JSON.parse(CUERPO));
    });
  });

  test("content-type con charset (como manda Meta) → el verify corre igual y la firma pasa", async () => {
    await conAppReal(async (base) => {
      const r = await fetch(`${base}/webhook/whatsapp`, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8", "x-hub-signature-256": firmar(CUERPO) },
        body: CUERPO,
      });
      assert.equal(r.status, 200);
    });
  });

  test("H1: /WEBHOOK/whatsapp con la firma del VACÍO → 403 — la firma nunca se desata del cuerpo", async () => {
    await conAppReal(async (base, visto) => {
      // Express rutea case-insensitive: este request LLEGA al handler. Con la
      // captura case-sensitive de antes, el crudo quedaba sin capturar y
      // HMAC(secreto, "") — una constante — validaba cualquier body.
      const r = await fetch(`${base}/WEBHOOK/whatsapp`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-hub-signature-256": firmar("") },
        body: '{"entry":[{"id":"wamid.FALSIFICADO"}]}',
      });
      assert.equal(r.status, 403);
      assert.equal(visto(), null);
    });
  });

  test("H2: 64 caracteres no-hex → 403, jamás 500", async () => {
    await conAppReal(async (base) => {
      const r = await fetch(`${base}/webhook/whatsapp`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=" + "z".repeat(64) },
        body: CUERPO,
      });
      assert.equal(r.status, 403);
    });
  });
});
