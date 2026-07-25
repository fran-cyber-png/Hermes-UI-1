import { test } from "node:test";
import assert from "node:assert/strict";
import { canalDeTipo, claveDeIdentidad, identidadDeClave, mismaIdentidad } from "./clave.js";

/**
 * EL PUENTE, EN PURO — de la clave del CRM a la identidad del grafo.
 *
 * Todo el CRM cuelga de `conv:<canal>:<persona>:<numeroPropio>`; el grafo de identidad
 * cuelga de `ontologia.personas.id`. Entre los dos no había nada, y sin ese nada no hay
 * a qué enlazar (issue #58). Acá vive la traducción, sola y sin base, porque es una
 * decisión sobre STRINGS: qué parte de la clave identifica a la persona y qué parte no.
 *
 * La decisión que este archivo fija: **el número propio de Goberna NO identifica a nadie**.
 * Si la misma persona le escribe al 986… y al 987… son dos claves, pero un solo humano —
 * y su ficha se une sin que nadie tenga que enlazar nada a mano.
 */

test("una conversación de WhatsApp es una identidad wa_id con el teléfono de la persona", () => {
  assert.deepEqual(identidadDeClave("conv:whatsapp:51987654321:51986394450"), {
    tipo: "wa_id",
    valor: "51987654321",
  });
});

test("el número propio de Goberna NO entra en la identidad: dos claves, una persona", () => {
  const porUnNumero = identidadDeClave("conv:whatsapp:51987654321:51986394450");
  const porElOtro = identidadDeClave("conv:whatsapp:51987654321:51900000000");
  assert.deepEqual(porUnNumero, porElOtro);
  assert.equal(mismaIdentidad(porUnNumero, porElOtro), true);
});

test("cada canal tiene su tipo de identidad, y ninguno es el del poblador (email/telefono)", () => {
  assert.equal(identidadDeClave("conv:instagram:17841400000:goberna")?.tipo, "ig_user");
  assert.equal(identidadDeClave("conv:facebook:7654321098:goberna")?.tipo, "psid");
  assert.equal(identidadDeClave("conv:whatsapp:51987654321:51986394450")?.tipo, "wa_id");
});

test("el tipo de identidad vuelve al canal del que salió (ida y vuelta)", () => {
  assert.equal(canalDeTipo("wa_id"), "whatsapp");
  assert.equal(canalDeTipo("ig_user"), "instagram");
  assert.equal(canalDeTipo("psid"), "facebook");
});

test("un comentario suelto (`int:<id>`) NO es enlazable: no tiene identidad estable", () => {
  // Meta oculta quién comentó en el 99% de los comentarios de Facebook. Enlazar
  // «el comentario 8123» a una persona sería atar el lazo a una fila, no a alguien.
  assert.equal(identidadDeClave("int:8123"), null);
});

test("una clave que no es del CRM, o con un canal desconocido, no inventa identidad", () => {
  assert.equal(identidadDeClave("lead:998"), null);
  assert.equal(identidadDeClave("general"), null);
  assert.equal(identidadDeClave("conv:telegram:123:456"), null);
  assert.equal(identidadDeClave(""), null);
});

test("una persona vacía no es una persona", () => {
  assert.equal(identidadDeClave("conv:whatsapp::51986394450"), null);
});

test("un persona_id con caracteres raros se rechaza: la identidad se guarda cruda y se compara cruda", () => {
  // El valor viaja a `ontologia.identidades.valor` y vuelve como patrón de búsqueda.
  // Un `%` o un `:` ahí convierte una identidad en un comodín.
  assert.equal(identidadDeClave("conv:whatsapp:51%:51986394450"), null);
  assert.equal(identidadDeClave("conv:whatsapp:a b:51986394450"), null);
});

test("la clave de identidad es «tipo:valor» — la misma forma que usa `clave_raiz`", () => {
  assert.equal(claveDeIdentidad({ tipo: "wa_id", valor: "51987654321" }), "wa_id:51987654321");
  // Y jamás pisa el espacio de nombres del poblador, que ancla en `email:` / `telefono:`.
  assert.equal(claveDeIdentidad({ tipo: "ig_user", valor: "goberna" }).startsWith("email:"), false);
});
