import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { _vaciarRegistro, catalogo, invocar, listar, obtener, registrar } from "./registro.js";

/** Una Tool de juguete. No toca la base: el registro no debe saber que Postgres existe. */
function toolDeJuguete(nombre = "governa.prueba.sumar") {
  return {
    nombre,
    descripcion: "Suma dos números. Existe solo para los tests del registro.",
    entrada: z.object({ a: z.number(), b: z.number().default(0) }),
    ejecutar: ({ a, b }: { a: number; b: number }) => ({ suma: a + b }),
    idempotente: true,
    cqIds: ["cq-prueba-001"],
    fuentes: ["sdk/registro.test.ts:1"],
  };
}

beforeEach(() => _vaciarRegistro());

describe("registro — registrar", () => {
  test("una Tool registrada aparece en el listado", () => {
    registrar(toolDeJuguete());
    assert.deepEqual(listar(), ["governa.prueba.sumar"]);
  });

  test("rechaza un nombre que no sea governa.<dominio>.<accion>", () => {
    assert.throws(() => registrar(toolDeJuguete("sumar")), /inválido/);
    assert.throws(() => registrar(toolDeJuguete("governa.sumar")), /inválido/);
    assert.throws(() => registrar(toolDeJuguete("Governa.Prueba.Sumar")), /inválido/);
  });

  test("registrar dos veces el mismo nombre falla en vez de pisar en silencio", () => {
    // Pisar sería peor que fallar: las CQs quedarían apuntando a otra implementación
    // sin que nada avise.
    registrar(toolDeJuguete());
    assert.throws(() => registrar(toolDeJuguete()), /ya está registrada/);
  });

  test("el listado sale ordenado, para que el catálogo sea estable entre llamadas", () => {
    registrar(toolDeJuguete("governa.zeta.uno"));
    registrar(toolDeJuguete("governa.alfa.dos"));
    assert.deepEqual(listar(), ["governa.alfa.dos", "governa.zeta.uno"]);
  });

  test("obtener devuelve null si no existe, en vez de reventar", () => {
    assert.equal(obtener("governa.nada.nada"), null);
  });
});

describe("registro — invocar", () => {
  test("una entrada válida devuelve la salida", async () => {
    registrar(toolDeJuguete());
    const r = await invocar<{ suma: number }>("governa.prueba.sumar", { a: 2, b: 3 });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.salida, { suma: 5 });
  });

  test("aplica los defaults del schema", async () => {
    registrar(toolDeJuguete());
    const r = await invocar<{ suma: number }>("governa.prueba.sumar", { a: 7 });
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.salida, { suma: 7 });
  });

  test("una Tool inexistente falla con motivo 'no_existe' y no lanza", async () => {
    const r = await invocar("governa.nada.nada", {});
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.motivo, "no_existe");
  });

  test("una entrada inválida falla con 'entrada_invalida' y dice qué campo", async () => {
    registrar(toolDeJuguete());
    const r = await invocar("governa.prueba.sumar", { a: "dos" });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.motivo, "entrada_invalida");
      assert.match(r.detalle, /a:/);
    }
  });

  test("si la Tool revienta, se reporta como 'fallo_ejecucion' con su mensaje", async () => {
    registrar({
      nombre: "governa.prueba.explotar",
      descripcion: "Revienta siempre.",
      entrada: z.object({}),
      ejecutar: () => {
        throw new Error("la base se cayó");
      },
      idempotente: true,
    });
    const r = await invocar("governa.prueba.explotar", {});
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.motivo, "fallo_ejecucion");
      assert.equal(r.detalle, "la base se cayó");
    }
  });

  test("body vacío equivale a {} para una Tool sin parámetros", async () => {
    registrar({
      nombre: "governa.prueba.constante",
      descripcion: "Devuelve siempre lo mismo.",
      entrada: z.object({}),
      ejecutar: () => ({ valor: 42 }),
      idempotente: true,
    });
    for (const entrada of [undefined, null, {}]) {
      const r = await invocar<{ valor: number }>("governa.prueba.constante", entrada);
      assert.equal(r.ok, true, `falló con ${JSON.stringify(entrada)}`);
    }
  });

  test("siempre reporta cuánto tardó, haya salido bien o mal", async () => {
    registrar(toolDeJuguete());
    const ok = await invocar("governa.prueba.sumar", { a: 1, b: 1 });
    const mal = await invocar("governa.nada.nada", {});
    assert.equal(typeof ok.ms, "number");
    assert.equal(typeof mal.ms, "number");
  });
});

describe("registro — catálogo", () => {
  test("publica JSON Schema derivado del Zod, sin escribirlo a mano", () => {
    registrar(toolDeJuguete());
    const [e] = catalogo();
    const schema = e.entrada as { type: string; properties: Record<string, unknown> };
    assert.equal(schema.type, "object");
    assert.deepEqual(Object.keys(schema.properties).sort(), ["a", "b"]);
  });

  test("lleva las CQs que responde y las fuentes de su verdad", () => {
    registrar(toolDeJuguete());
    const [e] = catalogo();
    assert.deepEqual(e.cqIds, ["cq-prueba-001"]);
    assert.deepEqual(e.fuentes, ["sdk/registro.test.ts:1"]);
  });

  test("una Tool sin cqIds ni fuentes las declara vacías, no undefined", () => {
    // El catálogo es un contrato con Ivi y con MCP: un campo ausente y uno vacío no pueden
    // obligar a quien consume a distinguirlos.
    registrar({
      nombre: "governa.prueba.pelada",
      descripcion: "Sin metadatos.",
      entrada: z.object({}),
      ejecutar: () => null,
      idempotente: true,
    });
    const [e] = catalogo();
    assert.deepEqual(e.cqIds, []);
    assert.deepEqual(e.fuentes, []);
  });

  test("la descripción viaja al catálogo: es lo que lee el modelo", () => {
    registrar(toolDeJuguete());
    assert.match(catalogo()[0].descripcion, /Suma dos números/);
  });

  test("el catálogo es serializable a JSON (viaja por HTTP)", () => {
    registrar(toolDeJuguete());
    assert.doesNotThrow(() => JSON.stringify(catalogo()));
  });
});
