import { describe, expect, it } from 'vitest';
import {
  claseDeMime,
  decidirPegado,
  esAdjuntoAceptado,
  motivoPorTamano,
  nombreFinalDePegado,
  nombreParaPegado,
  pesoLegible,
  TOPE_ADJUNTO_BYTES,
  type ArchivoPegable,
} from './pegarAdjunto';

const archivo = (type: string, size = 1024, name = 'image.png'): ArchivoPegable => ({ name, type, size });

const MB = 1024 * 1024;
/** Los topes de Meta, tal como los publica `GET /api/whatsapp/sesion`. */
const CLOUD_API = { imagen: 5 * MB, video: 16 * MB, audio: 16 * MB, documento: 64 * MB };

describe('decidirPegado', () => {
  it('sin archivos es un pegado de TEXTO: el composer no interviene', () => {
    // El caso más frecuente por lejos. Si esto devolviera «rechazado», pegar
    // una frase copiada mostraría un error rojo en cada ⌘V.
    expect(decidirPegado([])).toEqual({ tipo: 'texto' });
  });

  it('una captura de pantalla entra como adjunto, sin aviso', () => {
    const png = archivo('image/png');
    expect(decidirPegado([png])).toEqual({ tipo: 'adjunto', archivo: png, aviso: null });
  });

  it('video, audio y PDF también: la misma lista que acepta el clip', () => {
    for (const mime of ['video/mp4', 'audio/ogg', 'application/pdf']) {
      expect(decidirPegado([archivo(mime)]).tipo).toBe('adjunto');
    }
  });

  it('lo que WhatsApp no manda se RECHAZA con motivo, no en silencio', () => {
    const r = decidirPegado([archivo('application/zip')]);
    expect(r.tipo).toBe('rechazado');
    if (r.tipo === 'rechazado') expect(r.motivo).toMatch(/imagen, video, audio o PDF/);
  });

  it('con varios archivos va el PRIMERO y lo dice', () => {
    // Callarlo es el defecto que importa: la vendedora cree que mandó las tres.
    const r = decidirPegado([archivo('image/png'), archivo('image/jpeg'), archivo('image/webp')]);
    expect(r.tipo).toBe('adjunto');
    if (r.tipo === 'adjunto') {
      expect(r.archivo.type).toBe('image/png');
      expect(r.aviso).toMatch(/se pegaron 3/);
    }
  });

  it('mezcla de basura y una imagen: gana la imagen', () => {
    const png = archivo('image/png');
    const r = decidirPegado([archivo('text/html'), png]);
    expect(r.tipo).toBe('adjunto');
    if (r.tipo === 'adjunto') expect(r.archivo).toBe(png);
  });

  it('pasado el tope de 64 MB se rechaza diciendo cuánto pesa', () => {
    const r = decidirPegado([archivo('image/png', TOPE_ADJUNTO_BYTES + 1)]);
    expect(r.tipo).toBe('rechazado');
    if (r.tipo === 'rechazado') expect(r.motivo).toMatch(/64 MB/);
  });

  it('justo en el tope todavía entra', () => {
    expect(decidirPegado([archivo('image/png', TOPE_ADJUNTO_BYTES)]).tipo).toBe('adjunto');
  });

  it('🔴 el tope de la LÍNEA gana sobre el techo: el video de 17,9 MB no entra por Cloud API', () => {
    const r = decidirPegado([archivo('video/mp4', Math.round(17.9 * MB))], { limites: CLOUD_API });
    expect(r.tipo).toBe('rechazado');
    if (r.tipo === 'rechazado') expect(r.motivo).toBe('El video pesa 17,9 MB y por esta línea entran hasta 16 MB.');
  });

  it('el MISMO video por una línea whatsmeow sí entra', () => {
    // Los 16 MB son de la Cloud API, no de WhatsApp: aplicárselos a las líneas
    // de las vendedoras rechazaría envíos que hoy salen bien.
    expect(decidirPegado([archivo('video/mp4', Math.round(17.9 * MB))]).tipo).toBe('adjunto');
  });

  it('el tope es POR CLASE: 9 MB de imagen no entran, 9 MB de video sí', () => {
    expect(decidirPegado([archivo('image/png', 9 * MB)], { limites: CLOUD_API }).tipo).toBe('rechazado');
    expect(decidirPegado([archivo('video/mp4', 9 * MB)], { limites: CLOUD_API }).tipo).toBe('adjunto');
  });
});

describe('motivoPorTamano', () => {
  it('sin límites publicados solo aplica el techo — un server viejo no frena de más', () => {
    expect(motivoPorTamano(archivo('video/mp4', 30 * MB))).toBeNull();
    expect(motivoPorTamano(archivo('video/mp4', 30 * MB), {})).toBeNull();
  });

  it('una clase sin tope declarado cae al techo, no a cero', () => {
    // Con `{video: 16MB}` a secas, un `?? 0` haría que NINGUNA imagen entrara.
    expect(motivoPorTamano(archivo('image/png', 9 * MB), { video: 16 * MB })).toBeNull();
  });

  it('el motivo no menciona a Meta ni un código: lo lee una vendedora', () => {
    const motivo = motivoPorTamano(archivo('video/mp4', 30 * MB), CLOUD_API) ?? '';
    for (const feo of ['fbtrace', 'OAuth', '#100', 'Cloud API', 'parameter']) {
      expect(motivo).not.toContain(feo);
    }
  });

  it('claseDeMime: las cuatro clases, y lo desconocido como documento', () => {
    expect(claseDeMime('image/webp')).toBe('imagen');
    expect(claseDeMime('video/quicktime')).toBe('video');
    expect(claseDeMime('audio/ogg')).toBe('audio');
    expect(claseDeMime('application/octet-stream')).toBe('documento');
  });

  it('EN MODO REVISIÓN no se pega nada, y se explica por qué', () => {
    // Aprobar programa un TEXTO en la cola espaciada; esa cola no lleva
    // adjuntos. Aceptarlo mostraría un archivo en el composer que nunca sale.
    const r = decidirPegado([archivo('image/png')], { enRevision: true });
    expect(r.tipo).toBe('rechazado');
    if (r.tipo === 'rechazado') expect(r.motivo).toMatch(/aprobando un texto/);
  });

  it('en modo revisión un pegado de texto sigue siendo texto: se puede editar la sugerencia', () => {
    expect(decidirPegado([], { enRevision: true })).toEqual({ tipo: 'texto' });
  });
});

describe('pesoLegible', () => {
  it('🔴 una captura de pantalla se lee en KB, no como «0.0 MB»', () => {
    // El defecto que se vio en la evidencia: con ⌘V el caso normal pesa menos
    // de 1 MB, y «0.0 MB» se lee como archivo vacío.
    expect(pesoLegible(312 * 1024)).toBe('312 KB');
    expect(pesoLegible(1024)).toBe('1 KB');
  });

  it('lo chiquito en bytes', () => {
    expect(pesoLegible(0)).toBe('0 B');
    expect(pesoLegible(900)).toBe('900 B');
  });

  it('a partir de un mega, en MB con coma decimal', () => {
    // Sin «,0»: al lado de «17,9 MB» esa precisión no existe, y el server
    // escribe la otra mitad de la misma frase — tienen que coincidir.
    expect(pesoLegible(1024 * 1024)).toBe('1 MB');
    expect(pesoLegible(16 * 1024 * 1024)).toBe('16 MB');
    expect(pesoLegible(2.5 * 1024 * 1024)).toBe('2,5 MB');
    expect(pesoLegible(12.5 * 1024 * 1024)).toBe('12,5 MB');
  });

  it('pasados los 100 MB el decimal ya no informa', () => {
    expect(pesoLegible(124.3 * 1024 * 1024)).toBe('124 MB');
  });

  it('un tamaño imposible no dibuja basura', () => {
    expect(pesoLegible(Number.NaN)).toBe('');
    expect(pesoLegible(-1)).toBe('');
  });
});

describe('esAdjuntoAceptado', () => {
  it('acepta las cuatro familias y nada más', () => {
    expect(esAdjuntoAceptado('image/gif')).toBe(true);
    expect(esAdjuntoAceptado('application/pdf')).toBe(true);
    expect(esAdjuntoAceptado('application/vnd.ms-excel')).toBe(false);
    expect(esAdjuntoAceptado('text/plain')).toBe(false);
    expect(esAdjuntoAceptado('')).toBe(false);
  });
});

describe('nombreParaPegado', () => {
  const cuando = new Date(2026, 7, 5, 14, 32);

  it('nombra por fecha y hora, con la extensión del mime', () => {
    expect(nombreParaPegado('image/png', cuando)).toBe('captura-2026-08-05-1432.png');
    expect(nombreParaPegado('image/jpeg', cuando)).toBe('captura-2026-08-05-1432.jpeg');
  });

  it('un mime compuesto se queda con la parte usable', () => {
    expect(nombreParaPegado('image/svg+xml', cuando)).toBe('captura-2026-08-05-1432.svg');
  });

  it('un mime que no sirve como extensión no rompe el nombre', () => {
    // El nombre viaja en la query de `/enviar-media` y termina siendo el
    // archivo en disco: nunca puede salir con barras ni vacío.
    expect(nombreParaPegado('application/octet-stream', cuando)).toBe('captura-2026-08-05-1432.octetstream');
    expect(nombreParaPegado('', cuando)).toBe('captura-2026-08-05-1432.bin');
  });
});

describe('nombreFinalDePegado', () => {
  const cuando = new Date(2026, 7, 5, 14, 32);

  it('la captura del portapapeles (siempre «image.png») se renombra por fecha', () => {
    expect(nombreFinalDePegado(archivo('image/png', 10, 'image.png'), cuando)).toBe(
      'captura-2026-08-05-1432.png',
    );
  });

  it('un archivo sin nombre también', () => {
    expect(nombreFinalDePegado(archivo('image/jpeg', 10, ''), cuando)).toBe('captura-2026-08-05-1432.jpeg');
  });

  it('🔴 un archivo copiado del explorador CONSERVA su nombre', () => {
    // El nombre entra en la versión de la pieza (ADR 0022): en Goberna el
    // precio vive adentro del flyer, y `flyer-agosto` vs `flyer-julio` es la
    // única diferencia entre dos imágenes. Renombrarlo borraría ese dato.
    expect(nombreFinalDePegado(archivo('image/jpeg', 10, 'flyer-agosto-PRECIO-NUEVO.jpg'), cuando)).toBe(
      'flyer-agosto-PRECIO-NUEVO.jpg',
    );
  });

  it('un PDF con nombre propio también se conserva', () => {
    expect(nombreFinalDePegado(archivo('application/pdf', 10, 'temario-2026.pdf'), cuando)).toBe(
      'temario-2026.pdf',
    );
  });
});
