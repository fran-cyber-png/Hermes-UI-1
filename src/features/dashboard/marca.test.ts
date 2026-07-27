import { describe, expect, test } from 'vitest';
import { marcaDeFila } from './marca';

/**
 * Lo que se fija acá es COMPORTAMIENTO OBSERVABLE: dado el estado de la Ventana,
 * qué le dice la fila a la vendedora. Nada sobre cómo está escrita la función por
 * dentro ni sobre clases de CSS — el color se prueba mirando la pantalla, no acá.
 */
describe('marcaDeFila — la Ventana de Meta (#22)', () => {
  test('con la ventana abierta, cuenta los días que QUEDAN', () => {
    expect(marcaDeFila({ ventana_dias: 3 })).toEqual({
      texto: 'quedan 3 días para escribirle',
      tono: 'oro',
    });
  });

  test('el último día habla en singular — es el aviso que más se lee', () => {
    expect(marcaDeFila({ ventana_dias: 1 })).toEqual({
      texto: 'queda 1 día para escribirle',
      tono: 'oro',
    });
  });

  test('en oro solo mientras se pueda hacer algo: se acaba, todavía no se acabó', () => {
    // El oro significa «tiempo que se acaba» (CLAUDE.md) y esta es la única fila
    // del radar donde eso es literal. Si el oro también marcara lo ya perdido, la
    // vendedora aprendería a ignorarlo — que es cómo muere una señal.
    expect(marcaDeFila({ ventana_dias: 2 })?.tono).toBe('oro');
    expect(marcaDeFila({ ventana_dias: 0 })?.tono).toBe('apagado');
  });

  test('con la ventana cerrada lo dice, en vez de callarse', () => {
    // Callarse sería peor que avisar tarde: la vendedora vería un comentario sin
    // entender por qué no puede escribirle en privado.
    expect(marcaDeFila({ ventana_dias: 0 })).toEqual({
      texto: 'se cerró la ventana',
      tono: 'apagado',
    });
  });

  test('sin ventana no inventa un plazo: WhatsApp no muestra NADA', () => {
    // `null` es «no aplica» y `0` es «se te pasó». Colapsarlos le pondría una
    // cuenta regresiva a todos los chats, donde no hay ninguna puerta que cerrar
    // (CONTEXT.md §Ventana) — y el radar es casi todo WhatsApp.
    expect(marcaDeFila({ ventana_dias: null })).toBeNull();
  });
});
