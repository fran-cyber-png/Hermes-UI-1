import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { nombreCortoDeVendedora } from "./nombreVendedora.js";

/**
 * EL CANDADO ENTRE EL NOMBRE DE LA COLA Y EL NOMBRE DEL SOBRE.
 *
 * ══ QUÉ SE ROMPE SI ESTAS DOS SE SEPARAN ════════════════════════════════════
 *
 * 🔴 **Las dos mitades de la MISMA pantalla usan cada una la suya.** El composer
 * de Correos dibuja el sobre con `nombreCorto` del front
 * (`resumenDelSobre` → `src/dominio/dueno.ts`) y el correo sale con el `From` que
 * arma el server (`armarSobre` → `nombreVendedora.ts`). Si divergen, la vendedora
 * lee «Ventas10 · Escuela Goberna» arriba del botón y al lead le llega otra cosa
 * — o sea que la pantalla **enseña un sobre que nadie va a recibir**, que es
 * exactamente lo que este frente vino a corregir: la vista prometía «con tu
 * nombre» y mandaba otro.
 *
 * Y no hay error, no hay log y no hay conteo que no cierre: se descubre el día
 * que alguien compara una captura con un correo real.
 *
 * ══ QUÉ FIJA, Y POR QUÉ NO ES UN `assert.equal` DE DOS CONSTANTES ═══════════
 *
 * Acá lo compartido es una FUNCIÓN, no un número, así que lo que se cruza es **la
 * relación**: se lee el archivo del front, se le extrae el juego de separadores
 * que usa de verdad, se reconstruye su algoritmo con ese juego y se compara
 * contra el del server sobre los ids que existen en producción. Agregarle un
 * separador a una de las dos pone roja a la otra.
 *
 * ⚠️ **Lee el árbol por ruta, así que MOVER `src/dominio/dueno.ts` lo rompe en
 * EJECUCIÓN con el typecheck de las dos mitades en verde** (es la cicatriz de
 * `whatsapp/lid.paridad.test.ts`). Al mudar ese archivo, `grep -rn` de la ruta
 * vieja antes de darlo por bueno.
 */

const RUTA_FRONT = fileURLToPath(new URL("../../../src/dominio/dueno.ts", import.meta.url));

/** Los ids que EXISTEN, no los que se pueden imaginar: es lo que sale en un From real. */
const IDS_REALES = [
  "luz",
  "Luz",
  "Sindy",
  "alan",
  "Usuario1",
  "Usuario2",
  "Tracy",
  "ventas10@grupogoberna.com",
  "ventas11@grupogoberna.com",
  "ventas14@grupogoberna.com",
  "sindy.rojas",
  "ana-maria",
  "juan_perez",
  "srojas",
  "centurion:algo",
  "  luz  ",
  "",
];

/**
 * El algoritmo del FRONT, reconstruido con el juego de separadores que el archivo
 * declara hoy. No se evalúa su código —eso sería confiar en que un `eval` lee
 * igual que el bundler—: se replica la forma y se le inyecta lo único que cambia.
 */
function comoElFront(vendedoraId: string, separadores: RegExp): string {
  const base = vendedoraId.trim().split(separadores)[0] ?? "";
  if (!base) return vendedoraId.trim();
  return base.charAt(0).toUpperCase() + base.slice(1);
}

test("el nombre corto del From es el mismo que el de la cola", () => {
  const fuente = readFileSync(RUTA_FRONT, "utf8");

  const m = fuente.match(/export function nombreCorto[\s\S]*?\.split\((\/[^)]+?\/)\)/);
  assert.ok(
    m,
    "no se encontró el `split(/…/)` de `nombreCorto` en `src/dominio/dueno.ts` — ¿se renombró o se movió?",
  );

  const cuerpo = m![1];
  const separadores = new RegExp(cuerpo.slice(1, -1));

  for (const id of IDS_REALES) {
    assert.equal(
      nombreCortoDeVendedora(id),
      comoElFront(id, separadores),
      `«${id}»: el sobre que el server manda y el que la pantalla dibuja no coinciden`,
    );
  }
});

/**
 * ⚠️ Lo de arriba cruza los separadores; esto cruza **la forma**. Sin esto, el
 * front podría dejar de capitalizar (o empezar a devolver un placeholder cuando
 * no queda nada) y la réplica de este archivo seguiría diciendo que están de
 * acuerdo — porque la réplica es mía, no suya.
 */
test("🔴 el front sigue teniendo la MISMA forma que esta réplica", () => {
  const fuente = readFileSync(RUTA_FRONT, "utf8");
  const fn = fuente.slice(fuente.indexOf("export function nombreCorto"));

  assert.match(
    fn,
    /if \(!base\) return vendedoraId\.trim\(\);/,
    "el front cambió qué hace cuando no queda una primera palabra: acá se devuelve el id crudo",
  );
  assert.match(
    fn,
    /base\.charAt\(0\)\.toUpperCase\(\) \+ base\.slice\(1\)/,
    "el front cambió cómo capitaliza: el display name del From lo haría distinto",
  );
});
