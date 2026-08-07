import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { baseDePrueba } from "../pruebas/base.js";
import { guardarInteraccion } from "./proyectarInteraccion.js";
import { interpretar } from "../webhook/metaPayload.js";

/**
 * LOS DOS CAMINOS SOBRE LA MISMA BASE — que es donde se ve si conviven.
 *
 * El webhook trae el comentario en vivo; el polling (`npm run
 * ingest:interactions`) lo vuelve a traer después, porque sigue corriendo como
 * red de seguridad y porque es lo único que puede recuperar lo que se perdió
 * mientras el server estaba caído. **La segunda escritura tiene que ser un
 * no-op**, y si no lo fuera el síntoma sería el peor de todos: la conversación
 * duplicada en la cola de la vendedora, sin un error en ningún log.
 */

const PAGE_ID = "142062936237878";

const COMENTARIO_WEBHOOK = {
  object: "page",
  entry: [
    {
      id: PAGE_ID,
      time: 1754600000000,
      changes: [
        {
          field: "feed",
          value: {
            item: "comment",
            verb: "add",
            comment_id: "1234567890_9876543210",
            post_id: `${PAGE_ID}_555`,
            created_time: 1754599000,
            from: { id: "7788", name: "Ana Beltrán" },
            message: "¿Cuánto está la inversión?",
          },
        },
      ],
    },
  ],
};

/**
 * EL MISMO comentario tal como lo arma el polling desde el Graph API: `id` en vez
 * de `comment_id`, el post entero (por eso trae `contextoTexto`), y `from.name`.
 * Lo único que tiene que coincidir para que no duplique es `(source, externalId)`.
 */
const COMENTARIO_POLLING = {
  source: "meta_comment_fb",
  raw: { id: "1234567890_9876543210", post_id: `${PAGE_ID}_555` },
  proyeccion: {
    externalId: "1234567890_9876543210",
    canal: "facebook",
    tipo: "comentario",
    personaId: "7788",
    personaNombre: "Ana Beltrán",
    texto: "¿Cuánto está la inversión?",
    pageId: PAGE_ID,
    contextoId: `${PAGE_ID}_555`,
    contextoTexto: "Diploma en Gestión Pública — inscripciones abiertas",
    occurredAt: new Date(1754599000 * 1000),
  },
};

async function cuantas(db: Awaited<ReturnType<typeof baseDePrueba>>, externalId: string) {
  const [ev] = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM events WHERE external_id = ${externalId}`,
  );
  const [it] = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM interactions WHERE external_id = ${externalId}`,
  );
  return { eventos: ev?.n ?? 0, interacciones: it?.n ?? 0 };
}

describe("webhook y polling conviven sin duplicar", () => {
  test("el webhook escribe, el polling pasa después y NO duplica", async (t) => {
    const db = await baseDePrueba(t);

    const [item] = interpretar(COMENTARIO_WEBHOOK);
    assert.equal(await guardarInteraccion(item, db), true, "la primera escritura tiene que ser nueva");

    assert.equal(
      await guardarInteraccion(COMENTARIO_POLLING, db),
      false,
      "el polling volvió a escribir el mismo comentario: la cola lo mostraría duplicado",
    );

    assert.deepEqual(await cuantas(db, "1234567890_9876543210"), { eventos: 1, interacciones: 1 });
  });

  test("y al revés: el polling primero, el webhook después", async (t) => {
    const db = await baseDePrueba(t);

    assert.equal(await guardarInteraccion(COMENTARIO_POLLING, db), true);
    const [item] = interpretar(COMENTARIO_WEBHOOK);
    assert.equal(await guardarInteraccion(item, db), false);

    assert.deepEqual(await cuantas(db, "1234567890_9876543210"), { eventos: 1, interacciones: 1 });
  });

  test("el mismo webhook reenviado (Meta reintenta) tampoco duplica", async (t) => {
    const db = await baseDePrueba(t);
    const [item] = interpretar(COMENTARIO_WEBHOOK);

    assert.equal(await guardarInteraccion(item, db), true);
    assert.equal(await guardarInteraccion(item, db), false);
    assert.equal(await guardarInteraccion(item, db), false);

    assert.deepEqual(await cuantas(db, "1234567890_9876543210"), { eventos: 1, interacciones: 1 });
  });

  /**
   * GANA EL PRIMERO, y por eso los dos caminos tienen que ser intercambiables.
   * El webhook no trae el texto del post (`contexto_texto`): si el polling llegó
   * antes, ese dato queda — y si llegó después, no se pierde nada que la fila
   * necesite para servirse en la cola.
   */
  test("el que llega segundo NO pisa: la fila queda como la escribió el primero", async (t) => {
    const db = await baseDePrueba(t);

    const [item] = interpretar(COMENTARIO_WEBHOOK);
    await guardarInteraccion(item, db);
    await guardarInteraccion(COMENTARIO_POLLING, db);

    const [fila] = await db.execute<{ contexto_texto: string | null; texto: string | null }>(
      sql`SELECT contexto_texto, texto FROM interactions WHERE external_id = '1234567890_9876543210'`,
    );
    assert.equal(fila?.contexto_texto, null, "el webhook llegó primero y no trae el texto del post");
    assert.equal(fila?.texto, "¿Cuánto está la inversión?");
  });
});

describe("el webhook deja la fila que la cola sabe leer", () => {
  test("un DM entrante de Messenger entra como mensaje entrante de una persona", async (t) => {
    const db = await baseDePrueba(t);

    const [item] = interpretar({
      object: "page",
      entry: [
        {
          id: PAGE_ID,
          time: 1754600000000,
          messaging: [
            {
              sender: { id: "psid-4455" },
              recipient: { id: PAGE_ID },
              timestamp: 1754599500000,
              message: { mid: "m_AbCdEf123", text: "Hola, quiero info del diploma" },
            },
          ],
        },
      ],
    });
    await guardarInteraccion(item, db);

    const [fila] = await db.execute<{
      canal: string;
      tipo: string;
      direccion: string;
      autor: string | null;
      persona_id: string | null;
    }>(sql`SELECT canal, tipo, direccion, autor, persona_id FROM interactions
           WHERE external_id = 'm_AbCdEf123'`);

    assert.equal(fila?.canal, "facebook");
    assert.equal(fila?.tipo, "mensaje");
    assert.equal(fila?.direccion, "entrante");
    assert.equal(fila?.autor, "persona");
    assert.equal(fila?.persona_id, "psid-4455");
  });

  /**
   * ⚠️ EL ECO. Sin distinguirlo, `direccion` cae en el default `'entrante'` y la
   * cola contaría NUESTRA respuesta como deuda del lead: `respondida` diría lo
   * contrario de lo que pasó.
   */
  test("el eco de nuestro propio mensaje queda como SALIENTE en la base", async (t) => {
    const db = await baseDePrueba(t);

    const [item] = interpretar({
      object: "page",
      entry: [
        {
          id: PAGE_ID,
          time: 1754600000000,
          messaging: [
            {
              sender: { id: PAGE_ID },
              recipient: { id: "psid-4455" },
              timestamp: 1754599900000,
              message: { mid: "m_Echo1", text: "Te paso la info", is_echo: true },
            },
          ],
        },
      ],
    });
    await guardarInteraccion(item, db);

    const [fila] = await db.execute<{ direccion: string; autor: string | null }>(
      sql`SELECT direccion, autor FROM interactions WHERE external_id = 'm_Echo1'`,
    );
    assert.equal(fila?.direccion, "saliente");
    assert.equal(fila?.autor, "pagina");
  });
});
