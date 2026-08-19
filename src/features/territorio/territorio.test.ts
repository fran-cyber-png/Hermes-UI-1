import { describe, expect, it } from 'vitest';
import { distritoActual, lecturaDeTerritorio, type RespuestaTerritorio } from './territorio';

const CATALOGO = [
  { id: 1, nombre: 'Ate', zona: null, orden: 0 },
  { id: 2, nombre: 'Comas', zona: 'Lima Norte', orden: 0 },
];

const respuesta = (v: Partial<RespuestaTerritorio> = {}): RespuestaTerritorio => ({
  distritos: CATALOGO,
  conteos: {},
  ...v,
});

/**
 * 🔴 LOS TRES VACÍOS NO SON EL MISMO, y decir el equivocado manda a la operadora
 * a buscar donde no es: «no tenés línea» lo arregla un admin, «no hay distritos»
 * lo arregla quien maneja la campaña con el CLI, y «todavía no le preguntaste»
 * lo arregla ella misma, ahora. Es la misma regla que los ocho códigos de Ivi.
 */
describe('qué se lee en el bloque de territorio', () => {
  it('sin línea asignada lo dice, y no ofrece anotar', () => {
    const r = lecturaDeTerritorio(respuesta({ sinLinea: true, distritos: [] }));
    expect(r.puedeAnotar).toBe(false);
    expect(r.vacio).toContain('línea');
  });

  it('con línea y sin catálogo lo dice DISTINTO', () => {
    const r = lecturaDeTerritorio(respuesta({ sinCatalogo: true, distritos: [] }));
    expect(r.puedeAnotar).toBe(false);
    expect(r.vacio).toContain('distritos');
    // Y que no se confunda con el de arriba: son dos arreglos distintos.
    expect(r.vacio).not.toEqual(
      lecturaDeTerritorio(respuesta({ sinLinea: true, distritos: [] })).vacio,
    );
  });

  it('con catálogo se puede anotar y no se dibuja ningún vacío', () => {
    const r = lecturaDeTerritorio(respuesta());
    expect(r.puedeAnotar).toBe(true);
    expect(r.vacio).toBeNull();
  });

  it('⚠️ mientras carga no ofrece nada Y no afirma que falte algo', () => {
    // Con `undefined` (todavía sin respuesta) un `vacio` haría parpadear «esta
    // campaña no tiene distritos» en cada ficha que se abre.
    const r = lecturaDeTerritorio(undefined);
    expect(r.puedeAnotar).toBe(false);
    expect(r.vacio).toBeNull();
  });

  it('⚠️ un catálogo vacío SIN banderas se trata igual que `sinCatalogo`', () => {
    // Un server viejo puede no mandar la bandera: la lista vacía es el hecho.
    expect(lecturaDeTerritorio(respuesta({ distritos: [] })).puedeAnotar).toBe(false);
  });
});

describe('el distrito de esta conversación', () => {
  it('lo resuelve contra el catálogo', () => {
    expect(distritoActual(respuesta({ actual: { distritoId: 2, anotadoPor: 'x' } }))?.nombre).toBe(
      'Comas',
    );
  });

  it('sin anotar es null', () => {
    expect(distritoActual(respuesta({ actual: null }))).toBeNull();
    expect(distritoActual(respuesta())).toBeNull();
  });

  /**
   * ⚠️ Un distrito APAGADO después de haberlo anotado sale del catálogo pero la
   * fila sigue existiendo. No se le inventa un nombre: mostrar uno que el
   * catálogo ya no reconoce es afirmar algo que nadie puede verificar.
   */
  it('🔴 un id que ya no está en el catálogo no se inventa', () => {
    expect(distritoActual(respuesta({ actual: { distritoId: 99, anotadoPor: 'x' } }))).toBeNull();
  });
});
