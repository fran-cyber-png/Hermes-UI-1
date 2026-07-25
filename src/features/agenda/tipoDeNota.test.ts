import { describe, expect, it } from 'vitest';
import { barraDeNota, estiloDeNota, tipoDeNota, tipoDominante } from './tipoDeNota';
import type { Recordatorio } from './agenda';

/**
 * El tipo de acción de un recordatorio y su color (#109), sacados de
 * `VistaAgenda.tsx`. Lo que se fija acá son decisiones de producto: qué prefijos
 * reconoce, qué gana cuando algo está hecho Y vencido, y de qué color se pinta un
 * día entero cuando adentro hay de todo.
 */

const rec = (nota: string): Recordatorio => ({
  id: 1,
  clave: 'conv:whatsapp:51999:51961',
  canal: 'whatsapp',
  personaId: null,
  personaNombre: null,
  numeroPropio: null,
  nota,
  cuando: new Date(2026, 6, 23, 9, 0).toISOString(),
  estado: 'pendiente',
});

describe('tipoDeNota', () => {
  it('reconoce el prefijo que la vendedora tipea', () => {
    expect(tipoDeNota('llamada a Ana por el precio')).toBe('llamada');
    expect(tipoDeNota('wsp mandarle el temario')).toBe('wsp');
    expect(tipoDeNota('correo con la cotización')).toBe('correo');
  });

  it('«reunión» y «reunion» son lo mismo — la tilde no siempre se pone', () => {
    expect(tipoDeNota('reunión con el área')).toBe('reunion');
    expect(tipoDeNota('reunion con el area')).toBe('reunion');
  });

  it('no distingue mayúsculas', () => {
    expect(tipoDeNota('LLAMADA urgente')).toBe('llamada');
    expect(tipoDeNota('Wsp de seguimiento')).toBe('wsp');
  });

  it('el texto libre cae en «otro», y eso no es un fallo', () => {
    // La mayoría de las notas son texto suelto: se pintan neutras, no rotas.
    expect(tipoDeNota('preguntar si ya cobró')).toBe('otro');
    expect(tipoDeNota('')).toBe('otro');
  });

  it('el prefijo tiene que estar al principio, no en el medio', () => {
    // Si bastara con contener la palabra, «avisarle que no hubo llamada» se
    // pintaría como una llamada pendiente.
    expect(tipoDeNota('avisarle que no hubo llamada')).toBe('otro');
  });
});

describe('estiloDeNota y barraDeNota — la precedencia', () => {
  it('lo hecho se apaga aunque esté vencido', () => {
    // No sirve gritarle a la vendedora por algo que ya resolvió.
    expect(estiloDeNota('llamada a Ana', true, true)).toContain('line-through');
    expect(barraDeNota('llamada a Ana', true, true)).toBe('bg-muted-foreground/40');
  });

  it('lo vencido grita en rojo aunque fuera una llamada', () => {
    expect(estiloDeNota('llamada a Ana', true, false)).toContain('text-destructive');
    expect(barraDeNota('llamada a Ana', true, false)).toBe('bg-destructive');
  });

  it('sin vencer ni hacer, manda el tipo', () => {
    expect(estiloDeNota('wsp el temario', false, false)).toBe('bg-success/10 text-success');
    expect(barraDeNota('wsp el temario', false, false)).toBe('bg-success');
  });

  it('el dorado no aparece nunca — el oro es solo tiempo que se acaba', () => {
    const combinaciones = [
      estiloDeNota('llamada', false, false),
      estiloDeNota('reunión', true, false),
      estiloDeNota('correo', false, true),
      barraDeNota('wsp', false, false),
      barraDeNota('otro', true, false),
    ];
    for (const clase of combinaciones) expect(clase).not.toContain('gold');
  });
});

describe('tipoDominante', () => {
  it('gana el tipo más repetido del día', () => {
    const rs = [rec('wsp uno'), rec('llamada dos'), rec('llamada tres')];
    expect(tipoDominante(rs)).toBe('llamada');
  });

  it('en empate gana el que llegó primero', () => {
    // Con uno de cada tipo no hay mayoría: el puntito del día se queda con el
    // primero en vez de parpadear según el orden en que llegaron los datos.
    expect(tipoDominante([rec('llamada a Ana'), rec('wsp a Beto')])).toBe('llamada');
    expect(tipoDominante([rec('wsp a Beto'), rec('llamada a Ana')])).toBe('wsp');
  });

  it('un día vacío es «otro»', () => {
    expect(tipoDominante([])).toBe('otro');
  });
});
