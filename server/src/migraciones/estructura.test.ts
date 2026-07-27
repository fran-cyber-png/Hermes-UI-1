import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ASPECTOS,
  compararEstructuras,
  describirDiferencias,
  resumirComparacion,
  type Estructura,
} from "./estructura.js";

/**
 * EL CRITERIO DE «coincide» — puro, sin base.
 *
 * Es la función de la que depende que `db:adoptar` no marque una base como al día
 * mintiendo. Se prueba acá, en milisegundos, para no depender de que alguien levante
 * Postgres para saber si el criterio cambió.
 */

function vacia(): Estructura {
  return { tabla: [], columna: [], índice: [], restricción: [] };
}

function conTablas(...tablas: string[]): Estructura {
  return { ...vacia(), tabla: tablas };
}

test("dos estructuras iguales no tienen diferencias", () => {
  const e: Estructura = {
    tabla: ["public.notas", "public.hechos"],
    columna: ["public.notas.texto :: text NOT NULL"],
    índice: ["CREATE INDEX notas_clave_idx ON public.notas USING btree (clave)"],
    restricción: ["public.notas.notas_pkey :: PRIMARY KEY (id)"],
  };
  assert.deepEqual(compararEstructuras(e, e), []);
});

test("una tabla que sobra en la base viva es una diferencia, no un detalle", () => {
  // El caso real: algo que existe en producción y que el repo no describe. Es tan
  // problema como que falte — significa que la próxima base nueva no lo va a tener.
  const difs = compararEstructuras(conTablas("public.notas", "public.parche"), conTablas("public.notas"));
  assert.deepEqual(difs, [{ aspecto: "tabla", lado: "viva", firma: "public.parche" }]);
});

test("una tabla que falta en la base viva también", () => {
  const difs = compararEstructuras(conTablas("public.notas"), conTablas("public.notas", "public.hechos"));
  assert.deepEqual(difs, [{ aspecto: "tabla", lado: "baseline", firma: "public.hechos" }]);
});

test("cambiar la nulabilidad de una columna sale como dos diferencias, no como cero", () => {
  // La firma lleva el tipo Y la nulabilidad justamente para esto: si solo se
  // compararan nombres de columna, relajar un NOT NULL pasaría desapercibido y el
  // código nuevo insertaría NULLs contra un schema que el repo cree estricto.
  const viva: Estructura = { ...vacia(), columna: ["public.hechos.texto :: text NULL"] };
  const baseline: Estructura = { ...vacia(), columna: ["public.hechos.texto :: text NOT NULL"] };
  const difs = compararEstructuras(viva, baseline);
  assert.equal(difs.length, 2);
  assert.deepEqual(
    difs.map((d) => d.lado),
    ["baseline", "viva"],
  );
});

test("el orden de las listas no cambia el veredicto", () => {
  const a = conTablas("public.a", "public.b", "public.c");
  const b = conTablas("public.c", "public.a", "public.b");
  assert.deepEqual(compararEstructuras(a, b), []);
});

test("las diferencias salen ordenadas: dos corridas iguales imprimen lo mismo", () => {
  const viva: Estructura = {
    tabla: ["public.z", "public.a"],
    columna: ["public.z.x :: text NULL"],
    índice: [],
    restricción: [],
  };
  const primera = compararEstructuras(viva, vacia());
  const segunda = compararEstructuras(viva, vacia());
  assert.deepEqual(primera, segunda);
  assert.deepEqual(
    primera.map((d) => d.firma),
    ["public.a", "public.z", "public.z.x :: text NULL"],
  );
});

test("un duplicado no se cancela contra un único: se cuentan las repeticiones", () => {
  // Sin contar repeticiones, dos índices idénticos con nombres distintos podrían
  // taparse entre sí. Es raro, y por eso conviene que no dependa de la suerte.
  const viva: Estructura = { ...vacia(), índice: ["CREATE INDEX i ON t (c)", "CREATE INDEX i ON t (c)"] };
  const baseline: Estructura = { ...vacia(), índice: ["CREATE INDEX i ON t (c)"] };
  assert.equal(compararEstructuras(viva, baseline).length, 1);
});

test("describirDiferencias dice de qué lado está cada una, en castellano", () => {
  const texto = describirDiferencias([
    { aspecto: "índice", lado: "baseline", firma: "CREATE INDEX g ON notas USING gin (…)" },
  ]).join("\n");
  assert.match(texto, /\[índice\]/);
  assert.match(texto, /lo describe el repo y la base no lo tiene/);
});

test("el resumen dice QUÉ se comparó, no solo el veredicto", () => {
  // La lección de anoche: un dry-run que muestra el resultado y no las variables de
  // la decisión no verifica nada. «✓ todo igual» sobre cero tablas se ve idéntico a
  // «✓ todo igual» sobre cuarenta.
  const lineas = resumirComparacion(conTablas("public.a"), conTablas("public.a", "public.b"));
  assert.equal(lineas.length, ASPECTOS.length);
  assert.match(lineas[0]!, /≠/); // las tablas no coinciden: 1 vs 2
  assert.match(lineas[0]!, /base viva:\s+1\s+baseline:\s+2/);
  assert.match(lineas[1]!, /·/); // las columnas sí (0 y 0)
});
