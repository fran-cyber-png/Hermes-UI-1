import { describe, expect, it } from 'vitest';
import { nombreDelContacto } from './identidad';

describe('nombreDelContacto — el nombre real le gana al pushname', () => {
  it('con nada, no inventa un nombre', () => {
    expect(nombreDelContacto({})).toEqual({ principal: null, alias: null, fuente: 'ninguna' });
  });

  it('solo el pushname: es lo que hay, y no queda alias que repetir', () => {
    expect(nombreDelContacto({ pushname: 'MUMM-RA' })).toEqual({
      principal: 'MUMM-RA',
      alias: null,
      fuente: 'whatsapp',
    });
  });

  it('el nombre del formulario le gana al pushname basura, y el basura queda de alias', () => {
    expect(nombreDelContacto({ pushname: '🦋W', leadNombre: 'Javier Zeballos' })).toEqual({
      principal: 'Javier Zeballos',
      alias: '🦋W',
      fuente: 'formulario',
    });
  });

  it('Cerberus le gana al formulario: firmó una venta, no llenó un campo', () => {
    const n = nombreDelContacto({
      pushname: 'Alejandro Vila',
      leadNombre: 'Alejandro V.',
      cerberusNombre: 'DR EN DERECHO IGNACIO ALEJANDRO VILA CHÁVEZ',
    });
    expect(n.principal).toBe('DR EN DERECHO IGNACIO ALEJANDRO VILA CHÁVEZ');
    expect(n.fuente).toBe('cerberus');
    expect(n.alias).toBe('Alejandro Vila');
  });

  it('si el pushname es el mismo nombre, no se repite abajo — solo cambia el tamaño de letra', () => {
    expect(nombreDelContacto({ pushname: 'javier  zeballos', leadNombre: 'Javier Zeballos' }).alias).toBeNull();
  });

  it('un nombre en blanco no es un nombre', () => {
    expect(nombreDelContacto({ pushname: 'Kevin', leadNombre: '   ' })).toEqual({
      principal: 'Kevin',
      alias: null,
      fuente: 'whatsapp',
    });
  });
});
