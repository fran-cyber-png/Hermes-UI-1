import { describe, expect, it } from 'vitest';
import { ESTADOS_QUE_PIDEN_VINCULAR, motivoParaVincular, rotuloDeVincular } from './miLinea';

describe('por qué se ofrece vincular', () => {
  it('sin línea propia: el caso de siempre', () => {
    expect(motivoParaVincular(false, undefined)).toBe('sin_linea');
    expect(motivoParaVincular(false, 'conectado')).toBe('sin_linea');
  });

  /**
   * 🔴 EL CASO QUE FALTABA: la línea está registrada y muda. El server lo
   * permite (`numeroPedido`) y el front no lo ofrecía, así que la única salida
   * era `wa:vincular` por SSH.
   */
  it.each([...ESTADOS_QUE_PIDEN_VINCULAR])('con línea propia en «%s» se ofrece re-vincular', (estado) => {
    expect(motivoParaVincular(true, estado)).toBe('linea_muda');
  });

  it('una línea que anda no se toca', () => {
    expect(motivoParaVincular(true, 'conectado')).toBe(null);
  });

  /**
   * 🔴 Un `temporary_ban` se MUESTRA y no se reintenta. Ofrecer «volvé a
   * vincular» ahí es empujar a re-parear durante un ban — el anti-ban que este
   * repo prohíbe por escrito.
   */
  it('baneado NO ofrece vincular', () => {
    expect(motivoParaVincular(true, 'baneado')).toBe(null);
  });

  it('los transitorios tampoco: la línea vuelve sola', () => {
    expect(motivoParaVincular(true, 'conectando')).toBe(null);
    expect(motivoParaVincular(true, 'desconectado')).toBe(null);
  });

  it('sin estado no se ofrece — ante la duda el botón no parpadea', () => {
    expect(motivoParaVincular(true, undefined)).toBe(null);
    expect(motivoParaVincular(true, '')).toBe(null);
  });

  it('un estado que no conocemos no ofrece nada', () => {
    expect(motivoParaVincular(true, 'algo-nuevo')).toBe(null);
  });

  it('las dos acciones se llaman distinto', () => {
    expect(rotuloDeVincular('sin_linea')).toBe('Vincular tu WhatsApp');
    expect(rotuloDeVincular('linea_muda')).toBe('Volver a vincular tu WhatsApp');
  });
});
