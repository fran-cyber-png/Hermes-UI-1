import "dotenv/config";
import { hhmmLocal, proximoMomento } from "../autorespuesta/franja.js";
import { configDesdeEnv, type ConfigBot } from "../bot/config.js";
import {
  ENVIOS_POR_CORRIDA,
  MOTIVO_REENGANCHE,
  TEXTO_REENGANCHE,
  ZONA,
  decidirReenganche,
  esHoraDeReenganche,
  horasDesde,
  type HechosDelReenganche,
  type MotivoNoReenganche,
} from "../bot/reenganche.js";

/**
 * EL SIMULACRO DEL REENGANCHE — `npm run reenganche:simulacro`.
 *
 * Imprime a quién le escribiría el bot **sin mandar nada y sin escribir una
 * fila**. Es lo que se corre ANTES de poner `BOT_FOLLOWUPS_DIA` en algo distinto
 * de cero, y de nuevo cada vez que se toca un número.
 *
 * ── Por qué cada renglón empieza por CUÁNDO ESCRIBIÓ Y HACE CUÁNTO (#166) ──
 *
 * El 27-jul el simulacro de la auto-respuesta imprimió un plan de 33 mensajes
 * que se veía impecable y estaba mal de siete formas, porque mostraba la hora a
 * la que SALDRÍA cada mensaje y nunca la hora a la que había llegado el de la
 * persona. Un dry-run que muestra el resultado y no las variables de la decisión
 * no verifica nada. Acá van las dos columnas primero, y los descartados van de a
 * cinco por motivo con lo mismo.
 *
 * Usa la MISMA función que la corrida de verdad (`decidirReenganche`): lo que se
 * lee acá es lo que va a pasar, no una aproximación escrita aparte.
 *
 *   npm run reenganche:simulacro                 · contra la base, con el reloj de ahora
 *   npm run reenganche:simulacro -- --hora 21:00 · «¿y si fueran las 9 de la noche?»
 *   npm run reenganche:simulacro -- --demo       · sin base, con los tres casos del doc
 */

interface Opciones {
  demo: boolean;
  hora: string | null;
}

function leerOpciones(argv: string[]): Opciones {
  const i = argv.indexOf("--hora");
  return { demo: argv.includes("--demo"), hora: i >= 0 ? (argv[i + 1] ?? null) : null };
}

/** La ÚLTIMA vez que el reloj local marcó `hhmm` — el espejo de `proximoMomento`. */
function ultimoMomento(ahora: Date, hhmm: string): Date {
  const proximo = proximoMomento(ahora, hhmm, ZONA);
  return proximo.getTime() > ahora.getTime()
    ? new Date(proximo.getTime() - 24 * 3_600_000)
    : proximo;
}

/**
 * LOS TRES CASOS DEL DOC, sembrados en memoria. Sirven para leer el formato y
 * para ver que las reglas que más cuestan de creer están puestas:
 *   1. la que recibió el material a las 10:00 y no volvió a escribir → SALE;
 *   2. la que dijo «el próximo lunes» → no sale, y el motivo lo dice;
 *   3. la que escribió hace 25 horas → la ventana de WhatsApp está cerrada.
 */
function candidatosDeDemo(ahora: Date): HechosDelReenganche[] {
  const h = (n: number) => new Date(ahora.getTime() - n * 3_600_000);
  const base = (telefono: string, p: Partial<HechosDelReenganche>): HechosDelReenganche => ({
    clave: `conv:whatsapp:${telefono}:51984429504`,
    telefono,
    ultimoSalienteEn: h(5),
    // En los tres casos de demo el último saliente lo mandó el bot.
    ultimoSalienteHumanoEn: null,
    ultimoEntranteEn: h(5.2),
    recibioElMaterial: true,
    textosDelLead: ["me interesa el diploma"],
    tienePausa: false,
    yaHuboReenganche: false,
    ...p,
  });

  return [
    base("51999111222", {
      ultimoEntranteEn: ultimoMomento(ahora, "10:00"),
      ultimoSalienteEn: ultimoMomento(ahora, "10:05"),
    }),
    base("51932557675", {
      textosDelLead: ["todavía tengo plazo, el próximo lunes te confirmo"],
    }),
    base("5213318820245", { ultimoEntranteEn: h(25), ultimoSalienteEn: h(19) }),
    base("51924073609", { yaHuboReenganche: true }),
    base("51966628980", { recibioElMaterial: false }),
  ];
}

// ── La impresión ─────────────────────────────────────────────────────────────

const hhmm = (d: Date | null) => (d ? hhmmLocal(d, ZONA) : "  —  ");
const espera = (d: Date | null, ahora: Date) => {
  const h = horasDesde(d, ahora);
  return h === null ? "—" : `hace ${h} h`;
};

function renglon(c: HechosDelReenganche, ahora: Date, cola: string): string {
  return (
    `  ${hhmm(c.ultimoEntranteEn).padEnd(7)}` +
    `${espera(c.ultimoEntranteEn, ahora).padEnd(13)}` +
    `${c.telefono.padEnd(15)}` +
    `nuestro último: ${hhmm(c.ultimoSalienteEn)} (${espera(c.ultimoSalienteEn, ahora)})  ${cola}`
  );
}

function imprimir(
  candidatos: HechosDelReenganche[],
  cfg: ConfigBot,
  ahora: Date,
  encabezado: string[],
): void {
  const salen: HechosDelReenganche[] = [];
  const descartes = new Map<MotivoNoReenganche, HechosDelReenganche[]>();

  for (const c of candidatos) {
    const v = decidirReenganche(c, ahora, cfg);
    if (v.manda) salen.push(c);
    else descartes.set(v.motivo, [...(descartes.get(v.motivo) ?? []), c]);
  }

  console.log("");
  for (const l of encabezado) console.log(l);
  console.log("");
  console.log(`Texto     · «${TEXTO_REENGANCHE}»`);
  console.log(
    `Ritmo     · ${ENVIOS_POR_CORRIDA} por corrida, una corrida cada 10 min, ` +
      `tope ${cfg.followupsDia}/día por línea`,
  );
  console.log("");
  console.log("── LAS COLUMNAS SON: cuándo escribió ÉL · hace cuánto · teléfono ──");
  console.log("");
  console.log(`SALEN (${salen.length} de ${candidatos.length} mirados)`);
  if (salen.length === 0) console.log("  (ninguna)");
  for (const [i, c] of salen.entries()) {
    console.log(renglon(c, ahora, i < ENVIOS_POR_CORRIDA ? "← en la próxima corrida" : ""));
  }

  console.log("");
  console.log("DESCARTADOS");
  if (descartes.size === 0) console.log("  (ninguno)");
  for (const [motivo, filas] of [...descartes.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(filas.length).padStart(3)} × ${motivo}`);
    for (const c of filas.slice(0, 5)) console.log(`  ${renglon(c, ahora, "")}`);
    if (filas.length > 5) console.log(`         … y ${filas.length - 5} más`);
  }
  console.log("");
}

async function main(): Promise<void> {
  const opciones = leerOpciones(process.argv.slice(2));
  const cfg = configDesdeEnv();
  const ahora = opciones.hora ? proximoMomento(new Date(), opciones.hora, ZONA) : new Date();

  const encabezado = [
    `Reloj     · ${hhmmLocal(ahora, ZONA)} de Lima (${ahora.toISOString()})` +
      `${opciones.hora ? "  ← simulado con --hora" : ""}`,
    // Las dos llaves, siempre a la vista: el simulacro planifica igual, pero el
    // que lo lee tiene que saber si esto saldría o no.
    `Entorno   · BOT_FOLLOWUPS_DIA=${cfg.followupsDia}` +
      (cfg.followupsDia > 0 ? "" : "  ← APAGADO: hoy no saldría ninguno"),
    `Ventana   · ${cfg.followupHoraDesde}:00–${cfg.followupHoraHasta}:00 de Lima` +
      (esHoraDeReenganche(ahora, cfg) ? "" : "  ← AHORA ESTÁ FUERA: no saldría ninguno"),
  ];

  if (opciones.demo) {
    encabezado.push("Datos     · DEMO (sembrados en memoria, sin tocar la base)");
    imprimir(candidatosDeDemo(ahora), cfg, ahora, encabezado);
    return;
  }

  if (cfg.lineas.length === 0) {
    console.log("\n[bot] BOT_LINEAS está vacío: no hay línea que mirar. Probá con --demo.\n");
    return;
  }

  // Modo real: LECTURA de la base y nada más. El import es dinámico para que
  // `--demo` corra sin `DATABASE_URL` (`db/client.ts` lanza al importarse).
  const { db } = await import("../db/client.js");
  const { candidatosDeReenganche } = await import("../bot/correrReenganche.js");
  const { leerEstadoLinea } = await import("../bot/estadoLinea.js");
  const { modoValido } = await import("../bot/modo.js");

  for (const linea of cfg.lineas) {
    const estado = await leerEstadoLinea(db, linea);
    const modo = estado.modo ?? modoValido(cfg.modo);
    const candidatos = await candidatosDeReenganche(db, linea, ahora);
    imprimir(candidatos, cfg, ahora, [
      ...encabezado,
      `Línea     · ${linea} · modo ${modo.toUpperCase()}` +
        (modo === "automatico" ? "" : "  ← el reenganche solo sale en AUTOMATICO") +
        (estado.frenadoMotivo ? `  ← FRENADA: ${estado.frenadoMotivo}` : ""),
      `Claim     · una fila en bot_respuestas con motivo «${MOTIVO_REENGANCHE}» = ya se le mandó`,
    ]);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[reenganche simulacro] falló:", (err as Error).message);
  process.exit(1);
});
