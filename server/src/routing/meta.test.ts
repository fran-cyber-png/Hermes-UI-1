import assert from "node:assert/strict";
import test from "node:test";
import { resolverAnuncios, type ClienteGraph } from "./meta.js";

/** La forma REAL de la respuesta, copiada de lo que devolvió Meta el 11-ago-2026. */
const COMO_CONTESTA_META = {
  "120249343592840789": {
    id: "120249343592840789",
    campaign: {
      id: "120249343592830789",
      name: "[AGO] OSINT - INTERACCIONES - 11 - 31",
      effective_status: "ACTIVE",
    },
  },
  "120248613186150016": {
    id: "120248613186150016",
    campaign: {
      id: "120248613186140016",
      name: "[JUL] INTELIGENCIA | WSP",
      effective_status: "PAUSED",
    },
  },
};

const clienteQueContesta = (por: Record<string, any>): ClienteGraph => ({
  async get(path, params) {
    if (path === "") {
      const ids = (params?.ids ?? "").split(",");
      // Meta responde un objeto con UNA clave por id pedido.
      return Object.fromEntries(ids.filter((i) => por[i]).map((i) => [i, por[i]]));
    }
    if (por[path]) return por[path];
    throw new Error("Unsupported get request");
  },
});

test("resuelve un lote: trece anuncios pueden ser dos campañas", async () => {
  const { resueltos, fallaron } = await resolverAnuncios(
    ["120249343592840789", "120248613186150016"],
    clienteQueContesta(COMO_CONTESTA_META),
  );

  assert.deepEqual(fallaron, []);
  assert.deepEqual(
    resueltos.map((r) => [r.adId, r.campanaId, r.estado]),
    [
      ["120249343592840789", "120249343592830789", "ACTIVE"],
      ["120248613186150016", "120248613186140016", "PAUSED"],
    ],
  );
});

test("no repite trabajo: los ids duplicados y en blanco se descartan antes de salir", async () => {
  const pedidos: string[] = [];
  const cliente: ClienteGraph = {
    async get(_p, params) {
      pedidos.push(params?.ids ?? "");
      return COMO_CONTESTA_META;
    },
  };

  await resolverAnuncios(
    ["120249343592840789", " 120249343592840789 ", "", "  ", "120248613186150016"],
    cliente,
  );

  assert.deepEqual(pedidos, ["120249343592840789,120248613186150016"]);
});

/**
 * 🔴 EL CASO QUE JUSTIFICA EL REINTENTO. Con `ids=`, un solo id inválido —un
 * `12345` de una prueba vieja— hace que Meta falle el LOTE ENTERO. Sin el
 * reintento de a uno, las campañas de verdad quedaban sin resolver y el ruteo no
 * se podía configurar, sin que la pantalla pudiera explicar por qué.
 */
test("un id podrido no se lleva puesto al lote", async () => {
  let loteFallado = false;
  const cliente: ClienteGraph = {
    async get(path) {
      if (path === "") {
        loteFallado = true;
        throw new Error('Invalid parameter: "12345"');
      }
      if (COMO_CONTESTA_META[path as keyof typeof COMO_CONTESTA_META]) {
        return COMO_CONTESTA_META[path as keyof typeof COMO_CONTESTA_META];
      }
      throw new Error("no existe");
    },
  };

  const { resueltos, fallaron } = await resolverAnuncios(
    ["120249343592840789", "12345", "120248613186150016"],
    cliente,
  );

  assert.equal(loteFallado, true, "el lote tiene que haber fallado primero");
  assert.deepEqual(resueltos.map((r) => r.adId), ["120249343592840789", "120248613186150016"]);
  assert.deepEqual(fallaron, ["12345"]);
});

/**
 * Mejor que falte a que mienta: una fila sin nombre de campaña se vería en la
 * pantalla como una campaña real y le podrían poner una regla.
 */
test("un anuncio sin campaña legible no se guarda a medias", async () => {
  const { resueltos, fallaron } = await resolverAnuncios(
    ["sin-campana", "campana-sin-nombre"],
    clienteQueContesta({
      "sin-campana": { id: "sin-campana" },
      "campana-sin-nombre": { id: "campana-sin-nombre", campaign: { id: "c", name: "  " } },
    }),
  );

  assert.deepEqual(resueltos, []);
  assert.deepEqual(fallaron, ["sin-campana", "campana-sin-nombre"]);
});

test("sin anuncios que resolver no se le pregunta nada a Meta", async () => {
  let llamadas = 0;
  const { resueltos } = await resolverAnuncios([], {
    async get() {
      llamadas++;
      return {};
    },
  });
  assert.equal(llamadas, 0);
  assert.deepEqual(resueltos, []);
});
