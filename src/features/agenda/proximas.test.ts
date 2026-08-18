import { describe, expect, it } from 'vitest';
import { agruparProximas, etiquetaDeDia, pendientesFuturas } from './proximas';
import type { Recordatorio } from './agenda';

/**
 * El resumen de próximas actividades. Lo que se fija acá son las tres
 * decisiones de producto: **lo hecho no es lo que sigue**, **lo vencido va
 * primero** y **lo vencido no paga el tope** de la lista.
 *
 * Fechas con el constructor LOCAL, como en toda la agenda.
 */

const rec = (cuando: Date, over: Partial<Recordatorio> = {}): Recordatorio => ({
  id: Math.round(cuando.getTime() / 1000),
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

const HOY = new Date(2026, 7, 17, 15, 30); // lunes 17-ago-2026

describe('etiquetaDeDia', () => {
  it('hoy y mañana se dicen con palabras', () => {
    expect(etiquetaDeDia(new Date(2026, 7, 17), HOY)).toBe('Hoy');
    expect(etiquetaDeDia(new Date(2026, 7, 18), HOY)).toBe('Mañana');
  });

  it('de ahí en adelante el día dice su nombre Y su mes', () => {
    // Sin el mes, el «20» de agosto y el de septiembre se leen igual.
    const e = etiquetaDeDia(new Date(2026, 8, 20), HOY);
    expect(e).toContain('20');
    expect(e).toContain('septiembre');
  });
});

describe('agruparProximas', () => {
  it('lo HECHO no entra: el resumen es lo que sigue, no lo que pasó', () => {
    const rs = [rec(new Date(2026, 7, 18, 9, 0), { estado: 'hecho' })];
    expect(agruparProximas(rs, HOY)).toEqual([]);
  });

  it('lo vencido va PRIMERO y en su propio grupo', () => {
    const rs = [rec(new Date(2026, 7, 19, 9, 0)), rec(new Date(2026, 7, 10, 9, 0))];
    const g = agruparProximas(rs, HOY);
    expect(g[0].etiqueta).toBe('Vencidas');
    expect(g[0].vencido).toBe(true);
    expect(g[0].dia).toBeNull();
    expect(g[1].vencido).toBe(false);
  });

  it('una promesa de HOY más temprano NO es una vencida', () => {
    // El vencimiento es por día: a las 09:00 con el reloj en 15:30 sigue siendo
    // de hoy. Contarla como vencida haría gritar al resumen cada tarde.
    const g = agruparProximas([rec(new Date(2026, 7, 17, 9, 0))], HOY);
    expect(g).toHaveLength(1);
    expect(g[0].etiqueta).toBe('Hoy');
  });

  it('agrupa por día y respeta el orden de la hora', () => {
    const rs = [
      rec(new Date(2026, 7, 18, 16, 0), { id: 2 }),
      rec(new Date(2026, 7, 18, 9, 0), { id: 1 }),
      rec(new Date(2026, 7, 19, 9, 0), { id: 3 }),
    ];
    const g = agruparProximas(rs, HOY);
    expect(g.map((x) => x.etiqueta)).toEqual(['Mañana', 'miércoles, 19 de agosto']);
    expect(g[0].recordatorios.map((r) => r.id)).toEqual([1, 2]);
  });

  it('el tope recorta lo FUTURO y las vencidas no lo pagan', () => {
    const vencidas = Array.from({ length: 4 }, (_, i) => rec(new Date(2026, 7, 10 + i, 9, 0), { id: 100 + i }));
    const futuras = Array.from({ length: 5 }, (_, i) => rec(new Date(2026, 7, 18 + i, 9, 0), { id: 200 + i }));
    const g = agruparProximas([...vencidas, ...futuras], HOY, 2);
    expect(g[0].recordatorios).toHaveLength(4); // las cuatro vencidas, enteras
    expect(g.slice(1).reduce((n, x) => n + x.recordatorios.length, 0)).toBe(2);
  });
});

describe('pendientesFuturas', () => {
  it('cuenta lo pendiente de hoy en adelante, sin lo hecho ni lo vencido', () => {
    const rs = [
      rec(new Date(2026, 7, 10)), // vencida
      rec(new Date(2026, 7, 17, 9, 0)), // hoy
      rec(new Date(2026, 7, 25)), // futura
      rec(new Date(2026, 7, 26), { estado: 'hecho' }),
    ];
    expect(pendientesFuturas(rs, HOY)).toBe(2);
  });
});
