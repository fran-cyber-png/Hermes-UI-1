import { correrLazo } from "./worker.js";

/**
 * EL RELOJ DEL LAZO — el cron que no existía y costaba ~$33.000 de señal por mes.
 *
 * ── Por qué existe este archivo ──
 * `correrLazo` solo se invocaba desde `scripts/cerberus.ts:124`, o sea a mano, cuando alguien se
 * acordaba. Corrió una vez, el 2026-07-13. El reloj que sí existía (`pauta/reloj.ts`) llama a
 * `refrescarPauta` —los insights de Meta— y nunca tocó el lazo.
 *
 * Lo que costaba, medido el 2026-07-16:
 *
 *     273 ventas · $32.926 USD · confirmadas entre el 16/06 y el 04/07
 *     descartadas por `fuera_de_ventana`
 *     confirmadas hace menos de 8 días: CERO
 *
 * Tesorería había confirmado todas hace 12 a 30 días. El p90 de Tesorería es 4 días y el 94,3%
 * confirma dentro de la ventana de Meta. No se perdieron porque alguien fuera lento: se perdieron
 * porque nadie le avisó a Meta.
 *
 * `evento.ts:128` calcula `atraso = ahora − confirmadaAt` y manda `event_time = confirmadaAt`. Con
 * el lazo corriendo a diario ese atraso es ≤ 1 día, y toda venta confirmada entra en la ventana de
 * 7 días — sin importar cuánto haya tardado Tesorería en confirmarla.
 *
 * ── Por qué arranca APAGADO ──
 * `pauta/reloj.ts` arranca prendido y se apaga con `PAUTA_RELOJ=off`. Acá es al revés, y no es
 * una inconsistencia: la pauta LEE de Meta, esto le ESCRIBE. Un `git pull` no puede empezar a
 * mandarle eventos de compra a Meta porque sí. Y sin `META_TEST_EVENT_CODE`, cada evento es real y
 * entra al modelo de entrega — donde no se puede retractar (`evento.ts:50`).
 *
 * Se enciende a propósito:
 *
 *     LAZO_RELOJ=on              corre de verdad, cada 6 h
 *     LAZO_RELOJ=simulacion      evalúa y guarda, NO le manda nada a Meta
 *     (ausente)                  apagado
 *
 * El modo `simulacion` es el que hay que usar primero, siempre: deja ver los números que van a
 * salir antes de que salgan.
 */

/**
 * Cada 6 h, no cada 24.
 *
 * La ventana de Meta son 7 días y el atraso con 24 h ya sería suficiente. Pero 6 h iguala la
 * cadencia del reloj de la pauta —una sola cadencia que entender— y le da cuatro oportunidades por
 * día a una venta confirmada, en vez de una. Si una corrida falla, la siguiente es en 6 h y no en
 * 24. El costo es nulo: el lazo lee Postgres y solo le habla a Meta cuando hay algo nuevo que
 * decir (`yaEnMeta()` filtra el resto).
 */
const CADA_HORAS = 6;

export function arrancarRelojDelLazo(): void {
  const modo = process.env.LAZO_RELOJ;

  if (modo !== "on" && modo !== "simulacion") {
    console.log(
      "[lazo] reloj APAGADO. Meta no se entera de ninguna venta nueva hasta que alguien corra " +
        "`npm run lazo` a mano. Para encenderlo: LAZO_RELOJ=simulacion (seguro) o LAZO_RELOJ=on.",
    );
    return;
  }

  const soloRegistrar = modo === "simulacion";

  const correr = async () => {
    try {
      const r = await correrLazo({ soloRegistrar });
      const cabeza = soloRegistrar ? "[lazo] SIMULACIÓN" : "[lazo]";
      console.log(
        `${cabeza} ${r.evaluadas} evaluadas · ${r.yaEnviadas} ya estaban en Meta · ` +
          `${r.aEnviar} listas · ${r.enviadas} enviadas` +
          (r.esPrueba ? " · MODO PRUEBA (Test Events)" : ""),
      );
      // Los descartes se dicen en cada corrida, no solo cuando alguien mira la pantalla. Un lazo
      // que solo reporta lo que mandó esconde justamente la mitad que importa.
      const fuera = r.descartes.fuera_de_ventana;
      if (fuera > 0) {
        console.warn(
          `[lazo] ⚠ ${fuera} ventas fuera de la ventana de Meta. Si este número no baja a ~0 con ` +
            `el reloj corriendo, el problema NO es el cron: mirá governa.tesoreria.reloj.`,
        );
      }
      if (r.errores.length > 0) console.error(`[lazo] errores: ${r.errores.join(" · ")}`);
    } catch (err) {
      // Un fallo del lazo no puede tumbar el server. Queda registrado y se reintenta en 6 h.
      console.error("[lazo] la corrida falló:", (err as Error).message);
    }
  };

  // Igual que el reloj de la pauta: NO corre al arrancar. Si el server se reinicia seguido, cada
  // reinicio dispararía un envío a Meta. La primera corrida la hace el reloj, o alguien a mano.
  setInterval(correr, CADA_HORAS * 3_600_000);
  console.log(
    `[lazo] reloj activo cada ${CADA_HORAS}h` +
      (soloRegistrar ? " en SIMULACIÓN (no le manda nada a Meta)" : " — le va a MANDAR a Meta"),
  );
}
