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

describe('cursoDeTarjeta — de qué le vas a hablar (delega en el chip de la fila)', () => {
  test('el interés registrado manda: es la palabra de la vendedora', () => {
    const r = cursoDeTarjeta({ ...base, interes_curso: 'Diploma de OSINT', lead_curso: 'Criminología' });
    expect(r?.nombre).toBe('OSINT');
    expect(r?.fuente).toBe('interes');
    expect(r?.registrado).toBe(true);
  });

  test('sin interés registrado, el curso que eligió en el formulario', () => {
    const r = cursoDeTarjeta({ ...base, lead_curso: 'Diploma de Criminología' });
    expect(r?.nombre).toBe('Criminología');
    expect(r?.fuente).toBe('lead');
    expect(r?.registrado).toBe(false);
  });

  test('sin ninguno, queda el anuncio por el que entró — y NO cuenta como registrado', () => {
    const r = cursoDeTarjeta({
      ...base,
      ultima_origen: { fuente: 'anuncio', titulo: 'Diploma en Gestión Parlamentaria' },
    });
    expect(r?.fuente).toBe('anuncio');
    expect(r?.registrado).toBe(false);
  });

  test('sin ninguna de las tres, nada — ni placeholder ni hueco', () => {
    expect(cursoDeTarjeta(base)).toBeNull();
  });

  test('hereda el acortado de la fila: la edición y el calificativo no entran en la tarjeta', () => {
    const r = cursoDeTarjeta({
      ...base,
      interes_curso: 'Diploma de Especialización en Inteligencia y Contrainteligencia 14',
    });
    expect(r?.nombre).toBe('Inteligencia y Contrainteligencia');
  });

  test('el color es el mismo para dos redacciones del MISMO diploma', () => {
    const a = cursoDeTarjeta({ ...base, interes_curso: 'Diploma Internacional de OSINT 26' });
    const b = cursoDeTarjeta({ ...base, interes_curso: 'Curso de OSINT' });
    expect(a?.color).toBe(b?.color);
  });
});

describe('cotizarEnUnClic — el camino corto, con el nombre que el catálogo entiende', () => {
  test('con el curso del formulario: un clic registra el interés y mueve', () => {
    const r = cotizarEnUnClic({ ...base, lead_curso: 'Diploma de OSINT' });
    expect(r).toEqual({ crudo: 'Diploma de OSINT', etiqueta: 'OSINT', hayQueRegistrar: true });
  });

  test('con el interés ya registrado la compuerta ya está satisfecha: solo mueve', () => {
    const r = cotizarEnUnClic({ ...base, interes_curso: 'Diploma de OSINT' });
    expect(r).toEqual({ crudo: 'Diploma de OSINT', etiqueta: 'OSINT', hayQueRegistrar: false });
  });

  /**
   * EL CANDADO DE #137. El chip acorta con `familiaDeProducto` para entrar en la
   * tarjeta; el POST a `/api/gestiones/intereses` tiene que llevar el texto que
   * de verdad existe en el catálogo de la Escuela. Si acá vuelve el nombre
   * corto, se asienta un interés por un curso que nadie puede vender.
   */
  test('lo que se REGISTRA es el string crudo, jamás el nombre corto del chip', () => {
    const crudo = 'Diploma de Especialización en Inteligencia y Contrainteligencia 14';
    const r = cotizarEnUnClic({ ...base, lead_curso: crudo });
    expect(r?.crudo).toBe(crudo);
    expect(r?.etiqueta).toBe('Inteligencia y Contrainteligencia');
    expect(r?.crudo).not.toBe(r?.etiqueta);
  });

  test('el interés crudo le gana al del formulario, no el acortado de ninguno', () => {
    const r = cotizarEnUnClic({
      ...base,
      interes_curso: 'Diploma Internacional de Criminología 3',
      lead_curso: 'Diploma de OSINT',
    });
    expect(r?.crudo).toBe('Diploma Internacional de Criminología 3');
    expect(r?.hayQueRegistrar).toBe(false);
  });

  test('sin curso no hay un clic: hay que preguntar (el modal)', () => {
    expect(cotizarEnUnClic(base)).toBeNull();
  });

  /**
   * El título de un anuncio es de dónde vino la persona, no un curso del
   * catálogo: el chip lo muestra, pero registrarlo como interés sería inventar.
   */
  test('el anuncio pinta el chip pero NO habilita el clic: no es un curso del catálogo', () => {
    const c = { ...base, ultima_origen: { fuente: 'anuncio', titulo: 'Inteligencia Estratégica' } };
    expect(cursoDeTarjeta(c)).not.toBeNull();
    expect(cotizarEnUnClic(c)).toBeNull();
  });
});
