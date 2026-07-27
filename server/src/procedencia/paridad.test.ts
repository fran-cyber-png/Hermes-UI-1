import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLASES_DE_PIEZA } from "../piezas/direccion.js";
import { VECTORES_DE_MENSAJE, VECTORES_DE_SECUENCIA } from "../piezas/vectores.js";
import { columnasDeProcedencia, deUnAcuse, deUnDato, deUnPasoDePlantilla } from "./pieza.js";

/**
 * QUE LO QUE SE ESTAMPA SEA LO QUE EL CATÁLOGO PUBLICA.
 *
 * El valor de todo este frente está en un join: Ivi recomienda
 * `hecho:cuotas@sha256:…`, y para saber si esa pieza funcionó hay que
 * encontrarla en `envios_wa`. **Si las dos puntas no escriben exactamente lo
 * mismo, el join da cero filas y nadie se entera** — se lee como «esa pieza no
 * se usó nunca», que es la conclusión falsa que #169 existe para no sacar.
 *
 * Y eso no lo atrapa ningún test de los dos lados por separado: cada suite queda
 * verde con su propio vocabulario. Por eso el contrato está escrito con valores
 * literales en `piezas/vectores.ts`, y las dos ramas lo afirman desde su lado —
 * esta lo hace desde el lado que ESTAMPA. Si alguien le cambia la receta al lazo,
 * se cae acá, en su rama, y no meses después en un reporte que nadie sabe leer.
 *
 * Es la forma de `urgencia.paridad.test.db.ts` (#37) aplicada a la costura entre
 * dos PRs en vez de a dos funciones del mismo repo.
 */

const AQUI = fileURLToPath(new URL(".", import.meta.url));

describe("lo que el lazo estampa = lo que el catálogo publica", () => {
  test("un dato recomendado se estampa `hecho:<clave>` con la versión del vector", () => {
    const v = VECTORES_DE_MENSAJE.find((x) => x.direccion.clase === "hecho" && x.contenido.texto);
    assert.ok(v, "hace falta un vector de hecho");
    const p = deUnDato({ clave: v.direccion.id, editada: false, contenido: v.contenido });
    assert.equal(p.clase, v.direccion.clase);
    assert.equal(p.ref, v.ref);
    assert.equal(p.version, v.version);
  });

  test("un acuse se estampa `acuse:<slug>` con la versión del vector", () => {
    const v = VECTORES_DE_MENSAJE.find((x) => x.direccion.clase === "acuse");
    assert.ok(v, "hace falta un vector de acuse");
    const p = deUnAcuse({ plantillaId: v.direccion.id, contenido: v.contenido });
    assert.equal(p.clase, v.direccion.clase);
    assert.equal(p.ref, v.ref);
    assert.equal(p.version, v.version);
  });

  test("cada paso de una secuencia se estampa `plantilla:<id>#<orden>` con SU versión", () => {
    for (const v of VECTORES_DE_SECUENCIA) {
      v.pasos.forEach((contenido, i) => {
        const p = deUnPasoDePlantilla({
          plantillaId: Number(v.plantillaId),
          orden: i + 1,
          via: "panel-secuencias",
          contenido,
        });
        assert.equal(p.clase, "plantilla", v.nombre);
        assert.equal(p.ref, v.refsDePaso[i], v.nombre);
        assert.equal(p.version, v.versionesDePaso[i], `${v.nombre} · paso ${i + 1}`);
      });
    }
  });

  test("y eso es lo que termina en las columnas de `envios_wa`, sin retoques", () => {
    const v = VECTORES_DE_SECUENCIA[0];
    assert.ok(v);
    const cols = columnasDeProcedencia(
      deUnPasoDePlantilla({
        plantillaId: Number(v.plantillaId),
        orden: 1,
        via: "panel-secuencias",
        contenido: v.pasos[0]!,
      }),
    );
    assert.equal(cols.piezaClase, "plantilla");
    assert.equal(cols.piezaRef, v.refsDePaso[0]);
    assert.equal(cols.piezaVersion, v.versionesDePaso[0]);
  });

  test("EL FLYER: cambiarlo cambia la versión estampada, aunque el texto no se toque", () => {
    // El 42 % de la secuencia de venta lleva imagen, y en Goberna el precio y las
    // fechas viven ADENTRO de la imagen. Si `flyer-julio.jpg` y
    // `flyer-agosto-PRECIO-NUEVO.jpg` compartieran versión, los resultados de dos
    // ofertas distintas se sumarían y el promedio escondería la que funcionó.
    const [julio, agosto] = VECTORES_DE_SECUENCIA;
    assert.ok(julio && agosto);
    assert.equal(julio.pasos[0]!.texto, agosto.pasos[0]!.texto, "el texto es el mismo a propósito");
    assert.notEqual(julio.versionesDePaso[0], agosto.versionesDePaso[0]);

    const estampada = (contenido: { texto: string | null; archivo?: string | null }) =>
      deUnPasoDePlantilla({ plantillaId: 12, orden: 1, via: "panel-secuencias", contenido }).version;
    assert.notEqual(estampada(julio.pasos[0]!), estampada(agosto.pasos[0]!));
  });
});

describe("el front declara el mismo vocabulario", () => {
  test("las clases que la pantalla puede declarar existen del lado del server", () => {
    // El front no importa código del server, así que `CLASES_DECLARABLES` es una
    // copia a mano. Una copia que nadie verifica es la desincronización
    // silenciosa de siempre: la pantalla mandaría `clase: 'dato'`, el server la
    // descartaría por desconocida y el envío caería a la línea de base — sin
    // error, sin log, con la pieza perdida.
    const ruta = join(AQUI, "..", "..", "..", "src", "features", "whatsapp", "procedenciaComposer.ts");
    const fuente = readFileSync(ruta, "utf8");
    const bloque = /export const CLASES_DECLARABLES = \[([^\]]*)\] as const;/.exec(fuente);
    assert.ok(bloque, "no encontré CLASES_DECLARABLES en el front");

    const declaradas = [...bloque[1]!.matchAll(/'([a-z-]+)'/g)].map((m) => m[1] as string);
    assert.ok(declaradas.length > 0, "la lista del front quedó vacía");
    for (const c of declaradas) {
      assert.ok(
        (CLASES_DE_PIEZA as readonly string[]).includes(c),
        `el front declara «${c}», que no es una clase de pieza del server`,
      );
    }
  });
});
