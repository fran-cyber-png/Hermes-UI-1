import { describe, expect, it } from 'vitest';
import { faltaLoMinimo, partirIdentidad, prellenar } from './fichaLocal';

/**
 * EL PRELLENADO, QUE ES TODA LA VELOCIDAD DE ESTA PANTALLA.
 *
 * Registrar un contacto tiene que costar 5 segundos, y eso sólo pasa si lo que
 * ya está en el chat no se vuelve a tipear. Estos tests fijan justamente eso:
 * qué sale solo, y qué NO se pisa cuando ya hay algo escrito.
 */

describe('partirIdentidad', () => {
  it('parte el alias que trae la empresa pegada con un guion (caso real de la cola)', () => {
    expect(partirIdentidad('Jorge Martin - JM RUSH AUTOMOTRIZ')).toEqual({
      nombre: 'Jorge',
      apellido: 'Martin',
      empresa: 'JM RUSH AUTOMOTRIZ',
    });
  });

  it('NO parte un guion sin espacios: Jean-Pierre es el nombre de alguien', () => {
    expect(partirIdentidad('Jean-Pierre Gutierrez')).toEqual({
      nombre: 'Jean-Pierre',
      apellido: 'Gutierrez',
      empresa: '',
    });
  });

  it('los dos apellidos van juntos, que es como se escriben acá', () => {
    expect(partirIdentidad('Maria Elena Quispe Rojas').apellido).toBe('Elena Quispe Rojas');
  });

  it('una sola palabra es un NOMBRE, nunca un apellido', () => {
    expect(partirIdentidad('Sindy')).toEqual({ nombre: 'Sindy', apellido: '', empresa: '' });
  });

  it('sin nombre devuelve todo vacío, nunca undefined', () => {
    expect(partirIdentidad(null)).toEqual({ nombre: '', apellido: '', empresa: '' });
  });
});

describe('prellenar', () => {
  it('el chat solo ya llena nombre, apellido, empresa y teléfono', () => {
    const d = prellenar({ aliasChat: 'Jorge Martin - JM RUSH AUTOMOTRIZ', telefono: '51955950559' });
    expect(d).toMatchObject({
      nombre: 'Jorge',
      apellido: 'Martin',
      empresa: 'JM RUSH AUTOMOTRIZ',
      telefono: '51955950559',
    });
  });

  it('Cerberus manda sobre el alias, pero la EMPRESA del alias se conserva', () => {
    const d = prellenar({
      aliasChat: 'Jorgito - JM RUSH AUTOMOTRIZ',
      nombreCerberus: 'Jorge Luis Martin Salazar',
      correoCerberus: 'jorge@jmrush.pe',
    });
    expect(d.nombre).toBe('Jorge');
    expect(d.apellido).toBe('Luis Martin Salazar');
    expect(d.empresa).toBe('JM RUSH AUTOMOTRIZ');
    expect(d.email).toBe('jorge@jmrush.pe');
  });

  it('lo YA REGISTRADO gana: reabrir la ficha no revierte lo que alguien corrigió', () => {
    const d = prellenar({
      ficha: {
        clave: 'conv:x',
        telefono: '51955950559',
        nombre: 'Jorge',
        apellido: 'Martín Salazar',
        empresa: 'JM Rush',
        email: null,
        prioridad: 'alta',
        vendedoraId: 'luz',
        creadoAt: '',
        actualizadoAt: '',
      },
      aliasChat: 'Jorge Martin - JM RUSH AUTOMOTRIZ',
      correoLead: 'jorge@jmrush.pe',
    });
    expect(d.apellido).toBe('Martín Salazar');
    expect(d.empresa).toBe('JM Rush');
    expect(d.prioridad).toBe('alta');
    // Un campo vacío en la ficha SÍ se completa con lo que se sepa de afuera.
    expect(d.email).toBe('jorge@jmrush.pe');
  });
});

describe('faltaLoMinimo', () => {
  const vacio = { telefono: '', nombre: '', apellido: '', empresa: '', email: '', prioridad: null };

  it('sin nombre ni teléfono no hay ficha que valga', () => {
    expect(faltaLoMinimo(vacio)).toBe(true);
  });

  it('con el teléfono solo alcanza: un número es a quién llamar', () => {
    expect(faltaLoMinimo({ ...vacio, telefono: '51955950559' })).toBe(false);
  });
});
