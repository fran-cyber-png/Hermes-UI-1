import { describe, expect, test } from 'vitest';
import {
  cotizarEnUnClic,
  cursoDeTarjeta,
  esLegible,
  haceCorto,
  nombreDeTarjeta,
  turnoDeTarjeta,
  type DatosTarjeta,
} from './tarjeta';

/**
 * QUÉ DICE UNA TARJETA DEL PIPELINE — la política, sin DOM.
 *
 * Una tarjeta que dice todo no dice nada: con 1.389 en una columna, cada línea
 * que sobra es una decisión que la vendedora no toma. Acá se decide qué entra,
 * y `TarjetaEmbudo` solo pinta.
 */

const base: DatosTarjeta = {
  canal: 'whatsapp',
  persona_id: '51987654321',
  persona_nombre: 'Sofi',
  respondida: true,
  nivel: 4,
  referencia: new Date().toISOString(),
};

describe('esLegible — el filtro de los nombres basura de WhatsApp', () => {
  test('un nombre con dos letras o más es legible', () => {
    expect(esLegible('Sofi')).toBe(true);
    expect(esLegible('c.j.p.m')).toBe(true);
    expect(esLegible('Ken')).toBe(true);
  });

  test('los reales de producción que NO dicen quién es la persona', () => {
    expect(esLegible('🦋W')).toBe(false);
    expect(esLegible('.')).toBe(false);
    expect(esLegible('10 ❤️L')).toBe(false);
    expect(esLegible('')).toBe(false);
    expect(esLegible(null)).toBe(false);
  });
});

describe('nombreDeTarjeta — quién es', () => {
  test('el nombre del formulario le gana al de WhatsApp', () => {
    const r = nombreDeTarjeta({ ...base, persona_nombre: 'Sofi', lead_nombre: 'Luz Esteban' });
    expect(r).toEqual({ texto: 'Luz Esteban', delFormulario: true });
  });

  test('sin formulario, el de WhatsApp si se entiende', () => {
    expect(nombreDeTarjeta(base)).toEqual({ texto: 'Sofi', delFormulario: false });
  });

  test('un pushname basura cae al teléfono formateado, no a «Sin nombre»', () => {
    const r = nombreDeTarjeta({ ...base, persona_nombre: '🦋W' });
    expect(r).toEqual({ texto: '51 987 654 321', delFormulario: false });
  });

  test('un comentario de Meta sin nombre ni teléfono lo dice y no inventa', () => {
    const r = nombreDeTarjeta({ ...base, canal: 'facebook', persona_id: null, persona_nombre: null });
    expect(r).toEqual({ texto: 'Sin nombre', delFormulario: false });
  });
});

describe('turnoDeTarjeta — de quién es la pelota (CONTEXT.md)', () => {
  test('el último mensaje es de ella: deuda', () => {
    expect(turnoDeTarjeta({ ...base, respondida: false }).turno).toBe('deuda');
  });

  test('el último mensaje es nuestro: silencio', () => {
    expect(turnoDeTarjeta(base).turno).toBe('silencio');
  });

  test('un seguimiento vencido gana: es el único plazo que la vendedora se puso', () => {
    const r = turnoDeTarjeta({ ...base, nivel: 1 });
    expect(r.turno).toBe('vencido');
    expect(r.apremia).toBe(true);
  });

  test('alguien escribiendo AHORA (nivel 0) apremia', () => {
    const r = turnoDeTarjeta({ ...base, respondida: false, nivel: 0 });
    expect(r).toEqual({ turno: 'deuda', apremia: true });
  });

  test('un silencio no apremia: el turno es de la persona', () => {
    expect(turnoDeTarjeta(base).apremia).toBe(false);
  });
});

describe('haceCorto — el tiempo en una columna angosta', () => {
  test('menos de una hora, en minutos', () => {
    expect(haceCorto(0.5)).toBe('30 m');
    expect(haceCorto(0.001)).toBe('1 m');
  });

  test('el día, en horas', () => {
    expect(haceCorto(14)).toBe('14 h');
  });

  test('más de un día, en días', () => {
    expect(haceCorto(72)).toBe('3 d');
  });

  test('una fecha imposible no pinta basura', () => {
    expect(haceCorto(Number.NaN)).toBe('');
  });
});

describe('cursoDeTarjeta — de qué le vas a hablar', () => {
  test('el interés registrado manda: es la palabra de la vendedora', () => {
    const r = cursoDeTarjeta({ ...base, cursos: ['Diploma de OSINT'], lead_curso: 'Criminología' });
    expect(r).toEqual({ curso: 'Diploma de OSINT', registrado: true, otros: 0 });
  });

  test('varios intereses: el primero y cuántos más (la ficha muestra la línea entera)', () => {
    const r = cursoDeTarjeta({ ...base, cursos: ['OSINT', 'Criminología'] });
    expect(r).toEqual({ curso: 'OSINT', registrado: true, otros: 1 });
  });

  test('sin interés registrado, el curso que eligió en el formulario', () => {
    const r = cursoDeTarjeta({ ...base, lead_curso: 'Diploma de Criminología' });
    expect(r).toEqual({ curso: 'Diploma de Criminología', registrado: false, otros: 0 });
  });

  test('sin ninguno de los dos, nada — ni placeholder ni hueco', () => {
    expect(cursoDeTarjeta(base)).toBeNull();
  });
});

describe('cotizarEnUnClic — el camino corto que hoy no existe', () => {
  test('con el curso del formulario: un clic registra el interés y mueve', () => {
    const r = cotizarEnUnClic({ ...base, lead_curso: 'Diploma de OSINT' });
    expect(r).toEqual({ curso: 'Diploma de OSINT', hayQueRegistrar: true });
  });

  test('con el interés ya registrado la compuerta ya está satisfecha: solo mueve', () => {
    const r = cotizarEnUnClic({ ...base, cursos: ['Diploma de OSINT'] });
    expect(r).toEqual({ curso: 'Diploma de OSINT', hayQueRegistrar: false });
  });

  test('sin curso no hay un clic: hay que preguntar (el modal)', () => {
    expect(cotizarEnUnClic(base)).toBeNull();
  });
});
