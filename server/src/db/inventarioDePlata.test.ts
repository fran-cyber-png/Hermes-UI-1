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
 * Las únicas `numeric()` de `canonico.ts` que NO son plata, con la razón de cada una.
 *
 * Es una lista de EXCEPCIONES, y esa es la diferencia que importa. La primera versión de este
 * test filtraba las columnas por el PREFIJO del nombre (`monto|precio|saldo|moneda`), o sea
 * que reproducía en chiquito el defecto que vino a matar: la v1 del documento también armó el
 * gate por el nombre de los campos. Con el filtro por prefijo, agregar `ticket_usd` o
 * `descuento` a `ontologia.venta` dejaba el test verde —y `ticket` es un nombre que el propio
 * documento clasifica 🔴 en `governa.ventas.*.ticket`—.
 *
 * Al revés, la carga de la prueba queda del lado correcto: **toda** columna numérica de la
 * capa canónica es plata hasta que alguien escriba acá por qué no lo es.
 */
const NO_SON_PLATA: Record<string, string> = {
  "ontologia.pago.latencia_dias": "días entre la venta y el pago: un plazo, no un importe; no lleva moneda",
};

/**
 * Las columnas de la capa canónica que este gate vigila, leídas del schema:
 * **todas** las numéricas (los importes) más las de moneda, que son las que les ponen etiqueta
 * (y una etiqueta equivocada miente igual que un número equivocado — agujero C).
 */
function columnasVigiladasDeCanonico(): { importes: string[]; monedas: string[] } {
  const src = leer("server/src/db/canonico.ts");
  const importes: string[] = [];
  const monedas: string[] = [];
  let tabla: string | null = null;
  // Un solo barrido en orden: `ontologia.table("x"` abre una tabla —y puede venir
  // partida en dos líneas, así que NO se puede escanear línea por línea— y cada
  // `numeric("col")`/`text("col")` posterior le pertenece.
  for (const m of src.matchAll(/ontologia\.table\(\s*"([a-z_]+)"|(numeric|text)\(\s*"([a-z_]+)"/g)) {
    if (m[1]) {
      tabla = m[1];
      continue;
    }
    if (!tabla) continue;
    const campo = `ontologia.${tabla}.${m[3]}`;
    if (m[2] === "numeric") importes.push(campo);
    else if (/^moneda/.test(m[3])) monedas.push(campo);
  }
  return { importes, monedas };
}

/** Importes + monedas, que es lo que el documento tiene que clasificar entero. */
function camposDePlataDeCanonico(): string[] {
  const { importes, monedas } = columnasVigiladasDeCanonico();
  return [...importes, ...monedas];
}

test("el inventario del documento clasifica TODA columna de plata de la capa canónica", () => {
  const inventario = inventarioDelDocumento();
  const enElCodigo = camposDePlataDeCanonico();

  // Guardia del guardia: si el parseo se rompe, el test no puede pasar en vacío.
  assert.ok(enElCodigo.length >= 12, `el escaneo de canonico.ts encontró ${enElCodigo.length} campos: se rompió`);
  assert.ok(inventario.size >= 25, `el bloque §0.1 de ${DOC} tiene ${inventario.size} entradas: se rompió`);

  const faltantes = enElCodigo.filter((c) => !inventario.has(c) && !(c in NO_SON_PLATA));
  assert.deepEqual(
    faltantes,
    [],
    `campos de plata en db/canonico.ts sin veredicto en ${DOC} §0.1:\n  ${faltantes.join("\n  ")}\n` +
      "Si son plata, clasificalos. Si no lo son, anotalos en NO_SON_PLATA con la razón — este test\n" +
      "lee el schema, no la intención, y ya no adivina por el nombre de la columna.",
  );
});

test("la lista de excepciones no se puede llenar de columnas que ya no existen", () => {
  // Una excepción que sobrevive a su columna es una puerta abierta esperando que alguien
  // reutilice el nombre. Las excepciones caducan con la columna que las justifica.
  const importes = new Set(columnasVigiladasDeCanonico().importes);
  const huerfanas = Object.keys(NO_SON_PLATA).filter((c) => !importes.has(c));
  assert.deepEqual(huerfanas, [], `NO_SON_PLATA exime columnas que canonico.ts ya no tiene:\n  ${huerfanas.join("\n  ")}`);
});

test("el inventario no inventa columnas canónicas que el schema no tiene", () => {
  const inventario = inventarioDelDocumento();
  const enElCodigo = new Set(camposDePlataDeCanonico());
  const fantasmas = [...inventario.keys()].filter((k) => k.startsWith("ontologia.") && !enElCodigo.has(k));
  assert.deepEqual(fantasmas, [], `el documento clasifica campos que db/canonico.ts no tiene:\n  ${fantasmas.join("\n  ")}`);
});

/**
 * EL GATE NO SE PUEDE ABRIR JUSTO DONDE ESTÁ EL PROBLEMA.
 *
 * Los tests de arriba guardan PRESENCIA: exigen que cada campo tenga un renglón. No guardaban el
 * VEREDICTO — cambiar `ontologia.venta.monto_total` de 🔴 a 🟢 dejaba la suite en verde, y ese
 * flip es exactamente el defecto de la v1 servido otra vez (un gate abierto donde el agujero B
 * ensucia). El veredicto no se copia acá campo por campo, que sería la segunda lista divergente
 * de #37; se fija la invariante de la que sale:
 *
 * **Mientras `tb_moneda` no tenga historial de tasas, ningún IMPORTE de la capa canónica está
 * limpio.** El monto en moneda local lo ensucia el agujero B (la conversión vive en el JS del
 * navegador), y su conversión a USD arrastra el divisor roto. 🟢 significa «servible como HECHO»:
 * un importe no puede llegar ahí. Las etiquetas de moneda SÍ pueden (y `venta.moneda_iso` lo
 * está), porque un rótulo fiel no depende de ninguna tasa.
 *
 * El día que exista `tb_moneda_tasa` y los importes se recalculen, este test es el que hay que
 * venir a cambiar — a propósito: subir un importe a 🟢 tiene que costar una decisión explícita.
 */
test("ningún IMPORTE de la capa canónica puede figurar como limpio (🟢)", () => {
  const inventario = inventarioDelDocumento();
  const limpios = columnasVigiladasDeCanonico()
    .importes.filter((c) => !(c in NO_SON_PLATA))
    .filter((c) => inventario.get(c) === "🟢");
  assert.deepEqual(
    limpios,
    [],
    `${DOC} §0.1 da por limpios importes que el divisor roto contamina:\n  ${limpios.join("\n  ")}\n` +
      "Un importe solo puede ser 🟢 cuando exista historial de tasas. Si ese día llegó, cambiá este test.",
  );
});

/**
 * El mismo número no puede tener dos veredictos. `governa.tesoreria.reloj` es la tool que sirve
 * el `monto` de `canales/tesoreria.ts`: si el campo es 🔴 y la tool 🟢, el gate se pone en el
 * canal y se abre en la puerta por la que Ivi realmente entra.
 */
test("la tool y el campo que sirve dicen lo mismo", () => {
  const inventario = inventarioDelDocumento();
  assert.equal(
    inventario.get("governa.tesoreria.reloj.monto"),
    inventario.get("canales/tesoreria.ts.monto"),
    "`governa.tesoreria.reloj` sirve el `monto` de `canales/tesoreria.ts`: mismo número, mismo veredicto",
  );
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
