import { describe, it, expect } from 'vitest';
import { esCascaraSinElComando } from './cascara';

/**
 * EL DEFECTO REAL QUE ESTO CIERRA (7-ago-2026): al desplegar la vista Navegador
 * por OTA, ninguna cáscara instalada tenía el comando todavía, y tocar un
 * destino daba «Command abrir_navegador not allowed by ACL» — un botón muerto
 * con un mensaje en inglés.
 */
describe('reconocer una cáscara sin el comando', () => {
  it('el mensaje EXACTO que reportó el dueño', () => {
    expect(esCascaraSinElComando('Command abrir_navegador not allowed by ACL')).toBe(true);
  });

  it('las otras formas en que Tauri dice «no tengo ese comando»', () => {
    expect(esCascaraSinElComando('command abrir_navegador not found')).toBe(true);
    expect(esCascaraSinElComando('Unknown command: abrir_navegador')).toBe(true);
    expect(esCascaraSinElComando('command not registered')).toBe(true);
  });

  /**
   * 🔴 EL CASO PELIGROSO, Y EL MOTIVO POR EL QUE ESTE ARCHIVO TIENE TESTS.
   *
   * Si un rechazo de `validar()` se leyera como cáscara vieja, el fallback
   * abriría en Chrome **justo lo que Rust quiso frenar** — y la única guarda del
   * frente (solo `https:`) dejaría de existir en la práctica, sin un síntoma.
   */
  it('un rechazo de Rust NO es una cáscara vieja: se muestra su mensaje y no se abre nada', () => {
    expect(esCascaraSinElComando('solo se abren direcciones https — esta es «file»')).toBe(false);
    expect(esCascaraSinElComando('solo se abren direcciones https — esta es «javascript»')).toBe(false);
    expect(esCascaraSinElComando('la dirección no tiene sitio')).toBe(false);
  });

  it('lo que no es un string no decide nada: sin certeza, no hay fallback', () => {
    expect(esCascaraSinElComando(undefined)).toBe(false);
    expect(esCascaraSinElComando(null)).toBe(false);
    expect(esCascaraSinElComando(new Error('not allowed by ACL'))).toBe(false);
    expect(esCascaraSinElComando({ message: 'not found' })).toBe(false);
  });

  it('no mira mayúsculas: Tauri no promete una redacción estable', () => {
    expect(esCascaraSinElComando('COMMAND ABRIR_NAVEGADOR NOT ALLOWED BY ACL')).toBe(true);
  });
});
