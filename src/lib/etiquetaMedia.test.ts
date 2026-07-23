import { describe, expect, it } from 'vitest';
import { etiquetaDeMedia } from './etiquetaMedia';

/**
 * En vez de «(sin texto)», la cola dice QUÉ es: «📷 Foto», «🎤 Audio»… como
 * WhatsApp. El mapa es una sola fuente (cola, hilo, historial).
 */
describe('etiquetaDeMedia', () => {
  it('mapea cada clase a su etiqueta con ícono', () => {
    expect(etiquetaDeMedia('imagen')).toBe('📷 Foto');
    expect(etiquetaDeMedia('video')).toBe('🎬 Video');
    expect(etiquetaDeMedia('audio')).toBe('🎤 Audio');
    expect(etiquetaDeMedia('documento')).toBe('📄 Documento');
    expect(etiquetaDeMedia('sticker')).toBe('🖼️ Sticker');
  });

  it('clase nula, vacía o desconocida → null (el caller decide el fallback)', () => {
    expect(etiquetaDeMedia(null)).toBeNull();
    expect(etiquetaDeMedia(undefined)).toBeNull();
    expect(etiquetaDeMedia('')).toBeNull();
    expect(etiquetaDeMedia('ubicacion')).toBeNull();
  });
});
