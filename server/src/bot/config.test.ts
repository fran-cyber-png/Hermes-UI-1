import test from "node:test";
import assert from "node:assert/strict";
import {
  anunciarConfig,
  CONFIG_BOT_POR_DEFECTO,
  configDesdeEnv,
  resumenDeConfig,
} from "./config.js";
import { CONFIG_POR_DEFECTO as CONFIG_AUTORRESPUESTA } from "../autorespuesta/config.js";
import { minutosDeHhmm } from "../autorespuesta/franja.js";

/**
 * Lo que se prueba acá no son ocho lecturas de `process.env`: son las tres
 * formas medidas de que este ticket deje un bot roto sin que nadie se entere.
 *
 *   1. **apagado que parece prendido** — `BOT_LINEAS` puesto con un número que
 *      no normaliza. El bot no contesta y se ve igual que si estuviera apagado.
 *   2. **prendido con los topes equivocados** — un entero mal escrito que
 *      degrada en silencio. Se descubre con la factura.
 *   3. **la config que revienta la suite** — leer `process.env` al importar el
 *      módulo. `npm test` no carga `server/.env`.
 *
 * Cada test le pasa su propio `env` y su propio `avisar`: nada toca el proceso.
 */

/** Junta los avisos en vez de escupirlos a stderr, y deja assertarlos. */
function conAvisos(): { avisar: (m: string) => void; avisos: string[] } {
  const avisos: string[] = [];
  return { avisar: (m) => avisos.push(m), avisos };
}

test("sin ninguna variable vale la config por defecto, y eso significa APAGADO", () => {
  const { avisar, avisos } = conAvisos();
  const cfg = configDesdeEnv({}, avisar);

  assert.deepEqual(cfg, CONFIG_BOT_POR_DEFECTO);
  assert.deepEqual(cfg.lineas, [], "sin BOT_LINEAS no hay ninguna línea habilitada");
  assert.deepEqual(avisos, [], "una variable ausente no es una variable mal escrita: no avisa");
});

test("una variable vacía se comporta como ausente y no avisa — así la deja el .env.example", () => {
  const { avisar, avisos } = conAvisos();
  const cfg = configDesdeEnv(
    { BOT_LINEAS: "", BOT_MODELO: "", BOT_BUFFER_SEGUNDOS: "", BOT_MAX_TURNOS_DIA: "  " },
    avisar,
  );

  assert.deepEqual(cfg, CONFIG_BOT_POR_DEFECTO);
  assert.deepEqual(avisos, []);
});

test("`Number('')` es 0, no NaN: una variable vacía NO puede dejar un tope en cero", () => {
  // El chequeo de presencia va antes del parseo justo por esto. Sin él,
  // `BOT_MAX_TURNOS_DIA=` daría cero turnos por conversación: un bot mudo.
  const cfg = configDesdeEnv({ BOT_MAX_TURNOS_DIA: "", BOT_FOLLOWUPS_DIA: "" }, () => {});
  assert.equal(cfg.maxTurnosDia, CONFIG_BOT_POR_DEFECTO.maxTurnosDia);
  assert.equal(cfg.followupsDia, CONFIG_BOT_POR_DEFECTO.followupsDia);
});

test("BOT_LINEAS parsea el CSV, normaliza cada número al formato canónico y conserva el orden", () => {
  const { avisar, avisos } = conAvisos();
  const cfg = configDesdeEnv({ BOT_LINEAS: "51986394450, +51 999 888 777 , 986394451" }, avisar);

  assert.deepEqual(cfg.lineas, ["51986394450", "51999888777", "51986394451"]);
  assert.deepEqual(avisos, []);
});

test("una línea repetida —aunque venga escrita distinto— entra una sola vez", () => {
  const cfg = configDesdeEnv({ BOT_LINEAS: "51986394450,+51-986-394-450,986394450" }, () => {});
  assert.deepEqual(cfg.lineas, ["51986394450"]);
});

test("una parte que no es un teléfono se descarta, DICE CUÁL, y no apaga a las demás", () => {
  // El modo de falla propio de este ticket: con la variable puesta y un typo
  // adentro, el bot queda mudo y el síntoma es idéntico al de un bot apagado.
  const { avisar, avisos } = conAvisos();
  const cfg = configDesdeEnv({ BOT_LINEAS: "51986394450, la-de-luz, 51999888777" }, avisar);

  assert.deepEqual(cfg.lineas, ["51986394450", "51999888777"]);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0]!, /BOT_LINEAS/);
  assert.match(avisos[0]!, /la-de-luz/);
});

test("un entero inválido degrada al default Y AVISA nombrando la variable", () => {
  const { avisar, avisos } = conAvisos();
  const cfg = configDesdeEnv({ BOT_BUFFER_SEGUNDOS: "veinticinco" }, avisar);

  assert.equal(cfg.bufferSegundos, CONFIG_BOT_POR_DEFECTO.bufferSegundos);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0]!, /BOT_BUFFER_SEGUNDOS/, "un warn que no dice cuál de las ocho no sirve");
});

test("un entero fuera de rango, negativo o decimal degrada igual — el rango es parte del contrato", () => {
  const casos = ["0", "-5", "2.5", "99999"];
  for (const crudo of casos) {
    const { avisar, avisos } = conAvisos();
    const cfg = configDesdeEnv({ BOT_MAX_RESPUESTAS_HORA_LINEA: crudo }, avisar);
    assert.equal(
      cfg.maxRespuestasHoraLinea,
      CONFIG_BOT_POR_DEFECTO.maxRespuestasHoraLinea,
      `«${crudo}» tendría que haber degradado`,
    );
    assert.equal(avisos.length, 1, `«${crudo}» tendría que haber avisado`);
  }
});

test("BOT_FOLLOWUPS_DIA acepta cero: apagar sólo el follow-up es una decisión válida", () => {
  const { avisar, avisos } = conAvisos();
  const cfg = configDesdeEnv({ BOT_FOLLOWUPS_DIA: "0" }, avisar);

  assert.equal(cfg.followupsDia, 0);
  assert.deepEqual(avisos, [], "cero follow-ups no es un error: es el bot respondiendo y nada más");
});

test("una ventana de follow-up que no se abre nunca vuelve a las horas por defecto, avisando", () => {
  const { avisar, avisos } = conAvisos();
  const cfg = configDesdeEnv(
    { BOT_FOLLOWUP_HORA_DESDE: "20", BOT_FOLLOWUP_HORA_HASTA: "9" },
    avisar,
  );

  assert.equal(cfg.followupHoraDesde, CONFIG_BOT_POR_DEFECTO.followupHoraDesde);
  assert.equal(cfg.followupHoraHasta, CONFIG_BOT_POR_DEFECTO.followupHoraHasta);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0]!, /follow-up/);
});

test("las dos horas vuelven JUNTAS: media ventana a mano y media por defecto es una tercera ventana", () => {
  const cfg = configDesdeEnv({ BOT_FOLLOWUP_HORA_DESDE: "22" }, () => {});
  assert.equal(cfg.followupHoraDesde, CONFIG_BOT_POR_DEFECTO.followupHoraDesde);
  assert.equal(cfg.followupHoraHasta, CONFIG_BOT_POR_DEFECTO.followupHoraHasta);
});

test("una ventana de follow-up más angosta que la de por defecto se respeta tal cual", () => {
  const { avisar, avisos } = conAvisos();
  const cfg = configDesdeEnv(
    { BOT_FOLLOWUP_HORA_DESDE: "10", BOT_FOLLOWUP_HORA_HASTA: "18" },
    avisar,
  );

  assert.equal(cfg.followupHoraDesde, 10);
  assert.equal(cfg.followupHoraHasta, 18);
  assert.deepEqual(avisos, []);
});

test("las ocho variables se leen del env que se le pasa, no de process.env", () => {
  const { avisar, avisos } = conAvisos();
  const cfg = configDesdeEnv(
    {
      BOT_MODELO: "claude-haiku-4-5",
      BOT_LINEAS: "51986394450",
      BOT_BUFFER_SEGUNDOS: "40",
      BOT_MAX_TURNOS_DIA: "12",
      BOT_MAX_RESPUESTAS_HORA_LINEA: "30",
      BOT_FOLLOWUPS_DIA: "5",
      BOT_FOLLOWUP_HORA_DESDE: "8",
      BOT_FOLLOWUP_HORA_HASTA: "19",
    },
    avisar,
  );

  assert.deepEqual(cfg, {
    modelo: "claude-haiku-4-5",
    lineas: ["51986394450"],
    bufferSegundos: 40,
    maxTurnosDia: 12,
    maxRespuestasHoraLinea: 30,
    followupsDia: 5,
    followupHoraDesde: 8,
    followupHoraHasta: 19,
  });
  assert.deepEqual(avisos, []);
});

/**
 * EL CANDADO CONTRA LA OTRA COPIA DEL HORARIO.
 *
 * Las horas de follow-up del bot y la `franja` de la auto-respuesta son el mismo
 * horario de atención escrito dos veces, en dos módulos, con dos tipos. No se
 * unificaron —el porqué está en `config.ts`, sobre `HORARIO_DE_ATENCION`— así
 * que lo que se fija con test es la RELACIÓN entre las dos, que es el patrón de
 * la casa para lo que tiene que existir por duplicado (`piezas/vectores.ts` y
 * sus dos `paridad.test.ts`, `cursos/precedencia.ts` y su gemelo en SQL).
 *
 * Si esto falla, no está roto: alguien movió el horario de atención de un lado.
 * La decisión es si el bot lo sigue — y ahora es una decisión, no un olvido.
 */
test("la ventana de follow-up del bot coincide con el horario de atención de la auto-respuesta", () => {
  assert.equal(
    minutosDeHhmm(CONFIG_AUTORRESPUESTA.franja.desde),
    CONFIG_BOT_POR_DEFECTO.followupHoraDesde * 60,
    "el horario de atención (autorespuesta/config.ts, CONFIG_POR_DEFECTO.franja) se movió: " +
      "decidí si BOT_FOLLOWUP_HORA_DESDE lo sigue",
  );
  assert.equal(
    minutosDeHhmm(CONFIG_AUTORRESPUESTA.franja.hasta),
    CONFIG_BOT_POR_DEFECTO.followupHoraHasta * 60,
    "el horario de atención (autorespuesta/config.ts, CONFIG_POR_DEFECTO.franja) se movió: " +
      "decidí si BOT_FOLLOWUP_HORA_HASTA lo sigue",
  );
});

test("el resumen de arranque dice CUÁNTAS líneas quedaron y CUÁLES, no «bot listo»", () => {
  const cfg = configDesdeEnv({ BOT_LINEAS: "51986394450,51999888777" }, () => {});
  const linea = resumenDeConfig(cfg);

  assert.match(linea, /2 línea/);
  assert.match(linea, /51986394450/);
  assert.match(linea, /51999888777/);
  assert.match(linea, /claude-opus-5/);
});

test("sin líneas, el resumen lo dice con todas las letras — el bot apagado se tiene que ver", () => {
  const linea = resumenDeConfig(configDesdeEnv({}, () => {}));
  assert.match(linea, /APAGADO/);
  assert.match(linea, /BOT_LINEAS/);
});

test("anunciarConfig escribe el resumen por el log que se le pasa", () => {
  const dicho: string[] = [];
  anunciarConfig(configDesdeEnv({ BOT_LINEAS: "51986394450" }, () => {}), (m) => dicho.push(m));

  assert.equal(dicho.length, 1);
  assert.match(dicho[0]!, /51986394450/);
});
