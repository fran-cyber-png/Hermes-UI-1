import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { FUENTE, interpretar, momento } from "./metaPayload.js";

/**
 * LOS PAYLOADS SON LOS DE META, copiados de su documentación y de la forma que
 * llega de verdad. El valor de este archivo está en los casos que NO son el
 * feliz: el eco de nuestro propio mensaje, el `verb: 'remove'`, el comentario de
 * Instagram que no trae hora. Cada uno de esos, mal leído, produce una fila que
 * se ve razonable en la base y miente en la pantalla.
 */

const PAGE_ID = "142062936237878"; // la Página «Goberna»
const IG_ID = "17841407552521114";

describe("comentarios de Facebook (object: page, field: feed)", () => {
  const cuerpo = (value: Record<string, unknown>) => ({
    object: "page",
    entry: [{ id: PAGE_ID, time: 1754600000000, changes: [{ field: "feed", value }] }],
  });

  const COMENTARIO = {
    item: "comment",
    verb: "add",
    comment_id: "1234567890_9876543210",
    post_id: `${PAGE_ID}_555`,
    created_time: 1754599000,
    from: { id: "7788", name: "Ana Beltrán" },
    message: "¿Cuánto está la inversión?",
  };

  test("un comentario nuevo se proyecta con la misma forma que el polling", () => {
    const [item] = interpretar(cuerpo(COMENTARIO));
    assert.equal(item.source, FUENTE.comentarioFb);
    assert.deepEqual(item.proyeccion, {
      externalId: "1234567890_9876543210",
      canal: "facebook",
      tipo: "comentario",
      personaId: "7788",
      personaNombre: "Ana Beltrán",
      texto: "¿Cuánto está la inversión?",
      pageId: PAGE_ID,
      contextoId: `${PAGE_ID}_555`,
      contextoTexto: null,
      occurredAt: new Date(1754599000 * 1000),
    });
  });

  /**
   * `feed` trae TODO lo que pasa en el muro. Sin este recorte, cada reacción y
   * cada post propio entraría a la cola como si alguien nos hubiera hablado.
   */
  test("lo que no es un comentario NO entra: reacciones, posts, compartidos", () => {
    assert.deepEqual(interpretar(cuerpo({ ...COMENTARIO, item: "reaction" })), []);
    assert.deepEqual(interpretar(cuerpo({ ...COMENTARIO, item: "post" })), []);
    assert.deepEqual(interpretar(cuerpo({ ...COMENTARIO, item: "share" })), []);
  });

  test("borrar y ocultar no son contenido nuevo: no dejan una burbuja muda (fix #70)", () => {
    assert.deepEqual(interpretar(cuerpo({ ...COMENTARIO, verb: "remove" })), []);
    assert.deepEqual(interpretar(cuerpo({ ...COMENTARIO, verb: "hide" })), []);
    assert.equal(interpretar(cuerpo({ ...COMENTARIO, verb: "edited" })).length, 1);
  });

  test("sin comment_id no hay idempotencia posible: mejor perderlo que duplicarlo", () => {
    assert.deepEqual(interpretar(cuerpo({ ...COMENTARIO, comment_id: undefined })), []);
  });

  test("sin nombre igual sirve: el comentario existe aunque Meta oculte quién es", () => {
    const [item] = interpretar(cuerpo({ ...COMENTARIO, from: undefined }));
    assert.equal(item.proyeccion.personaId, null);
    assert.equal(item.proyeccion.personaNombre, null);
    assert.equal(item.proyeccion.texto, "¿Cuánto está la inversión?");
  });
});

describe("comentarios de Instagram (object: instagram, field: comments)", () => {
  const CUERPO = {
    object: "instagram",
    entry: [
      {
        id: IG_ID,
        time: 1754600000000,
        changes: [
          {
            field: "comments",
            value: {
              id: "17900000000000000",
              from: { id: "9911", username: "sofia.mendoza" },
              media: { id: "18000000000000000", media_product_type: "FEED" },
              text: "Info por favor 🙌",
            },
          },
        ],
      },
    ],
  };

  test("se proyecta con el @usuario, que es lo único que da Meta y alcanza", () => {
    const [item] = interpretar(CUERPO);
    assert.equal(item.source, FUENTE.comentarioIg);
    assert.equal(item.proyeccion.canal, "instagram");
    assert.equal(item.proyeccion.personaNombre, "sofia.mendoza");
    assert.equal(item.proyeccion.texto, "Info por favor 🙌");
    assert.equal(item.proyeccion.contextoId, "18000000000000000");
  });

  /**
   * EL CASO QUE SE VE BIEN Y ROMPE LA PANTALLA. El webhook de comentarios de IG
   * no manda hora. Con `new Date(undefined)` la fila queda `Invalid Date`; con
   * un 0, en enero de 1970 — y ahí cae FUERA de la ventana de 30 días de la
   * cola, o sea que el comentario se guarda y no aparece en ningún lado.
   */
  test("sin hora propia usa la del entry, nunca 1970 ni Invalid Date", () => {
    const [item] = interpretar(CUERPO);
    assert.equal(item.proyeccion.occurredAt.getTime(), 1754600000000);
    assert.equal(Number.isNaN(item.proyeccion.occurredAt.getTime()), false);
  });
});

describe("mensajes de Messenger y DMs de Instagram (entry[].messaging)", () => {
  const mensajeria = (m: Record<string, unknown>, object = "page") => ({
    object,
    entry: [{ id: PAGE_ID, time: 1754600000000, messaging: [m] }],
  });

  const ENTRANTE = {
    sender: { id: "psid-4455" },
    recipient: { id: PAGE_ID },
    timestamp: 1754599500000,
    message: { mid: "m_AbCdEf123", text: "Hola, quiero info del diploma" },
  };

  test("un mensaje del lead entra como entrante, de la persona", () => {
    const [item] = interpretar(mensajeria(ENTRANTE));
    assert.equal(item.source, FUENTE.mensajeFb);
    assert.equal(item.proyeccion.tipo, "mensaje");
    assert.equal(item.proyeccion.direccion, "entrante");
    assert.equal(item.proyeccion.autor, "persona");
    assert.equal(item.proyeccion.personaId, "psid-4455");
    assert.equal(item.proyeccion.externalId, "m_AbCdEf123");
    assert.equal(item.proyeccion.occurredAt.getTime(), 1754599500000);
  });

  /**
   * ⚠️ EL ECO. Meta nos devuelve por el webhook TODO lo que la Página manda,
   * incluso desde Business Suite. Leerlo como entrante haría que la cola contara
   * como deuda las respuestas que ya dimos, y `respondida` diría lo contrario de
   * lo que pasó.
   */
  test("is_echo es NUESTRO mensaje: saliente, de la página, sin persona_id", () => {
    const [item] = interpretar(
      mensajeria({
        sender: { id: PAGE_ID },
        recipient: { id: "psid-4455" },
        timestamp: 1754599900000,
        message: { mid: "m_EchoXyz", text: "Hola! Te paso la info", is_echo: true },
      }),
    );
    assert.equal(item.proyeccion.direccion, "saliente");
    assert.equal(item.proyeccion.autor, "pagina");
    assert.equal(item.proyeccion.personaId, null);
  });

  test("sin is_echo, un sender que ES la Página también es saliente", () => {
    const [item] = interpretar(
      mensajeria({
        sender: { id: PAGE_ID },
        recipient: { id: "psid-4455" },
        timestamp: 1754599900000,
        message: { mid: "m_SinEcho", text: "…" },
      }),
    );
    assert.equal(item.proyeccion.direccion, "saliente");
  });

  test("los acuses de lectura y entrega NO son mensajes", () => {
    assert.deepEqual(
      interpretar(mensajeria({ sender: { id: "psid-1" }, read: { watermark: 175459 } })),
      [],
    );
    assert.deepEqual(
      interpretar(mensajeria({ sender: { id: "psid-1" }, delivery: { mids: ["m_1"] } })),
      [],
    );
    assert.deepEqual(
      interpretar(mensajeria({ sender: { id: "psid-1" }, postback: { payload: "GET_STARTED" } })),
      [],
    );
  });

  test("un DM de Instagram entra con canal instagram, no facebook", () => {
    const [item] = interpretar(mensajeria(ENTRANTE, "instagram"));
    assert.equal(item.proyeccion.canal, "instagram");
  });
});

describe("lo que NO se entiende no rompe: el webhook responde 200 igual", () => {
  test("un objeto ajeno, un body vacío o basura devuelven lista vacía sin tirar", () => {
    assert.deepEqual(interpretar({ object: "whatsapp_business_account", entry: [] }), []);
    assert.deepEqual(interpretar({}), []);
    assert.deepEqual(interpretar(null), []);
    assert.deepEqual(interpretar("hola"), []);
    assert.deepEqual(interpretar({ object: "page" }), []);
    assert.deepEqual(interpretar({ object: "page", entry: [{ time: 1 }] }), []);
    assert.deepEqual(interpretar({ object: "page", entry: [{ id: PAGE_ID, changes: [{}] }] }), []);
  });

  test("un campo que todavía no manejamos se ignora, no se guarda a medias", () => {
    const cuerpo = {
      object: "page",
      entry: [{ id: PAGE_ID, time: 1, changes: [{ field: "mention", value: { post_id: "1" } }] }],
    };
    assert.deepEqual(interpretar(cuerpo), []);
  });

  test("varios eventos en un body se devuelven todos, en orden", () => {
    const cuerpo = {
      object: "page",
      entry: [
        {
          id: PAGE_ID,
          time: 1754600000000,
          changes: [
            {
              field: "feed",
              value: { item: "comment", verb: "add", comment_id: "c1", created_time: 1754599000 },
            },
          ],
          messaging: [
            { sender: { id: "p1" }, timestamp: 1754599500000, message: { mid: "m1", text: "a" } },
          ],
        },
      ],
    };
    assert.deepEqual(
      interpretar(cuerpo).map((i) => i.proyeccion.externalId),
      ["c1", "m1"],
    );
  });
});

describe("momento()", () => {
  test("segundos y milisegundos, sin confundirlos", () => {
    assert.equal(momento(1754599000, undefined).getTime(), 1754599000000);
    assert.equal(momento(undefined, 1754599000000).getTime(), 1754599000000);
  });

  test("sin nada usable cae en ahora, nunca en 1970 ni en Invalid Date", () => {
    const antes = Date.now();
    for (const v of [undefined, null, 0, -1, "", "mañana", NaN]) {
      const d = momento(v, v);
      assert.equal(Number.isNaN(d.getTime()), false, `momento(${String(v)}) dio Invalid Date`);
      assert.ok(d.getTime() >= antes, `momento(${String(v)}) cayó en el pasado`);
    }
  });
});
