import { describe, expect, test } from 'vitest';
import { crearCacheDeBlobs } from './cacheDeBlobs';

/**
 * El caché existe porque la media autenticada se baja con fetch (los endpoints
 * exigen Bearer, #36) y sin caché cambiar de chat y volver re-bajaba TODO el
 * hilo. Las reglas que estos tests fijan: una URL se baja UNA vez (aun con dos
 * componentes pidiéndola a la vez), lo menos usado se revoca al superar el
 * límite, y el logout revoca todo — los blobs de una vendedora no se los
 * hereda la siguiente.
 */

function armar(limite = 3) {
  const revocados: string[] = [];
  const cache = crearCacheDeBlobs(limite, (v) => revocados.push(v));
  let bajadas = 0;
  const bajar = (valor: string | null = 'blob:x') => {
    bajadas += 1;
    return Promise.resolve(valor);
  };
  return { cache, revocados, bajar, cuantasBajadas: () => bajadas };
}

describe('crearCacheDeBlobs', () => {
  test('la segunda pedida de la misma URL sale del caché, sin volver a bajar', async () => {
    const { cache, bajar, cuantasBajadas } = armar();
    expect(await cache.traer('a', () => bajar('blob:a'))).toBe('blob:a');
    expect(await cache.traer('a', () => bajar('blob:otra'))).toBe('blob:a');
    expect(cuantasBajadas()).toBe(1);
  });

  test('dos pedidas CONCURRENTES comparten una sola bajada (dos burbujas, un fetch)', async () => {
    const { cache, cuantasBajadas } = armar();
    let soltar!: (v: string) => void;
    const lenta = new Promise<string>((res) => (soltar = res));
    let bajadas = 0;
    const bajar = () => {
      bajadas += 1;
      return lenta;
    };
    const p1 = cache.traer('a', bajar);
    const p2 = cache.traer('a', bajar);
    soltar('blob:a');
    expect(await p1).toBe('blob:a');
    expect(await p2).toBe('blob:a');
    expect(bajadas).toBe(1);
    expect(cuantasBajadas()).toBe(0);
  });

  test('al superar el límite se revoca el MENOS usado, no el que está en pantalla', async () => {
    const { cache, revocados } = armar(2);
    await cache.traer('a', () => Promise.resolve('blob:a'));
    await cache.traer('b', () => Promise.resolve('blob:b'));
    // 'a' se vuelve a usar (está en pantalla): pasa al frente.
    expect(cache.obtener('a')).toBe('blob:a');
    await cache.traer('c', () => Promise.resolve('blob:c'));
    expect(revocados).toEqual(['blob:b']); // el sacrificado es b, el más frío
    expect(cache.obtener('a')).toBe('blob:a');
    expect(cache.obtener('b')).toBeNull();
  });

  test('una bajada que devuelve null (404) no se cachea: la próxima reintenta', async () => {
    const { cache, cuantasBajadas, bajar } = armar();
    expect(await cache.traer('a', () => bajar(null))).toBeNull();
    expect(await cache.traer('a', () => bajar('blob:a'))).toBe('blob:a');
    expect(cuantasBajadas()).toBe(2);
  });

  test('una bajada que revienta no envenena la URL: la próxima reintenta', async () => {
    const { cache } = armar();
    await expect(cache.traer('a', () => Promise.reject(new Error('red caída')))).rejects.toThrow();
    expect(await cache.traer('a', () => Promise.resolve('blob:a'))).toBe('blob:a');
  });

  test('limpiar() revoca todo y vacía — el logout no le hereda blobs a la próxima', async () => {
    const { cache, revocados } = armar();
    await cache.traer('a', () => Promise.resolve('blob:a'));
    await cache.traer('b', () => Promise.resolve('blob:b'));
    cache.limpiar();
    expect(revocados.sort()).toEqual(['blob:a', 'blob:b']);
    expect(cache.obtener('a')).toBeNull();
    expect(cache.obtener('b')).toBeNull();
  });
});
