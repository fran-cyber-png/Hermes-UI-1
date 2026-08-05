import { describe, expect, it } from 'vitest';
import {
  ALTURA_MINIMA,
  bytesDe,
  kbpsMinimoPara,
  kbpsQueEntran,
  planDeCompresion,
  type EntradaVideo,
} from './planDeCompresion';

const MB = 1024 * 1024;
const TOPE_VIDEO_CLOUD_API = 16 * MB;

/**
 * EL VIDEO REAL que disparó todo esto — promo del I Foro de Estado, medido con
 * ffprobe el 5-ago-2026. Los números son los del archivo, no inventados:
 * 18.759.519 bytes · 132,97 s · 1080×1920 · H.264 + AAC · 1.128 kbps.
 */
const FORO: EntradaVideo = { bytes: 18_759_519, duracionSeg: 132.97, ladoCorto: 1080 };

describe('el caso real: el video que Meta rechazó', () => {
  it('🔴 se salva SIN bajar de 1080p — le sobraba un 11 %', () => {
    // El reflejo obvio era mandarlo a 720p. Habría tirado la mitad de los
    // píxeles para ahorrar un 11 % que el bitrate solo ya daba.
    const p = planDeCompresion(FORO, TOPE_VIDEO_CLOUD_API);
    expect(p.tipo).toBe('comprimir');
    if (p.tipo !== 'comprimir') return;
    expect(p.ladoCorto).toBe(1080);
    expect(p.bajaResolucion).toBe(false);
  });

  it('el resultado entra en el tope, con margen', () => {
    const p = planDeCompresion(FORO, TOPE_VIDEO_CLOUD_API);
    if (p.tipo !== 'comprimir') throw new Error('debía comprimir');
    expect(p.bytesEstimados).toBeLessThan(TOPE_VIDEO_CLOUD_API);
    // Y no de casualidad: apuntar exacto al tope es lo que hace que un video
    // rebote DESPUÉS de un minuto de espera.
    expect(p.bytesEstimados).toBeLessThan(TOPE_VIDEO_CLOUD_API * 0.95);
  });

  it('el bitrate cae cerca de lo medido con ffmpeg (820 kbps dieron 13,6 MB)', () => {
    const p = planDeCompresion(FORO, TOPE_VIDEO_CLOUD_API);
    if (p.tipo !== 'comprimir') throw new Error('debía comprimir');
    expect(p.videoKbps).toBeGreaterThan(700);
    expect(p.videoKbps).toBeLessThan(1000);
    expect(p.audioKbps).toBe(96);
  });
});

describe('planDeCompresion', () => {
  it('🔴 lo que YA entra no se toca', () => {
    // Reencodear un archivo que entra solo lo empeora: pierde calidad, tarda un
    // minuto y no gana nada.
    expect(planDeCompresion({ ...FORO, bytes: 10 * MB }, TOPE_VIDEO_CLOUD_API).tipo).toBe('entra_como_esta');
    expect(planDeCompresion({ ...FORO, bytes: TOPE_VIDEO_CLOUD_API }, TOPE_VIDEO_CLOUD_API).tipo).toBe(
      'entra_como_esta',
    );
  });

  it('baja la resolución solo cuando el bitrate ya no alcanza', () => {
    // 3:25 en 16 MB → 602 kbps de presupuesto: no da para 1080p digno (700),
    // pero sí para 720p (400). Ahí y solo ahí se resignan píxeles.
    const largo: EntradaVideo = { bytes: 60 * MB, duracionSeg: 205, ladoCorto: 1080 };
    const p = planDeCompresion(largo, TOPE_VIDEO_CLOUD_API);
    expect(p.tipo).toBe('comprimir');
    if (p.tipo !== 'comprimir') return;
    expect(p.ladoCorto).toBe(720);
    expect(p.bajaResolucion).toBe(true);
  });

  it('🔴 el audio cede ANTES que la imagen', () => {
    // 2:38 → 782 kbps. Con 96 de audio quedan 686 de video, apenas debajo del
    // mínimo de 1080p (700); con 64 quedan 718 y entra. Bajar la imagen a 720p
    // para salvar 32 kbps de audio sería cambiar lo que se ve por lo que no se
    // nota.
    const ajustado: EntradaVideo = { bytes: 40 * MB, duracionSeg: 158, ladoCorto: 1080 };
    const p = planDeCompresion(ajustado, TOPE_VIDEO_CLOUD_API);
    if (p.tipo !== 'comprimir') throw new Error('debía comprimir');
    expect(p.audioKbps).toBe(64);
    expect(p.ladoCorto).toBe(1080);
    expect(p.bajaResolucion).toBe(false);
    expect(p.videoKbps).toBeGreaterThanOrEqual(kbpsMinimoPara(1080));
  });

  it('10 minutos en 16 MB no entran: son 206 kbps, basura en cualquier resolución', () => {
    const p = planDeCompresion({ bytes: 80 * MB, duracionSeg: 600, ladoCorto: 1080 }, TOPE_VIDEO_CLOUD_API);
    expect(p.tipo).toBe('imposible');
  });

  it('🔴 nunca devuelve un plan que produzca algo ilegible', () => {
    // La propiedad que importa: cualquier plan respeta el mínimo de SU
    // resolución. Un 1080p a 200 kbps entra y es basura — y lo que llega del
    // otro lado lo ve un lead.
    const casos: EntradaVideo[] = [
      FORO,
      { bytes: 60 * MB, duracionSeg: 300, ladoCorto: 1080 },
      { bytes: 200 * MB, duracionSeg: 400, ladoCorto: 2160 },
      { bytes: 30 * MB, duracionSeg: 90, ladoCorto: 720 },
      { bytes: 25 * MB, duracionSeg: 45, ladoCorto: 480 },
    ];
    for (const c of casos) {
      const p = planDeCompresion(c, TOPE_VIDEO_CLOUD_API);
      if (p.tipo !== 'comprimir') continue;
      expect(p.videoKbps).toBeGreaterThanOrEqual(kbpsMinimoPara(p.ladoCorto));
      expect(p.ladoCorto).toBeGreaterThanOrEqual(ALTURA_MINIMA);
      expect(p.bytesEstimados).toBeLessThanOrEqual(TOPE_VIDEO_CLOUD_API);
    }
  });

  it('un video imposible lo DICE, con qué hacer', () => {
    // Media hora en 16 MB no existe. Decir «comprimiendo…» un minuto para
    // devolver basura es peor que decir que no.
    const p = planDeCompresion({ bytes: 500 * MB, duracionSeg: 1800, ladoCorto: 1080 }, TOPE_VIDEO_CLOUD_API);
    expect(p.tipo).toBe('imposible');
    if (p.tipo !== 'imposible') return;
    expect(p.motivo).toMatch(/30 minutos/);
    expect(p.motivo).toMatch(/[Rr]ecorta/);
  });

  it('🔴 sin duración legible no se inventa un bitrate', () => {
    // El `<video>` puede dar `NaN` o `Infinity` en un archivo dañado. Cualquier
    // número que saliéramos a usar ahí sería inventado.
    for (const d of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const p = planDeCompresion({ ...FORO, duracionSeg: d }, TOPE_VIDEO_CLOUD_API);
      expect(p.tipo).toBe('imposible');
      if (p.tipo === 'imposible') expect(p.motivo).toMatch(/duración/);
    }
  });

  it('sirve para cualquier tope, no solo el de Meta', () => {
    // Las líneas whatsmeow tienen 64 MB. La regla no puede tener 16 adentro.
    const p = planDeCompresion({ ...FORO, bytes: 90 * MB }, 64 * MB);
    expect(p.tipo).toBe('comprimir');
    if (p.tipo !== 'comprimir') return;
    expect(p.bytesEstimados).toBeLessThan(64 * MB);
    expect(p.ladoCorto).toBe(1080);
  });
});

describe('la aritmética', () => {
  it('kbpsQueEntran y bytesDe son inversas', () => {
    const kbps = kbpsQueEntran(16 * MB, 133);
    expect(bytesDe(kbps, 133)).toBeCloseTo(16 * MB, -2);
  });

  it('una duración de cero no divide por cero', () => {
    expect(kbpsQueEntran(10 * MB, 0)).toBe(0);
  });

  it('kbpsMinimoPara nunca devuelve cero, ni para una resolución minúscula', () => {
    expect(kbpsMinimoPara(1080)).toBe(700);
    expect(kbpsMinimoPara(720)).toBe(400);
    expect(kbpsMinimoPara(240)).toBeGreaterThan(0);
    expect(kbpsMinimoPara(2160)).toBe(700);
  });
});
