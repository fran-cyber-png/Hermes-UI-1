import { horaLimaDelDia } from "../lib/horaLima.js";

/**
 * EL HORARIO DE ATENCIÓN — una frontera, escrita una vez (#126).
 *
 * De 08:00 a 21:00, hora de Lima. No es un parámetro de configuración: es lo
 * que la medición de producción dijo que existe. Entre las 21 y las 8 entran
 * ~470 mensajes por semana y salen ~15 — o sea, de noche NO se atiende. Poner
 * la frontera en otro lado sería inventar un turno que nadie trabaja.
 *
 * PARA QUÉ SIRVE: la mediana de la primera respuesta vale 10 minutos EN horario
 * y 496 FUERA. Reportar una sola mediana (≈ 40 min) sería un número que parece
 * verdad y no lo es: escondería que la demora no es un problema de velocidad,
 * es un problema de COBERTURA. Las dos medianas, lado a lado, dicen la verdad —
 * y el gráfico de cobertura horaria muestra el agujero que las explica.
 *
 * La mitad SQL de esto vive en `lib/horaLimaSql.ts` (`horaDelDiaLimaSql`), junto
 * al corte de día, para que la zona horaria se escriba en un solo archivo.
 */

/** Primera hora del turno (inclusive), en el reloj de pared de Lima. */
export const HORA_APERTURA = 8;
/** Primera hora YA fuera del turno (exclusiva): a las 21:00 nadie contesta más. */
export const HORA_CIERRE = 21;

/** ¿Este instante cae dentro del turno de atención? */
export function enHorario(instante: Date): boolean {
  const hora = horaLimaDelDia(instante);
  return hora >= HORA_APERTURA && hora < HORA_CIERRE;
}

/**
 * Las 24 horas del día, en orden. El eje del gráfico de cobertura sale de acá y
 * no de los datos: una hora sin un solo mensaje tiene que dibujarse igual —
 * justamente ese hueco es lo que hay que ver.
 */
export function horasDelDia(): number[] {
  return Array.from({ length: 24 }, (_, h) => h);
}
