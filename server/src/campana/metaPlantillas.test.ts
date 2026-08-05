import assert from "node:assert/strict";
import test from "node:test";
import {
  comoPlantillaAprobada,
  cuerpoDe,
  ErrorDeMeta,
  interpretar,
  tieneHeaderDeImagen,
  traerPlantillasDeMeta,
} from "./metaPlantillas.js";

/**
 * COPIA LITERAL de lo que Meta devolvió el 5-ago-2026 para la WABA de la
 * Escuela. Es el fixture que defiende de un renombre de campo: si Meta cambia
 * `quality_score` por otra cosa, esto falla acá y no en una campaña de mil.
 */
const RESPUESTA_REAL_DE_META = {
  data: [
    {
      id: "1387372356726668",
      name: "foro_estado_5_ago",
      language: "es_PE",
      status: "APPROVED",
      category: "MARKETING",
      quality_score: { score: "UNKNOWN" },
      rejected_reason: "NONE",
      components: [
        { type: "HEADER", format: "IMAGE", example: { header_handle: ["4::aW..."] } },
        { type: "BODY", text: "Hola, te esperamos en el Foro de Estado." },
        { type: "FOOTER", text: "Goberna" },
      ],
    },
    {
      id: "1259544702043867",
      name: "promo_3x1_cursos",
      language: "en",
      status: "APPROVED",
      category: "MARKETING",
      quality_score: { score: "UNKNOWN" },
      rejected_reason: "NONE",
      components: [
        { type: "HEADER", format: "IMAGE" },
        { type: "BODY", text: "🚨 *PROMO 3X1 IMPERDIBLE* 🚨" },
      ],
    },
    {
      id: "999",
      name: "hello_world",
      language: "en_US",
      status: "APPROVED",
      category: "UTILITY",
      components: [{ type: "BODY", text: "Hello World" }],
    },
  ],
};

const fetchQueDevuelve = (cuerpo: unknown, estado = 200): typeof fetch =>
  (async () =>
    new Response(JSON.stringify(cuerpo), {
      status: estado,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

test("lee la respuesta real de produccion", async () => {
  const r = await traerPlantillasDeMeta({
    wabaId: "1",
    token: "x",
    fetchImpl: fetchQueDevuelve(RESPUESTA_REAL_DE_META),
  });
  assert.equal(r.length, 3);
  const foro = r.find((p) => p.nombre === "foro_estado_5_ago")!;
  assert.equal(foro.enviable, true);
  assert.equal(foro.headerDeImagen, true, "sin esto el envio falla con 132012");
  assert.equal(foro.cuerpo, "Hola, te esperamos en el Foro de Estado.");
  assert.equal(foro.calidad.tono, "espera", "UNKNOWN no es verde");
});

test("EL `type` DE META VIENE EN MAYUSCULAS AL LEER", () => {
  // Comparar sensible a mayusculas devuelve null para TODAS, y null significa
  // «no se puede versionar»: el lazo perderia la pieza entera, en silencio.
  assert.equal(cuerpoDe({ components: [{ type: "BODY", text: "hola" }] }), "hola");
  assert.equal(cuerpoDe({ components: [{ type: "body", text: "hola" }] }), "hola");
  assert.equal(tieneHeaderDeImagen({ components: [{ type: "HEADER", format: "IMAGE" }] }), true);
  assert.equal(tieneHeaderDeImagen({ components: [{ type: "header", format: "image" }] }), true);
});

test("sin componentes no se inventa un cuerpo", () => {
  assert.equal(cuerpoDe({}), null);
  assert.equal(cuerpoDe({ components: [] }), null);
  assert.equal(cuerpoDe({ components: [{ type: "HEADER", format: "IMAGE" }] }), null);
  assert.equal(cuerpoDe({ components: "no es lista" as never }), null);
});

test("un header de TEXTO no es un header de imagen", () => {
  assert.equal(tieneHeaderDeImagen({ components: [{ type: "HEADER", format: "TEXT" }] }), false);
});

test("SIN CUERPO NO SE PUEDE MANDAR: sin cuerpo no hay version", () => {
  const p = interpretar({ name: "x", language: "es", status: "APPROVED", components: [] });
  assert.equal(p.enviable, true, "Meta la aprobo");
  assert.equal(comoPlantillaAprobada(p), null, "pero sin cuerpo no se puede versionar");
});

test("una plantilla que no esta aprobada no se convierte", () => {
  for (const estado of ["PAUSED", "REJECTED", "PENDING", "DISABLED", "ALGO_NUEVO"]) {
    const p = interpretar({
      name: "x",
      language: "es",
      status: estado,
      components: [{ type: "BODY", text: "hola" }],
    });
    assert.equal(comoPlantillaAprobada(p), null, `${estado} no se manda`);
  }
});

test("FAIL-CLOSED: sin config se lanza, no se devuelve una lista vacia", async () => {
  // Una lista vacia es una mentira para quien la consume (cicatriz de ADR 0023),
  // y aca el consumidor es un envio a mil personas.
  await assert.rejects(
    () => traerPlantillasDeMeta({ wabaId: undefined, token: undefined, fetchImpl: fetchQueDevuelve({}) }),
    (e: unknown) => e instanceof ErrorDeMeta && e.codigo === "falta_config",
  );
});

test("un 403 se distingue de un 500: piden acciones distintas", async () => {
  await assert.rejects(
    () => traerPlantillasDeMeta({ wabaId: "1", token: "x", fetchImpl: fetchQueDevuelve({}, 403) }),
    (e: unknown) => e instanceof ErrorDeMeta && e.codigo === "sin_permiso",
  );
  await assert.rejects(
    () => traerPlantillasDeMeta({ wabaId: "1", token: "x", fetchImpl: fetchQueDevuelve({}, 500) }),
    (e: unknown) => e instanceof ErrorDeMeta && e.codigo === "http_inesperado",
  );
});

test("una respuesta sin `data` es un error, no cero plantillas", async () => {
  await assert.rejects(
    () => traerPlantillasDeMeta({ wabaId: "1", token: "x", fetchImpl: fetchQueDevuelve({ ok: true }) }),
    (e: unknown) => e instanceof ErrorDeMeta && e.codigo === "respuesta_invalida",
  );
});

test("la red caida se distingue del timeout", async () => {
  const explota = (nombre: string): typeof fetch =>
    (async () => {
      const e = new Error("nope");
      e.name = nombre;
      throw e;
    }) as unknown as typeof fetch;

  await assert.rejects(
    () => traerPlantillasDeMeta({ wabaId: "1", token: "x", fetchImpl: explota("TimeoutError") }),
    (e: unknown) => e instanceof ErrorDeMeta && e.codigo === "timeout",
  );
  await assert.rejects(
    () => traerPlantillasDeMeta({ wabaId: "1", token: "x", fetchImpl: explota("TypeError") }),
    (e: unknown) => e instanceof ErrorDeMeta && e.codigo === "red",
  );
});

test("un campo que Meta agregue no rompe nada", async () => {
  const conCampoNuevo = {
    data: [
      {
        name: "x",
        language: "es",
        status: "APPROVED",
        components: [{ type: "BODY", text: "hola" }],
        campo_que_meta_invento: { cosas: [1, 2] },
      },
    ],
  };
  const r = await traerPlantillasDeMeta({
    wabaId: "1",
    token: "x",
    fetchImpl: fetchQueDevuelve(conCampoNuevo),
  });
  assert.equal(r[0].enviable, true);
});
