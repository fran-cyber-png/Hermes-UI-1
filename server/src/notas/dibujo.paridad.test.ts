import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LIMITE_ANOTACIONES_BYTES } from "./notas.js";
import { hayAnotaciones } from "./textoPlano.js";

/**
 * EL CANDADO ENTRE LA CAPA DEL FRONT Y LO QUE EL SERVER ENTIENDE DE ELLA.
 *
 * ══ QUÉ SE ESTÁ SOSTENIENDO ═════════════════════════════════════════════════
 *
 * El server guarda la capa en `notas.anotaciones` y no la interpreta casi nada
 * —a propósito—, pero tiene que coincidir con el front en DOS cosas:
 *
 *   1. **Cuánto puede pesar.** Dos números, uno en cada lado.
 *   2. **Cómo se reconoce una figura**, que es lo único que `hayAnotaciones`
 *      mira para decidir si una página sin texto igual se guarda.
 *
 * ══ POR QUÉ ESTO NECESITA UN TEST Y NO UN COMENTARIO ════════════════════════
 *
 * Es la misma familia que `limiteTexto.paridad.test.ts`, y por el mismo motivo:
 * cuando se desincronizan **no se rompe nada visible**.
 *
 *  · Si el tope del front sube y el del server no, la vendedora dibuja hasta que
 *    un guardado devuelve 400 sobre una página que en pantalla se ve entera —y
 *    el aviso amable que el front prepara nunca aparece, porque para él todavía
 *    entraba.
 *  · Si el front renombra `clase`, `hayAnotaciones` deja de reconocer las
 *    figuras y una página que es solo un diagrama vuelve a rechazarse por
 *    «vacía»: exactamente el fallo mudo que este frente vino a arreglar.
 */

const RUTA_FIGURAS = fileURLToPath(
  new URL("../../../src/features/notas/dibujo/figuras.ts", import.meta.url),
);

const fuente = readFileSync(RUTA_FIGURAS, "utf8");

test("el tope de la capa es el mismo de los dos lados", () => {
  const m = fuente.match(/export const LIMITE_FIGURAS_BYTES\s*=\s*([\d\s*_]+);/);
  assert.ok(m, "no se encontró `LIMITE_FIGURAS_BYTES` en figuras.ts — ¿se renombró?");

  const delFront = Number(new Function(`return ${m![1].replace(/_/g, "")}`)());
  assert.equal(
    delFront,
    LIMITE_ANOTACIONES_BYTES,
    `el front deja dibujar hasta ${delFront} bytes y el server acepta ${LIMITE_ANOTACIONES_BYTES}: ` +
      "el que sobre se pierde en un 400 sobre una página que se ve entera",
  );
});

test("el tope deja aire para el resto del body de 100 KB de express", () => {
  // `index.ts` monta `express.json()` SIN `limit`, o sea el default de 100 KB,
  // bastante por debajo del `TOPE_DOC_BYTES` de 512 KB que `routes/notas.ts`
  // cree estar aplicando. Mientras eso siga así, la capa tiene que dejar lugar
  // para el `doc` y el texto, o el aviso del front lo pisa un 413 mudo.
  assert.ok(
    LIMITE_ANOTACIONES_BYTES <= 64 * 1024,
    `la capa puede pesar ${Math.round(LIMITE_ANOTACIONES_BYTES / 1024)} KB y el body entero tiene 100 KB`,
  );
});

test("🔴 una figura del front la reconoce el server", () => {
  // No se comparan NOMBRES: se arma una figura con la forma que el front declara
  // en su tipo `Figura` y se la pasa a la función del server. Si allá se renombra
  // `clase`, este test se cae — que es lo que un `grep` no garantiza.
  const declaracion = fuente.match(/export type Figura =[\s\S]*?;\n/);
  assert.ok(declaracion, "no se encontró el tipo `Figura` en figuras.ts");
  assert.match(
    declaracion![0],
    /\bclase:/,
    "las figuras ya no se distinguen por un campo `clase`: `hayAnotaciones` las sigue buscando así",
  );

  const capa = [
    { clase: "trazo", color: "#111827", grosor: 3, puntos: [[10, 10], [200, 140]] },
    { clase: "elipse", color: "#ef4444", grosor: 2, desde: [40, 30], hasta: [180, 90] },
  ];
  assert.equal(hayAnotaciones(capa), true, "el server tiene que ver que esta página está anotada");
});

test("las clases que el front puede producir están todas cubiertas", () => {
  // Cada una tiene que hacer que `hayAnotaciones` diga que sí: si mañana se
  // agrega una y el server no la cuenta, una página que es solo esa figura se
  // rechazaría por vacía.
  for (const clase of ["trazo", "resaltador", "linea", "flecha", "rectangulo", "elipse", "rotulo"]) {
    assert.ok(
      fuente.includes(`'${clase}'`),
      `«${clase}» ya no existe en figuras.ts — este test quedó viejo, o se perdió una figura`,
    );
    assert.equal(hayAnotaciones([{ clase }]), true, `el server no reconoce «${clase}»`);
  }
});
