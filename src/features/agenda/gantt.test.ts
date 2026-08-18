import { describe, expect, it } from 'vitest';
import { armarGantt, barraDe, diasDeGantt, diasEntre, estadoDeBarra, rangoDeGantt } from './gantt';
import type { Recordatorio } from './agenda';

/**
 * El Gantt de la agenda: lo que se fija acá es **qué mide una barra**, que es la
 * única decisión de producto del módulo. Lo demás (colores, anchos en píxeles)
 * es dibujo y vive en `VistaGantt.tsx`.
 *
 * Todas las fechas se construyen con el constructor LOCAL, nunca con ISO + `Z`:
 * la agenda se lee en la hora de la vendedora y el runner de CI está en otra
 * zona (la misma regla que `fechas.test.ts`).
 */

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

const HOY = new Date(2026, 7, 17, 15, 30); // lunes 17-ago-2026, media tarde
const DIAS = diasDeGantt(new Date(2026, 7, 17), 21); // 17-ago .. 6-sep

describe('diasEntre', () => {
  it('cuenta días de CALENDARIO, no de 24 horas', () => {
    // Las 23:59 de hoy y las 00:01 de mañana están a dos minutos y a un día.
    expect(diasEntre(new Date(2026, 7, 17, 23, 59), new Date(2026, 7, 18, 0, 1))).toBe(1);
  });

  it('el mismo día a distinta hora es cero', () => {
    expect(diasEntre(new Date(2026, 7, 17, 1, 0), new Date(2026, 7, 17, 23, 0))).toBe(0);
  });

  it('hacia atrás da negativo', () => {
    expect(diasEntre(new Date(2026, 7, 17), new Date(2026, 7, 14))).toBe(-3);
  });
});

describe('diasDeGantt', () => {
  it('devuelve días consecutivos desde la medianoche del primero', () => {
    const d = diasDeGantt(new Date(2026, 7, 17, 18, 45), 3);
    expect(d).toHaveLength(3);
    expect(d[0].getHours()).toBe(0);
    expect(d.map((x) => x.getDate())).toEqual([17, 18, 19]);
  });

  it('cruza el fin de mes sin saltarse nada', () => {
    const d = diasDeGantt(new Date(2026, 7, 30), 4);
    expect(d.map((x) => `${x.getDate()}/${x.getMonth() + 1}`)).toEqual(['30/8', '31/8', '1/9', '2/9']);
  });
});

describe('estadoDeBarra', () => {
  it('lo hecho está hecho AUNQUE haya vencido — la misma precedencia que el chip', () => {
    expect(estadoDeBarra(rec(new Date(2026, 7, 10), { estado: 'hecho' }), HOY)).toBe('hecha');
  });

  it('pendiente de ayer es vencida', () => {
    expect(estadoDeBarra(rec(new Date(2026, 7, 16, 9, 0)), HOY)).toBe('vencida');
  });

  it('pendiente de HOY todavía no venció, aunque la hora ya haya pasado', () => {
    // El vencimiento de la agenda es por DÍA: a las 09:00 con el reloj en 15:30
    // la promesa sigue siendo de hoy, no una deuda de ayer.
    expect(estadoDeBarra(rec(new Date(2026, 7, 17, 9, 0)), HOY)).toBe('corriendo');
  });
});

describe('barraDe', () => {
  it('una promesa que corre va de HOY hasta el día que vence: el margen que queda', () => {
    const b = barraDe(rec(new Date(2026, 7, 20, 9, 0)), DIAS, HOY);
    expect(b).not.toBeNull();
    expect(b!.desde).toBe(0); // hoy es la primera columna
    expect(b!.ancho).toBe(4); // 17, 18, 19 y 20
    expect(b!.estado).toBe('corriendo');
  });

  it('una vencida va del día que venció hasta HOY: la deuda, y crece sola', () => {
    const dias = diasDeGantt(new Date(2026, 7, 14), 21); // arranca antes de hoy
    const b = barraDe(rec(new Date(2026, 7, 15, 9, 0)), dias, HOY);
    expect(b!.desde).toBe(1); // 15-ago
    expect(b!.ancho).toBe(3); // 15, 16 y 17
    expect(b!.estado).toBe('vencida');
  });

  it('lo hecho ocupa UN día: ya no dura nada', () => {
    const b = barraDe(rec(new Date(2026, 7, 20), { estado: 'hecho' }), DIAS, HOY);
    expect(b!.ancho).toBe(1);
    expect(b!.desde).toBe(3);
  });

  it('lo que empieza antes de la ventana se recorta y lo DICE', () => {
    // Venció hace un mes: el tramo real arranca fuera de la vista.
    const b = barraDe(rec(new Date(2026, 6, 10)), DIAS, HOY);
    expect(b!.desde).toBe(0);
    expect(b!.cortadaIzquierda).toBe(true);
    expect(b!.cortadaDerecha).toBe(false);
  });

  it('lo que termina después de la ventana también se dice', () => {
    const b = barraDe(rec(new Date(2026, 9, 1)), DIAS, HOY);
    expect(b!.cortadaDerecha).toBe(true);
    expect(b!.desde).toBe(0);
    expect(b!.ancho).toBe(DIAS.length);
  });

  it('lo que cae ENTERO fuera de la ventana no se dibuja', () => {
    // Un hecho de julio: sin este descarte quedaría una barra de ancho cero
    // pegada al borde, que se leería como una promesa de ese día.
    expect(barraDe(rec(new Date(2026, 6, 1), { estado: 'hecho' }), DIAS, HOY)).toBeNull();
  });

  it('sin días no hay barra', () => {
    expect(barraDe(rec(new Date(2026, 7, 20)), [], HOY)).toBeNull();
  });
});

describe('armarGantt', () => {
  it('ordena por fecha y descarta lo que no entra en la ventana', () => {
    const rs = [
      rec(new Date(2026, 7, 25), { id: 3 }),
      rec(new Date(2026, 6, 1), { id: 99, estado: 'hecho' }), // fuera
      rec(new Date(2026, 7, 18), { id: 2 }),
    ];
    expect(armarGantt(rs, DIAS, HOY).map((b) => b.r.id)).toEqual([2, 3]);
  });

  it('una fila por PROMESA: dos del mismo contacto no se colapsan', () => {
    const rs = [
      rec(new Date(2026, 7, 19), { id: 1, personaId: '51999888777' }),
      rec(new Date(2026, 7, 21), { id: 2, personaId: '51999888777' }),
    ];
    expect(armarGantt(rs, DIAS, HOY)).toHaveLength(2);
  });
});

describe('rangoDeGantt', () => {
  it('nombra las dos puntas del tramo', () => {
    expect(rangoDeGantt(DIAS)).toContain('–');
  });

  it('sin días no inventa un rango', () => {
    expect(rangoDeGantt([])).toBe('');
  });
});
