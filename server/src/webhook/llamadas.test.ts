import test from "node:test";
import assert from "node:assert/strict";
import { claveDeLlamada } from "./llamadas.js";

/**
 * El defecto que estos tests fijan: una llamada manda VARIOS webhooks con el mismo `id`, y con
 * una clave que fuera solo el `id` el segundo se descartaba en silencio. El que se perdía era
 * el `terminate` — el único que trae `duration`.
 */
test("dos eventos de la MISMA llamada no colisionan", () => {
  const id = "wacid.ABGGFjFVU2AfAgo6V";
  assert.notEqual(claveDeLlamada({ id, event: "connect" }), claveDeLlamada({ id, event: "terminate" }));
});

test("el mismo evento de la misma llamada SÍ colisiona — es un reintento de Meta", () => {
  const id = "wacid.ABGGFjFVU2AfAgo6V";
  assert.equal(claveDeLlamada({ id, event: "terminate" }), claveDeLlamada({ id, event: "terminate" }));
});

test("sin `event` cae al `status` — los webhooks de estado traen uno y no el otro", () => {
  assert.equal(claveDeLlamada({ id: "wacid.X", status: "RINGING" }), "wacid.X:RINGING");
  assert.notEqual(
    claveDeLlamada({ id: "wacid.X", status: "RINGING" }),
    claveDeLlamada({ id: "wacid.X", status: "ACCEPTED" }),
  );
});

test("un evento que Meta todavía no manda cae en su propia fila, no pisa otra", () => {
  const id = "wacid.X";
  const conocido = claveDeLlamada({ id, event: "connect" });
  const futuro = claveDeLlamada({ id, event: "transferred" });
  assert.notEqual(conocido, futuro);
});

test("sin evento ni estado la clave es explícita, no vacía", () => {
  assert.equal(claveDeLlamada({ id: "wacid.X" }), "wacid.X:sin_evento");
});
