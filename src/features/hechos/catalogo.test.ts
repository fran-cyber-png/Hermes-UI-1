import { describe, expect, it } from 'vitest';
import { MOMENTOS, PORQUE_DEL_MOMENTO, type MomentoDeVenta } from './hechos';
import { claveSugerida, enCuantosMomentosSeVe } from './catalogo';

/**
 * LA CLAVE ES LA IDENTIDAD, Y ROMPERLA ROMPE EL LAZO DE RESULTADOS.
 *
 * `hecho:<clave>` es lo que se estampa en `envios_wa` cuando la vendedora manda
 * una de estas frases (ADR 0022). Si la pantalla produjera una clave que el
 * server rechaza —o peor, una distinta a la que después se usa para editar—, el
 * join de resultados daría cero filas en silencio, que se lee como «esa pieza
 * no se usó nunca».
 *
 * El server exige `^[a-z0-9-]+$`, entre 2 y 40 (`server/src/routes/hechos.ts`).
 */
describe('la clave que se sugiere desde el rótulo', () => {
  const VALIDA = /^[a-z0-9-]+$/;

  it('saca las tildes en vez de dejarlas pasar a un 400', () => {
    expect(claveSugerida('Acceso por un año')).toBe('acceso-por-un-ano');
    expect(claveSugerida('Quién certifica')).toBe('quien-certifica');
  });

  it('cumple el patrón del server para cualquier rótulo escribible', () => {
    for (const rotulo of [
      'Cuotas',
      '¿Se puede pagar en 2 cuotas?',
      'Precio · México',
      'ACCESO   un   año',
      'Ñandú 100% válido',
      '  espacios  al  borde  ',
    ]) {
      const clave = claveSugerida(rotulo);
      expect(clave, `rótulo «${rotulo}»`).toMatch(VALIDA);
      expect(clave.length).toBeLessThanOrEqual(40);
    }
  });

  it('no deja guiones colgando en las puntas', () => {
    expect(claveSugerida('  ¡Cuotas!  ')).toBe('cuotas');
    expect(claveSugerida('---raro---')).toBe('raro');
  });

  it('un rótulo sin nada aprovechable da cadena vacía, y el formulario lo frena', () => {
    // Vale devolver '' — lo que NO vale es devolver algo que el server rechaza.
    expect(claveSugerida('¿¿¿???')).toBe('');
    expect(claveSugerida('')).toBe('');
  });

  it('el tope de 40 se respeta aunque el rótulo sea largo', () => {
    expect(claveSugerida('a'.repeat(80)).length).toBe(40);
  });
});

/**
 * «SE VE EN N MOMENTOS» SE CUENTA SOBRE EL RECORTE REAL, NO SOBRE `momentos`.
 *
 * Es toda la razón de ser de la pantalla: un dato puede valer para los seis
 * momentos y no verse en ninguno, porque otros tres le ganan por `orden`. Ese
 * es el caso medido en producción (las frases de precio con `orden = 100`), y
 * contarlo desde `momentos` lo taparía justo.
 */
describe('en cuántos momentos se ve un dato', () => {
  const vacia = Object.fromEntries(MOMENTOS.map((m) => [m, [] as string[]])) as unknown as Record<
    MomentoDeVenta,
    string[]
  >;

  it('cuenta las apariciones en la vista previa del server', () => {
    const previa = { ...vacia, cotizada: ['cuotas'], enfriada: ['cuotas'] };
    expect(enCuantosMomentosSeVe('cuotas', previa)).toBe(2);
  });

  it('el dato que vale para todos pero pierde por orden da CERO', () => {
    // Vale para los seis (`momentos: []`) y aun así no aparece en ninguno.
    expect(enCuantosMomentosSeVe('precio-peru', vacia)).toBe(0);
  });

  /**
   * `null` («no se sabe») y CERO («no se ve») no son lo mismo, y confundirlos
   * hace exactamente el daño que la pantalla quiere evitar: mientras el front
   * nuevo corre contra un server que todavía no se desplegó (N4 va solo, N5 es
   * un botón), `vistaPrevia` no viene — y devolver 0 pintaría TODO el catálogo
   * con la alarma «no se ve» sin tener con qué afirmarlo.
   */
  it('sin vista previa dice «no sé», no «no se ve»', () => {
    expect(enCuantosMomentosSeVe('cuotas', undefined)).toBeNull();
    expect(enCuantosMomentosSeVe('cuotas', undefined)).not.toBe(0);
  });
});

/**
 * La lista de momentos se DERIVA del `Record`, que no compila si falta uno.
 * Si alguien la volviera a escribir a mano, este test es lo que lo delata.
 */
describe('la lista de momentos', () => {
  it('tiene exactamente las claves del Record de descripciones', () => {
    expect(MOMENTOS).toEqual(Object.keys(PORQUE_DEL_MOMENTO));
  });

  it('cada uno viaja con una descripción usable, no con su slug', () => {
    for (const m of MOMENTOS) {
      expect(PORQUE_DEL_MOMENTO[m].length, `«${m}» sin descripción`).toBeGreaterThan(10);
      expect(PORQUE_DEL_MOMENTO[m]).not.toBe(m);
    }
  });
});
