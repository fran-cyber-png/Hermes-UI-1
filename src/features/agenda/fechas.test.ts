import { describe, expect, it } from 'vitest';
import { aLocal, horaDe, indiceTrasAhora, inicioDeSemana, mismaFecha, traducirCuando } from './fechas';
import type { Recordatorio } from './agenda';

/**
 * Las fechas de la agenda (#109), sacadas de `VistaAgenda.tsx` para poder probarlas.
 *
 * Todas las fechas se construyen con el constructor LOCAL (`new Date(2026, 6, 23)`)
 * y nunca con ISO + `Z`: esta máquina está en Perú y el runner de CI no, así que
 * un test escrito en UTC diría una cosa acá y otra allá.
 */

/** Constructor corto: solo importan `cuando` y `nota`. */
const rec = (cuando: Date, over: Partial<Recordatorio> = {}): Recordatorio => ({
  id: 1,
  clave: 'conv:whatsapp:51999:51961',
  canal: 'whatsapp',
  personaId: null,
  personaNombre: null,
  numeroPropio: null,
  nota: 'llamada de seguimiento',
  cuando: cuando.toISOString(),
  estado: 'pendiente',
  ...over,
});

describe('mismaFecha', () => {
  it('el mismo día aunque cambie la hora', () => {
    expect(mismaFecha(new Date(2026, 6, 23, 9, 0), new Date(2026, 6, 23, 23, 59))).toBe(true);
  });

  it('mismo día y mes pero distinto año NO es la misma fecha', () => {
    // El error clásico de comparar solo día y mes: un seguimiento del año pasado
    // aparecería pintado en el día de hoy.
    expect(mismaFecha(new Date(2026, 6, 23), new Date(2025, 6, 23))).toBe(false);
  });

  it('el cambio de mes se respeta', () => {
    expect(mismaFecha(new Date(2026, 6, 31), new Date(2026, 7, 1))).toBe(false);
  });
});

describe('inicioDeSemana', () => {
  it('la semana empieza el LUNES, no el domingo', () => {
    // 2026-07-23 es jueves; su semana arranca el lunes 20.
    const lunes = inicioDeSemana(new Date(2026, 6, 23, 15, 30));
    expect(lunes.getDate()).toBe(20);
    expect(lunes.getDay()).toBe(1); // 1 = lunes
  });

  it('el domingo cierra la semana que pasó, no abre la que viene', () => {
    // Es el caso que rompe la fórmula ingenua: JavaScript numera al domingo 0, así
    // que sin el `(getDay()+6)%7` el domingo 26 se iría al lunes 27 — una semana
    // adelante de la que la vendedora está mirando.
    const lunes = inicioDeSemana(new Date(2026, 6, 26, 10, 0));
    expect(lunes.getDate()).toBe(20);
    expect(lunes.getDay()).toBe(1);
  });

  it('un lunes se devuelve a sí mismo, a las 00:00', () => {
    const lunes = inicioDeSemana(new Date(2026, 6, 20, 18, 45));
    expect(lunes.getDate()).toBe(20);
    expect([lunes.getHours(), lunes.getMinutes(), lunes.getSeconds()]).toEqual([0, 0, 0]);
  });
});

describe('horaDe', () => {
  it('la hora del recordatorio, con dos dígitos', () => {
    // Se asierta sobre los números, no sobre el formato entero: el ICU de Node
    // puede escribir «09:30» o «09:30 a. m.» según la versión.
    expect(horaDe(rec(new Date(2026, 6, 23, 9, 30)))).toContain('09:30');
  });
});

describe('aLocal', () => {
  it('arma el valor de un input datetime-local en hora local', () => {
    expect(aLocal(new Date(2026, 6, 23, 14, 5))).toBe('2026-07-23T14:05');
  });

  it('las 00:00 se proponen como 09:00 — el clic en un día vacío cae a medianoche', () => {
    // Comportamiento INTENCIONAL y hoy sin cambios: al tocar un día del calendario
    // la fecha llega a las 00:00 y nadie agenda a esa hora, así que se propone la
    // mañana. El costo, escrito acá para que se vea: un recordatorio real de las
    // 00:30 también sale 09:30. Cambiarlo es otra decisión, no parte de #109.
    expect(aLocal(new Date(2026, 6, 23, 0, 0))).toBe('2026-07-23T09:00');
    expect(aLocal(new Date(2026, 6, 23, 0, 30))).toBe('2026-07-23T09:30');
  });
});

describe('traducirCuando', () => {
  it('lo de hoy dice «hoy» y lo de mañana dice «mañana»', () => {
    // Nombrar el día en palabras es lo que evita agendar para el mes que viene
    // sin darse cuenta: un «2026-08-23T09:00» no se lee, «mañana jueves 23» sí.
    const hoy = new Date();
    hoy.setHours(11, 0, 0, 0);
    expect(traducirCuando(hoy.toISOString()).startsWith('hoy ')).toBe(true);

    const manana = new Date();
    manana.setDate(manana.getDate() + 1);
    manana.setHours(9, 0, 0, 0);
    expect(traducirCuando(manana.toISOString()).startsWith('mañana ')).toBe(true);
  });

  it('de pasado mañana en adelante no lleva prefijo — solo el día', () => {
    const enTresDias = new Date();
    enTresDias.setDate(enTresDias.getDate() + 3);
    enTresDias.setHours(9, 0, 0, 0);
    const texto = traducirCuando(enTresDias.toISOString());
    expect(texto.startsWith('hoy ')).toBe(false);
    expect(texto.startsWith('mañana ')).toBe(false);
    expect(texto).toContain(String(enTresDias.getDate()));
  });

  it('lo que no parsea devuelve vacío, nunca «Invalid Date»', () => {
    // Un hueco es honesto; «Invalid Date» en la pantalla es un bug a la vista.
    expect(traducirCuando('cualquier cosa')).toBe('');
    expect(traducirCuando('')).toBe('');
  });
});

describe('indiceTrasAhora', () => {
  const ahora = new Date(2026, 6, 23, 12, 0);

  it('devuelve el índice del primer futuro — ahí va la línea del ahora', () => {
    const rs = [
      rec(new Date(2026, 6, 23, 9, 0)),
      rec(new Date(2026, 6, 23, 11, 0)),
      rec(new Date(2026, 6, 23, 15, 0)),
    ];
    expect(indiceTrasAhora(rs, ahora)).toBe(2);
  });

  it('si ya pasaron todos, la línea va al final', () => {
    const rs = [rec(new Date(2026, 6, 23, 8, 0)), rec(new Date(2026, 6, 23, 9, 0))];
    expect(indiceTrasAhora(rs, ahora)).toBe(2);
  });

  it('si no pasó ninguno, la línea va arriba de todo', () => {
    const rs = [rec(new Date(2026, 6, 23, 18, 0))];
    expect(indiceTrasAhora(rs, ahora)).toBe(0);
  });

  it('lista vacía → 0', () => {
    expect(indiceTrasAhora([], ahora)).toBe(0);
  });
});
