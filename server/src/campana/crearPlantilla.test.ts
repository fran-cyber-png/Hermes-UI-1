import assert from "node:assert/strict";
import test from "node:test";
import { crearPlantilla, ErrorAlCrear, subirEjemploDeImagen } from "./crearPlantilla.js";

const CRED = { appId: "111", wabaId: "222", token: "T" };
const BUENA = {
  nombre: "promo_agosto",
  idioma: "es_PE",
  categoria: "MARKETING",
  cuerpo: "Hola, tenemos una promo.",
};

/** Registra cada llamada para poder afirmar sobre headers y URLs. */
function espia(respuestas: unknown[], estados: number[] = []) {
  const llamadas: { url: string; init: RequestInit }[] = [];
  let i = 0;
  const fetchImpl = (async (url: URL | string, init: RequestInit) => {
    llamadas.push({ url: String(url), init });
    const cuerpo = respuestas[Math.min(i, respuestas.length - 1)];
    const estado = estados[Math.min(i, estados.length - 1)] ?? 200;
    i++;
    return new Response(JSON.stringify(cuerpo), {
      status: estado,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { llamadas, fetchImpl };
}

test("crea la plantilla y devuelve su id y estado", async () => {
  const { fetchImpl, llamadas } = espia([{ id: "999", status: "PENDING", category: "MARKETING" }]);
  const r = await crearPlantilla(BUENA, { ...CRED, fetchImpl });
  assert.equal(r.id, "999");
  assert.equal(r.estado, "PENDING");
  assert.match(llamadas[0].url, /\/222\/message_templates$/);
  assert.match(llamadas[0].url, /v23\.0/, "la versión de la Graph API se FIJA, no se deja abierta");
});

test("🔴 LOS REPAROS SE REVISAN ANTES DE SALIR A LA RED", async () => {
  // El ciclo con Meta es de hasta 24 h. Enterarse mañana de que habia una
  // mayuscula en el nombre es el peor lazo posible.
  const { fetchImpl, llamadas } = espia([{}]);
  await assert.rejects(
    () => crearPlantilla({ ...BUENA, nombre: "Promo Agosto" }, { ...CRED, fetchImpl }),
    (e: unknown) => e instanceof ErrorAlCrear && e.codigo === "reparos" && e.reparos.length === 1,
  );
  assert.equal(llamadas.length, 0, "no se molestó a Meta");
});

test("el cuerpo con variables lleva su EJEMPLO, o Meta rechaza sin decir por qué", async () => {
  const { fetchImpl, llamadas } = espia([{ id: "1" }]);
  await crearPlantilla({ ...BUENA, cuerpo: "Hola {{1}}, tu curso {{2}} arranca" }, { ...CRED, fetchImpl });
  const body = JSON.parse(String(llamadas[0].init.body));
  const cuerpo = body.components.find((c: { type: string }) => c.type === "BODY");
  assert.deepEqual(cuerpo.example.body_text, [["ejemplo1", "ejemplo2"]]);
});

test("sin variables NO se manda un ejemplo vacío", async () => {
  const { fetchImpl, llamadas } = espia([{ id: "1" }]);
  await crearPlantilla(BUENA, { ...CRED, fetchImpl });
  const body = JSON.parse(String(llamadas[0].init.body));
  const cuerpo = body.components.find((c: { type: string }) => c.type === "BODY");
  assert.equal(cuerpo.example, undefined);
});

test("el header de imagen viaja como header_handle", async () => {
  const { fetchImpl, llamadas } = espia([{ id: "1" }]);
  await crearPlantilla({ ...BUENA, headerImagenHandle: "4::aW..." }, { ...CRED, fetchImpl });
  const body = JSON.parse(String(llamadas[0].init.body));
  const h = body.components.find((c: { type: string }) => c.type === "HEADER");
  assert.equal(h.format, "IMAGE");
  assert.deepEqual(h.example.header_handle, ["4::aW..."]);
});

test("la imagen le gana al header de texto: son excluyentes", async () => {
  const { fetchImpl, llamadas } = espia([{ id: "1" }]);
  await crearPlantilla(
    { ...BUENA, headerImagenHandle: "4::aW...", headerTexto: "Hola" },
    { ...CRED, fetchImpl },
  );
  const body = JSON.parse(String(llamadas[0].init.body));
  const headers = body.components.filter((c: { type: string }) => c.type === "HEADER");
  assert.equal(headers.length, 1, "un solo HEADER");
  assert.equal(headers[0].format, "IMAGE");
});

test("los botones se traducen a QUICK_REPLY o URL según tengan link", async () => {
  const { fetchImpl, llamadas } = espia([{ id: "1" }]);
  await crearPlantilla(
    { ...BUENA, botones: [{ texto: "Quiero info" }, { texto: "Pagar", url: "https://x.pe" }] },
    { ...CRED, fetchImpl },
  );
  const body = JSON.parse(String(llamadas[0].init.body));
  const bs = body.components.find((c: { type: string }) => c.type === "BUTTONS").buttons;
  assert.equal(bs[0].type, "QUICK_REPLY");
  assert.equal(bs[1].type, "URL");
  assert.equal(bs[1].url, "https://x.pe");
});

test("🔴 LA SUBIDA VA CON `OAuth`, NO CON `Bearer` — y con file_offset", async () => {
  // Es la trampa que hace perder una tarde: con Bearer responde 401 y parece
  // que el token esta mal, cuando el token esta perfecto.
  const { fetchImpl, llamadas } = espia([{ id: "upload:SES" }, { h: "4::HANDLE" }]);
  const h = await subirEjemploDeImagen(new Uint8Array([1, 2, 3]), "f.jpg", "image/jpeg", {
    ...CRED,
    fetchImpl,
  });
  assert.equal(h, "4::HANDLE");

  const abrir = llamadas[0].init.headers as Record<string, string>;
  assert.match(abrir.Authorization, /^Bearer /, "abrir la sesión SÍ va con Bearer");
  assert.match(llamadas[0].url, /\/111\/uploads/, "va con el APP ID, no con el WABA");

  const subir = llamadas[1].init.headers as Record<string, string>;
  assert.match(subir.Authorization, /^OAuth /, "subir los bytes va con OAuth");
  assert.equal(subir.file_offset, "0");
  assert.match(llamadas[1].url, /upload:SES/);
});

test("el largo del archivo que se declara es el REAL", async () => {
  const { fetchImpl, llamadas } = espia([{ id: "upload:S" }, { h: "H" }]);
  await subirEjemploDeImagen(new Uint8Array(1234), "f.jpg", "image/jpeg", { ...CRED, fetchImpl });
  assert.match(llamadas[0].url, /file_length=1234/);
  assert.match(llamadas[0].url, /file_type=image%2Fjpeg/);
});

test("si Meta no devuelve el handle, se lanza — no se sigue con `undefined`", async () => {
  const { fetchImpl } = espia([{ id: "upload:S" }, { ok: true }]);
  await assert.rejects(
    () => subirEjemploDeImagen(new Uint8Array([1]), "f.jpg", "image/jpeg", { ...CRED, fetchImpl }),
    (e: unknown) => e instanceof ErrorAlCrear && e.codigo === "respuesta_invalida",
  );
});

test("EL CUPO LLENO NO ES UN ERROR DE LA PLANTILLA", async () => {
  // 2388019 es de la CUENTA: la salida es borrar plantillas viejas o verificar
  // el portafolio. Mezclarlo con «tu texto esta mal» manda a corregir lo que
  // no falla.
  const { fetchImpl } = espia([{ error: { code: 2388019, message: "limit exceeded" } }], [400]);
  await assert.rejects(
    () => crearPlantilla(BUENA, { ...CRED, fetchImpl }),
    (e: unknown) => e instanceof ErrorAlCrear && e.codigo === "cupo_lleno",
  );
});

test("los 2388xxx de la plantilla se distinguen del resto", async () => {
  const { fetchImpl } = espia([{ error: { code: 2388299, message: "leading parameters" } }], [400]);
  await assert.rejects(
    () => crearPlantilla(BUENA, { ...CRED, fetchImpl }),
    (e: unknown) => e instanceof ErrorAlCrear && e.codigo === "rechazada_al_crear",
  );
});

test("un 403 dice QUÉ scope falta, no «error 403»", async () => {
  const { fetchImpl } = espia([{ error: { code: 200, message: "no permission" } }], [403]);
  await assert.rejects(
    () => crearPlantilla(BUENA, { ...CRED, fetchImpl }),
    (e: unknown) =>
      e instanceof ErrorAlCrear &&
      e.codigo === "sin_permiso" &&
      /whatsapp_business_management/.test(e.message),
  );
});

test("sin credenciales se lanza antes de tocar la red", async () => {
  await assert.rejects(
    () => crearPlantilla(BUENA, { appId: "", wabaId: "", token: "" }),
    (e: unknown) => e instanceof ErrorAlCrear && e.codigo === "falta_config",
  );
});

test("el timeout se distingue de la red caída", async () => {
  const explota = (nombre: string): typeof fetch =>
    (async () => {
      const e = new Error("nope");
      e.name = nombre;
      throw e;
    }) as unknown as typeof fetch;
  await assert.rejects(
    () => crearPlantilla(BUENA, { ...CRED, fetchImpl: explota("TimeoutError") }),
    (e: unknown) => e instanceof ErrorAlCrear && e.codigo === "timeout",
  );
  await assert.rejects(
    () => crearPlantilla(BUENA, { ...CRED, fetchImpl: explota("TypeError") }),
    (e: unknown) => e instanceof ErrorAlCrear && e.codigo === "red",
  );
});
