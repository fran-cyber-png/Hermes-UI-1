import assert from "node:assert/strict";
import test from "node:test";
import {
  comoVa,
  hayQuePreocuparse,
  motivoLegible,
  type EnvioDeCorrida,
} from "./corridas.js";

const T0 = new Date("2026-08-05T20:00:00Z");
const min = (m: number) => new Date(T0.getTime() + m * 60_000);
const AHORA = min(300);

const envio = (p: Partial<EnvioDeCorrida> = {}): EnvioDeCorrida => ({
  telefono: "51900000000",
  estado: "enviado",
  creadoAt: T0,
  motivo: null,
  contestoEn: null,
  loAtendieronEn: null,
  duena: null,
  ...p,
});

test("cuenta enviados y fallidos por separado", () => {
  const c = comoVa(
    [envio(), envio(), envio({ estado: "fallido", motivo: "131049" })],
    "promo",
    AHORA,
  );
  assert.equal(c.enviados, 2);
  assert.equal(c.fallidos, 1);
});

test("EL TOPE POR USUARIO NO SE PRESENTA COMO UNA CAÍDA", () => {
  // 131049 es adaptativo, sin número publicado, y aparece en cualquier lote
  // grande. Mostrarlo como un error haría que una campaña sana se lea rota.
  assert.match(motivoLegible("(#131049) marketing limit"), /normal/);
  assert.doesNotMatch(motivoLegible("(#131049) marketing limit"), /🔴/);
});

test("los fallos que SÍ son graves se marcan", () => {
  for (const cod of ["132015", "132016", "131031"]) {
    assert.match(motivoLegible(`error ${cod}`), /🔴/, `${cod} es grave`);
  }
});

test("un motivo que no conocemos viaja crudo, recortado — nunca se traga", () => {
  const raro = motivoLegible("algo_que_meta_invento_hoy con detalle");
  assert.match(raro, /algo_que_meta_invento_hoy/);
});

test("LA TASA DE RESPUESTA VIAJA CON SU DENOMINADOR", () => {
  // Una tasa sin `n` no se puede leer: 2/3 no le gana a 180/400.
  const c = comoVa(
    [envio({ contestoEn: min(1) }), envio({ contestoEn: min(5) }), envio(), envio()],
    "promo",
    AHORA,
  );
  assert.equal(c.respondieron.n, 2);
  assert.equal(c.respondieron.de, 4);
  assert.equal(c.respondieron.pct, 50);
});

test("los fallidos NO entran al denominador de la respuesta", () => {
  // A quien no le llegó no se le puede pedir que conteste.
  const c = comoVa(
    [envio({ contestoEn: min(1) }), envio({ estado: "fallido", motivo: "131049" })],
    "promo",
    AHORA,
  );
  assert.equal(c.respondieron.de, 1, "solo los que salieron");
  assert.equal(c.respondieron.pct, 100);
});

test("🔴 SIN ATENDER se mide sobre los que CONTESTARON, no sobre el lote", () => {
  // Sobre el lote, el numero BAJARIA al mandar mas mensajes — exactamente al
  // reves de lo que significa. Los que no contestaron no esperan nada.
  const c = comoVa(
    [
      envio({ contestoEn: min(1), loAtendieronEn: min(9) }),
      envio({ contestoEn: min(2) }),
      envio(),
      envio(),
      envio(),
    ],
    "promo",
    AHORA,
  );
  assert.equal(c.sinAtender.n, 1);
  assert.equal(c.sinAtender.de, 2, "sobre los 2 que contestaron, no sobre los 5");
  assert.equal(c.sinAtender.pct, 50);
});

test("la mediana de respuesta y el pico de la primera hora", () => {
  const c = comoVa(
    [
      envio({ contestoEn: min(1) }),
      envio({ contestoEn: min(5) }),
      envio({ contestoEn: min(9) }),
      envio({ contestoEn: min(200) }),
    ],
    "promo",
    AHORA,
  );
  assert.equal(c.medianaRespuestaMin, 5);
  assert.equal(c.enLaPrimeraHora, 3);
});

test("sin ni una respuesta no hay mediana: null, nunca cero", () => {
  const c = comoVa([envio(), envio()], "promo", AHORA);
  assert.equal(c.medianaRespuestaMin, null, "un 0 diría «contestaron al instante»");
  assert.equal(c.respondieron.pct, 0);
});

test("la espera abierta más vieja se mide contra el reloj que se pasa", () => {
  const c = comoVa([envio({ contestoEn: min(60) }), envio({ contestoEn: min(120) })], "promo", AHORA);
  assert.equal(c.masViejaSinAtenderMin, 240, "la de min(60), contra AHORA=min(300)");
});

test("EN CURSO SE DERIVA DEL RELOJ, no de un estado guardado", () => {
  // Un proceso que muere deja un flag `en_curso` en true para siempre, y la
  // pantalla diria «saliendo» sobre algo cortado hace tres horas.
  const reciente = comoVa([envio({ creadoAt: min(295) })], "promo", AHORA);
  assert.equal(reciente.enCurso, true);
  const viejo = comoVa([envio({ creadoAt: min(100) })], "promo", AHORA);
  assert.equal(viejo.enCurso, false);
});

test("sin envíos no explota: todo en cero y sin fechas", () => {
  const c = comoVa([], "promo", AHORA);
  assert.equal(c.enviados, 0);
  assert.equal(c.empezo, null);
  assert.equal(c.enCurso, false);
  assert.equal(c.medianaRespuestaMin, null);
  assert.equal(c.respondieron.pct, 0, "0 de 0 es 0, no NaN");
});

test("el desglose por dueña, ordenado por volumen", () => {
  const c = comoVa(
    [
      envio({ duena: "luz", contestoEn: min(1) }),
      envio({ duena: "luz" }),
      envio({ duena: "luz", contestoEn: min(2), loAtendieronEn: min(5) }),
      envio({ duena: "ventas10@grupogoberna.com", contestoEn: min(3) }),
      envio({ duena: null }),
    ],
    "promo",
    AHORA,
  );
  assert.equal(c.porDuena[0].duena, "luz");
  assert.equal(c.porDuena[0].enviados, 3);
  assert.equal(c.porDuena[0].respondieron, 2);
  assert.equal(c.porDuena[0].sinAtender, 1);
  assert.equal(c.porDuena.length, 2, "sin dueña no arma un grupo");
});

test("LA ALARMA: una plantilla pausada le gana a todo", () => {
  const c = comoVa(
    [envio({ estado: "fallido", motivo: "error 132015 paused" }), envio({ contestoEn: min(1) })],
    "promo",
    AHORA,
  );
  assert.match(hayQuePreocuparse(c)!, /PAUSADA/);
});

test("LA ALARMA: gente esperando hace más de una hora", () => {
  const c = comoVa([envio({ contestoEn: min(60) })], "promo", AHORA);
  assert.match(hayQuePreocuparse(c)!, /nadie las atendió/);
});

test("una campaña sana no dispara ninguna alarma", () => {
  const c = comoVa(
    [
      envio({ contestoEn: min(1), loAtendieronEn: min(5) }),
      envio({ estado: "fallido", motivo: "131049" }),
      envio(),
    ],
    "promo",
    AHORA,
  );
  assert.equal(hayQuePreocuparse(c), null, "el tope por usuario no es una alarma");
});

test("alguien que contestó recién NO dispara la alarma todavía", () => {
  const c = comoVa([envio({ contestoEn: min(280) })], "promo", AHORA);
  assert.equal(hayQuePreocuparse(c), null, "20 minutos es tiempo razonable");
});

test("🔴 EL CONTESTADOR DE OTRO NEGOCIO NO CUENTA COMO RESPUESTA", () => {
  // Medido el 5-ago-2026: 5 de 13 «respuestas» eran el WhatsApp Business de
  // otras empresas. Contarlas inflaba la tasa Y mandaba a una vendedora a
  // atender el saludo automático de un taller mecánico.
  const c = comoVa(
    [
      envio({ contestoEn: min(1), textoDeRespuesta: "Quiero el paquete" }),
      envio({ contestoEn: min(2), textoDeRespuesta: "Gracias por comunicarte con JM RUSH AUTOMOTRIZ" }),
      envio({ contestoEn: min(3), textoDeRespuesta: "¡Hola! Gracias por contactar a Reynaldo Marketing" }),
      envio(),
    ],
    "promo",
    AHORA,
  );
  assert.equal(c.respondieron.n, 1, "una sola persona");
  assert.equal(c.autoRespuestas, 2, "los dos bots se cuentan APARTE");
  assert.equal(c.sinAtender.de, 1, "y no engordan la lista de tareas");
});

test("los bots se DICEN, no se esconden", () => {
  // Esconderlos del todo sería la otra forma de mentir: quien mira tiene que
  // poder enterarse de que hay negocios en la lista.
  const c = comoVa(
    [envio({ contestoEn: min(1), textoDeRespuesta: "Gracias por comunicarte con ACME" })],
    "promo",
    AHORA,
  );
  assert.equal(c.autoRespuestas, 1);
  assert.equal(c.respondieron.n, 0);
});

test("sin texto se asume PERSONA: el sesgo va al falso negativo", () => {
  // Esconder a alguien real cuesta un lead que nadie va a buscar.
  const c = comoVa([envio({ contestoEn: min(1), textoDeRespuesta: null })], "promo", AHORA);
  assert.equal(c.respondieron.n, 1);
  assert.equal(c.autoRespuestas, 0);
});
