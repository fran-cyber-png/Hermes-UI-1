import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * EL INVENTARIO DE CAMPOS DE PLATA (H11, #169) — el test que faltaba.
 *
 * `docs/moneda-fuentes-afectadas.md` es el entregable que le permite a Ivi poner
 * un gate acotado sobre las cifras contaminadas por el divisor roto de
 * `tb_moneda`. Un error ahí no rompe nada acá: hace que Ivi sirva como `HECHO`
 * una cifra que no lo es. Por eso el documento tiene un bloque machine-readable
 * (§0.1) y por eso este archivo existe.
 *
 * EL DEFECTO QUE ESTE TEST MATA. La v1 del documento armó la tabla del gate
 * enumerando campos `*_usd` — y el agujero B (Cerberus no convierte en el
 * servidor, la conversión vive en el JavaScript del navegador) contamina la
 * cifra EN MONEDA LOCAL, no su conversión. Resultado: `venta.monto_total`,
 * `detalle_venta.precio_venta`/`precio_total`, `cuota.monto_total`,
 * `pago.monto`, `producto.precio_normal` y el `monto` de
 * `canales/tesoreria.ts` quedaron FUERA de la lista. El gate se habría puesto
 * donde el problema no estaba.
 *
 * Un documento no se testea leyéndolo. Se testea cerrando el lazo con el código
 * que describe: acá se escanea `db/canonico.ts` en busca de columnas de plata y
 * se exige que cada una tenga veredicto en el inventario. Si alguien agrega una
 * columna de monto a la capa canónica, este test falla hasta que el documento la
 * clasifique — que es exactamente cómo se coló el defecto de la v1.
 */

const raiz = new URL("../../../", import.meta.url);
const leer = (rel: string) => readFileSync(fileURLToPath(new URL(rel, raiz)), "utf8");

const DOC = "docs/moneda-fuentes-afectadas.md";

/** `🔴 no servir como HECHO` · `🟡 con salvedad` · `🟢 limpio`. */
type Veredicto = "🔴" | "🟡" | "🟢";

/**
 * El inventario del documento: las líneas `fuente.campo = 🔴` del bloque de §0.1.
 * Se parsea el documento en vez de duplicar la lista acá a propósito — una
 * segunda copia podría divergir, que es la lección de #37.
 */
function inventarioDelDocumento(): Map<string, Veredicto> {
  const md = leer(DOC);
  const entradas = new Map<string, Veredicto>();
  for (const linea of md.split("\n")) {
    const m = /^([A-Za-z][\w./*]*(?:\.[\w./*]+)+)\s*=\s*(🔴|🟡|🟢)\s*$/.exec(linea.trim());
    if (m) entradas.set(m[1], m[2] as Veredicto);
  }
  return entradas;
}

/**
 * Las columnas de plata de la capa canónica, leídas del schema.
 * «De plata» = un `numeric()` cuyo nombre empieza en monto/precio/saldo, más las
 * columnas de moneda, que son las que le ponen etiqueta a esos números (y una
 * etiqueta equivocada miente igual que un número equivocado — agujero C).
 */
function camposDePlataDeCanonico(): string[] {
  const src = leer("server/src/db/canonico.ts");
  const campos: string[] = [];
  let tabla: string | null = null;
  // Un solo barrido en orden: `ontologia.table("x"` abre una tabla —y puede venir
  // partida en dos líneas, así que NO se puede escanear línea por línea— y cada
  // `numeric("col")`/`text("col")` posterior le pertenece.
  for (const m of src.matchAll(/ontologia\.table\(\s*"([a-z_]+)"|(?:numeric|text)\(\s*"([a-z_]+)"/g)) {
    if (m[1]) {
      tabla = m[1];
    } else if (tabla && /^(monto|precio|saldo|moneda)/.test(m[2])) {
      campos.push(`ontologia.${tabla}.${m[2]}`);
    }
  }
  return campos;
}

test("el inventario del documento clasifica TODA columna de plata de la capa canónica", () => {
  const inventario = inventarioDelDocumento();
  const enElCodigo = camposDePlataDeCanonico();

  // Guardia del guardia: si el parseo se rompe, el test no puede pasar en vacío.
  assert.ok(enElCodigo.length >= 12, `el escaneo de canonico.ts encontró ${enElCodigo.length} campos: se rompió`);
  assert.ok(inventario.size >= 25, `el bloque §0.1 de ${DOC} tiene ${inventario.size} entradas: se rompió`);

  const faltantes = enElCodigo.filter((c) => !inventario.has(c));
  assert.deepEqual(
    faltantes,
    [],
    `campos de plata en db/canonico.ts sin veredicto en ${DOC} §0.1:\n  ${faltantes.join("\n  ")}\n` +
      "Si son plata, clasificalos. Si no, cambiá el nombre — este test lee el schema, no la intención.",
  );
});

test("el inventario no inventa columnas canónicas que el schema no tiene", () => {
  const inventario = inventarioDelDocumento();
  const enElCodigo = new Set(camposDePlataDeCanonico());
  const fantasmas = [...inventario.keys()].filter((k) => k.startsWith("ontologia.") && !enElCodigo.has(k));
  assert.deepEqual(fantasmas, [], `el documento clasifica campos que db/canonico.ts no tiene:\n  ${fantasmas.join("\n  ")}`);
});

/**
 * LA FILA QUE LA v1 TENÍA AL REVÉS. Decía que `canales/tesoreria.ts` sirve
 * «sumas y promedios en USD». No sirve una sola: sirve `monto_pagado` CRUDO en
 * moneda local, que es lo que el agujero B ensucia. Y sale a Ivi por
 * `governa.tesoreria.reloj`.
 */
test("canales/tesoreria.ts sirve plata en MONEDA LOCAL, y el documento lo dice así", () => {
  const src = leer("server/src/canales/tesoreria.ts");

  assert.equal(
    (src.match(/usd/gi) ?? []).length,
    0,
    "tesoreria.ts ganó un campo USD: revisá la fila de §3.2 antes de dar por buena la corrección",
  );
  assert.match(src, /monto_pagado/, "tesoreria.ts dejó de servir el monto crudo: el documento quedó viejo");
  assert.match(
    src,
    /p\.payload->>'codigo_moneda'/,
    "tesoreria.ts dejó de leer la moneda DEL PAGO: si ahora usa la de la venta, heredó el agujero C",
  );

  const inventario = inventarioDelDocumento();
  assert.equal(inventario.get("canales/tesoreria.ts.monto"), "🔴");
  assert.equal(inventario.get("canales/tesoreria.ts.moneda"), "🟢");
});

/**
 * El catálogo es el otro lado del mismo error: la v1 lo dio por «USD limpio» con
 * tres indicios de nombre. La v2 lo mide (§2.4) y lo deja en 🟡 — sigue sin haber
 * columna de moneda, ni acá ni en Cerberus.
 */
test("el precio de catálogo va con salvedad mientras no exista columna de moneda", () => {
  const inventario = inventarioDelDocumento();
  for (const campo of ["tb_producto.precio_normal", "tb_producto.precio_promocion", "ontologia.producto.precio_normal"]) {
    assert.equal(inventario.get(campo), "🟡", `${campo} debería ir con salvedad en ${DOC} §0.1`);
  }

  assert.ok(
    !camposDePlataDeCanonico().some((c) => c.startsWith("ontologia.producto.moneda")),
    "ontologia.producto ganó una columna de moneda: si el precio ya viene rotulado, el estado puede subir a 🟢",
  );
});
