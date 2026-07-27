import { describe, expect, test } from 'vitest';
import { marcaDeFila } from './marca';

/**
 * Lo que se fija acá es COMPORTAMIENTO OBSERVABLE: dado el estado de una fila,
 * qué le dice al vendedor. Nada sobre cómo está escrita la función por dentro ni
 * sobre clases de CSS — el color se prueba mirando la pantalla, no acá.
 *
 * Los niveles son los de `cola/urgencia.ts`: 0 vivo · 1 vencido · 2 expira ·
 * 3 espera · 4 silencio · 5 archivo.
 */

describe('marcaDeFila — la Ventana de Meta (#22)', () => {
  test('con la ventana abierta, cuenta los días que QUEDAN', () => {
    expect(marcaDeFila({ nivel: 2, ventana_dias: 3 })).toEqual({
      texto: 'quedan 3 días para escribirle',
      tono: 'urgente',
    });
  });

  test('el último día habla en singular — es el aviso que más se lee', () => {
    expect(marcaDeFila({ nivel: 2, ventana_dias: 1 })).toEqual({
      texto: 'queda 1 día para escribirle',
      tono: 'urgente',
    });
  });

  test('en oro solo mientras se pueda hacer algo: se acaba, todavía no se acabó', () => {
    // El oro significa «tiempo que se acaba» (CLAUDE.md) y es la única fila del
    // radar donde eso es literal. Si el oro también marcara lo ya perdido, la
    // vendedora aprendería a ignorarlo — que es cómo muere una señal.
    expect(marcaDeFila({ nivel: 2, ventana_dias: 2 })?.tono).toBe('urgente');
    expect(marcaDeFila({ nivel: 5, ventana_dias: 0 })?.tono).toBe('neutro');
  });

  test('con la ventana cerrada lo dice, en vez de callarse', () => {
    expect(marcaDeFila({ nivel: 5, ventana_dias: 0 })).toEqual({
      texto: 'se cerró la ventana',
      tono: 'neutro',
    });
  });

  test('sin ventana no inventa un plazo: WhatsApp no muestra NADA', () => {
    // `null` es «no aplica» y `0` es «se te pasó». Colapsarlos le pondría una
    // cuenta regresiva a todos los chats, donde no hay ninguna puerta que cerrar
    // (CONTEXT.md §Ventana) — y el radar es casi todo WhatsApp.
    expect(marcaDeFila({ nivel: 3, ventana_dias: null })).toBeNull();
  });
});

describe('marcaDeFila — el Vencido (#23)', () => {
  test('dice DE QUÉ se trata el compromiso, no solo que existe', () => {
    // El ticket entero: «vencido» a secas no le dice a la vendedora qué hacer.
    expect(marcaDeFila({ nivel: 1, ventana_dias: null, seguimiento_nota: 'mandarle el temario' })).toEqual({
      texto: 'vencido · mandarle el temario',
      tono: 'perdido',
    });
  });

  test('rojo, no oro: el oro es lo que se acaba y esto YA se acabó', () => {
    const vencido = marcaDeFila({ nivel: 1, ventana_dias: null, seguimiento_nota: 'llamar' });
    const seAcaba = marcaDeFila({ nivel: 2, ventana_dias: 1 });
    expect(vencido?.tono).toBe('perdido');
    expect(seAcaba?.tono).toBe('urgente');
    expect(vencido?.tono).not.toBe(seAcaba?.tono);
  });

  test('sin nota avisa igual — callarse sería peor que decir poco', () => {
    expect(marcaDeFila({ nivel: 1, ventana_dias: null, seguimiento_nota: null })).toEqual({
      texto: 'vencido',
      tono: 'perdido',
    });
    // Una nota en blanco es lo mismo que no tenerla.
    expect(marcaDeFila({ nivel: 1, ventana_dias: null, seguimiento_nota: '   ' })?.texto).toBe('vencido');
  });

  test('una nota larga se recorta: la marca no le come el renglón a la fila', () => {
    const larga = 'mandarle el temario completo del diplomado y confirmar si quiere la cuota en dos partes';
    const marca = marcaDeFila({ nivel: 1, ventana_dias: null, seguimiento_nota: larga });
    expect(marca!.texto.startsWith('vencido · mandarle el temario')).toBe(true);
    expect(marca!.texto.endsWith('…')).toBe(true);
    expect(marca!.texto.length).toBeLessThan(60);
  });

  test('los saltos de línea de la nota no rompen el renglón', () => {
    // La nota se escribe en un textarea de la Agenda: puede traer saltos.
    expect(marcaDeFila({ nivel: 1, ventana_dias: null, seguimiento_nota: 'llamar\n  a las 3' })?.texto).toBe(
      'vencido · llamar a las 3',
    );
  });

  test('el VENCIDO le gana a la Ventana, porque así los ordenó el server', () => {
    // Un comentario de FB con la ventana abierta Y un seguimiento vencido: el
    // server lo puso en nivel 1, así que la fila explica el vencido. Si acá se
    // recalculara la precedencia, la marca podría contradecir a la posición.
    expect(marcaDeFila({ nivel: 1, ventana_dias: 4, seguimiento_nota: 'pasarle el link' })).toEqual({
      texto: 'vencido · pasarle el link',
      tono: 'perdido',
    });
  });

  test('un seguimiento futuro no se marca: el nivel es el que manda', () => {
    // La fecha futura la descarta `cola/urgencia.ts` antes de llegar acá; la nota
    // puede venir igual y no tiene que disparar nada.
    expect(marcaDeFila({ nivel: 3, ventana_dias: null, seguimiento_nota: 'llamar mañana' })).toBeNull();
  });
});

describe('marcaDeFila — el Silencio, y el silencio de la marca (#20)', () => {
  test('nivel 4: le contestamos y no volvió — «se enfría»', () => {
    // Es la única de las tres marcas que no se ve de ninguna otra forma en la
    // fila: la temperatura y el «hace X» dicen CUÁNDO pasó algo, no QUIÉN tiene
    // el turno. Sin esto, una que se enfría se lee igual que una recién llegada.
    expect(marcaDeFila({ nivel: 4, ventana_dias: null })).toEqual({ texto: 'se enfría', tono: 'neutro' });
  });

  test('en neutro: es seguimiento, no una cuenta regresiva', () => {
    // Ni oro (no hay plazo corriendo) ni rojo (no se perdió nada todavía).
    expect(marcaDeFila({ nivel: 4, ventana_dias: null })?.tono).toBe('neutro');
  });

  test('VIVO y ESPERA no llevan marca — y eso es la decisión, no un olvido', () => {
    // Una marca en TODAS las filas no distingue ninguna: es el defecto que #16
    // vino a arreglar. La temperatura y el «hace X» ya cuentan estos dos.
    expect(marcaDeFila({ nivel: 0, ventana_dias: null })).toBeNull();
    expect(marcaDeFila({ nivel: 3, ventana_dias: null })).toBeNull();
  });

  test('el silencio NO le gana a la ventana de un comentario', () => {
    // Un comentario respondido con la ventana todavía abierta: lo que le importa
    // a la vendedora es que la puerta se cierra, no que la persona no volvió.
    // El nivel lo decide el server; acá solo se comprueba que no se adelanta.
    expect(marcaDeFila({ nivel: 2, ventana_dias: 3 })?.texto).toBe('quedan 3 días para escribirle');
  });
});
