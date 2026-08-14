import { describe, expect, it } from 'vitest';
import { ErrorApi } from '../../lib/datos/cliente';
import { mensajeDeErrorCenturion } from './centurionSso';

/**
 * QUÉ LEE LA PERSONA CUANDO EL LINK DE CENTURIÓN NO ANDA.
 *
 * Lo que se fija acá no es la redacción: es que **cada causa termine en un paso
 * distinto**. Un mensaje que manda a hacer lo que no corresponde cuesta la tarde
 * de alguien — y el caso que lo hacía era justamente el que NO tiene arreglo del
 * lado de la persona.
 */

const MENSAJE_SIN_LINEA = 'todavía no tenés una línea de WhatsApp asignada en Hermes — avisá a soporte';

describe('mensajeDeErrorCenturion', () => {
  it('🔴 el 403 sin_linea_asignada dice lo que dijo el server, no «probá de nuevo»', () => {
    const err = new ErrorApi(MENSAJE_SIN_LINEA, 403, 'sin_linea_asignada');
    expect(mensajeDeErrorCenturion(err)).toBe(MENSAJE_SIN_LINEA);
    // Lo que NO puede decir: reintentar y usar la otra puerta fallan las dos por
    // el mismo motivo, así que ofrecerlas es mandar a perder el tiempo.
    expect(mensajeDeErrorCenturion(err)).not.toMatch(/probá de nuevo/i);
    expect(mensajeDeErrorCenturion(err)).not.toMatch(/usuario y contraseña/i);
  });

  it('el 503 de «esto no está prendido acá» no se confunde con un link vencido', () => {
    const err = new ErrorApi('el login de Centurión no está habilitado acá', 503, 'sso_no_configurado');
    expect(mensajeDeErrorCenturion(err)).toMatch(/no está habilitado/i);
  });

  it('el 401 es el link vencido, y manda de vuelta a Centurión', () => {
    const err = new ErrorApi('ese token de Centurión no sirve o venció', 401);
    expect(mensajeDeErrorCenturion(err)).toMatch(/venció o ya se usó/i);
  });

  it('cualquier otra cosa cae en el genérico, que ofrece la otra puerta', () => {
    expect(mensajeDeErrorCenturion(new TypeError('fetch failed'))).toMatch(/usuario y contraseña/i);
    expect(mensajeDeErrorCenturion(new ErrorApi('Error 500', 500))).toMatch(/usuario y contraseña/i);
  });

  it('un 403 sin mensaje no deja la pantalla en blanco: cae al genérico', () => {
    // El `message` de `ErrorApi` sale del cuerpo del server; si viniera vacío,
    // devolverlo sería un cartel de error sin una letra adentro.
    const err = new ErrorApi('', 403, 'sin_linea_asignada');
    expect(mensajeDeErrorCenturion(err).length).toBeGreaterThan(0);
  });
});
