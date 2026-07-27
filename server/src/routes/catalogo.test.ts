import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { firmarSesion } from "../auth/sesion.js";
import type { Pieza } from "../catalogo/pieza.js";
import { catalogoRouter } from "./catalogo.js";

/**
 * EL CATÁLOGO PARA IVI — la ruta con el lector INYECTADO (cero base).
 *
 * Lo que se prueba acá es la PUERTA y la HONESTIDAD de la respuesta, que es
 * todo lo que la ruta decide:
 *
 *   · quién entra (credencial de servicio, no la sesión de una vendedora);
 *   · qué pasa cuando el catálogo no se puede leer — **5xx, jamás `piezas: []`**.
 *     Es la cicatriz de Ivi (su ADR 0002): un 200 con lista vacía es
 *     indistinguible de «no hay nada» y se cachea como catálogo válido.
 *
 * El servidor efímero es 127.0.0.1: no sale a ningún lado.
 */

const TOKEN_SERVICIO = "token-de-catalogo-para-pruebas";

function pieza(over: Partial<Pieza> = {}): Pieza {
  return {
    clase: "hecho",
    id: "cuotas",
    version: "sha256:0000000000000000",
    estado: "vigente",
    alcance: "negocio",
    propietario: null,
    rotulo: "Se puede en 2 cuotas",
    texto: "El pago se puede hacer en 2 cuotas.",
    momentos: ["cotizada"],
    familia: null,
    pasos: null,
    placeholders: [],
    sintaxisPlaceholder: null,
    enviable: true,
    motivoNoEnviable: null,
    ...over,
  };
}

interface Respuesta {
  status: number;
  json: Record<string, unknown> | null;
}

/** Levanta el router con el lector inyectado, hace UN request y cierra. */
async function pedir(
  leer: () => Promise<Pieza[]>,
  opciones: { token?: string | null; ruta?: string; secreto?: string | null } = {},
): Promise<Respuesta> {
  const antes = process.env.HERMES_CATALOGO_SERVICE_TOKEN;
  const secreto = opciones.secreto === undefined ? TOKEN_SERVICIO : opciones.secreto;
  if (secreto === null) delete process.env.HERMES_CATALOGO_SERVICE_TOKEN;
  else process.env.HERMES_CATALOGO_SERVICE_TOKEN = secreto;

  const app = express();
  app.use(express.json());
  app.use("/api/catalogo", catalogoRouter(leer));

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  try {
    const headers: Record<string, string> = {};
    const token = opciones.token === undefined ? TOKEN_SERVICIO : opciones.token;
    if (token) headers.authorization = `Bearer ${token}`;
    const resp = await fetch(`http://127.0.0.1:${port}${opciones.ruta ?? "/api/catalogo/piezas"}`, {
      headers,
    });
    const json = (await resp.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: resp.status, json };
  } finally {
    server.close();
    await once(server, "close");
    if (antes === undefined) delete process.env.HERMES_CATALOGO_SERVICE_TOKEN;
    else process.env.HERMES_CATALOGO_SERVICE_TOKEN = antes;
  }
}

describe("GET /api/catalogo/piezas", () => {
  test("con la base caída: 5xx y NO una lista vacía", async () => {
    let sirvio = false;
    const caida = async (): Promise<Pieza[]> => {
      sirvio = true;
      throw new Error("connect ECONNREFUSED 127.0.0.1:5438");
    };

    const r = await pedir(caida);

    assert.equal(sirvio, true, "el lector tiene que haberse intentado");
    assert.ok(r.status >= 500, `esperaba 5xx, vino ${r.status}`);
    // Lo importante no es solo el status: el cuerpo NO puede traer un catálogo.
    assert.equal(r.json?.piezas, undefined, "un error nunca trae `piezas`");
    const error = r.json?.error as { motivo?: string } | undefined;
    assert.equal(error?.motivo, "catalogo_indisponible");
  });

  test("un catálogo vacío es un fallo, no un 200: siempre hay piezas de código", async () => {
    const r = await pedir(async () => []);

    assert.ok(r.status >= 500, `esperaba 5xx, vino ${r.status}`);
    assert.equal(r.json?.piezas, undefined);
    assert.equal((r.json?.error as { motivo?: string })?.motivo, "catalogo_vacio");
  });

  test("sin credencial: 401 y ni se lee el catálogo", async () => {
    let leido = false;
    const r = await pedir(
      async () => {
        leido = true;
        return [pieza()];
      },
      { token: null },
    );

    assert.equal(r.status, 401);
    assert.equal(leido, false);
  });

  test("con el Bearer de una VENDEDORA: 401 — Ivi es una máquina, no una vendedora", async () => {
    const r = await pedir(async () => [pieza()], { token: firmarSesion("ana") });
    assert.equal(r.status, 401);
  });

  test("sin el secreto configurado en el server: 503 falta_config, no 401", async () => {
    // La lección de `401` vs `503` que Ivi ya aprendió del otro lado: «el server
    // no tiene token» y «el cliente mandó mal el token» no pueden verse iguales,
    // o una falla de configuración se disfraza de credencial equivocada y se
    // vive semanas sin enterarse.
    const r = await pedir(async () => [pieza()], { secreto: null });

    assert.equal(r.status, 503);
    assert.equal((r.json?.error as { motivo?: string })?.motivo, "falta_config");
  });

  test("con la credencial: 200 con las piezas y el vocabulario", async () => {
    const r = await pedir(async () => [pieza(), pieza({ clase: "gancho", id: "osint" })]);

    assert.equal(r.status, 200);
    const piezas = r.json?.piezas as Pieza[];
    assert.equal(piezas.length, 2);
    assert.equal(piezas[0]?.clase, "hecho");
    assert.equal(r.json?.total, 2);
    // El vocabulario viaja con el catálogo (H9): Ivi no tiene que hacer dos
    // viajes ni leer un `.ts` para saber qué momentos existen.
    const vocab = r.json?.vocabulario as { momentos?: { id: string }[] };
    assert.ok((vocab.momentos ?? []).length > 0);
  });

  test("`?clase=` filtra sin volver a pedirle nada a la base", async () => {
    const r = await pedir(async () => [pieza(), pieza({ clase: "gancho", id: "osint" })], {
      ruta: "/api/catalogo/piezas?clase=gancho",
    });

    assert.equal(r.status, 200);
    const piezas = r.json?.piezas as Pieza[];
    assert.equal(piezas.length, 1);
    assert.equal(piezas[0]?.clase, "gancho");
  });

  test("un filtro que no deja nada es 200 vacío, y lo DICE — no es el catálogo", async () => {
    // Distinto del catálogo vacío de arriba: acá el catálogo se sirvió bien y el
    // filtro es del que preguntó. `filtrado: true` es lo que le permite a Ivi no
    // cachear esto como «el catálogo».
    const r = await pedir(async () => [pieza()], {
      ruta: "/api/catalogo/piezas?clase=plantilla",
    });

    assert.equal(r.status, 200);
    assert.deepEqual(r.json?.piezas, []);
    assert.equal(r.json?.filtrado, true);
  });

  test("una clase desconocida en el filtro es 400, no un vacío silencioso", async () => {
    const r = await pedir(async () => [pieza()], { ruta: "/api/catalogo/piezas?clase=inventada" });
    assert.equal(r.status, 400);
  });
});

describe("GET /api/catalogo/vocabulario", () => {
  test("sirve los momentos sin tocar la base (H9)", async () => {
    let leido = false;
    const r = await pedir(
      async () => {
        leido = true;
        return [];
      },
      { ruta: "/api/catalogo/vocabulario" },
    );

    assert.equal(r.status, 200);
    assert.equal(leido, false, "el vocabulario no depende del catálogo ni de la base");
    const momentos = r.json?.momentos as { id: string; descripcion: string }[];
    assert.ok(momentos.some((m) => m.id === "cotizada"));
    assert.ok(momentos.every((m) => typeof m.descripcion === "string" && m.descripcion.length > 0));
    assert.equal(typeof r.json?.version, "string");
  });

  test("también exige la credencial", async () => {
    const r = await pedir(async () => [], { ruta: "/api/catalogo/vocabulario", token: null });
    assert.equal(r.status, 401);
  });
});
