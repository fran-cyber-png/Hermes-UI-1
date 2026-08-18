import type { Recordatorio } from './agenda';

/**
 * EL GANTT DE LA AGENDA — lógica pura, testeable sin DOM.
 *
 * La grilla del mes responde «¿qué hay el día 18?». El Gantt responde la otra
 * pregunta, la que una grilla no puede dibujar: **¿cuánto tiempo le queda a cada
 * promesa, y cuánto lleva esperando la que ya venció?** Por eso acá una barra
 * **dura días**, mientras que un chip del mes es un punto en el tiempo.
 *
 * Las tres formas de una barra, y la semántica es lo que las distingue (no el
 * color):
 * - `corriendo` — pendiente que todavía no vence: va de **hoy hasta el día que
 *   vence**. Lo que se lee es el margen que queda.
 * - `vencida` — pendiente que ya pasó: va **del día que venció hasta hoy**. Lo
 *   que se lee es la deuda, y crece sola cada día que nadie la toca.
 * - `hecha` — un solo día, en su fecha. Ya no dura nada.
 *
 * ⚠️ **No se inventa una duración que el dato no tiene.** Un recordatorio guarda
 * un instante (`cuando`), no un rango: el largo de la barra siempre se mide
 * **contra hoy**, que es un hecho, y nunca contra una duración estimada.
 *
 * Todo trabaja en **hora local**, como el resto de la agenda (`fechas.ts`): la
 * vendedora lee su calendario mirando el reloj de la pared.
 */

export type EstadoBarra = 'vencida' | 'corriendo' | 'hecha';

export interface BarraGantt {
  r: Recordatorio;
  /** Columna donde arranca la barra, ya recortada a la ventana visible. */
  desde: number;
  /** Cuántas columnas ocupa. Mínimo 1: una barra de ancho cero no se ve. */
  ancho: number;
  estado: EstadoBarra;
  /** `true` si el tramo real empieza antes de la ventana (se recortó a la izquierda). */
  cortadaIzquierda: boolean;
  /** `true` si el tramo real termina después de la ventana. */
  cortadaDerecha: boolean;
}

/** Medianoche local de una fecha: el día del calendario, sin la hora. */
function dia0(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Cuántos días de calendario hay entre dos fechas.
 *
 * Se redondea a propósito: los cambios de horario de verano hacen que un «día»
 * dure 23 o 25 horas, y una división entera devolvería el día equivocado dos
 * veces al año.
 */
export function diasEntre(a: Date, b: Date): number {
  return Math.round((dia0(b).getTime() - dia0(a).getTime()) / 86_400_000);
}

/** Las columnas del Gantt: `cantidad` días consecutivos desde `desde`. */
export function diasDeGantt(desde: Date, cantidad: number): Date[] {
  const base = dia0(desde);
  return Array.from({ length: cantidad }, (_, i) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + i));
}

/** El estado de una barra: la misma precedencia que el chip (hecho gana sobre vencido). */
export function estadoDeBarra(r: Recordatorio, hoy: Date): EstadoBarra {
  if (r.estado === 'hecho') return 'hecha';
  return diasEntre(hoy, new Date(r.cuando)) < 0 ? 'vencida' : 'corriendo';
}

/**
 * De un recordatorio a su barra, recortada a la ventana de `dias`.
 *
 * Devuelve `null` cuando el tramo cae **entero** fuera de la ventana: una barra
 * de ancho cero pegada al borde se leería como una promesa de ese día, que es
 * justo lo que no es.
 */
export function barraDe(r: Recordatorio, dias: Date[], hoy: Date): BarraGantt | null {
  if (dias.length === 0) return null;
  const estado = estadoDeBarra(r, hoy);
  const cuando = new Date(r.cuando);
  const iCuando = diasEntre(dias[0], cuando);
  const iHoy = diasEntre(dias[0], hoy);

  // El tramo real, antes de recortar. Hecha no dura: es su propio día.
  const [crudoDesde, crudoHasta] =
    estado === 'hecha'
      ? [iCuando, iCuando]
      : estado === 'vencida'
        ? [iCuando, iHoy] // venció: del día que venció hasta hoy
        : [iHoy, iCuando]; // corre: de hoy hasta el día que vence

  const ultima = dias.length - 1;
  if (crudoHasta < 0 || crudoDesde > ultima) return null;

  const desde = Math.max(crudoDesde, 0);
  const hasta = Math.min(crudoHasta, ultima);
  return {
    r,
    desde,
    ancho: hasta - desde + 1,
    estado,
    cortadaIzquierda: crudoDesde < 0,
    cortadaDerecha: crudoHasta > ultima,
  };
}

/**
 * Las filas del Gantt: una por recordatorio, ordenadas por su fecha.
 *
 * **Una fila por promesa y no una por persona**, aunque la referencia visual
 * agrupe por persona: con dos promesas pendientes del mismo contacto las dos
 * barras arrancan hoy y se taparían entre ellas. El nombre de la persona se
 * dibuja igual en la etiqueta de cada fila.
 */
export function armarGantt(rs: Recordatorio[], dias: Date[], hoy: Date): BarraGantt[] {
  return rs
    .map((r) => barraDe(r, dias, hoy))
    .filter((b): b is BarraGantt => b !== null)
    .sort((a, b) => a.r.cuando.localeCompare(b.r.cuando));
}

/** El rótulo del rango que se está mirando: «18 ago – 7 sep». */
export function rangoDeGantt(dias: Date[]): string {
  if (dias.length === 0) return '';
  const f = (d: Date) => d.toLocaleDateString('es', { day: 'numeric', month: 'short' });
  return `${f(dias[0])} – ${f(dias[dias.length - 1])}`;
}
