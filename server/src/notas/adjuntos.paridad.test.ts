import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { archivoSeguro, nombreSeguro } from "../whatsapp/mediaDir.js";

/**
 * LAS IMÁGENES QUE SE PEGAN EN UNA PÁGINA — el candado de las dos puntas.
 *
 * ══ QUÉ SE ESTÁ SOSTENIENDO ═════════════════════════════════════════════════
 *
 * La ruta de adjuntos y el front tienen que coincidir en QUÉ FORMATOS se
 * aceptan. Son dos listas escritas a mano en dos lenguajes distintos:
 *
 *   · el server las usa para decidir el 415 y la extensión del archivo;
 *   · el front las usa para el `accept` del buscador y para avisar ANTES de
 *     gastar una subida.
 *
 * Cuando se separan **no se rompe nada visible**: el buscador de archivos deja
 * elegir un formato que el server va a rechazar, y la vendedora ve un error
 * después de esperar la subida de una imagen de varios MB. O al revés, el front
 * niega algo que el server aceptaba de buena gana.
 *
 * Es la misma familia que `limiteTexto.paridad.test.ts` y `dibujo.paridad.test.ts`.
 */

const RUTA_RUTA = fileURLToPath(new URL("../routes/notas.ts", import.meta.url));
const RUTA_FRONT = fileURLToPath(
  new URL("../../../src/features/notas/dibujo/adjuntos.ts", import.meta.url),
);

const fuenteServer = readFileSync(RUTA_RUTA, "utf8");
const fuenteFront = readFileSync(RUTA_FRONT, "utf8");

/** Los `image/…` que aparecen en un bloque de código. */
function tiposEn(fuente: string, bloque: RegExp): string[] {
  const m = fuente.match(bloque);
  assert.ok(m, `no se encontró el bloque de tipos — ¿se renombró?\n${bloque}`);
  return [...m![0].matchAll(/image\/[a-z+]+/g)].map((x) => x[0]).sort();
}

test("🔴 los formatos aceptados son los mismos de los dos lados", () => {
  const delServer = tiposEn(fuenteServer, /const TIPOS_DE_IMAGEN[\s\S]*?\n};/);
  const delFront = tiposEn(fuenteFront, /export const TIPOS_ACEPTADOS[\s\S]*?as const;/);

  assert.ok(delServer.length > 0, "el server no declara ningún formato");
  assert.deepEqual(
    delFront,
    delServer,
    "el buscador de archivos y el server no aceptan lo mismo: se elige una imagen, se espera la subida y llega un 415",
  );
});

test("🔴 el SVG no se acepta en ninguno de los dos lados", () => {
  // No es un olvido: un SVG es un documento con scripts y referencias externas.
  // Servirlo desde el mismo origen que la app le daría un XSS de primera clase a
  // cualquiera que pueda pegar una imagen.
  assert.ok(!fuenteServer.includes("image/svg"), "el server aceptaría SVG");
  assert.ok(!fuenteFront.includes("image/svg"), "el front ofrecería SVG");
});

test("el `accept` del input repite exactamente la lista, sin inventar", () => {
  // El `<input type=file>` lleva la lista escrita literal en el JSX de la capa;
  // este test la cruza contra la fuente de verdad del front.
  const capa = readFileSync(
    fileURLToPath(new URL("../../../src/features/notas/dibujo/CapaDeAnotaciones.tsx", import.meta.url)),
    "utf8",
  );
  const m = capa.match(/accept="([^"]+)"/);
  assert.ok(m, "no se encontró el `accept` del input de archivos");

  const delInput = m![1].split(",").map((s) => s.trim()).sort();
  const delFront = tiposEn(fuenteFront, /export const TIPOS_ACEPTADOS[\s\S]*?as const;/);
  assert.deepEqual(delInput, delFront, "el buscador ofrece formatos distintos de los que el módulo declara");
});

/**
 * ══ EL NOMBRE DEL ARCHIVO ═══════════════════════════════════════════════════
 *
 * Lo arma el server entero y no entra nada del cliente, pero el saneado se
 * verifica igual: es la única cosa entre un nombre y un `join()` con el disco.
 */

test("el nombre que arma la ruta pasa la lista blanca de lectura", () => {
  // La misma forma que produce `POST /adjuntos`.
  const armado = nombreSeguro(`nota-${Date.now()}-a1b2c3d4.png`);
  assert.ok(archivoSeguro(armado), `«${armado}» no pasaría la guardia de lectura`);
});

test("🔴 un nombre con path traversal no pasa la guardia", () => {
  for (const malo of ["../../etc/passwd", "a/b.png", "..%2Fx", "nota-1-../x.png", ""]) {
    assert.equal(archivoSeguro(malo), false, `«${malo}» se coló`);
  }
});

test("la ruta de lectura usa `archivoSeguro`, no un regex propio", () => {
  // Con una copia del regex, endurecer la lista blanca en `mediaDir.ts` dejaría
  // esta ruta como estaba — que es el defecto que ese módulo documenta.
  const lectura = fuenteServer.match(/notasRouter\.get\('\/adjuntos\/:archivo'[\s\S]*?\n}\);/);
  assert.ok(lectura, "no se encontró la ruta de lectura de adjuntos");
  assert.match(lectura![0], /archivoSeguro\(/, "la ruta valida el nombre por su cuenta en vez de reusar la guardia");
});

test("la subida declara su propio tope, aparte del `json()` de la app", () => {
  // `express.json()` de `index.ts` tiene 100 KB para toda la app: sin un
  // `express.raw` con su límite, ninguna imagen entraría jamás.
  const subida = fuenteServer.match(/notasRouter\.post\(\s*'\/adjuntos'[\s\S]*?ruta\(/);
  assert.ok(subida, "no se encontró la ruta de subida");
  assert.match(subida![0], /express\.raw\(/, "el cuerpo tiene que ser crudo, no JSON");
  assert.match(subida![0], /limit:\s*'8mb'/, "sin límite propio hereda el de la app y nada entra");
});
