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

/**
 * #175 — CUANDO EL SERVER SE PRONUNCIA, MANDA ÉL.
 *
 * El 502 trae `reintentable` ya calculado, con el estado HTTP a la vista. Acá el estado no
 * llega, así que la tabla de este archivo **no puede** decidir bien `http_inesperado`: adentro
 * de ese código conviven el 404 permanente y el 500 transitorio.
 *
 * Los tests de arriba siguen construyendo el error SIN el flag a propósito: son los que fijan
 * el respaldo para un server viejo. Estos fijan la preferencia.
 */
function error502Con(codigo: string, reintentable: boolean | undefined) {
  return new ErrorApi('lo que sea que diga el server', 502, undefined, undefined, codigo, reintentable);
}

describe('lecturaDeError — el flag del server le gana a la tabla del front', () => {
  it('EL CASO DEL ISSUE: el 500 transitorio de Ivi ofrece reintentar, aunque la tabla diga que no', () => {
    // `http_inesperado` es el cajón de sastre. Con un 500 de Ivi —pgvector reiniciándose— el
    // server manda `reintentable: true`; la tabla, que no ve el estado, tiene `false`.
    expect(leer('http_inesperado').reintentable).toBe(false);
    expect(lecturaDeError(error502Con('http_inesperado', true))!.reintentable).toBe(true);
  });

  it('y el 404 del mismo código sigue sin ofrecerlo: no es «siempre true», es lo que dijo el server', () => {
    expect(lecturaDeError(error502Con('http_inesperado', false))!.reintentable).toBe(false);
  });

  it('el flag también apaga: un server que dice `false` sobre algo que la tabla cree transitorio', () => {
    expect(leer('timeout').reintentable).toBe(true);
    expect(lecturaDeError(error502Con('timeout', false))!.reintentable).toBe(false);
  });

  it('un código que esta versión no conoce toma el flag — es donde la tabla no tiene NADA que decir', () => {
    const l = lecturaDeError(error502Con('codigo_del_futuro', true))!;
    expect(l.codigo).toBe('codigo_del_futuro');
    expect(l.reintentable).toBe(true);
    // Y se sigue leyendo como un código desconocido, no como uno inventado.
    expect(l.titulo.length).toBeGreaterThan(0);
  });

  it('sin flag manda la tabla: un server viejo no deja la pantalla sin criterio', () => {
    expect(lecturaDeError(error502Con('timeout', undefined))!.reintentable).toBe(true);
    expect(lecturaDeError(error502Con('falta_config', undefined))!.reintentable).toBe(false);
  });

  it('el flag NO toca el resto de la lectura: solo responde «¿sirve reintentar?»', () => {
    const sin = leer('http_inesperado');
    const con = lecturaDeError(error502Con('http_inesperado', true))!;
    expect(con.titulo).toBe(sin.titulo);
    expect(con.detalle).toBe(sin.detalle);
    expect(con.culpa).toBe(sin.culpa);
    expect(con.codigo).toBe(sin.codigo);
  });

  it('un 401 no consulta el flag: «volvé a entrar» no es reintentar la misma consulta', () => {
    const l = lecturaDeError(new ErrorApi('no autorizado', 401, undefined, undefined, undefined, true))!;
    expect(l.culpa).toBe('sesion');
    expect(l.reintentable).toBe(false);
  });
});
