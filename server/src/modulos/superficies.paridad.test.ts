import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { SUPERFICIES, moduloDeLaSuperficie, type Modulo } from "./modulo.js";

/**
 * LOS CANDADOS DE LAS SUPERFICIES — que la lista, el montaje y el árbol no se
 * separen.
 *
 * 🔴 **Los tres modos de fallar que esto atrapa no dan error ni log**, y por eso
 * hay tres tests y no uno:
 *
 * 1. Un prefijo declarado y NO montado deja la superficie abierta mientras su
 *    nombre está escrito en el módulo de la frontera — la peor combinación,
 *    porque quien lea la lista va a creer que está cubierta.
 * 2. Un `deVentas` montado sobre algo que la lista no declara le corta una
 *    superficie a alguien sin que la lista —que es lo que se lee para entender
 *    la frontera— diga que esa ruta está adentro.
 * 3. 🔴 **Un router NUEVO que importe `cerberus/` o lea icarus y que nadie
 *    declare.** Éste es el que importa de verdad: los dos primeros vigilan lo
 *    que ya se decidió, y éste vigila lo que todavía no se decidió. Es
 *    exactamente cómo se llegó a las once rutas abiertas que encontró la
 *    auditoría del 19-ago-2026 — ninguna se abrió, todas nacieron abiertas.
 *
 * Se leen los archivos en vez de importarlos a propósito: `index.ts` levanta la
 * app entera (base, transporte, webhooks) y no se puede importar desde un test
 * puro. Es el mismo recurso que `limitesMedia.paridad.test.ts` (#37).
 */

const AQUI = new URL(".", import.meta.url);
const INDEX = readFileSync(fileURLToPath(new URL("../index.ts", AQUI)), "utf8");
const RUTAS_DIR = fileURLToPath(new URL("../routes/", AQUI));

/** El nombre del middleware que monta cada módulo, tal como se escribe en `index.ts`. */
const GUARDA: Record<Modulo, string> = { ventas: "deVentas", campana: "deCampana" };

describe("la lista de superficies y el montaje", () => {
  test("todo prefijo declarado se monta con la guarda de SU módulo", () => {
    for (const [prefijo, modulo] of Object.entries(SUPERFICIES)) {
      const montaje = new RegExp(
        `app\\.use\\(\\s*"${prefijo.replace(/\//g, "\\/")}"\\s*,\\s*${GUARDA[modulo]}\\s*[,)]`,
      );
      assert.match(
        INDEX,
        montaje,
        `«${prefijo}» está declarado como «${modulo}» pero NO se monta con ` +
          `${GUARDA[modulo]}: la lista promete una frontera que el server no aplica`,
      );
    }
  });

  test("no se monta una guarda sobre algo que la lista no declara", () => {
    for (const [modulo, guarda] of Object.entries(GUARDA) as [Modulo, string][]) {
      const montados = [
        ...INDEX.matchAll(new RegExp(`app\\.use\\(\\s*"([^"]+)"\\s*,\\s*${guarda}\\s*[,)]`, "g")),
      ].map((m) => m[1]);
      for (const ruta of montados) {
        assert.equal(
          SUPERFICIES[ruta],
          modulo,
          `«${ruta}» se monta con ${guarda} y la lista no lo declara como «${modulo}»`,
        );
      }
      const declarados = Object.entries(SUPERFICIES).filter(([, m]) => m === modulo).length;
      assert.equal(
        montados.length,
        declarados,
        `${guarda}: ${montados.length} montajes contra ${declarados} declarados`,
      );
    }
  });

  /**
   * 🔴 **LAS SUBRUTAS TIENEN QUE MONTARSE ANTES QUE SU ROUTER PADRE.**
   * `app.use` matchea en orden: con `/api/gestiones` montado primero, ese router
   * atiende `/api/gestiones/intereses` y el candado no corre nunca. El defecto
   * no da error — devuelve el catálogo de Cerberus con la lista diciendo que
   * está cubierto, que es la forma exacta del punto 1 de arriba.
   */
  test("una subruta declarada se monta ANTES que su padre", () => {
    for (const prefijo of Object.keys(SUPERFICIES)) {
      const partes = prefijo.split("/").filter(Boolean);
      if (partes.length < 3) continue; // no es una subruta de un router montado
      const padre = `/${partes.slice(0, 2).join("/")}`;
      const donde = (p: string) => INDEX.indexOf(`app.use("${p}"`);
      const posPadre = donde(padre);
      if (posPadre === -1) continue; // el padre no se monta: no hay orden que romper
      assert.ok(
        donde(prefijo) !== -1 && donde(prefijo) < posPadre,
        `«${prefijo}» se monta DESPUÉS de «${padre}»: Express nunca va a llegar al candado`,
      );
    }
  });
});

/**
 * ══ EL BARRIDO DEL ÁRBOL ═════════════════════════════════════════════════════
 *
 * Los routers que tocan Cerberus o icarus **sólo en algunas subrutas** y por eso
 * no se pueden vedar enteros. Cada uno lleva escrito **qué queda cubierto y qué
 * no** — el motivo es obligatorio y el test lo exige, así que esta lista no se
 * puede ampliar en silencio.
 *
 * ⚠️ **`eventos` es RESIDUO CONOCIDO, no una excepción resuelta.** `POST /` pide
 * el catálogo de Cerberus cuando el evento trae un `curso`, y hoy nada impide
 * que un operador de campaña lo mande. No se veda el router entero porque el
 * timeline es CRM genérico y le sirve a los dos módulos. Se cierra cuando la
 * campaña tenga su propio vocabulario de eventos: ahí `pregunto_curso` deja de
 * existir de ese lado y el campo no tiene cómo llegar.
 */
const PARCIALES: Record<string, string> = {
  "gestiones.ts":
    "sólo /intereses va contra Cerberus (el catálogo de cursos); etapas, etiquetas y la " +
    "bitácora son CRM genérico. Cubierto por la subruta /api/gestiones/intereses.",
  "eventos.ts":
    "RESIDUO: POST / consulta el catálogo de Cerberus sólo si el evento trae `curso`. " +
    "El timeline es genérico y se comparte; el campo se cierra con el vocabulario de campaña.",
  "auth.ts":
    "el login ES contra Cerberus y es la puerta de entrada de las dos identidades " +
    "(Cerberus y Centurión). Vedarlo dejaría a la campaña sin poder entrar.",
};

describe("el barrido: ningún router toca Cerberus o icarus sin declararse", () => {
  test("todo router que importa cerberus/ o icarus está declarado o es parcial con motivo", () => {
    const archivos = readdirSync(RUTAS_DIR).filter(
      (f) => f.endsWith(".ts") && !f.includes(".test."),
    );
    const sinDeclarar: string[] = [];

    for (const archivo of archivos) {
      const fuente = readFileSync(`${RUTAS_DIR}${archivo}`, "utf8");
      const tocaCerberus = /^import[^;]*from\s+["'][^"']*\/cerberus\//m.test(fuente);
      const tocaIcarus = /\bicarus\b/i.test(fuente) && /^import/m.test(fuente);
      if (!tocaCerberus && !tocaIcarus) continue;

      if (archivo in PARCIALES) {
        assert.ok(
          PARCIALES[archivo].trim().length > 40,
          `«${archivo}» es parcial y su motivo no explica nada`,
        );
        continue;
      }

      // El router se monta en algún prefijo; alcanza con que ese prefijo, o el
      // path completo de alguna de sus subrutas, esté declarado.
      const variable = archivo.replace(/\.ts$/, "");
      const monta = new RegExp(
        `app\\.use\\(\\s*"([^"]+)"[^)]*\\b\\w*${variable}\\w*Router\\b`,
        "i",
      );
      const m = monta.exec(INDEX);
      if (!m) continue; // no está montado: no hay superficie que vedar
      if (!moduloDeLaSuperficie(m[1])) sinDeclarar.push(`${archivo} → ${m[1]}`);
    }

    assert.deepEqual(
      sinDeclarar,
      [],
      "estos routers sirven Cerberus o icarus y ningún módulo los reclama — " +
        "declaralos en SUPERFICIES o agregalos a PARCIALES con el motivo",
    );
  });

  test("PARCIALES no puede nombrar un router que ya no toca Cerberus ni icarus", () => {
    // La otra mitad: una excepción que sobrevive a su motivo se lee como una
    // decisión vigente, y la próxima persona la respeta sin verificarla.
    for (const archivo of Object.keys(PARCIALES)) {
      const fuente = readFileSync(`${RUTAS_DIR}${archivo}`, "utf8");
      const toca =
        /^import[^;]*from\s+["'][^"']*\/cerberus\//m.test(fuente) || /\bicarus\b/i.test(fuente);
      assert.ok(toca, `«${archivo}» ya no toca Cerberus ni icarus: sacalo de PARCIALES`);
    }
  });
});

describe("moduloDeLaSuperficie", () => {
  test("cubre las subrutas, no sólo el prefijo exacto", () => {
    assert.equal(moduloDeLaSuperficie("/api/notas"), "ventas");
    assert.equal(moduloDeLaSuperficie("/api/notas/por-link/abc"), "ventas");
    assert.equal(moduloDeLaSuperficie("/api/espacios/3/miembros"), "ventas");
  });

  test("🔴 no matchea un prefijo que sólo COMPARTE el comienzo", () => {
    // Sin el `/` del final, `/api/notasimportantes` entraría por parecido — y al
    // revés, una ruta nueva llamada así quedaría vedada sin que nadie lo decidiera.
    assert.equal(moduloDeLaSuperficie("/api/notasimportantes"), undefined);
    assert.equal(moduloDeLaSuperficie("/api/correosmasivos"), undefined);
  });

  test("lo que no está declarado es compartido, y eso es el default", () => {
    assert.equal(moduloDeLaSuperficie("/api/conversaciones"), undefined);
    assert.equal(moduloDeLaSuperficie("/api/whatsapp/enviar"), undefined);
    assert.equal(moduloDeLaSuperficie("/api/gestiones/etiquetas"), undefined);
    assert.equal(moduloDeLaSuperficie("/"), undefined);
  });

  test("🔴 gana el prefijo MÁS LARGO: la subruta le pisa al padre", () => {
    // Hoy `/api/gestiones` no está declarado, así que esto fija la regla antes
    // de que haga falta — el día que alguien declare el padre, el hijo tiene que
    // seguir decidiendo, y el orden de las claves de un objeto no es un contrato.
    assert.equal(moduloDeLaSuperficie("/api/gestiones/intereses"), "ventas");
    assert.equal(moduloDeLaSuperficie("/api/gestiones/intereses/derivado"), "ventas");
    assert.equal(moduloDeLaSuperficie("/api/dashboard"), undefined);
    assert.equal(moduloDeLaSuperficie("/api/dashboard/negocio"), "ventas");
  });
});
