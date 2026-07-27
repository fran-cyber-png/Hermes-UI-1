import test from "node:test";
import assert from "node:assert/strict";
import {
  LARGO_MAXIMO_LLAVE,
  armarLlaveAtribucion,
  leerLlaveAtribucion,
  partirClave,
} from "./llave.js";

/**
 * La llave de atribución es el único dato que hace el viaje entero Hermes → Cerberus → Hermes.
 * Si el armado y el parseo divergen, la venta vuelve diciendo de qué chat salió y nadie la
 * entiende. Por eso el test central es el ida-y-vuelta, no el formato.
 */

test("ida y vuelta: la conversación sobrevive el viaje a Cerberus", () => {
  const clave = "conv:whatsapp:51987654321:51986394450";
  const llave = armarLlaveAtribucion({ vendedoraId: "andreecito", clave, ahora: 1_769_000_000_000 });

  const vuelta = leerLlaveAtribucion(llave);
  assert.deepEqual(vuelta, {
    clave,
    canal: "whatsapp",
    personaId: "51987654321",
    numeroPropio: "51986394450",
  });
});

test("los tres canales que conversan hacen el viaje", () => {
  for (const [canal, persona] of [
    ["whatsapp", "51987654321"],
    ["instagram", "17841400000000000"],
    ["facebook", "1234567890123456"],
  ] as const) {
    const clave = `conv:${canal}:${persona}:51986394450`;
    const llave = armarLlaveAtribucion({ vendedoraId: "ana", clave });
    assert.equal(leerLlaveAtribucion(llave)?.clave, clave, `falló ${canal}`);
  }
});

test("la llave entra en los 64 caracteres del idempotency_key de Cerberus", () => {
  const clave = "conv:instagram:17841400000000000:51986394450";
  const llave = armarLlaveAtribucion({ vendedoraId: "vendedora-con-nombre-largo", clave });
  assert.ok(llave.length <= LARGO_MAXIMO_LLAVE, `la llave mide ${llave.length}`);
});

test("si no entra en 64, cae a la llave sin atribución — nunca truncada", () => {
  // Una persona de 64 caracteres es válida para `identidad/clave.ts` y no entra codificada.
  const persona = "x".repeat(64);
  const llave = armarLlaveAtribucion({
    vendedoraId: "ana",
    clave: `conv:whatsapp:${persona}:51986394450`,
    ahora: 1_769_000_000_000,
  });

  assert.equal(llave, "hermes-ana-1769000000000");
  assert.equal(leerLlaveAtribucion(llave), null);
});

test("sin conversación, la llave es exactamente la de siempre (nada regresa)", () => {
  const ahora = 1_769_000_000_000;
  assert.equal(armarLlaveAtribucion({ vendedoraId: "ana", ahora }), "hermes-ana-1769000000000");
  assert.equal(
    armarLlaveAtribucion({ vendedoraId: "ana", clave: null, ahora }),
    "hermes-ana-1769000000000",
  );
  assert.equal(
    armarLlaveAtribucion({ vendedoraId: "ana", clave: "  ", ahora }),
    "hermes-ana-1769000000000",
  );
});

test("una clave que no identifica a nadie no se atribuye: comentario, libreta, lead", () => {
  const ahora = 1_769_000_000_000;
  for (const clave of ["int:12345", "general", "lead:9", "conv:correo:x:1"]) {
    assert.equal(
      armarLlaveAtribucion({ vendedoraId: "ana", clave, ahora }),
      "hermes-ana-1769000000000",
      `${clave} no debería atribuir`,
    );
  }
});

test("dos clicks en el mismo milisegundo dan la misma llave (la idempotencia de Cerberus)", () => {
  const args = { vendedoraId: "ana", clave: "conv:whatsapp:519:51986394450", ahora: 1_769_000_000_000 };
  assert.equal(armarLlaveAtribucion(args), armarLlaveAtribucion(args));
});

test("dos conversaciones distintas nunca comparten llave, ni en el mismo milisegundo", () => {
  const ahora = 1_769_000_000_000;
  const a = armarLlaveAtribucion({ vendedoraId: "ana", clave: "conv:whatsapp:51900000001:51986394450", ahora });
  const b = armarLlaveAtribucion({ vendedoraId: "ana", clave: "conv:whatsapp:51900000002:51986394450", ahora });
  assert.notEqual(a, b);
});

test("el número propio viaja: N números de Goberna, N llaves distintas", () => {
  const ahora = 1_769_000_000_000;
  const a = armarLlaveAtribucion({ vendedoraId: "ana", clave: "conv:whatsapp:51900000001:51986394450", ahora });
  const b = armarLlaveAtribucion({ vendedoraId: "ana", clave: "conv:whatsapp:51900000001:51999999999", ahora });
  assert.notEqual(a, b);
  assert.equal(leerLlaveAtribucion(a)?.numeroPropio, "51986394450");
  assert.equal(leerLlaveAtribucion(b)?.numeroPropio, "51999999999");
});

test("una clave sin número propio sigue siendo atribuible", () => {
  const llave = armarLlaveAtribucion({ vendedoraId: "ana", clave: "conv:whatsapp:51987654321:" });
  assert.deepEqual(leerLlaveAtribucion(llave), {
    clave: "conv:whatsapp:51987654321:",
    canal: "whatsapp",
    personaId: "51987654321",
    numeroPropio: "",
  });
});

test("lo que no es una llave de Hermes se lee como null, no se adivina", () => {
  for (const basura of [
    null,
    undefined,
    "",
    "hermes-ana-1769000000000", // el formato viejo
    "MANUAL-2024-001", // una venta cargada a mano en Cerberus
    "h1~w~519~51986394450", // le falta el timestamp
    "h1~z~519~51986394450~abc", // canal inexistente
    "h1~w~51 9~51986394450~abc", // persona con espacio: comodín potencial
    "h1~w~519~5198639445X~abc", // número propio con letra
    "h2~w~519~51986394450~abc", // versión futura que este código no entiende
  ]) {
    assert.equal(leerLlaveAtribucion(basura as string), null, `«${basura}» no debería leerse`);
  }
});

test("partirClave rechaza lo que no es una conversación de chat", () => {
  assert.equal(partirClave("int:9"), null);
  assert.equal(partirClave("general"), null);
  assert.equal(partirClave("conv:whatsapp"), null);
  assert.deepEqual(partirClave("conv:whatsapp:519:51986394450")?.canal, "whatsapp");
});
