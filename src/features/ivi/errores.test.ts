import { describe, expect, it } from 'vitest';
import { ErrorApi } from '../../lib/datos/cliente';
import { CODIGOS_ERROR_IVI, lecturaDeError } from './errores';

/**
 * LOS OCHO CÓDIGOS DEL PROXY, TRADUCIDOS A ALGO QUE UNA VENDEDORA PUEDA HACER.
 *
 * Hoy `/api/preguntar` de Ivi da 404 en producción, así que el 502 es lo PRIMERO que va a
 * ver una vendedora real cuando abra esta pantalla. Un estado que se ve siempre no puede ser
 * un `catch` feo.
 */

function error502(codigo: string) {
  return new ErrorApi('lo que sea que diga el server', 502, undefined, undefined, codigo);
}

/** Siempre hay lectura para un error real: el `!` es el aserto, no un descuido. */
function leer(codigo: string) {
  return lecturaDeError(error502(codigo))!;
}

describe('lecturaDeError — cada código dice qué pasó y qué hacer', () => {
  it('los ocho códigos tienen lectura propia: ninguno cae en el genérico', () => {
    const leidos = CODIGOS_ERROR_IVI.map((c) => leer(c));
    expect(leidos).toHaveLength(8);
    for (const l of leidos) {
      expect(l.titulo.length).toBeGreaterThan(0);
      expect(l.queHacer.length).toBeGreaterThan(0);
    }
    // Ocho títulos distintos: si dos códigos se leyeran igual, tener ocho no serviría de nada.
    expect(new Set(leidos.map((l) => l.titulo)).size).toBe(8);
  });

  it('NINGUNA lectura se puede confundir con «Ivi no encontró datos» (regla dura del repo)', () => {
    for (const c of CODIGOS_ERROR_IVI) {
      const l = leer(c);
      const todo = `${l.titulo} ${l.detalle} ${l.queHacer}`.toLowerCase();
      expect(todo, c).not.toMatch(/no encontr|no hay datos|sin resultados|no sabe/);
    }
  });

  it('el código crudo siempre viaja: una captura de pantalla tiene que alcanzar para reportar', () => {
    expect(leer('timeout').codigo).toBe('timeout');
  });

  it('solo lo transitorio ofrece reintentar — reintentar una config rota es hacerle perder el tiempo', () => {
    expect(leer('timeout').reintentable).toBe(true);
    expect(leer('red').reintentable).toBe(true);
    expect(leer('falta_config').reintentable).toBe(false);
    expect(leer('config_hermes').reintentable).toBe(false);
    expect(leer('ivi_no_configurado').reintentable).toBe(false);
    expect(leer('respuesta_invalida').reintentable).toBe(false);
  });

  it('los problemas de configuración se nombran como lo que son: de Hermes, no de Ivi', () => {
    expect(leer('falta_config').culpa).toBe('hermes');
    expect(leer('config_hermes').culpa).toBe('hermes');
    expect(leer('ivi_no_configurado').culpa).toBe('ivi');
    expect(leer('red').culpa).toBe('red');
  });

  it('un código que Hermes no conoce se lee igual, mostrándolo — nunca un renglón en blanco', () => {
    const l = leer('codigo_del_futuro');
    expect(l.codigo).toBe('codigo_del_futuro');
    expect(l.titulo.length).toBeGreaterThan(0);
    expect(l.reintentable).toBe(false);
  });

  it('un 401 es la sesión de la vendedora, no un fallo de Ivi: se dice distinto', () => {
    const l = lecturaDeError(new ErrorApi('no autorizado', 401))!;
    expect(l.titulo).toMatch(/sesión/i);
    expect(l.culpa).toBe('sesion');
  });

  it('un fallo sin respuesta del server (la app no llegó ni a hablar) también tiene lectura', () => {
    const l = lecturaDeError(new TypeError('Failed to fetch'))!;
    expect(l.titulo.length).toBeGreaterThan(0);
    expect(l.reintentable).toBe(true);
  });

  it('sin error no hay lectura', () => {
    expect(lecturaDeError(null)).toBeNull();
  });
});
