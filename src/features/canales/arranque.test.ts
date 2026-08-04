import { describe, it, expect } from 'vitest';
import { arranqueDeLaCola } from './arranque';
import { LINEA_MIAS } from './cola';

/**
 * DÓNDE ABRE LA COLA LA PRIMERA VEZ.
 *
 * Lo que estos tests protegen son las dos formas de arruinarlo: abrirle la cola
 * de las otras cuatro líneas el día uno, y abrirle una cola VACÍA — que se lee
 * como «se rompió algo», no como «todavía no te tocó ninguna».
 */

describe('arranqueDeLaCola', () => {
  it('con leads asignados abre en «Míos»: la línea ya no separa a nadie', () => {
    // Cinco personas en una línea: «su línea» son las mismas 93 conversaciones
    // para las cinco. Lo que las separa es el reparto.
    expect(arranqueDeLaCola({ yaEligio: false, asignadas: 14, tieneLineasPropias: true })).toEqual({
      mios: true,
      linea: '',
    });
  });

  /**
   * EL CASO DEL DÍA UNO, y el que justifica que haya dos escalones y no uno.
   * Una vendedora que arranca hoy tiene cero asignadas: abrirle «Míos» sería
   * abrirle una cola en blanco.
   */
  it('sin asignadas todavía, cae a SU LÍNEA — nunca a una cola vacía', () => {
    expect(arranqueDeLaCola({ yaEligio: false, asignadas: 0, tieneLineasPropias: true })).toEqual({
      mios: false,
      linea: LINEA_MIAS,
    });
  });

  it('sin asignadas y sin líneas propias no toca nada: «Todas» es lo correcto', () => {
    expect(arranqueDeLaCola({ yaEligio: false, asignadas: 0, tieneLineasPropias: false })).toBeNull();
  });

  /**
   * MANDA LA PERSONA. Un default que se reimpone es un default que pisa: si eligió
   * «Todas» a propósito, mañana tiene que seguir abriendo en «Todas» aunque el
   * reparto le haya dado veinte.
   */
  it('si ya eligió, no se decide nada — ni siquiera con asignadas nuevas', () => {
    expect(arranqueDeLaCola({ yaEligio: true, asignadas: 20, tieneLineasPropias: true })).toBeNull();
    expect(arranqueDeLaCola({ yaEligio: true, asignadas: 0, tieneLineasPropias: true })).toBeNull();
  });

  /**
   * `null` cuando no hay nada mejor que «Todas» **no es** «ya eligió»: el que
   * llama no debe registrar la elección en ese caso, o gastaría la única
   * oportunidad de ayudarla el día que sí tenga algo (mañana la mapean, o le
   * asignan el primer lead).
   */
  it('«no hay nada mejor» y «ya eligió» se responden igual, y el llamador no debe confundirlos', () => {
    const sinNada = arranqueDeLaCola({ yaEligio: false, asignadas: 0, tieneLineasPropias: false });
    const yaEligio = arranqueDeLaCola({ yaEligio: true, asignadas: 5, tieneLineasPropias: true });
    expect(sinNada).toBeNull();
    expect(yaEligio).toBeNull();
  });
});
