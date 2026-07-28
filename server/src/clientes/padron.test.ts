import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { filaDePadron, evaluarFilaDePadron } from "./padron.js";
import { sufijoTelefono } from "../whatsapp/identidadWa.js";

/**
 * EL PADRÓN, FILA POR FILA (#133) — de lo que trae la fuente a lo que la cola
 * necesita para cruzar por teléfono sin inventar clientes.
 *
 * El riesgo que estos casos vigilan es el de **#119**: la llave de match de la
 * casa son los últimos 9 dígitos (`sufijoTelefono`), y eso alcanza mientras
 * todos sean peruanos. Casi 2 de cada 3 clientes del padrón NO lo son (México
 * 1.987, Ecuador 1.981, Guatemala 393…), y los largos nacionales son distintos:
 * Perú 9 dígitos, México 10, Guatemala 8. Ahí el sufijo de 9 se come parte del
 * código de país y dos personas de países distintos pueden compartirlo.
 */

const compro = { n_purchases: 1, buyer_tier: "single" };

describe("filaDePadron — el teléfono internacional se respeta", () => {
  test("Perú: el número ya viene en E.164", () => {
    const f = filaDePadron({ id: 1, phone: "+51 986 394 450", country: "Perú", ...compro });
    assert.equal(f?.sufijo, "986394450");
    assert.equal(f?.codigoPais, "51");
  });

  test("México: 10 dígitos nacionales, el código sale del propio número", () => {
    const f = filaDePadron({ id: 2, phone: "529912345678", country: null, ...compro });
    assert.equal(f?.codigoPais, "52");
    assert.equal(f?.sufijo, "912345678");
  });

  test("México con el «1» viejo de WhatsApp sigue siendo México", () => {
    const f = filaDePadron({ id: 3, phone: "5219912345678", country: null, ...compro });
    assert.equal(f?.codigoPais, "52");
  });

  test("Guatemala: 8 dígitos nacionales", () => {
    const f = filaDePadron({ id: 4, phone: "50255551234", country: null, ...compro });
    assert.equal(f?.codigoPais, "502");
  });

  test("Ecuador: 9 dígitos nacionales", () => {
    const f = filaDePadron({ id: 5, phone: "593992345678", country: null, ...compro });
    assert.equal(f?.codigoPais, "593");
  });
});

describe("filaDePadron — el número local se completa con el país declarado", () => {
  /**
   * Cerberus guarda el número LOCAL (`cerberus/ficha.ts` lo dice). Sin
   * completarlo, un guatemalteco NUNCA matchea: su local de 8 dígitos da un
   * sufijo de 8 y el de la conversación (`50255551234`) da uno de 9. No es un
   * falso positivo, es un cliente invisible — y son 393 personas.
   */
  test("Guatemala local: se le antepone el 502 y recién ahí el sufijo coincide", () => {
    const f = filaDePadron({ id: 6, phone: "5555-1234", country: "Guatemala", ...compro });
    assert.equal(f?.codigoPais, "502");
    assert.equal(f?.sufijo, sufijoTelefono("50255551234"));
  });

  test("Perú local: el sufijo es el mismo con o sin el 51", () => {
    const f = filaDePadron({ id: 7, phone: "986394450", country: "PE", ...compro });
    assert.equal(f?.codigoPais, "51");
    assert.equal(f?.sufijo, sufijoTelefono("51986394450"));
  });

  test("México local: 10 dígitos + el 52 declarado", () => {
    const f = filaDePadron({ id: 8, phone: "9912345678", country: "Mexico", ...compro });
    assert.equal(f?.codigoPais, "52");
    assert.equal(f?.sufijo, sufijoTelefono("529912345678"));
  });

  test("sin país declarado no se inventa uno: queda sin guarda y se dice", () => {
    const f = filaDePadron({ id: 9, phone: "9912345678", country: null, ...compro });
    assert.equal(f?.codigoPais, null);
  });
});

describe("filaDePadron — el falso positivo de #119", () => {
  /**
   * Un mexicano de Veracruz (+52 991 234 5678) y un peruano (+51 912 345 678)
   * comparten los últimos 9 dígitos. Con la llave de la casa son la MISMA
   * persona; el código de país es lo único que los separa, y por eso viaja a la
   * tabla: el JOIN sigue siendo por sufijo, pero la fila trae con qué desmentirlo.
   */
  test("dos países distintos comparten el sufijo y NO comparten el código", () => {
    const mexicano = filaDePadron({ id: 10, phone: "529912345678", country: "México", ...compro });
    assert.equal(mexicano?.sufijo, sufijoTelefono("51912345678"));
    assert.notEqual(mexicano?.codigoPais, "51");
  });
});

describe("filaDePadron — lo que NO entra a la tabla", () => {
  test("sin compras no hay ex-cliente que marcar", () => {
    assert.equal(filaDePadron({ id: 11, phone: "51986394450", country: "PE", n_purchases: 0, buyer_tier: "prospect" }), null);
  });

  test("sin teléfono no hay con qué cruzar contra la cola", () => {
    assert.equal(filaDePadron({ id: 12, phone: null, country: "PE", ...compro }), null);
  });

  test("un teléfono que no es teléfono no aporta llave", () => {
    assert.equal(filaDePadron({ id: 13, phone: "n/a", country: "PE", ...compro }), null);
  });

  test("el conteo llega como texto desde el driver y se lee igual", () => {
    const f = filaDePadron({ id: 14, phone: "51986394450", country: "PE", n_purchases: "3", buyer_tier: "repeat" });
    assert.equal(f?.compras, 3);
    assert.equal(f?.nivel, "recompro");
  });

  test("la fila lleva el id con su namespace: mañana puede haber otra fuente", () => {
    const f = filaDePadron({ id: 15, phone: "51986394450", country: "PE", ...compro });
    assert.equal(f?.clienteId, "icarus:15");
  });
});

/**
 * «YA COMPRÓ» ES UNA AFIRMACIÓN SOBRE PLATA, y `n_purchases` no la sostiene.
 *
 * Medido contra el padrón vivo el 27-jul-2026: de 10.504 contactos con
 * `n_purchases >= 1`, **5.805 no tienen ni una fila en `icarus.sales`** — y 5.466
 * de ésos son `crm_import` sin `goberna_app_id`, o sea que ni siquiera están
 * vinculados a un cliente de Cerberus. Su conteo lo copió verbatim el import de
 * `leads_crm` y nadie lo volvió a calcular.
 *
 * Del otro lado, Cerberus —la fuente de verdad de las ventas— lo confirma: de 50
 * conversaciones marcadas así en la cola, 49 tenían ficha con `ventas_count: 0`,
 * incluidas varias marcadas VIP con 5 compras. Eso es lo que la vendedora veía
 * como «Cliente» sin una sola compra que mostrarle.
 */
describe("filaDePadron — el conteo no alcanza: hace falta una venta que lo respalde", () => {
  test("dice que compró y no hay venta: NO es ex-cliente", () => {
    const r = evaluarFilaDePadron({
      id: 20, phone: "51986394450", country: "PE", n_purchases: 5, buyer_tier: "vip", con_venta: false,
    });
    assert.deepEqual(r, { descarte: "sin_respaldo", clienteId: "icarus:20" });
  });

  test("ni siquiera un VIP con cinco compras: el tier es una etiqueta, no una venta", () => {
    assert.equal(
      filaDePadron({ id: 21, phone: "51986394450", country: "PE", n_purchases: 5, buyer_tier: "vip", con_venta: false }),
      null,
    );
  });

  test("con la venta que lo respalda, entra igual que siempre", () => {
    const f = filaDePadron({ id: 22, phone: "51986394450", country: "PE", ...compro, con_venta: true });
    assert.equal(f?.nivel, "compro");
    assert.equal(f?.sufijo, "986394450");
  });

  test("NO SE PUDO PREGUNTAR (sin `icarus.sales`) no es lo mismo que «no hay»", () => {
    // Degradación honesta: se comporta como antes del chequeo, nunca desmarca por
    // no haber podido mirar. `undefined` y `null` son la misma cosa acá.
    assert.notEqual(filaDePadron({ id: 23, phone: "51986394450", country: "PE", ...compro }), null);
    assert.notEqual(
      filaDePadron({ id: 24, phone: "51986394450", country: "PE", ...compro, con_venta: null }),
      null,
    );
  });

  test("el descarte lleva el id, que es con lo único que se puede DESMARCAR", () => {
    // Sin esto, las 5.805 filas ya escritas sobrevivirían al arreglo: el upsert
    // pisa lo que sigue calificando y no toca lo que dejó de calificar.
    const r = evaluarFilaDePadron({
      id: 25, phone: "51986394450", country: "PE", ...compro, con_venta: false,
    });
    assert.ok("descarte" in r && r.clienteId === "icarus:25");
  });

  test("un lead sin compras se descarta por OTRO motivo, y no se cuenta como afirmación falsa", () => {
    const r = evaluarFilaDePadron({ id: 26, phone: "51986394450", country: "PE", n_purchases: 0, buyer_tier: null });
    assert.ok("descarte" in r && r.descarte === "sin_compras");
  });
});
