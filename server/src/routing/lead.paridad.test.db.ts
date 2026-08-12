import { test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { baseDePrueba } from "../pruebas/base.js";
import { duenoDeLead, indiceDeTelefono, indiceDeTelefonoSql } from "./lead.js";

/**
 * 🔴 LA MISMA REGLA ESCRITA DOS VECES — y este archivo existe para que no
 * divergan. El TypeScript decide qué dueño MOSTRAR y el SQL decide qué leads
 * entran a «Míos»; si dicen distinto, la vendedora ve en su cola un lead que la
 * fila de al lado atribuye a otra persona, y no hay error que lo delate.
 *
 * Es el patrón de `urgencia.paridad`, `ventana.paridad` y `entrega/paridad`.
 */

/** Teléfonos REALES de la base (formato y largo variados), más los bordes. */
const TELEFONOS = [
  "51993166578",
  "51922572001",
  "51973645406",
  "5215511443374",
  "593969185042",
  "+51 984 429 504",
  "1",
  "",
];

for (const cuantas of [1, 2, 3, 5, 7]) {
  test(`el índice es el mismo en TS y en SQL con ${cuantas} conectadas`, async (t) => {
    const db = await baseDePrueba(t);

    for (const telefono of TELEFONOS) {
      const [fila] = await db.execute<{ i: number }>(
        sql`SELECT ${indiceDeTelefonoSql(sql`${telefono}`, cuantas)} AS i`,
      );
      assert.equal(
        Number(fila!.i),
        indiceDeTelefono(telefono, cuantas),
        `«${telefono}» con ${cuantas} conectadas`,
      );
    }
  });
}

test("un teléfono ilegible no se queda sin dueño: cae en la primera", async (t) => {
  const db = await baseDePrueba(t);
  const [fila] = await db.execute<{ i: number }>(
    sql`SELECT ${indiceDeTelefonoSql(sql`'sin-numeros'`, 3)} AS i`,
  );
  assert.equal(Number(fila!.i), 0);
  assert.equal(indiceDeTelefono("sin-numeros", 3), 0);
});

test("🔴 el mismo teléfono cae SIEMPRE en la misma, aunque reenvíe el formulario", () => {
  // Cada envío es un `lead.id` nuevo (154 envíos de 145 personas, ADR 0051).
  // Si el reparto dependiera del id, la persona cambiaría de dueña al insistir.
  const equipo = ["ventas11@grupogoberna.com", "ventas12@grupogoberna.com"];
  const primero = duenoDeLead("51993166578", equipo);
  assert.equal(duenoDeLead("51993166578", equipo), primero);
  assert.equal(duenoDeLead("+51 993 166 578", equipo), primero, "y no le importa el formato");
});

test("sin cables el lead no es de nadie — que es como está la cola hoy", () => {
  assert.equal(duenoDeLead("51993166578", []), null);
});

test("el orden de los cables no cambia el resultado: se ordena antes de elegir", () => {
  const a = duenoDeLead("51993166578", ["zoe", "ana", "beto"]);
  const b = duenoDeLead("51993166578", ["beto", "zoe", "ana"]);
  assert.equal(a, b);
});
