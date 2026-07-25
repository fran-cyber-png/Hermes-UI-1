import { test } from "node:test";
import assert from "node:assert/strict";
import { LIMITE_ENLACES, decidirEnlace, type LadoDelEnlace } from "./decidir.js";

/**
 * QUÉ SIGNIFICA ENLAZAR — la decisión, sin base.
 *
 * «Es la misma persona que…» se traduce a: las dos identidades apuntan a la MISMA persona
 * del grafo. De ahí salen solas dos propiedades que la spec pide (issue #58) y que acá se
 * fijan como tests:
 *
 *   · **simetría** — no hay arista A→B: hay dos aristas A→P y B→P. Ver desde B que está
 *     enlazada con A no es una segunda escritura, es la misma.
 *   · **idempotencia** — enlazar dos veces lo mismo no crea nada: la segunda vez ya están
 *     las dos en P.
 *
 * Y una que la spec NO pide pero la base exige: el destino de una fusión tiene que ser
 * DETERMINISTA. Si depende del orden en que la vendedora hizo clic, dos caminos que llevan
 * al mismo grupo terminan en dos personas distintas.
 */

const lado = (l: Partial<LadoDelEnlace> & { claveIdentidad: string }): LadoDelEnlace => ({
  persona: null,
  identidadesActivas: 0,
  ...l,
});

test("ninguna de las dos tenía persona: se crea una, anclada en la identidad más chica", () => {
  const d = decidirEnlace(
    lado({ claveIdentidad: "wa_id:51987654321" }),
    lado({ claveIdentidad: "ig_user:goberna" }),
  );
  assert.deepEqual(d, { accion: "crear", claveRaiz: "ig_user:goberna" });
});

test("el ancla no depende del orden del clic: enlazar B con A da la misma persona", () => {
  const ida = decidirEnlace(
    lado({ claveIdentidad: "wa_id:51987654321" }),
    lado({ claveIdentidad: "ig_user:goberna" }),
  );
  const vuelta = decidirEnlace(
    lado({ claveIdentidad: "ig_user:goberna" }),
    lado({ claveIdentidad: "wa_id:51987654321" }),
  );
  assert.deepEqual(ida, vuelta);
});

test("una ya tiene persona: la otra se le suma (no se crea una nueva)", () => {
  const d = decidirEnlace(
    lado({ claveIdentidad: "wa_id:51987654321", persona: { id: 7, claveRaiz: "wa_id:51987654321" }, identidadesActivas: 1 }),
    lado({ claveIdentidad: "ig_user:goberna" }),
  );
  assert.deepEqual(d, { accion: "sumar", persona: 7, lado: "b" });
});

test("simétrico: da igual desde qué ficha se enlace, la que no tiene persona se suma", () => {
  const d = decidirEnlace(
    lado({ claveIdentidad: "ig_user:goberna" }),
    lado({ claveIdentidad: "wa_id:51987654321", persona: { id: 7, claveRaiz: "wa_id:51987654321" }, identidadesActivas: 1 }),
  );
  assert.deepEqual(d, { accion: "sumar", persona: 7, lado: "a" });
});

test("ya estaban enlazadas: no se escribe nada (idempotente)", () => {
  const p = { id: 7, claveRaiz: "ig_user:goberna" };
  const d = decidirEnlace(
    lado({ claveIdentidad: "wa_id:51987654321", persona: p, identidadesActivas: 2 }),
    lado({ claveIdentidad: "ig_user:goberna", persona: p, identidadesActivas: 2 }),
  );
  assert.deepEqual(d, { accion: "ya_enlazadas", persona: 7 });
});

test("dos grupos distintos se fusionan hacia el ancla más chica, no hacia el que se clickeó", () => {
  const chica = { id: 3, claveRaiz: "ig_user:aaa" };
  const grande = { id: 9, claveRaiz: "wa_id:51987654321" };
  const ida = decidirEnlace(
    lado({ claveIdentidad: "wa_id:51987654321", persona: grande, identidadesActivas: 2 }),
    lado({ claveIdentidad: "ig_user:aaa", persona: chica, identidadesActivas: 2 }),
  );
  const vuelta = decidirEnlace(
    lado({ claveIdentidad: "ig_user:aaa", persona: chica, identidadesActivas: 2 }),
    lado({ claveIdentidad: "wa_id:51987654321", persona: grande, identidadesActivas: 2 }),
  );
  assert.deepEqual(ida, { accion: "fusionar", destino: 3, origen: 9 });
  assert.deepEqual(ida, vuelta);
});

test("no se enlaza una persona consigo misma", () => {
  const d = decidirEnlace(
    lado({ claveIdentidad: "wa_id:51987654321" }),
    lado({ claveIdentidad: "wa_id:51987654321" }),
  );
  assert.deepEqual(d, { accion: "rechazar", motivo: "misma_identidad" });
});

test("un grupo no crece sin techo: el Frankenstein se corta antes de armarse", () => {
  // `identidades_bloqueadas` existe porque un `informes@` puede colapsar 300 personas en
  // una. Acá el riesgo es el mismo con otra forma: clics repetidos sobre la ficha
  // equivocada. El techo no es una opinión estética — es el freno de mano.
  const d = decidirEnlace(
    lado({ claveIdentidad: "wa_id:51987654321", persona: { id: 7, claveRaiz: "wa_id:1" }, identidadesActivas: LIMITE_ENLACES }),
    lado({ claveIdentidad: "ig_user:goberna" }),
  );
  assert.deepEqual(d, { accion: "rechazar", motivo: "demasiadas_identidades" });
});

test("la fusión también respeta el techo: dos grupos que juntos se pasan, no se juntan", () => {
  const d = decidirEnlace(
    lado({ claveIdentidad: "wa_id:1", persona: { id: 3, claveRaiz: "wa_id:1" }, identidadesActivas: LIMITE_ENLACES - 1 }),
    lado({ claveIdentidad: "ig_user:a", persona: { id: 9, claveRaiz: "ig_user:a" }, identidadesActivas: 2 }),
  );
  assert.deepEqual(d, { accion: "rechazar", motivo: "demasiadas_identidades" });
});
