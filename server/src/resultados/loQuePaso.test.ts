import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { A_MANO, deUnDato, deUnPasoDePlantilla } from "../procedencia/pieza.js";
import { loQuePaso, VENTANAS_POR_DEFECTO, type HechosDeUnEnvio } from "./loQuePaso.js";

const SALIO = new Date("2026-07-20T10:00:00Z");
const mas = (min: number) => new Date(SALIO.getTime() + min * 60_000);

/** Una gestión asentada N minutos después del envío (60 por defecto: bien adentro). */
const gestion = (etapa: string, min = 60) => ({ etapa, cuando: mas(min) });

const CUOTAS = () =>
  deUnDato({ clave: "cuotas", editada: false, contenido: { texto: "Se puede en 2 cuotas." } });

const hechos = (over: Partial<HechosDeUnEnvio> = {}): HechosDeUnEnvio => ({
  envioId: 1,
  clave: "conv:whatsapp:51900000000:51999999999",
  vendedoraId: "ana",
  procedencia: CUOTAS(),
  texto: "El pago se puede hacer en 2 cuotas.",
  salioEn: SALIO,
  primerEntranteEn: null,
  siguienteEnvioEn: null,
  etapaAntes: null,
  etapasDespues: [],
  ventaEn: null,
  seSabeDeVentas: true,
  ...over,
});

describe("¿contestó, y en cuánto?", () => {
  test("contestó a los 12 minutos: hubo respuesta, y se dice cuánto tardó", () => {
    const v = loQuePaso(hechos({ primerEntranteEn: mas(12) }));
    assert.equal(v.huboRespuesta, true);
    assert.equal(v.minutosHastaLaRespuesta, 12);
  });

  test("no contestó: `false` y sin demora — no un cero que se lea como «instantáneo»", () => {
    const v = loQuePaso(hechos());
    assert.equal(v.huboRespuesta, false);
    assert.equal(v.minutosHastaLaRespuesta, null);
  });

  test("contestó DESPUÉS de la ventana: no cuenta, y tampoco se reporta la demora", () => {
    // A los 5 días es una respuesta, pero atribuírsela a este mensaje sería
    // inventar una causa.
    const v = loQuePaso(hechos({ primerEntranteEn: mas(5 * 24 * 60) }));
    assert.equal(v.huboRespuesta, false);
    assert.equal(v.minutosHastaLaRespuesta, null);
  });

  test("justo en el borde de la ventana SÍ cuenta", () => {
    const v = loQuePaso(hechos({ primerEntranteEn: mas(VENTANAS_POR_DEFECTO.horas * 60) }));
    assert.equal(v.huboRespuesta, true);
  });

  test("un entrante ANTERIOR al envío no es una respuesta a este envío", () => {
    const v = loQuePaso(hechos({ primerEntranteEn: new Date(SALIO.getTime() - 60_000) }));
    assert.equal(v.huboRespuesta, false);
  });
});

/**
 * LA REGLA DEL ÚLTIMO MENSAJE — el bug que encontró el corpus sintético.
 *
 * Con la forma de los datos reales (conversaciones de hasta cuatro salientes
 * espaciados dos horas), la tasa SEMBRADA era 22 % y el reporte imprimía 54 %:
 * la misma respuesta se le acreditaba a los cuatro mensajes anteriores. Y el
 * inflado no es parejo —crece con cuántos mensajes tuvo la conversación, que es
 * justo lo que correlaciona con la gente que ya iba a contestar—, así que
 * premia a las piezas usadas en conversaciones largas.
 */
describe("una respuesta es de UN mensaje, no de todos los anteriores", () => {
  test("si le escribimos otra cosa antes de que contestara, la respuesta NO es de este envío", () => {
    const v = loQuePaso(
      hechos({
        siguienteEnvioEn: mas(120), // le mandamos otra cosa a las 2 h
        primerEntranteEn: mas(180), // ella contestó a las 3 h
      }),
    );
    assert.equal(v.huboRespuesta, false, "esa respuesta es del mensaje de las 2 h, no de este");
    assert.equal(v.minutosHastaLaRespuesta, null);
  });

  test("el ÚLTIMO mensaje antes de la respuesta SÍ se la lleva", () => {
    const v = loQuePaso(
      hechos({
        siguienteEnvioEn: null, // no le escribimos nada más
        primerEntranteEn: mas(180),
      }),
    );
    assert.equal(v.huboRespuesta, true);
    assert.equal(v.minutosHastaLaRespuesta, 180);
  });

  test("si el siguiente envío salió DESPUÉS de que contestó, la respuesta sigue siendo de este", () => {
    // El caso normal de una conversación viva: mandamos, contesta, y recién
    // entonces le respondemos. Ese segundo envío no le saca el mérito al primero.
    const v = loQuePaso(
      hechos({
        primerEntranteEn: mas(30),
        siguienteEnvioEn: mas(45),
      }),
    );
    assert.equal(v.huboRespuesta, true);
  });

  test("en una secuencia, los pasos del medio no cobran la respuesta del final", () => {
    // Cuatro pasos a 90 s uno del otro y una respuesta a la media hora: la gana
    // el paso 4. No se puede saber cuál de los cuatro la ganó de verdad, y
    // atribuírsela al último es la única regla que no cuenta de más.
    const paso1 = loQuePaso(hechos({ siguienteEnvioEn: mas(1.5), primerEntranteEn: mas(30) }));
    const paso4 = loQuePaso(hechos({ siguienteEnvioEn: null, primerEntranteEn: mas(30) }));
    assert.equal(paso1.huboRespuesta, false);
    assert.equal(paso4.huboRespuesta, true);
  });
});

describe("¿avanzó de etapa?", () => {
  test("estaba en contactado y alguien asentó cotizado: avanzó", () => {
    const v = loQuePaso(hechos({ etapaAntes: "contactado", etapasDespues: [gestion("cotizado")] }));
    assert.equal(v.huboAvanceDeEtapa, true);
  });

  test("sin gestión previa, cualquier etapa asentada después es un avance", () => {
    const v = loQuePaso(hechos({ etapaAntes: null, etapasDespues: [gestion("interesado")] }));
    assert.equal(v.huboAvanceDeEtapa, true);
  });

  test("volvió a asentar la MISMA etapa: eso no es avanzar", () => {
    const v = loQuePaso(hechos({ etapaAntes: "cotizado", etapasDespues: [gestion("cotizado")] }));
    assert.equal(v.huboAvanceDeEtapa, false);
  });

  test("retrocedió: tampoco es avanzar", () => {
    const v = loQuePaso(hechos({ etapaAntes: "cierre", etapasDespues: [gestion("contactado")] }));
    assert.equal(v.huboAvanceDeEtapa, false);
  });

  test("«perdido» NO es un avance — es la salida, y se cuenta aparte", () => {
    // El contrapeso honesto: una pieza detrás de la cual la gente se declara
    // perdida no puede aparecer neutra.
    const v = loQuePaso(hechos({ etapaAntes: "contactado", etapasDespues: [gestion("perdido")] }));
    assert.equal(v.huboAvanceDeEtapa, false);
    assert.equal(v.seDeclaroPerdida, true);
  });

  test("los valores viejos se normalizan: 'venta' es cierre y sí es un avance", () => {
    const v = loQuePaso(hechos({ etapaAntes: "cotizado", etapasDespues: [gestion("venta")] }));
    assert.equal(v.huboAvanceDeEtapa, true);
  });

  test("varias gestiones después: alcanza con que UNA haya avanzado", () => {
    const v = loQuePaso(
      hechos({
        etapaAntes: "interesado",
        etapasDespues: [gestion("interesado", 10), gestion("cotizado", 90)],
      }),
    );
    assert.equal(v.huboAvanceDeEtapa, true);
  });

  test("una gestión FUERA de la ventana no cuenta — y la ventana la aplica esta función, no el SQL", () => {
    // Es lo que permite que la consulta no tenga ni un umbral: trae todo con su
    // fecha, y la única regla vive acá.
    const v = loQuePaso(
      hechos({ etapaAntes: "interesado", etapasDespues: [gestion("cierre", 10 * 24 * 60)] }),
    );
    assert.equal(v.huboAvanceDeEtapa, false);
  });
});

describe("¿compró? — y la diferencia entre «no» y «no sabemos»", () => {
  test("con atribución conectada y venta dentro de la ventana: sí", () => {
    const v = loQuePaso(hechos({ ventaEn: mas(3 * 24 * 60) }));
    assert.equal(v.huboVentaDespues, true);
    assert.equal(v.minutosHastaLaVenta, 3 * 24 * 60);
  });

  test("con atribución conectada y sin venta: `false` — es un NO de verdad", () => {
    assert.equal(loQuePaso(hechos()).huboVentaDespues, false);
  });

  test("SIN atribución conectada: `null`, nunca `false`", () => {
    // Es la degradación honesta mientras el PR #165 no esté: decir «no compró»
    // sobre 6.800 ventas que existen y no sabemos ligar sería la peor mentira
    // que este módulo puede contar.
    const v = loQuePaso(hechos({ seSabeDeVentas: false, ventaEn: mas(60) }));
    assert.equal(v.huboVentaDespues, null);
    assert.equal(v.minutosHastaLaVenta, null);
  });

  test("la venta usa SU ventana, no la de la respuesta: a los 6 días todavía cuenta", () => {
    // Con una sola ventana habría que elegir entre descartar casi todas las
    // compras reales o acreditarle a este mensaje un «hola» de la otra semana.
    const v = loQuePaso(hechos({ ventaEn: mas(6 * 24 * 60) }));
    assert.equal(v.huboVentaDespues, true);
  });

  test("una venta MUY posterior tampoco: la ventana de venta también tiene tope", () => {
    const v = loQuePaso(hechos({ ventaEn: mas(60 * 24 * 60) }));
    assert.equal(v.huboVentaDespues, false);
  });
});

describe("la procedencia viaja con el veredicto", () => {
  test("un envío a mano se juzga con la MISMA regla que una pieza", () => {
    // La línea de base no es un caso especial del cálculo: es una fila más,
    // medida igual. Si se midiera distinto, la comparación no valdría nada.
    const conPieza = loQuePaso(
      hechos({
        procedencia: deUnPasoDePlantilla({
          plantillaId: 1,
          orden: 1,
          via: "panel-secuencias",
          contenido: { texto: "hola {nombre}" },
        }),
        primerEntranteEn: mas(30),
      }),
    );
    const aMano = loQuePaso(hechos({ procedencia: A_MANO, primerEntranteEn: mas(30) }));
    assert.deepEqual(conPieza, aMano);
  });
});
