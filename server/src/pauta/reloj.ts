import { cuentasConfiguradas, refrescarPauta } from "./snapshot.js";

/**
 * El reloj: lo único que le habla a Meta sin que nadie lo pida.
 *
 * Cada 6 horas revisa la pauta y deja el snapshot en Postgres. Las pantallas leen de ahí.
 *
 * Por qué 6 horas y no 5 minutos: una campaña no cambia de rendimiento en 5 minutos, y cada
 * corrida son ~120 llamadas a la Graph API. Refrescar más seguido no da mejores decisiones,
 * solo acerca el rate limit. Quien necesite el dato al segundo tiene el botón "Revisar ahora".
 */

const CADA_HORAS = 6;
const RANGO_POR_DEFECTO = "90d"; // el mismo con el que abre el dashboard

export function arrancarReloj(): void {
  if (process.env.PAUTA_RELOJ === "off") {
    console.log("[pauta] reloj apagado (PAUTA_RELOJ=off)");
    return;
  }

  const correr = async () => {
    try {
      const cuentas = await cuentasConfiguradas();
      if (cuentas.length === 0) return; // nadie eligió cuentas todavía: no hay nada que revisar

      const inicio = Date.now();
      const snap = await refrescarPauta(RANGO_POR_DEFECTO);
      const seg = Math.round((Date.now() - inicio) / 1000);

      if (snap) {
        const fallidas = snap.errores.length;
        console.log(
          `[pauta] revisado: ${snap.campanas.length} campañas de ${cuentas.length} cuentas en ${seg}s` +
            (fallidas ? ` · ${fallidas} cuenta(s) fallaron` : ""),
        );
      }
    } catch (err) {
      // Un fallo del reloj no debe tumbar el server. Queda registrado y se reintenta al rato.
      console.error("[pauta] el reloj falló:", (err as Error).message);
    }
  };

  // Al arrancar NO corremos: si el server se reinicia seguido, cada reinicio dispararía ~120
  // llamadas a Meta. El primer refresco lo hace el reloj, o alguien con el botón.
  setInterval(correr, CADA_HORAS * 3_600_000);
  console.log(`[pauta] reloj activo: revisa cada ${CADA_HORAS}h`);
}
