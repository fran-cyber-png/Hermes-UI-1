import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { A_MANO, deUnDato, deUnPasoDePlantilla } from "../procedencia/pieza.js";
import { agregar } from "./agregar.js";
import { medir } from "./medicion.js";
import type { HechosDeUnEnvio } from "./loQuePaso.js";

const SALIO = new Date("2026-07-20T10:00:00Z");
const mas = (min: number) => new Date(SALIO.getTime() + min * 60_000);

let siguiente = 1;
const envio = (over: Partial<HechosDeUnEnvio> = {}): HechosDeUnEnvio => ({
  envioId: siguiente++,
  clave: `conv:whatsapp:5190000${siguiente}:51999999999`,
  vendedoraId: "ana",
  procedencia: A_MANO,
  texto: "hola, ¿cómo estás?",
  salioEn: SALIO,
  primerEntranteEn: null,
  etapaAntes: null,
  etapasDespues: [],
  ventaEn: null,
  seSabeDeVentas: true,
  ...over,
});

const TEXTO_CUOTAS = "Se puede pagar en 2 cuotas.";
const CUOTAS = (editada = false) =>
  deUnDato({ clave: "cuotas", editada, contenido: { texto: TEXTO_CUOTAS } });
const PASO = () =>
  deUnPasoDePlantilla({
    plantillaId: 12,
    orden: 1,
    via: "panel-sugerencia",
    contenido: { texto: "hola {nombre}" },
  });

describe("el agregado cuenta por pieza, y la línea de base es una fila más", () => {
  test("agrupa por (clase, ref) y la muestra viene con cada número", () => {
    const r = agregar([
      envio({ procedencia: CUOTAS(), primerEntranteEn: mas(10) }),
      envio({ procedencia: CUOTAS(), primerEntranteEn: mas(30) }),
      envio({ procedencia: CUOTAS() }),
      envio({ procedencia: A_MANO, primerEntranteEn: mas(5) }),
    ]);

    const dato = r.filas.find((f) => f.pieza === "dato:cuotas")!;
    assert.equal(dato.envios, 3, "el tamaño de la muestra");
    assert.equal(dato.respondieron.exitos, 2);
    assert.equal(dato.respondieron.n, 3, "la proporción nunca viaja sin su n");
    assert.equal(dato.medianaMinutosHastaLaRespuesta, 20);
  });

  test("la línea de base sale PRIMERA y dice que lo es", () => {
    const r = agregar([
      envio({ procedencia: CUOTAS() }),
      envio({ procedencia: CUOTAS() }),
      envio({ procedencia: CUOTAS() }),
      envio({ procedencia: A_MANO }),
    ]);
    assert.equal(r.filas[0].clave, "a-mano");
    assert.equal(r.filas[0].esLineaDeBase, true);
    assert.equal(r.filas[0].rotulo, "escrito a mano (la línea de base)");
    // Aunque tenga MENOS envíos que la pieza: es contra ella que se compara todo.
    assert.ok(r.filas[0].envios < r.filas[1].envios);
  });

  test("el resto se ordena por MUESTRA, no por tasa", () => {
    // Ordenar por porcentaje pondría arriba a la pieza de 2/3 —la que menos
    // sabemos— justo donde la vista se posa.
    const otro = deUnDato({
      clave: "acceso-un-anio",
      editada: false,
      contenido: { texto: "El acceso lo tenés por un año." },
    });
    const r = agregar([
      ...Array.from({ length: 3 }, () => envio({ procedencia: otro, primerEntranteEn: mas(5) })),
      ...Array.from({ length: 10 }, () => envio({ procedencia: CUOTAS() })),
    ]);
    assert.equal(r.filas[0].pieza, "dato:cuotas", "10 envíos con 0 respuestas van antes que 3 con 3");
    assert.equal(r.filas[1].pieza, "dato:acceso-un-anio");
  });

  test("la MISMA pieza por dos vías es UNA fila, con el desglose de por dónde entró", () => {
    const contenido = { texto: "hola {nombre}" };
    const sugerida = deUnPasoDePlantilla({ plantillaId: 12, orden: 1, via: "panel-sugerencia", contenido });
    const elegida = deUnPasoDePlantilla({ plantillaId: 12, orden: 1, via: "panel-secuencias", contenido });
    const r = agregar([
      envio({ procedencia: sugerida }),
      envio({ procedencia: sugerida }),
      envio({ procedencia: elegida }),
    ]);

    const fila = r.filas.find((f) => f.pieza === "paso:12#1")!;
    assert.equal(fila.envios, 3, "una sola pieza: la 12 es la 12 venga de donde venga");
    assert.deepEqual(fila.porVia, [
      { via: "panel-sugerencia", envios: 2 },
      { via: "panel-secuencias", envios: 1 },
    ]);
  });

  test("los editados se cuentan aparte: lo que salió no era del todo la pieza", () => {
    const r = agregar([
      envio({ procedencia: CUOTAS(true) }),
      envio({ procedencia: CUOTAS() }),
    ]);
    const fila = r.filas.find((f) => f.pieza === "dato:cuotas")!;
    assert.equal(fila.envios, 2);
    assert.equal(fila.editados, 1);
  });
});

describe("LA VERSIÓN separa las filas — el blanco deja de moverse", () => {
  test("dos textos de la misma pieza son DOS filas, no un promedio que los tapa", () => {
    // El escenario exacto del riesgo: una pieza que rendía poco y mejoró mucho.
    // Agrupada sin versión daría ~21 % y nadie vería que el cambio funcionó.
    const vieja = deUnDato({ clave: "cuotas", editada: false, contenido: { texto: "Se paga en 2." } });
    const nueva = deUnDato({
      clave: "cuotas",
      editada: false,
      contenido: { texto: "El pago va en 2 cuotas: una reserva tu lugar." },
    });

    const r = agregar([
      // vieja: 1 de 4 contestó
      envio({ procedencia: vieja, primerEntranteEn: mas(10) }),
      envio({ procedencia: vieja }),
      envio({ procedencia: vieja }),
      envio({ procedencia: vieja }),
      // nueva: 3 de 4
      envio({ procedencia: nueva, primerEntranteEn: mas(10) }),
      envio({ procedencia: nueva, primerEntranteEn: mas(10) }),
      envio({ procedencia: nueva, primerEntranteEn: mas(10) }),
      envio({ procedencia: nueva }),
    ]);

    const deCuotas = r.filas.filter((f) => f.pieza === "dato:cuotas");
    assert.equal(deCuotas.length, 2, "una fila por versión");
    assert.deepEqual(
      deCuotas.map((f) => `${f.respondieron.exitos}/${f.respondieron.n}`).sort(),
      ["1/4", "3/4"],
      "los dos textos NO se promedian en un 50 % que esconde la mejora",
    );
    // Y las dos filas dicen a qué pieza pertenecen, para poder sumarlas a propósito.
    assert.deepEqual([...new Set(deCuotas.map((f) => f.pieza))], ["dato:cuotas"]);
    assert.notEqual(deCuotas[0].version, deCuotas[1].version);
  });

  test("las versiones de una pieza salen JUNTAS y en orden de primer uso", () => {
    // El hash no da orden; `primerUso` sí — y sin orden no se puede leer «la
    // que vino después funcionó mejor».
    const v1 = deUnDato({ clave: "cuotas", editada: false, contenido: { texto: "texto viejo" } });
    const v2 = deUnDato({ clave: "cuotas", editada: false, contenido: { texto: "texto nuevo" } });
    const otra = deUnDato({ clave: "acceso", editada: false, contenido: { texto: "un año" } });

    const r = agregar([
      envio({ procedencia: v2, salioEn: mas(1000) }),
      envio({ procedencia: otra }),
      envio({ procedencia: v1, salioEn: SALIO }),
      envio({ procedencia: v1, salioEn: SALIO }),
    ]);

    const piezas = r.filas.map((f) => f.pieza);
    assert.deepEqual(piezas, ["dato:cuotas", "dato:cuotas", "dato:acceso"], "juntas y por volumen");
    assert.ok(r.filas[0].primerUso < r.filas[1].primerUso, "la vieja primero");
  });

  test("una fila sin versión conocida no se mezcla con una versionada", () => {
    const sinVersion = deUnDato({ clave: "cuotas", editada: false, contenido: null });
    const conVersion = deUnDato({ clave: "cuotas", editada: false, contenido: { texto: "algo" } });
    const r = agregar([envio({ procedencia: sinVersion }), envio({ procedencia: conVersion })]);
    assert.equal(r.filas.filter((f) => f.pieza === "dato:cuotas").length, 2);
    assert.ok(r.filas.some((f) => f.clave.endsWith("@sin-versión")));
  });
});

describe("«no lo sabemos» no se dibuja como «cero»", () => {
  test("sin atribución de ventas, la columna entera es null — no 0 %", () => {
    const r = agregar([
      envio({ procedencia: CUOTAS(), seSabeDeVentas: false }),
      envio({ procedencia: A_MANO, seSabeDeVentas: false }),
    ]);
    assert.equal(r.seSabeDeVentas, false);
    for (const f of r.filas) assert.equal(f.ventasDespues, null);
  });

  test("con atribución, una pieza sin ventas SÍ dice 0 de N — y eso es un dato", () => {
    const r = agregar([envio({ procedencia: CUOTAS() }), envio({ procedencia: CUOTAS() })]);
    const fila = r.filas.find((f) => f.pieza === "dato:cuotas")!;
    assert.equal(r.seSabeDeVentas, true);
    assert.equal(fila.ventasDespues!.exitos, 0);
    assert.equal(fila.ventasDespues!.n, 2);
    assert.equal(fila.ventasDespues!.tasa, 0);
  });

  test("una venta posterior cuenta para la pieza que la precedió", () => {
    const r = agregar([
      envio({ procedencia: PASO(), ventaEn: mas(2 * 24 * 60) }),
      envio({ procedencia: PASO() }),
    ]);
    const fila = r.filas.find((f) => f.pieza === "paso:12#1")!;
    assert.equal(fila.ventasDespues!.exitos, 1);
    assert.equal(fila.ventasDespues!.n, 2);
  });
});

describe("sin envíos no se inventa una tabla", () => {
  test("cero envíos: cero filas, y el total lo dice", () => {
    const r = agregar([]);
    assert.equal(r.envios, 0);
    assert.deepEqual(r.filas, []);
    assert.equal(r.seSabeDeVentas, false);
  });
});
