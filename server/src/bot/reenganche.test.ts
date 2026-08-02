import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ESPERA_MAXIMA_H,
  ESPERA_MINIMA_H,
  MOTIVO_REENGANCHE,
  TEXTO_REENGANCHE,
  VENTANA_DE_CONSULTA_H,
  VENTANA_SERVICIO_H,
  ZONA,
  decidirReenganche,
  esHoraDeReenganche,
  horasDesde,
  inicioDelDiaLocal,
  laPelotaEsNuestra,
  pusoUnaFecha,
  ventanaDeServicioAbierta,
  type HechosDelReenganche,
  type MotivoNoReenganche,
} from "./reenganche.js";
import { validarSalida } from "./guardrails.js";
import { trocear } from "./chunker.js";
import { horaLocal } from "../autorespuesta/franja.js";

const VENTANA = { followupHoraDesde: 9, followupHoraHasta: 20 };
/** 1-ago-2026, 15:00 en Lima (UTC-5). Media tarde: adentro del horario. */
const AHORA = new Date("2026-08-01T20:00:00Z");
const H = 3600_000;
const haceH = (h: number) => new Date(AHORA.getTime() - h * H);

function hechos(p: Partial<HechosDelReenganche> = {}): HechosDelReenganche {
  return {
    clave: "conv:whatsapp:51999888777:51984429504",
    telefono: "51999888777",
    // El caso base ES el caso del doc: le mandamos el material hace 5 horas y
    // no volvió a escribir.
    ultimoSalienteEn: haceH(5),
    // El caso base: el último saliente fue del BOT, no de una persona.
    ultimoSalienteHumanoEn: null,
    ultimoEntranteEn: haceH(5.2),
    recibioElMaterial: true,
    textosDelLead: ["quiero información del diploma"],
    tienePausa: false,
    yaHuboReenganche: false,
    ...p,
  };
}

const motivo = (h: HechosDelReenganche, ahora = AHORA): MotivoNoReenganche | "manda" => {
  const v = decidirReenganche(h, ahora, VENTANA);
  return v.manda ? "manda" : v.motivo;
};

describe("decidirReenganche — los 38 leads que recibieron el material y se callaron", () => {
  test("el caso del doc: material recibido, 5 horas de silencio, la pelota es nuestra", () => {
    assert.equal(motivo(hechos()), "manda");
  });

  test("una sola vez, para siempre: dos reenganches son acoso", () => {
    assert.equal(motivo(hechos({ yaHuboReenganche: true })), "ya_hubo_reenganche");
  });

  test("quien dijo que no, se despidió o fue escalado tiene pausa y no se toca", () => {
    assert.equal(motivo(hechos({ tienePausa: true })), "pausada");
  });

  test("sin material no es reenganche: es empezar de cero", () => {
    assert.equal(motivo(hechos({ recibioElMaterial: false })), "sin_material");
  });

  test("si él escribió último NO es reenganche: es una respuesta que debemos", () => {
    assert.equal(
      motivo(hechos({ ultimoSalienteEn: haceH(5), ultimoEntranteEn: haceH(4) })),
      "la_pelota_es_suya",
    );
  });

  test("el empate cuenta como nuestra: el pipeline normal ya lo habría tomado", () => {
    const t = haceH(5);
    assert.equal(motivo(hechos({ ultimoSalienteEn: t, ultimoEntranteEn: t })), "manda");
  });

  test("antes de dos horas todavía lo está leyendo", () => {
    assert.equal(
      motivo(hechos({ ultimoSalienteEn: haceH(ESPERA_MINIMA_H - 0.1) })),
      "demasiado_pronto",
    );
  });

  test("a las dos horas justas ya entra", () => {
    assert.equal(motivo(hechos({ ultimoSalienteEn: haceH(ESPERA_MINIMA_H) })), "manda");
  });

  test("pasadas las 20 h no sale: la ventana de WhatsApp está por cerrarse", () => {
    assert.equal(
      motivo(
        hechos({
          ultimoSalienteEn: haceH(ESPERA_MAXIMA_H + 0.5),
          ultimoEntranteEn: haceH(ESPERA_MAXIMA_H + 0.6),
        }),
      ),
      "demasiado_tarde",
    );
  });

  test("nunca le hablamos: no hay nada que retomar", () => {
    assert.equal(motivo(hechos({ ultimoSalienteEn: null })), "nunca_le_hablamos");
  });

  test("a las 3 de la mañana no sale nada, aunque todo lo demás califique", () => {
    // 08:00 UTC = 03:00 en Lima.
    const madrugada = new Date("2026-08-02T08:00:00Z");
    assert.equal(horaLocal(madrugada, ZONA), 3);
    assert.equal(
      motivo(
        hechos({ ultimoSalienteEn: new Date("2026-08-02T03:00:00Z"), ultimoEntranteEn: new Date("2026-08-02T02:50:00Z") }),
        madrugada,
      ),
      "fuera_de_horario",
    );
  });
});

describe("la ventana de servicio de WhatsApp — dos relojes, no uno", () => {
  test("le contestamos tarde: nuestro +20 h cae afuera de SU +24 h", () => {
    // Escribió a las 10:00 y le contestamos a las 15:00 (5 h después). A las 19
    // horas de nuestro mensaje, para él ya pasaron 24: Meta rechaza el envío.
    // Con el techo de 20 h solo, esta conversación habría calificado.
    const h = hechos({ ultimoSalienteEn: haceH(19), ultimoEntranteEn: haceH(24) });
    assert.equal(motivo(h), "ventana_cerrada");
  });

  test("sin saber cuándo escribió, no se manda (fail-closed)", () => {
    assert.equal(ventanaDeServicioAbierta(null, AHORA), false);
  });

  test("el margen de una hora es real: a las 23 h de su mensaje ya no sale", () => {
    assert.equal(ventanaDeServicioAbierta(haceH(VENTANA_SERVICIO_H - 1), AHORA), false);
    assert.equal(ventanaDeServicioAbierta(haceH(VENTANA_SERVICIO_H - 1.5), AHORA), true);
  });
});

describe("pusoUnaFecha — «decido el lunes» es un compromiso, no un silencio", () => {
  test("los casos reales del 1-ago", () => {
    assert.equal(pusoUnaFecha(["Todavía tengo plazo"]), true);
    assert.equal(pusoUnaFecha(["el próximo lunes lo vemos"]), true);
    assert.equal(pusoUnaFecha(["avísame para la próxima edición"]), true);
  });

  test("el compromiso de volver, en sus formas", () => {
    assert.equal(pusoUnaFecha(["gracias, cualquier cosa te aviso"]), true);
    assert.equal(pusoUnaFecha(["lo consulto con mi esposa"]), true);
    assert.equal(pusoUnaFecha(["cuando cobre me inscribo"]), true);
    assert.equal(pusoUnaFecha(["a fin de mes lo hago"]), true);
  });

  test("una PREGUNTA con un día adentro no es una promesa", () => {
    // «el lunes» a secas es la pregunta más común de la línea («¿inicia el
    // lunes?»). Solo cuenta con «próximo» adelante o con un verbo de la lista.
    assert.equal(pusoUnaFecha(["¿el curso inicia el lunes?"]), false);
    assert.equal(pusoUnaFecha(["¿las clases son los viernes?"]), false);
  });

  test("«fin de semana» sola no descarta: casi siempre es una pregunta de horario", () => {
    assert.equal(pusoUnaFecha(["¿hay grupos fin de semana?"]), false);
    assert.equal(pusoUnaFecha(["el fin de semana te confirmo"]), true);
  });

  test("un interesado normal no dispara nada", () => {
    assert.equal(pusoUnaFecha(["me interesa, ¿cuánto cuesta?"]), false);
    assert.equal(pusoUnaFecha([null, undefined, ""]), false);
  });
});

describe("los tres «no» del lead", () => {
  test("un rechazo en cualquiera de sus últimos mensajes lo saca", () => {
    assert.equal(motivo(hechos({ textosDelLead: ["no me interesa", "hola"] })), "dijo_que_no");
  });

  test("una despedida cuenta solo si es el ÚLTIMO que escribió", () => {
    assert.equal(
      motivo(hechos({ textosDelLead: ["gracias por la atención", "¿tienen cuotas?"] })),
      "se_despidio",
    );
    // Al revés: se despidió y después volvió a preguntar. Sigue vivo.
    assert.equal(
      motivo(hechos({ textosDelLead: ["¿tienen cuotas?", "gracias por la atención"] })),
      "manda",
    );
  });

  test("y una fecha lo saca aunque todo lo demás califique", () => {
    assert.equal(motivo(hechos({ textosDelLead: ["te aviso la otra semana"] })), "puso_una_fecha");
  });
});

describe("el orden de los motivos importa: es lo que reporta el simulacro", () => {
  test("quien ya dijo que no y encima es temprano se reporta como pausada, no como pronto", () => {
    const h = hechos({ tienePausa: true, ultimoSalienteEn: haceH(0.5) });
    assert.equal(motivo(h), "pausada");
  });
});

describe("el horario, en hora de Lima y no del server", () => {
  test("VPS1 corre en UTC: 20:00 UTC son las 15:00 de la vendedora", () => {
    assert.equal(horaLocal(AHORA, ZONA), 15);
    assert.equal(esHoraDeReenganche(AHORA, VENTANA), true);
  });

  test("a las 20:00 locales ya no sale (la ventana es [desde, hasta))", () => {
    const ochoDeLaNoche = new Date("2026-08-02T01:00:00Z"); // 20:00 en Lima
    assert.equal(horaLocal(ochoDeLaNoche, ZONA), 20);
    assert.equal(esHoraDeReenganche(ochoDeLaNoche, VENTANA), false);
  });

  test("el día del tope diario también es el de Lima", () => {
    const inicio = inicioDelDiaLocal(AHORA);
    assert.equal(horaLocal(inicio, ZONA), 0);
    assert.ok(inicio < AHORA);
  });
});

describe("el texto que sale — es catálogo, no prosa del modelo", () => {
  test("pasa el mismo guardrail que valida lo que escribe el modelo", () => {
    const v = validarSalida(TEXTO_REENGANCHE);
    assert.equal(v.ok, true, v.ok ? "" : `${v.violacion}: ${v.detalle}`);
  });

  test("pide una OPINIÓN, no una decisión", () => {
    // «¿estás interesado?» invita a un sí o un no —y el no es gratis—; «¿qué te
    // pareció?» invita a hablar. Es la diferencia que el doc §5 bis argumenta, y
    // la que un modelo parafraseando pierde nueve de cada diez veces.
    const plano = TEXTO_REENGANCHE.toLowerCase();
    assert.ok(plano.includes("te pareció"));
    assert.equal(plano.includes("sigues interesad"), false);
    assert.equal(plano.includes("estás interesad"), false);
  });

  test("no se anuncia como máquina ni promete que otro va a contactar", () => {
    const plano = TEXTO_REENGANCHE.toLowerCase();
    for (const p of ["automátic", "bot", "sistema", "asesor", "te contactar", "recordatorio"]) {
      assert.equal(plano.includes(p), false, `dice «${p}»`);
    }
  });

  test("entra en una sola burbuja", () => {
    assert.equal(trocear(TEXTO_REENGANCHE).length, 1);
  });

  test("el motivo con el que queda escrito es el mismo que hace de claim", () => {
    assert.equal(MOTIVO_REENGANCHE, "reenganche");
  });
});

describe("la consulta mira más lejos que la regla — a propósito", () => {
  test("la ventana de consulta es un superconjunto del techo", () => {
    // El SQL trae hechos crudos y el veredicto lo da la función pura. Si la
    // consulta filtrara con el mismo umbral, habría dos implementaciones del
    // mismo número (#37) y un día dirían cosas distintas.
    assert.ok(VENTANA_DE_CONSULTA_H > ESPERA_MAXIMA_H);
  });
});

describe("horasDesde — lo que el simulacro imprime al principio del renglón", () => {
  test("cuenta desde el instante, con un decimal", () => {
    assert.equal(horasDesde(haceH(5.25), AHORA), 5.3);
    assert.equal(horasDesde(null, AHORA), null);
  });
});

describe("laPelotaEsNuestra", () => {
  test("sin saliente no es nuestra", () => {
    assert.equal(laPelotaEsNuestra(null, haceH(1)), false);
  });
  test("sin entrante (nunca escribió) es nuestra", () => {
    assert.equal(laPelotaEsNuestra(haceH(1), null), true);
  });
});

/**
 * VENDEDORA_ACTIVA — el freno que faltaba, y que un revisor adversario encontró
 * antes de que llegara a producción.
 *
 * `laPelotaEsNuestra` da `true` igual si el último mensaje lo escribió una
 * persona, así que sin este freno el reenganche le escribe encima a la vendedora
 * que está trabajando la conversación. Y no hay red abajo: `bot_pausas` solo lo
 * escriben `escalar` y `pausar` del propio bot — no existe ninguna ruta con la
 * que una persona diga «esta la tomo yo».
 *
 * Peor todavía: en cuanto el bot escribe, `vendedoraActivaDesde` deja de
 * considerarla activa, y el bot se queda con la conversación de ella.
 */
describe("reenganche — no le escribe encima a la vendedora", () => {
  test("NO manda si una persona contestó después del último mensaje del lead", () => {
    const v = decidirReenganche(
      hechos({
        ultimoEntranteEn: haceH(6),
        // Ella contestó DESPUÉS de que él escribió: la conversación es suya.
        ultimoSalienteHumanoEn: haceH(5),
        ultimoSalienteEn: haceH(5),
      }),
      AHORA,
      VENTANA,
    );
    assert.equal(v.manda, false);
    if (!v.manda) assert.equal(v.motivo, "vendedora_activa");
  });

  test("SÍ manda si la persona escribió ANTES del último mensaje del lead", () => {
    // Ella contestó, él volvió a escribir después y nadie lo atendió: la
    // conversación vuelve a estar libre. Es la misma regla que el pipeline.
    const v = decidirReenganche(
      hechos({
        ultimoSalienteHumanoEn: haceH(9),
        ultimoEntranteEn: haceH(8),
        ultimoSalienteEn: haceH(5),
      }),
      AHORA,
      VENTANA,
    );
    assert.equal(v.manda, true);
  });

  test("SÍ manda cuando el último saliente fue del bot", () => {
    assert.equal(decidirReenganche(hechos({ ultimoSalienteHumanoEn: null }), AHORA, VENTANA).manda, true);
  });
});
