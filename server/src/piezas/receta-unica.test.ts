import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * EL CANDADO CONTRA LA SEGUNDA RECETA.
 *
 * `piezas/version.ts` existe porque el catálogo y el lazo se habían escrito cada
 * uno la suya, y **dos recetas de la misma versión no rompen ningún test**: cada
 * lado queda verde en su suite y el join entre ellos da cero filas, en silencio.
 *
 * Este test hace lo único que ataja eso de verdad: **inventaría quién puede
 * hashear en todo el server**. Si aparece un `createHash`/`createHmac` nuevo, el
 * test falla y obliga a contestar una pregunta de una sola línea: *¿esto es la
 * versión de una pieza?* Si lo es, se importa `versionDeContenido` y listo. Si
 * no lo es —una firma, un seudónimo—, se agrega acá con su motivo escrito.
 *
 * Es la forma de `urgencia.paridad.test.db.ts` (#37) aplicada a otra cosa: la
 * única defensa contra dos implementaciones de la misma verdad es un test que
 * las compare, o que impida que nazca la segunda.
 */

const AQUI = fileURLToPath(new URL(".", import.meta.url));
const RAIZ_SRC = join(AQUI, "..");
/** El front, para la guarda de «el navegador no hashea». Puede no existir en un checkout parcial. */
const RAIZ_FRONT = join(RAIZ_SRC, "..", "..", "src");

/** Este mismo archivo nombra las funciones prohibidas: se excluye para no acusarse solo. */
const ESTE_ARCHIVO = "piezas/receta-unica.test.ts";

/**
 * Quién puede hashear, y para qué. **La lista es corta a propósito.**
 *
 * Cada entrada es un uso que NO es la versión de una pieza. Agregar una fila acá
 * es una decisión; que el test la exija es el punto.
 */
const HASHES_PERMITIDOS: Record<string, string> = {
  "piezas/version.ts": "LA receta de versión de una pieza. La única.",
  "webhook/firma.ts":
    "HMAC de la firma de Meta en el webhook: verifica el emisor, no versiona nada.",
  "webhook/firma.test.ts": "El test de lo anterior: arma la firma esperada.",
  "auth/sesion.ts": "HMAC del token Bearer de la vendedora. Es una credencial, no un contenido.",
  "auth/centurion.ts": "Verifica la firma HS256 del JWT de login de Centurión. Es una credencial, no un contenido.",
  "auth/centurion.test.ts": "El test de lo anterior: firma tokens de prueba con la misma receta.",
  "routes/auth.centurion.test.db.ts": "El test de cableado de /api/auth/centurion: firma tokens de prueba con la misma receta.",
  "lazo/evento.ts":
    "Seudonimiza un correo antes de mandarlo al SDK. Hashea una IDENTIDAD para esconderla, no un texto para compararlo.",
  "migraciones/referencia.ts":
    "El sha256 de un archivo de migración, con la receta que fija drizzle-kit (ADR 0021). Identifica un ARCHIVO ya aplicado, no el contenido de una pieza — y su formato no lo elegimos nosotros.",
};

const LLAMA_A_HASH = /\bcreateHash\s*\(|\bcreateHmac\s*\(/;
/** Lo que usaría un hash en el navegador. No debería haber ninguno. */
const HASH_DE_NAVEGADOR = /\bsubtle\s*\.\s*digest\s*\(|\bcreateHash\s*\(/;

function archivos(dir: string, ext: readonly string[]): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir)) {
    if (entrada === "node_modules" || entrada === "dist") continue;
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) salida.push(...archivos(ruta, ext));
    else if (ext.some((e) => entrada.endsWith(e))) salida.push(ruta);
  }
  return salida;
}

function relativos(rutas: string[], raiz: string): string[] {
  return rutas.map((r) => relative(raiz, r).split(sep).join("/")).sort();
}

describe("una sola receta de versión en todo el server", () => {
  test("nadie hashea fuera de la lista — y la lista dice para qué", () => {
    const encontrados = relativos(
      archivos(RAIZ_SRC, [".ts"]).filter((r) => LLAMA_A_HASH.test(readFileSync(r, "utf8"))),
      RAIZ_SRC,
    ).filter((f) => f !== ESTE_ARCHIVO);

    const nuevos = encontrados.filter((f) => !(f in HASHES_PERMITIDOS));
    const desaparecidos = Object.keys(HASHES_PERMITIDOS)
      .filter((f) => !encontrados.includes(f))
      .sort();

    assert.deepEqual(
      nuevos,
      [],
      `Hash nuevo sin justificar en: ${nuevos.join(", ")}.\n` +
        "  ¿Es la versión de una pieza (una plantilla, un hecho, un acuse, un gancho)?\n" +
        "    → NO escribas otra receta: importá `versionDeContenido` de `piezas/version.ts`.\n" +
        "      Con dos recetas el catálogo publica una versión, el lazo estampa otra, y el join\n" +
        "      entre `envios_wa` y el catálogo da CERO FILAS sin que nadie se entere.\n" +
        "  ¿Es otra cosa (una firma, un seudónimo)?\n" +
        "    → agregalo a HASHES_PERMITIDOS acá, con el motivo en una línea.",
    );

    assert.deepEqual(
      desaparecidos,
      [],
      `Estos ya no hashean: ${desaparecidos.join(", ")}. Sacalos de HASHES_PERMITIDOS ` +
        "para que la lista no se vuelva un adorno.",
    );
  });

  test("y la receta compartida es la que dice ser", () => {
    const receta = readFileSync(join(RAIZ_SRC, "piezas", "version.ts"), "utf8");
    assert.match(receta, /export function versionDeContenido/);
    assert.match(receta, /sha256/);
  });

  test("el NAVEGADOR no hashea: la versión se calcula en un solo lugar", () => {
    // Desde el composer viaja el TEXTO de la pieza, no un hash. Si el navegador
    // hasheara, dos clientes con distinta normalización partirían en dos la
    // historia de una pieza sin que nadie lo note — y ahí no hay test que valga,
    // porque las dos mitades serían «correctas» cada una por su lado.
    if (!existsSync(RAIZ_FRONT)) return;
    const culpables = relativos(
      archivos(RAIZ_FRONT, [".ts", ".tsx"]).filter((r) =>
        HASH_DE_NAVEGADOR.test(readFileSync(r, "utf8")),
      ),
      RAIZ_FRONT,
    );
    assert.deepEqual(
      culpables,
      [],
      `El front hashea en: ${culpables.join(", ")}. La versión la calcula el SERVER.`,
    );
  });
});
