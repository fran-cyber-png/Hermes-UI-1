import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CLASES_DE_PIEZA, refDeDireccion } from "../piezas/direccion.js";
import { VECTORES_DE_MENSAJE, VECTORES_DE_SECUENCIA } from "../piezas/vectores.js";
import { piezaDeUnMensaje, piezaDeUnaSecuencia } from "./armar.js";

/**
 * QUE LO QUE SE PUBLICA SEA LO QUE EL LAZO ESTAMPA.
 *
 * Este catálogo existe para que Ivi elija una pieza y devuelva `{id, version}`;
 * el lazo de resultados (ADR 0022, PR #171) escribe esa misma pieza en
 * `envios_wa`. **El valor de los dos frentes juntos está en el join entre ellos**
 * — «¿la pieza que Ivi recomendó funcionó?» no se puede contestar de otra
 * manera.
 *
 * Y ese join se rompe sin romper ningún test: cada rama queda verde con su
 * propio vocabulario, el `JOIN` devuelve cero filas y el reporte dice «esa pieza
 * no se usó nunca». Por eso el contrato está escrito con valores literales en
 * `piezas/vectores.ts` y las dos ramas lo afirman desde su lado — esta desde el
 * lado que PUBLICA.
 *
 * Es la forma de `urgencia.paridad.test.db.ts` (#37) aplicada a la costura entre
 * dos PRs en vez de a dos funciones del mismo repo.
 */

describe("lo que el catálogo publica = lo que el lazo estampa", () => {
  test("cada pieza de un solo mensaje sale con la ref y la versión del vector", () => {
    for (const v of VECTORES_DE_MENSAJE) {
      assert.notEqual(v.direccion.clase, "plantilla", "una secuencia no es un mensaje suelto");
      const p = piezaDeUnMensaje({
        clase: v.direccion.clase as "hecho" | "acuse" | "gancho",
        id: v.direccion.id,
        rotulo: "un rótulo cualquiera",
        contenido: v.contenido,
      });
      assert.equal(p.clase, v.direccion.clase, v.nombre);
      assert.equal(p.id, v.ref, v.nombre);
      assert.equal(p.version, v.version, v.nombre);
    }
  });

  test("una secuencia publica SU versión y la de cada uno de sus pasos", () => {
    // Los dos niveles importan y son de dueños distintos: el catálogo direcciona
    // la plantilla (un paso no tiene id propio estable) y el lazo estampa el
    // paso (`12#3`). Si el catálogo no publicara la versión de cada paso, lo que
    // el lazo escribe no aparecería en ningún lado del catálogo — y el join
    // volvería a dar cero, más disimulado.
    for (const v of VECTORES_DE_SECUENCIA) {
      const p = piezaDeUnaSecuencia({
        id: v.plantillaId,
        rotulo: "Secuencia de venta",
        pasos: v.pasos.map((c, i) => ({
          orden: i + 1,
          texto: c.texto,
          mediaClase: c.archivo ? "imagen" : null,
          mediaArchivo: c.archivo ?? null,
        })),
      });
      assert.equal(p.clase, "plantilla", v.nombre);
      assert.equal(p.id, v.ref, v.nombre);
      assert.equal(p.version, v.version, v.nombre);
      assert.deepEqual(
        p.pasos?.map((paso) => paso.version),
        [...v.versionesDePaso],
        v.nombre,
      );
      // Y la dirección de cada paso es la MISMA cadena que va a `envios_wa.pieza_ref`.
      assert.deepEqual(
        p.pasos?.map((paso) => refDeDireccion({ clase: "plantilla", id: p.id, orden: paso.orden })),
        [...v.refsDePaso],
        v.nombre,
      );
    }
  });

  test("EL FLYER: cambiar la imagen cambia la versión publicada, aunque el texto no se toque", () => {
    // El bug que este test mata: el catálogo hasheaba `media_clase` —la cadena
    // "imagen"— en vez de `media_archivo`. Cambiar flyer-julio.jpg por
    // flyer-agosto-PRECIO-NUEVO.jpg dejaba la versión IDÉNTICA, mientras el ADR
    // afirmaba que «entra el texto y las referencias de media».
    //
    // Importa porque el 42 % de la secuencia de venta lleva imagen y en Goberna
    // **el precio y las fechas viven adentro de la imagen**: los resultados de
    // la oferta de julio y la de agosto se habrían sumado bajo una sola versión.
    const [julio, agosto] = VECTORES_DE_SECUENCIA;
    assert.ok(julio && agosto);
    assert.equal(julio.pasos[0]!.texto, agosto.pasos[0]!.texto, "el texto es el mismo a propósito");
    assert.notEqual(julio.version, agosto.version, "y las versiones NO pueden serlo");

    const publicar = (v: typeof julio) =>
      piezaDeUnaSecuencia({
        id: v.plantillaId,
        rotulo: "Secuencia de venta",
        pasos: v.pasos.map((c, i) => ({
          orden: i + 1,
          texto: c.texto,
          mediaClase: c.archivo ? "imagen" : null,
          mediaArchivo: c.archivo ?? null,
        })),
      }).version;
    assert.notEqual(publicar(julio), publicar(agosto));
  });

  test("las clases publicadas son el vocabulario compartido, no una lista propia", () => {
    assert.deepEqual([...CLASES_DE_PIEZA], ["plantilla", "hecho", "acuse", "gancho", "hsm"]);
  });
});
