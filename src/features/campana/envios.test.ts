import { describe, expect, test } from 'vitest';
import {
  avisarMuestraChica,
  comparacion,
  conMuestra,
  demora,
  numero,
  porcentaje,
  rango,
  queDibujar,
  respuestas,
  resumen,
  salvedad,
} from './envios';
import type { EnviosDeUnaPlantilla, EnviosPorPlantilla, Medicion } from './plantillas';

const medicion = (exitos: number, n: number): Medicion => ({
  base: 'respondio_despues_de',
  exitos,
  n,
  tasa: n === 0 ? null : exitos / n,
  intervalo: n === 0 ? null : { bajo: 0.02, alto: 0.04 },
  muestraSuficiente: n >= 30,
});

const foro = (over: Partial<EnviosDeUnaPlantilla> = {}): EnviosDeUnaPlantilla => ({
  plantilla: 'foro_estado_5_ago',
  salieron: 1000,
  noSalieron: 4,
  medibles: 1000,
  primerUso: '2026-08-05T15:00:00Z',
  ultimoUso: '2026-08-06T18:00:00Z',
  versiones: 1,
  respondieron: medicion(26, 1000),
  medianaMinutosHastaLaRespuesta: 8,
  ...over,
});

describe('🔴 «no se pudo contar» y «no se mandó nunca» no se dibujan igual', () => {
  const respuesta = (plantillas: EnviosDeUnaPlantilla[]): EnviosPorPlantilla => ({
    dias: 90,
    lineaDeBase: null,
    plantillas,
  });

  test('sin respuesta del server NO se dibuja nada', () => {
    // Un «0 envíos» acá invita a mandar de nuevo una campaña que ya salió a
    // mil personas. Es el mismo cuidado que la ruta tiene del lado del server.
    expect(queDibujar(undefined, 'foro_estado_5_ago')).toEqual({ tipo: 'nada' });
  });

  test('con respuesta y sin la plantilla, es un cero DE VERDAD', () => {
    expect(queDibujar(respuesta([]), 'hello_world')).toEqual({ tipo: 'nunca' });
  });

  test('con la plantilla, devuelve sus números', () => {
    const e = foro();
    expect(queDibujar(respuesta([e]), 'foro_estado_5_ago')).toEqual({ tipo: 'datos', e });
  });

  test('no confunde una plantilla con otra', () => {
    expect(queDibujar(respuesta([foro()]), 'promo_3x1_cursos').tipo).toBe('nunca');
  });
});

describe('el porcentaje no puede decir 0 % de algo que sí pasó', () => {
  test('4 de 1.000 es «<1%», nunca «0%»', () => {
    // «0 %» se lee como «no contestó nadie», y es la diferencia entre tirar la
    // plantilla y repetirla.
    expect(porcentaje(medicion(4, 1000))).toBe('<1%');
  });

  test('0 de 1.000 SÍ es 0 %', () => {
    expect(porcentaje(medicion(0, 1000))).toBe('0%');
  });

  test('sin muestra no hay porcentaje, y no es cero', () => {
    expect(porcentaje(medicion(0, 0))).toBe('—');
  });

  test('26 de 1.000 redondea a 3 %', () => {
    expect(porcentaje(medicion(26, 1000))).toBe('3%');
  });
});

describe('la proporción nunca viaja sin su muestra', () => {
  test('siempre dice cuántos sobre cuántos', () => {
    expect(conMuestra(medicion(26, 1000))).toBe('26 de 1,000 (3%)');
  });

  test('con cero envíos lo dice en vez de inventar un número', () => {
    expect(conMuestra(medicion(0, 0))).toBe('sin envíos que medir');
  });
});

describe('el resumen', () => {
  test('separa lo que salió de lo que no', () => {
    // Los que no salieron NUNCA se suman: son mensajes que nadie recibió, y
    // meterlos adentro del total convertiría un fracaso de entrega en alcance.
    const t = resumen(foro());
    expect(t).toContain('1,000 envíos');
    expect(t).toContain('4 no salieron');
  });

  test('sin fallos no menciona los fallos', () => {
    expect(resumen(foro({ noSalieron: 0 }))).not.toContain('no salieron');
  });

  test('un solo envío se dice en singular', () => {
    expect(resumen(foro({ salieron: 1, medibles: 1, noSalieron: 0 }))).toContain('1 envío ');
  });

  test('un solo día no se escribe como un rango', () => {
    const unDia = '2026-08-05T15:00:00Z';
    expect(rango(unDia, '2026-08-05T23:00:00Z')).not.toContain('–');
    expect(rango(unDia, '2026-08-06T18:00:00Z')).toContain('–');
  });
});

describe('las respuestas', () => {
  test('el nombre no promete causa', () => {
    // La misma regla que `resultados/medicion.ts` fija con un test del lado del
    // server: contestar DESPUÉS de un mensaje no prueba que se haya contestado
    // POR el mensaje.
    const t = respuestas(foro());
    expect(t).toContain('contestaron después');
    for (const palabra of ['efectiv', 'funcion', 'gracias a', 'logró', 'generó']) {
      expect(t.toLowerCase()).not.toContain(palabra);
    }
  });

  test('lleva la mediana cuando alguien contestó', () => {
    expect(respuestas(foro())).toContain('8 min');
  });

  test('sin nadie que haya contestado, no inventa una demora', () => {
    const t = respuestas(foro({ respondieron: medicion(0, 1000), medianaMinutosHastaLaRespuesta: null }));
    expect(t).not.toContain('la mitad contestó');
  });

  test('si no salió ninguno lo dice, en vez de medir cero sobre cero', () => {
    expect(respuestas(foro({ salieron: 0, medibles: 0, respondieron: medicion(0, 0) }))).toContain('no hay nada que medir');
  });
});

describe('la demora elige la unidad por el tamaño', () => {
  test.each([
    [8, '8 min'],
    [59, '59 min'],
    [120, '2 h'],
    [60 * 24 * 3, '3 días'],
    [60 * 24, '1 día'],
  ])('%i minutos → %s', (minutos, esperado) => {
    expect(demora(minutos)).toBe(esperado);
  });
});

describe('el aviso de muestra chica', () => {
  test('avisa cuando el número no alcanza para decidir', () => {
    expect(avisarMuestraChica(foro({ salieron: 5, medibles: 5, respondieron: medicion(1, 5) }))).toBe(true);
  });

  test('con mil envíos no molesta', () => {
    expect(avisarMuestraChica(foro())).toBe(false);
  });

  test('con cero envíos no avisa: ya se dijo que no salió ninguno', () => {
    expect(avisarMuestraChica(foro({ salieron: 0, medibles: 0, respondieron: medicion(0, 0) }))).toBe(false);
  });
});

describe('la comparación con la línea de base', () => {
  test('pone los dos números al lado SIN decir cuál gana', () => {
    // Afirmar que una le gana a la otra necesita que los intervalos no se
    // toquen (`leGanaClaramente`, en el server). Un «esta es mejor» calculado
    // de a ojo en el navegador es justo lo que el módulo de medición existe
    // para no dejar sacar.
    const t = comparacion({ envios: 471, respondieron: medicion(76, 471) })!;
    expect(t).toContain('76 de 471');
    for (const palabra of ['mejor', 'peor', 'gana', 'supera']) {
      expect(t.toLowerCase()).not.toContain(palabra);
    }
  });

  test('sin línea de base no se dibuja nada — «no hay con qué comparar» no es 0 %', () => {
    expect(comparacion(null)).toBe(null);
    expect(comparacion({ envios: 0, respondieron: medicion(0, 0) })).toBe(null);
  });
});

describe('🔴 «salieron» y «se pueden medir» son dos números', () => {
  // Medido en producción: los 89 envíos de `promo_3x1_cursos` salieron con
  // `referencia = 'campana:…'` y no con una clave de conversación, así que el
  // lazo de resultados no los ve. Sin esto la tarjeta decía «88 envíos» arriba
  // y «contestaron 0 de 0» abajo — que juntos se leen como «no contestó nadie».
  const promo = foro({
    plantilla: 'promo_3x1_cursos',
    salieron: 88,
    noSalieron: 1,
    medibles: 0,
    respondieron: medicion(0, 0),
    medianaMinutosHastaLaRespuesta: null,
  });

  test('el resumen cuenta lo que SALIÓ, aunque no se pueda medir', () => {
    expect(resumen(promo)).toContain('88 envíos');
  });

  test('no dibuja «0 de 0»: dice que no se puede saber', () => {
    const t = respuestas(promo);
    expect(t).toBe('no se puede saber si contestaron');
    expect(t).not.toContain('0 de 0');
  });

  test('y la salvedad explica POR QUÉ', () => {
    expect(salvedad(promo)).toContain('no quedaron atados a una conversación');
  });

  test('cuando se pudo medir una parte, dice cuál', () => {
    expect(salvedad(foro({ salieron: 1000, medibles: 400 }))).toBe(
      'se pudo mirar la respuesta de 400 de los 1,000',
    );
  });

  test('cuando los dos números coinciden no aclara nada', () => {
    expect(salvedad(foro())).toBe(null);
  });

  test('sin nada medible tampoco avisa «muestra chica»', () => {
    // Sería un aviso sobre un porcentaje que no existe.
    expect(avisarMuestraChica(promo)).toBe(false);
  });
});

describe('el formato del número', () => {
  // ⚠️ En es-PE el separador de miles es la COMA (1,004), no el punto: Perú usa
  // el punto para los decimales. El resto de la pantalla de campañas ya formatea
  // así (`PantallaListas`), y mezclar las dos convenciones en la misma vista es
  // cómo un número se lee mal de un vistazo.
  test('lleva separador de miles, el de Perú', () => {
    expect(numero(1004)).toBe('1,004');
  });
});
