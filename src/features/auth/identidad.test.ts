import { describe, expect, it } from 'vitest';
import { PREFIJO_CENTURION, esIdentidadDeCenturion, tieneSesionDeCerberus } from './identidad';

/**
 * De qué sistema viene quien está adentro. Es una pregunta de una línea y decide
 * si la barra le promete —o no— una sesión de Cerberus que no puede existir.
 */
describe('identidad — quién puede tener sesión de Cerberus', () => {
  it('una vendedora de Cerberus la tiene', () => {
    expect(tieneSesionDeCerberus('luz')).toBe(true);
    expect(tieneSesionDeCerberus('ventas10@grupogoberna.com')).toBe(true);
    expect(esIdentidadDeCenturion('luz')).toBe(false);
  });

  it('🔴 una identidad de Centurión NO la tiene, y nunca la va a tener', () => {
    expect(tieneSesionDeCerberus(`${PREFIJO_CENTURION}betto.romero`)).toBe(false);
    expect(esIdentidadDeCenturion(`${PREFIJO_CENTURION}betto.romero`)).toBe(true);
  });

  it('el prefijo se mira al PRINCIPIO: un usuario que lo lleva adentro sigue siendo de Cerberus', () => {
    // Un `vendedora_id` de Cerberus con la palabra adentro no puede quedar sin
    // su aviso: el prefijo es namespacing del server, no una subcadena.
    expect(tieneSesionDeCerberus('walter.centurion:algo')).toBe(true);
    expect(tieneSesionDeCerberus('el-centurion')).toBe(true);
  });
});
