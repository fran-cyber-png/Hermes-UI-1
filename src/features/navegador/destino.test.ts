import { describe, expect, it } from 'vitest';
import { DESTINOS, interpretar } from './destino';

describe('interpretar', () => {
  it('completa https cuando se escribe el sitio a secas', () => {
    expect(interpretar('app.goberna.us')).toEqual({ ok: true, url: 'https://app.goberna.us/' });
  });

  it('no pelea con lo que ya viene completo, ni con el camino', () => {
    expect(interpretar('https://grupogoberna.com/cursos')).toEqual({
      ok: true,
      url: 'https://grupogoberna.com/cursos',
    });
  });

  it('perdona los espacios de los costados (pegar arrastra uno casi siempre)', () => {
    expect(interpretar('  app.goberna.us  ')).toEqual({ ok: true, url: 'https://app.goberna.us/' });
  });

  it('la caja vacía no es un error que haya que explicar', () => {
    expect(interpretar('')).toEqual({ ok: false, motivo: 'vacio' });
    expect(interpretar('   ')).toEqual({ ok: false, motivo: 'vacio' });
  });

  /**
   * El caso que motiva la validación de hostname: `new URL` NO tira acá, deja
   * `hola%20mundo` de host. Sin esta rama el botón se habilitaría y abriría una
   * ventana en blanco.
   */
  it('una búsqueda no es una dirección', () => {
    expect(interpretar('cuanto sale el diploma')).toEqual({ ok: false, motivo: 'no_es_direccion' });
  });

  it('una palabra sin punto tampoco', () => {
    expect(interpretar('cerberus')).toEqual({ ok: false, motivo: 'no_es_direccion' });
    expect(interpretar('localhost')).toEqual({ ok: false, motivo: 'no_es_direccion' });
  });

  /**
   * 🔴 NO se traduce a https. Rust rechaza todo lo que no sea https, y esa es la
   * garantía; si acá se "arreglara" el esquema, la vendedora recibiría un sitio
   * distinto del que pidió sin que nada se lo diga. Que pase entero y que el
   * rechazo lo dé quien manda.
   */
  it('deja pasar el esquema que se escribió, para que lo juzgue Rust', () => {
    expect(interpretar('http://app.goberna.us')).toEqual({ ok: true, url: 'http://app.goberna.us/' });
    expect(interpretar('javascript:alert(1)')).toEqual({ ok: false, motivo: 'no_es_direccion' });
  });
});

describe('DESTINOS', () => {
  /**
   * Todos https, o el atajo se rompería contra la guarda de Rust — y un atajo
   * roto es peor que no tenerlo: se aprieta antes de leer.
   */
  it('los atajos son todos https y todos válidos', () => {
    for (const d of DESTINOS) {
      expect(interpretar(d.url), d.nombre).toEqual({ ok: true, url: expect.any(String) });
      expect(new URL(d.url).protocol, d.nombre).toBe('https:');
    }
  });
});
