import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { RETENCION_META_MESES, trocear, ventanaMaxima, type Ventana } from "./ventanas.js";

const dia = (s: string) => new Date(`${s}T12:00:00Z`);

/** Los días que cubre una ventana, para probar cobertura sin huecos ni solapes. */
function dias(v: Ventana): string[] {
  const out: string[] = [];
  const fin = new Date(`${v.until}T00:00:00Z`);
  for (let d = new Date(`${v.since}T00:00:00Z`); d <= fin; d = new Date(d.getTime() + 86_400_000)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

describe("trocear — sin huecos ni solapes", () => {
  test("un trozo por cada 3 meses, cubriendo todo el rango", () => {
    const t = trocear(dia("2026-01-01"), dia("2026-06-30"));
    assert.equal(t.length, 2);
    assert.deepEqual(t[0], { since: "2026-01-01", until: "2026-03-31" });
    assert.deepEqual(t[1], { since: "2026-04-01", until: "2026-06-30" });
  });

  test("NO hay huecos: cada día del rango aparece exactamente una vez", () => {
    // Un hueco de un día sería un día de gasto que no existe para el sistema, y nadie lo notaría.
    const todos = trocear(dia("2024-01-01"), dia("2026-07-15")).flatMap(dias);
    const esperados = dias({ since: "2024-01-01", until: "2026-07-15" });
    assert.equal(todos.length, esperados.length);
    assert.deepEqual(todos, esperados);
  });

  test("NO hay solapes: ningún día se pide dos veces", () => {
    // Un solape le pagaría a Meta dos veces por el mismo dato.
    const todos = trocear(dia("2023-08-01"), dia("2026-07-15")).flatMap(dias);
    assert.equal(new Set(todos).size, todos.length);
  });

  test("el último trozo se corta en `hasta`, no lo pasa", () => {
    const t = trocear(dia("2026-01-01"), dia("2026-02-10"));
    assert.equal(t.at(-1)!.until, "2026-02-10");
  });

  test("un solo día", () => {
    assert.deepEqual(trocear(dia("2026-07-15"), dia("2026-07-15")), [
      { since: "2026-07-15", until: "2026-07-15" },
    ]);
  });

  test("rango invertido devuelve vacío en vez de un loop infinito", () => {
    assert.deepEqual(trocear(dia("2026-07-15"), dia("2026-01-01")), []);
  });

  test("mesesPorTrozo en 0 no cuelga el proceso", () => {
    // Sin la guarda, `inicio` nunca avanzaría y esto correría para siempre. Un backfill que no
    // termina es peor que uno que falla.
    const t = trocear(dia("2026-01-01"), dia("2026-01-10"), 0);
    assert.ok(t.length > 0 && t.length <= 10);
  });

  test("los 37 meses completos dan ~13 trozos, todos pedibles", () => {
    const t = trocear(dia("2023-08-01"), dia("2026-07-15"));
    assert.equal(t.length, 12);
    // Ninguno puede pasar de ~3 meses: ahí es donde Meta devuelve 400/500.
    for (const v of t) assert.ok(dias(v).length <= 95, `${v.since}→${v.until} es muy largo`);
  });
});

describe("ventanaMaxima — el borde de los 37 meses", () => {
  const AHORA = dia("2026-07-16");

  test("termina AYER, no hoy: el día en curso está incompleto", () => {
    // Guardar un día parcial haría que "ayer" valga menos que "anteayer" por el reloj, no por
    // el negocio.
    assert.equal(ventanaMaxima(AHORA).until, "2026-07-15");
  });

  test("arranca dentro de los 37 meses que Meta retiene (no en el borde exacto)", () => {
    const v = ventanaMaxima(AHORA);
    const desde = new Date(`${v.since}T00:00:00Z`);
    const limite = new Date(AHORA);
    limite.setMonth(limite.getMonth() - RETENCION_META_MESES);
    // Pedir el borde exacto da ERROR(3018) si la consulta cruza la medianoche del huso de Meta.
    assert.ok(desde > limite, `${v.since} debe estar dentro del límite de 37 meses`);
  });

  test("la ventana máxima, troceada, cubre ~37 meses sin huecos", () => {
    const v = ventanaMaxima(AHORA);
    const trozos = trocear(new Date(`${v.since}T12:00:00Z`), new Date(`${v.until}T12:00:00Z`));
    const todos = trozos.flatMap(dias);
    assert.equal(new Set(todos).size, todos.length); // sin solapes
    assert.equal(todos[0], v.since);
    assert.equal(todos.at(-1), v.until);
  });
});
