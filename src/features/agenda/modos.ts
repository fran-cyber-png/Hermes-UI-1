/**
 * CÓMO SE MIRA LA AGENDA — el vocabulario de los modos, en un solo lugar.
 *
 * Vive aparte de `CalendarHeader` para que la barra y la vista lean la MISMA
 * lista: con una copia en cada lado, agregar un modo deja los botones andando y
 * la vista sin su rama (o al revés, una rama que nadie puede elegir).
 *
 * Los tres primeros parten el tiempo en casilleros —mes, semana, día—; el
 * **Gantt** no: dibuja cuánto DURA cada promesa. Por eso es un modo y no un
 * zoom más de los otros.
 */

export const MODOS = ['mes', 'semana', 'dia', 'gantt'] as const;
export type Modo = (typeof MODOS)[number];

export const MODO_ROTULO: Record<Modo, string> = {
  mes: 'Mes',
  semana: 'Semana',
  dia: 'Día',
  gantt: 'Gantt',
};
