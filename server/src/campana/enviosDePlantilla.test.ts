import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { A_MANO, deUnaCampana, deUnDato } from "../procedencia/pieza.js";
import { agregar } from "../resultados/agregar.js";
import type { HechosDeUnEnvio } from "../resultados/loQuePaso.js";
import { agregarPorPlantilla, type IntentosPorPlantilla } from "./enviosDePlantilla.js";

const HORA = new Date("2026-08-05T15:00:00Z");
/** Lo que `contarIntentos` trae de la base: el universo, sin el filtro del seam. */
const intentos = (
  filas: Record<string, { salieron: number; noSalieron?: number }>,
): IntentosPorPlantilla =>
  new Map(
    Object.entries(filas).map(([nombre, f]) => [
      nombre,
      { salieron: f.salieron, noSalieron: f.noSalieron ?? 0, primero: HORA, ultimo: HORA },
    ]),
  );

const SALIO = new Date("2026-08-05T15:00:00Z");
const mas = (min: number) => new Date(SALIO.getTime() + min * 60_000);

let siguiente = 1;
const envio = (over: Partial<HechosDeUnEnvio> = {}): HechosDeUnEnvio => ({
  envioId: siguiente++,
  clave: `conv:whatsapp:5190000${siguiente}:51984429504`,
  vendedoraId: "campana",
  procedencia: A_MANO,
  texto: "hola",
  salioEn: SALIO,
  primerEntranteEn: null,
  siguienteEnvioEn: null,
  etapaAntes: null,
  etapasDespues: [],
  ventaEn: null,
  seSabeDeVentas: true,
  ...over,
});

const FORO = (texto = "Te invitamos al XII Foro de Estado") =>
  deUnaCampana({ nombre: "foro_estado_5_ago", contenido: { texto } });
const PROMO = () => deUnaCampana({ nombre: "promo_3x1_cursos", contenido: { texto: "3x1" } });

describe("los envíos de una plantilla", () => {
  test("agrupa por NOMBRE de plantilla y la proporción viaja con su n", () => {
    const r = agregarPorPlantilla([
      envio({ procedencia: FORO(), primerEntranteEn: mas(10) }),
      envio({ procedencia: FORO(), primerEntranteEn: mas(30) }),
      envio({ procedencia: FORO() }),
      envio({ procedencia: FORO() }),
    ], intentos({ foro_estado_5_ago: { salieron: 4 } }));

    const foro = r.plantillas.find((p) => p.plantilla === "foro_estado_5_ago")!;
    assert.equal(foro.medibles, 4);
    assert.equal(foro.salieron, 4);
    assert.equal(foro.respondieron.exitos, 2);
    assert.equal(foro.respondieron.n, 4, "un porcentaje sin su n no se puede leer");
    assert.equal(foro.medianaMinutosHastaLaRespuesta, 20);
  });

  /**
   * EL ROLLUP ES LO QUE ESTE MÓDULO AGREGA, y es su única diferencia con
   * `agregar()`: dos textos bajo el mismo nombre son UNA plantilla para la
   * pregunta «¿cuánto se mandó?», y dos filas para «¿qué texto funcionó mejor?».
   */
  test("SUMA las versiones de una misma plantilla, y dice cuántas eran", () => {
    const r = agregarPorPlantilla([
      envio({ procedencia: FORO("texto viejo"), primerEntranteEn: mas(5) }),
      envio({ procedencia: FORO("texto nuevo") }),
      envio({ procedencia: FORO("texto nuevo") }),
    ], intentos({ foro_estado_5_ago: { salieron: 3 } }));

    const foro = r.plantillas[0];
    assert.equal(foro.salieron, 3, "las dos versiones son la misma plantilla");
    assert.equal(foro.versiones, 2, "y la pantalla tiene que poder decirlo");
    // El mismo corpus, agrupado por versión, da DOS filas: es lo que este
    // módulo suma a propósito y `agregar()` se niega a sumar.
    const porVersion = agregar([
      envio({ procedencia: FORO("texto viejo") }),
      envio({ procedencia: FORO("texto nuevo") }),
    ]).filas.filter((f) => !f.esLineaDeBase);
    assert.equal(porVersion.length, 2);
  });

  test("una versión desconocida NO cuenta como un texto", () => {
    // `version: null` es «no se pudo determinar qué texto era». Contarlo diría
    // «1 texto» sobre algo que nadie sabe qué fue.
    const r = agregarPorPlantilla([
      envio({ procedencia: deUnaCampana({ nombre: "foro_estado_5_ago", contenido: null }) }),
    ]);
    assert.equal(r.plantillas[0].versiones, 0);
  });

  test("lo que no salió se dice aparte y NUNCA entra al denominador", () => {
    const r = agregarPorPlantilla(
      [envio({ procedencia: FORO(), primerEntranteEn: mas(8) })],
      intentos({ foro_estado_5_ago: { salieron: 1, noSalieron: 4 } }),
    );

    const foro = r.plantillas[0];
    assert.equal(foro.salieron, 1);
    assert.equal(foro.noSalieron, 4);
    assert.equal(
      foro.respondieron.n,
      1,
      "medir contra 5 sería contar como fracaso a cuatro mensajes que nadie recibió",
    );
  });

  test("una plantilla cuyos envíos fallaron TODOS se sigue viendo", () => {
    // Si sólo se armara desde los hechos, esta plantilla no existiría en la
    // respuesta y la pantalla diría «todavía no se mandó» de algo que se
    // intentó mil veces y no salió nunca.
    const r = agregarPorPlantilla([], intentos({ promo_3x1_cursos: { salieron: 0, noSalieron: 12 } }));
    const promo = r.plantillas.find((p) => p.plantilla === "promo_3x1_cursos")!;
    assert.equal(promo.salieron, 0);
    assert.equal(promo.noSalieron, 12);
    assert.equal(promo.respondieron.tasa, null, "0 de 0 no es 0 %, es «no hay dato»");
  });

  /**
   * 🔴 EL CASO QUE ESTE MÓDULO SE EQUIVOCÓ PRIMERO, medido en producción.
   *
   * Los 89 envíos de `promo_3x1_cursos` salieron con `referencia =
   * 'campana:promo_3x1_cursos:<tel>'`, no con una clave `conv:`, así que
   * `consultarEnvios` no los ve. Contando desde los hechos, la pantalla decía
   * «todavía no se mandó ninguna vez» sobre 88 envíos que salieron de verdad.
   */
  test("una plantilla que salió SIN conversación se cuenta igual, y se dice que no se puede medir", () => {
    const r = agregarPorPlantilla(
      [],
      intentos({ promo_3x1_cursos: { salieron: 88, noSalieron: 1 } }),
    );

    const promo = r.plantillas.find((p) => p.plantilla === "promo_3x1_cursos")!;
    assert.equal(promo.salieron, 88, "salieron, aunque el lazo de resultados no los vea");
    assert.equal(promo.noSalieron, 1);
    assert.equal(promo.medibles, 0, "de ninguno se puede saber si contestó");
    assert.equal(promo.respondieron.n, 0);
    assert.equal(promo.respondieron.tasa, null, "y eso NO es 0 % de respuesta");
  });

  test("`medibles` puede ser MENOR que `salieron`, y los dos números viajan", () => {
    // La mitad de una campaña con conversación y la otra mitad sin ella: el
    // porcentaje se mide sobre la mitad que se puede, y la pantalla tiene con
    // qué decir sobre cuántos.
    const r = agregarPorPlantilla(
      [
        envio({ procedencia: FORO(), primerEntranteEn: mas(5) }),
        envio({ procedencia: FORO() }),
      ],
      intentos({ foro_estado_5_ago: { salieron: 10 } }),
    );

    const foro = r.plantillas[0];
    assert.equal(foro.salieron, 10);
    assert.equal(foro.medibles, 2);
    assert.equal(foro.respondieron.n, 2, "el denominador es lo medible, nunca lo que salió");
  });

  test("se ordena por MUESTRA, no por tasa", () => {
    const r = agregarPorPlantilla([
      envio({ procedencia: PROMO(), primerEntranteEn: mas(1) }),
      ...Array.from({ length: 5 }, () => envio({ procedencia: FORO() })),
    ], intentos({ promo_3x1_cursos: { salieron: 1 }, foro_estado_5_ago: { salieron: 5 } }));
    // `promo` tiene 100 % y una sola muestra; `foro` tiene 0 % y cinco.
    assert.equal(r.plantillas[0].plantilla, "foro_estado_5_ago");
  });
});

describe("la línea de base", () => {
  test("es lo escrito a mano, en la MISMA ventana", () => {
    const r = agregarPorPlantilla([
      envio({ procedencia: FORO() }),
      envio({ procedencia: A_MANO, primerEntranteEn: mas(4) }),
      envio({ procedencia: A_MANO }),
    ]);
    assert.equal(r.lineaDeBase?.envios, 2);
    assert.equal(r.lineaDeBase?.respondieron.exitos, 1);
  });

  test("sin un solo envío a mano es `null`, y eso NO es 0 %", () => {
    const r = agregarPorPlantilla([envio({ procedencia: FORO() })]);
    assert.equal(r.lineaDeBase, null, "«no hay con qué comparar» no se dibuja como una base de 0 %");
  });

  test("lo que no es HSM no se cuenta como plantilla ni como línea de base", () => {
    // Un dato del panel es una pieza y no es una campaña: contarlo acá metería
    // los envíos de la conversación uno a uno adentro del total de una campaña.
    const r = agregarPorPlantilla([
      envio({
        procedencia: deUnDato({ clave: "cuotas", editada: false, contenido: { texto: "en 2 cuotas" } }),
      }),
      envio({ procedencia: FORO() }),
    ]);
    assert.equal(r.plantillas.length, 1);
    assert.equal(r.lineaDeBase, null);
  });
});

/**
 * EL CANDADO: este módulo agrupa distinto, pero NO puede contar distinto.
 *
 * Es la misma clase de test que `entrega/paridad.test.ts` y
 * `consultarResultados.test.db.ts`: sobre los mismos hechos, dos caminos tienen
 * que dar el mismo total. Si alguien "optimiza" esto metiendo la cuenta en un
 * `GROUP BY` de SQL, o cambia el criterio de qué envío entra, acá se rompe.
 */
describe("paridad con el reporte por pieza", () => {
  test("la suma de envíos es la misma que la de agregar()", () => {
    const hechos = [
      envio({ procedencia: FORO("uno"), primerEntranteEn: mas(3) }),
      envio({ procedencia: FORO("dos") }),
      envio({ procedencia: FORO("dos") }),
      envio({ procedencia: PROMO() }),
      envio({ procedencia: A_MANO, primerEntranteEn: mas(2) }),
    ];

    const mio = agregarPorPlantilla(hechos);
    const suyo = agregar(hechos);

    const enviosPorPlantilla = new Map(mio.plantillas.map((p) => [p.plantilla, p.medibles]));
    const esperado = new Map<string, number>();
    for (const f of suyo.filas) {
      if (f.esLineaDeBase) continue;
      const nombre = f.pieza.replace(/^hsm:/, "");
      esperado.set(nombre, (esperado.get(nombre) ?? 0) + f.envios);
    }
    assert.deepEqual(enviosPorPlantilla, esperado);

    // Y los que respondieron también: el veredicto es `loQuePaso` en los dos.
    const respondieronAca = mio.plantillas.reduce((s, p) => s + p.respondieron.exitos, 0);
    const respondieronAlla = suyo.filas
      .filter((f) => !f.esLineaDeBase && f.pieza.startsWith("hsm:"))
      .reduce((s, f) => s + f.respondieron.exitos, 0);
    assert.equal(respondieronAca, respondieronAlla);

    // La línea de base es la misma fila `a-mano` del otro reporte.
    const base = suyo.filas.find((f) => f.esLineaDeBase)!;
    assert.equal(mio.lineaDeBase?.envios, base.envios);
    assert.equal(mio.lineaDeBase?.respondieron.exitos, base.respondieron.exitos);
  });
});
